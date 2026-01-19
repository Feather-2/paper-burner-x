import { toNonEmptyString } from "../../../../shared/index.js";

/**
 * get-artifact tool - load persisted outputs from RunStore by artifactId
 *
 * Used to retrieve large tool results stored via persisted-output pipeline.
 */

/**
 * @typedef {object} GetArtifactArgs
 * @property {string} artifactId
 * @property {number=} maxChars
 *
 * @typedef {object} GetArtifactContext
 * @property {{runStore?: {getArtifactRecord?:(artifactId:string)=>Promise<any>}}=} stageApi
 *
 * @typedef {object} GetArtifactSuccess
 * @property {true} success
 * @property {string} artifactId
 * @property {string=} runId
 * @property {string=} type
 * @property {string=} mime
 * @property {number=} bytes
 * @property {string=} sha256
 * @property {boolean} truncated
 * @property {number} totalChars
 * @property {string} data
 *
 * @typedef {object} GetArtifactFailure
 * @property {false} success
 * @property {string} error
 */

function safeInt(value, fallback) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

function toText(data) {
  if (data === null || data === undefined) return "";
  if (typeof data === "string") return data;
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

function truncate(text, maxChars) {
  const s = String(text || "");
  const limit = safeInt(maxChars, 0);
  if (!limit || s.length <= limit) return { text: s, truncated: false, totalChars: s.length };
  return { text: s.slice(0, limit) + "\n...(truncated)", truncated: true, totalChars: s.length };
}

export const definition = {
  name: "get-artifact",
  description: `按 artifactId 读取已持久化的输出（persisted-output）。

当某些工具返回内容过大时，系统会把完整结果写入 RunStore（IndexedDB），并在对话中只保留 preview + artifactId。
使用此工具可按需取回更多内容（建议配合 maxChars 分页/截断）。`,
  layer: 0,
  activation: {
    keywords: ["artifact", "persisted", "load", "retrieve", "读取", "取回"],
    phases: ["researching", "writing"],
  },
  parameters: {
    artifactId: "artifactId（必需）",
    maxChars: "最大返回字符数（默认 4000）",
  },
};

/**
 * @param {GetArtifactArgs} args
 * @param {GetArtifactContext} context
 * @returns {Promise<GetArtifactSuccess|GetArtifactFailure>}
 */
export async function handler(args, context) {
  const artifactId = toNonEmptyString(args?.artifactId);
  const maxChars = safeInt(args?.maxChars, 4000);
  const stageApi = context?.stageApi || {};
  const runStore = stageApi?.runStore;

  if (!artifactId) {
    return { success: false, error: "artifactId is required" };
  }
  if (!runStore || typeof runStore.getArtifactRecord !== "function") {
    return { success: false, error: "runStore.getArtifactRecord is not available in this environment" };
  }

  try {
    const rec = await runStore.getArtifactRecord(artifactId);
    if (!rec) return { success: false, error: `artifact not found: ${artifactId}` };

    const raw = toText(rec.data);
    const clipped = truncate(raw, maxChars);

    return {
      success: true,
      artifactId: rec.artifactId,
      runId: rec.runId,
      type: rec.type,
      mime: rec.mime,
      bytes: rec.bytes,
      sha256: rec.sha256,
      truncated: clipped.truncated,
      totalChars: clipped.totalChars,
      data: clipped.text,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

export default { definition, handler };
