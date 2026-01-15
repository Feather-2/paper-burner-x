/**
 * Format a value into a fenced markdown code block.
 */
export function formatCodeBlock(value, { lang = "" } = {}) {
  const content = value == null ? "" : String(value);
  const language = typeof lang === "string" ? lang.trim() : "";
  return `\`\`\`${language}\n${content}\n\`\`\``;
}

