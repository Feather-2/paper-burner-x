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

export default { writeTextFileWithPolicy };

