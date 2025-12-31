import { normalizeVfsPath } from "./path.js";
import { recordVfsCheckpoint } from "./checkpoints.js";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function safeReadText(vfs, path) {
  try {
    if (typeof vfs.readText === "function") return await vfs.readText(path);
    const bytes = await vfs.readFile(path);
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function getEmitFn(stageApi) {
  const emit = stageApi?.emit || stageApi?.eventBus?.emit;
  return typeof emit === "function" ? emit : null;
}

function normalizeEditOperation(edit, index) {
  const op = edit && typeof edit === "object" ? edit : {};
  const oldString = typeof op.old_string === "string" ? op.old_string : typeof op.oldString === "string" ? op.oldString : "";
  const newString = typeof op.new_string === "string" ? op.new_string : typeof op.newString === "string" ? op.newString : "";

  if (!oldString) {
    throw new Error(`multi_edit: edits[${index}].old_string must be a non-empty string`);
  }
  if (oldString === newString) {
    throw new Error(`multi_edit: edits[${index}] old_string equals new_string (no-op)`);
  }

  return { oldString, newString };
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let start = 0;
  while (start <= haystack.length) {
    const idx = haystack.indexOf(needle, start);
    if (idx === -1) break;
    count += 1;
    start = idx + needle.length;
  }
  return count;
}

function detectEditConflicts(editPositions) {
  const conflicts = [];
  const list = Array.isArray(editPositions) ? editPositions : [];

  const ranges = list
    .map((e) => ({ index: e.index, start: e.start, end: e.end }))
    .sort((a, b) => a.start - b.start);

  for (let i = 1; i < ranges.length; i += 1) {
    const prev = ranges[i - 1];
    const cur = ranges[i];
    if (cur.start < prev.end) {
      conflicts.push({
        edit1Index: prev.index,
        edit2Index: cur.index,
        description: `Edits ${prev.index + 1} and ${cur.index + 1} overlap (positions ${prev.start}-${prev.end} and ${cur.start}-${cur.end})`,
      });
    }
  }

  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i];
      const b = list[j];
      if (a.newString.includes(b.oldString)) {
        conflicts.push({
          edit1Index: a.index,
          edit2Index: b.index,
          description: `Edit ${a.index + 1}'s new_string contains Edit ${b.index + 1}'s old_string`,
        });
      }
      if (b.newString.includes(a.oldString)) {
        conflicts.push({
          edit1Index: b.index,
          edit2Index: a.index,
          description: `Edit ${b.index + 1}'s new_string contains Edit ${a.index + 1}'s old_string`,
        });
      }
    }
  }

  return conflicts;
}

function applyEditsByPositions(originalText, editPositions) {
  const list = Array.isArray(editPositions) ? editPositions : [];
  const sorted = list.slice().sort((a, b) => b.start - a.start);
  let out = originalText;
  for (const edit of sorted) {
    out = out.slice(0, edit.start) + edit.newString + out.slice(edit.end);
  }
  return out;
}

export async function writeTextFileWithPolicy({
  vfs,
  path,
  text,
  policy,
  runStore,
  runId,
  stageApi,
  signal,
  checkpoint = true,
} = {}) {
  if (!vfs || typeof vfs.writeText !== "function") throw new Error("writeTextFileWithPolicy: vfs.writeText is required");
  const normalizedPath = normalizeVfsPath(path);
  if (!normalizedPath) throw new Error("writeTextFileWithPolicy: path must be a non-empty VFS path");

  const content = typeof text === "string" ? text : String(text ?? "");

  const approval = policy && typeof policy.authorize === "function"
    ? await policy.authorize(
      {
        type: "vfs.write",
        tool: "vfs.writeText",
        resource: normalizedPath,
        args: { path: normalizedPath, bytes: content.length },
      },
      { signal: signal || stageApi?.signal }
    )
    : { allowed: true };

  if (approval?.allowed === false) {
    const reason = typeof approval.reason === "string" ? approval.reason : "denied";
    throw new Error(`Policy denied: ${reason}`);
  }

  const before = await safeReadText(vfs, normalizedPath);
  await vfs.writeText(normalizedPath, content);

  let checkpointRef = null;
  if (checkpoint && runStore && runId) {
    try {
      const after = content;
      const saved = await recordVfsCheckpoint({
        runStore,
        runId,
        path: normalizedPath,
        before: before ?? "",
        after,
        op: "writeText",
      });
      checkpointRef = { artifactId: saved.artifactId, type: "vfs_checkpoint.json" };
    } catch {
      // ignore checkpoint failures
    }
  }

  const emit = getEmitFn(stageApi);
  emit?.("vfs.write.completed", {
    path: normalizedPath,
    bytes: content.length,
    ...(checkpointRef ? { checkpoint: checkpointRef } : {}),
    ...(approval && isPlainObject(approval) ? { policy: approval } : {}),
  });

  return { ok: true, path: normalizedPath, ...(checkpointRef ? { checkpoint: checkpointRef } : {}) };
}

