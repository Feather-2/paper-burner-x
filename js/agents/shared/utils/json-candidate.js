/**
 * Shared JSON candidate extraction utilities.
 *
 * Used to pull a parsable JSON substring out of model/tool output that may contain:
 * - DeepSeek-R1 style <think>...</think> blocks
 * - Markdown fenced code blocks
 * - Leading "json:" / "json" prefix
 * - Extra trailing/leading noise around the JSON payload
 */

/**
 * Strip DeepSeek-R1 style <think>...</think> reasoning blocks from output.
 * These blocks contain chain-of-thought reasoning that should not be part of the final output.
 * @param {string} text - The input text potentially containing thinking tags.
 * @returns {string} The text with thinking tags removed.
 */
export function stripThinkingTags(text) {
  const s = String(text || "");
  return s.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function normalizePrefer(prefer) {
  const p = typeof prefer === "string" ? prefer.trim().toLowerCase() : "";
  if (p === "array" || p === "object") return p;
  return "any";
}

/**
 * Extract a JSON candidate substring from noisy text.
 *
 * @param {string} text
 * @param {{prefer?: "any"|"array"|"object"}} [options]
 * @returns {string|null}
 */
export function extractJsonCandidate(text, { prefer = "any" } = {}) {
  let s = stripThinkingTags(text).trim();
  if (!s) return null;

  // Prefer fenced code blocks.
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced && fenced[1]) s = fenced[1].trim();

  // Best-effort: remove raw code fences if present.
  s = s.replace(/^```(?:json)?[\s\n]*/i, "").replace(/[\s\n]*```$/i, "").trim();

  // Some models prefix output with "json:" or "json".
  s = s.replace(/^json\b[:\s]*/i, "").trim();
  if (!s) return null;

  const findBalancedEnd = (startIdx) => {
    const openCh = s[startIdx];
    if (openCh !== "{" && openCh !== "[") return -1;

    const stack = [openCh];
    let inString = false;
    let escape = false;

    for (let i = startIdx + 1; i < s.length; i++) {
      const ch = s[i];

      if (inString) {
        if (escape) {
          escape = false;
          continue;
        }
        if (ch === "\\") {
          escape = true;
          continue;
        }
        if (ch === '"') inString = false;
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === "{" || ch === "[") {
        stack.push(ch);
        continue;
      }

      if (ch === "}" || ch === "]") {
        const top = stack[stack.length - 1];
        const matches = (ch === "}" && top === "{") || (ch === "]" && top === "[");
        if (!matches) continue;

        stack.pop();
        if (!stack.length) return i;
      }
    }

    return -1;
  };

  const idxObject = s.indexOf("{");
  const idxArray = s.indexOf("[");

  const starts = [];
  const mode = normalizePrefer(prefer);
  if (mode === "array") {
    if (idxArray >= 0) starts.push(idxArray);
    if (idxObject >= 0) starts.push(idxObject);
  } else if (mode === "object") {
    if (idxObject >= 0) starts.push(idxObject);
    if (idxArray >= 0) starts.push(idxArray);
  } else {
    starts.push(...[idxObject, idxArray].filter((idx) => idx >= 0).sort((a, b) => a - b));
  }

  for (const startIdx of starts) {
    const endIdx = findBalancedEnd(startIdx);
    if (endIdx < 0) continue;

    const candidate = s.slice(startIdx, endIdx + 1);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch { /* intentional: try next candidate */ }
  }

  return s;
}

export default { stripThinkingTags, extractJsonCandidate };
