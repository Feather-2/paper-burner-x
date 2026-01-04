import { computeSha256 } from "../storage/artifact-manager.js";

import { isPlainObject } from "../shared/utils/value-utils.js";
function encodeUtf8Bytes(text) {
  if (typeof text !== "string") return 0;
  try {
    return new TextEncoder().encode(text).byteLength;
  } catch {
    return text.length;
  }
}

function safeJsonStringify(value, space = 2) {
  try {
    return JSON.stringify(value, null, space);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ error: "json_stringify_failed", message: msg });
  }
}

function truncateText(text, maxChars) {
  const s = typeof text === "string" ? text : String(text ?? "");
  const limit = Number.isFinite(Number(maxChars)) ? Math.max(0, Math.floor(Number(maxChars))) : 0;
  if (!limit || s.length <= limit) return { text: s, truncated: false };
  const minKeep = Math.max(0, Math.floor(limit * 0.6));
  const head = s.slice(0, limit);
  const newline = head.lastIndexOf("\n");
  const space = head.lastIndexOf(" ");
  const cut =
    newline >= minKeep
      ? newline
      : space >= minKeep
        ? space
        : limit;
  return { text: s.slice(0, cut) + "\n...(truncated)", truncated: true };
}

function summarizeToolResult(result) {
  if (result === null || result === undefined) return { kind: "null" };
  if (typeof result !== "object") return { kind: typeof result, value: String(result) };

  const out = {};
  if (typeof result.success === "boolean") out.success = result.success;
  if (typeof result.error === "string" && result.error) out.error = result.error;

  const keys = Object.keys(result);
  out.keys = keys.slice(0, 20);
  if (keys.length > 20) out.moreKeys = keys.length - 20;
  return out;
}

/**
 * Persist a potentially large payload into RunStore and return a small reference object for prompts/UI.
 *
 * @param {object} options
 * @param {object} options.runStore RunStore-like (saveArtifact)
 * @param {string} options.runId
 * @param {string} options.type Artifact type (must end with .json for best UX)
 * @param {any} options.data Payload to store (will be JSON-stringified)
 * @param {number} [options.maxInlineChars=8000]
 * @param {number} [options.previewChars=1200]
 * @returns {Promise<{persisted:boolean,inline:any,ref?:object}>}
 */
export async function maybePersistJsonArtifact({
  runStore,
  runId,
  type = "tool_output.json",
  data,
  maxInlineChars = 8000,
  previewChars = 1200,
} = {}) {
  const json = safeJsonStringify(data, 2);
  if (typeof json === "string" && json.length <= maxInlineChars) {
    return { persisted: false, inline: data };
  }

  const preview = truncateText(json, previewChars).text;

  if (!runStore || typeof runStore.saveArtifact !== "function" || !runId) {
    return {
      persisted: false,
      inline: {
        persisted: false,
        truncated: true,
        preview,
        totalChars: typeof json === "string" ? json.length : undefined,
        note: "Result too large to inline; persistence unavailable in this environment.",
      },
    };
  }

  const bytes = encodeUtf8Bytes(json);
  let sha256;
  try {
    sha256 = await computeSha256(json);
  } catch {
    sha256 = undefined;
  }

  const artifactId = await runStore.saveArtifact(runId, type, json, {
    mime: "application/json",
    bytes,
    ...(sha256 ? { sha256 } : {}),
  });

  return {
    persisted: true,
    inline: {
      persisted: true,
      artifactId,
      type,
      bytes,
      ...(sha256 ? { sha256 } : {}),
      preview,
      note: "Full payload persisted. Use get-artifact to retrieve more if needed.",
    },
    ref: { artifactId, type, bytes, sha256 },
  };
}

/**
 * Helper for persisting tool outputs with a consistent envelope.
 */
export async function maybePersistToolOutput({
  runStore,
  runId,
  toolName,
  args,
  iteration,
  result,
  type = "tool_output.json",
  maxInlineChars = 8000,
  previewChars = 1200,
} = {}) {
  const envelope = {
    schemaVersion: "0.1",
    kind: "tool_output",
    tool: String(toolName || ""),
    ts: new Date().toISOString(),
    ...(Number.isFinite(iteration) ? { iteration: Math.floor(iteration) } : {}),
    ...(isPlainObject(args) ? { args } : {}),
    result,
  };

  const stored = await maybePersistJsonArtifact({
    runStore,
    runId,
    type,
    data: envelope,
    maxInlineChars,
    previewChars,
  });

  if (!stored.persisted) {
    return { persisted: false, inline: result };
  }

  const ref = stored.ref || {};
  const artifactId = typeof ref.artifactId === "string" ? ref.artifactId : stored.inline?.artifactId;
  const bytes = typeof ref.bytes === "number" ? ref.bytes : stored.inline?.bytes;
  const sha256 = typeof ref.sha256 === "string" ? ref.sha256 : stored.inline?.sha256;

  return {
    persisted: true,
    inline: {
      tool: envelope.tool,
      summary: summarizeToolResult(result),
      persistedOutput: {
        persisted: true,
        artifactId,
        type,
        ...(typeof bytes === "number" ? { bytes } : {}),
        ...(sha256 ? { sha256 } : {}),
        note: "Full payload persisted. Use get-artifact to retrieve more if needed.",
      },
    },
    ref: stored.ref,
  };
}

export default {
  maybePersistJsonArtifact,
  maybePersistToolOutput,
};