export async function multiEditTextFileWithPolicy({
  vfs,
  path,
  edits,
  policy,
  runStore,
  runId,
  stageApi,
  signal,
  checkpoint = true,
} = {}) {
  if (!vfs || typeof vfs.writeText !== "function") throw new Error("multiEditTextFileWithPolicy: vfs.writeText is required");
  const normalizedPath = normalizeVfsPath(path);
  if (!normalizedPath) throw new Error("multiEditTextFileWithPolicy: path must be a non-empty VFS path");

  const rawEdits = Array.isArray(edits) ? edits : [];
  if (rawEdits.length === 0) throw new Error("multiEditTextFileWithPolicy: edits must be a non-empty array");

  const before = await safeReadText(vfs, normalizedPath);
  if (before === null) throw new Error(`multiEditTextFileWithPolicy: file not found: ${normalizedPath}`);

  const normalizedEdits = [];
  const seenOld = new Set();
  for (let i = 0; i < rawEdits.length; i += 1) {
    const { oldString, newString } = normalizeEditOperation(rawEdits[i], i);
    if (seenOld.has(oldString)) throw new Error(`multi_edit: duplicate old_string in edits[${i}]`);
    seenOld.add(oldString);
    normalizedEdits.push({ index: i, oldString, newString });
  }

  const positions = [];
  for (const edit of normalizedEdits) {
    const occurrences = countOccurrences(before, edit.oldString);
    if (occurrences === 0) {
      throw new Error(`multi_edit: edits[${edit.index}].old_string not found`);
    }
    if (occurrences > 1) {
      throw new Error(`multi_edit: edits[${edit.index}].old_string found ${occurrences} times (must be unique)`);
    }
    const start = before.indexOf(edit.oldString);
    const end = start + edit.oldString.length;
    positions.push({ ...edit, start, end });
  }

  const conflicts = detectEditConflicts(positions);
  if (conflicts.length > 0) {
    const lines = conflicts.map((c) => `- ${c.description}`).join("\n");
    throw new Error(`multi_edit: detected ${conflicts.length} conflict(s):\n${lines}`);
  }

  const after = applyEditsByPositions(before, positions);
  if (after === before) {
    return { ok: true, path: normalizedPath, noOp: true };
  }

  const approval = policy && typeof policy.authorize === "function"
    ? await policy.authorize(
      {
        type: "vfs.write",
        tool: "vfs.multiEdit",
        resource: normalizedPath,
        args: { path: normalizedPath, edits: normalizedEdits.length, bytes: after.length },
      },
      { signal: signal || stageApi?.signal }
    )
    : { allowed: true };

  if (approval?.allowed === false) {
    const reason = typeof approval.reason === "string" ? approval.reason : "denied";
    throw new Error(`Policy denied: ${reason}`);
  }

  try {
    await vfs.writeText(normalizedPath, after);
  } catch (err) {
    try {
      await vfs.writeText(normalizedPath, before);
    } catch {
      // ignore rollback failures
    }
    throw err;
  }

  let checkpointRef = null;
  if (checkpoint && runStore && runId) {
    try {
      const saved = await recordVfsCheckpoint({
        runStore,
        runId,
        path: normalizedPath,
        before,
        after,
        op: "multi_edit",
      });
      checkpointRef = { artifactId: saved.artifactId, type: "vfs_checkpoint.json" };
    } catch {
      // ignore checkpoint failures
    }
  }

  const emit = getEmitFn(stageApi);
  emit?.("vfs.write.completed", {
    path: normalizedPath,
    bytes: after.length,
    ...(checkpointRef ? { checkpoint: checkpointRef } : {}),
    ...(approval && isPlainObject(approval) ? { policy: approval } : {}),
  });

  return { ok: true, path: normalizedPath, ...(checkpointRef ? { checkpoint: checkpointRef } : {}) };
}

export default { writeTextFileWithPolicy, multiEditTextFileWithPolicy };
