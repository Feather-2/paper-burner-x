/**
 * Format a value into a fenced markdown code block.
 *
 * @param {unknown} value - The content to wrap in a code block (converted to string).
 * @param {object} [options] - Formatting options.
 * @param {string} [options.lang=""] - The language identifier for syntax highlighting.
 * @returns {string} A fenced markdown code block with the specified language.
 */
export function formatCodeBlock(value, { lang = "" } = {}) {
  const content = value == null ? "" : String(value);
  const language = typeof lang === "string" ? lang.trim() : "";
  return `\`\`\`${language}\n${content}\n\`\`\``;
}

