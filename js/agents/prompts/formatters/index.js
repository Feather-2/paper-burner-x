export { escapeTemplateDelimiters } from "./escape-template-delimiters.js";
export { formatBullets } from "./format-bullets.js";
export { formatCodeBlock } from "./format-code-block.js";
export { formatJson } from "./format-json.js";
export { formatLines } from "./format-lines.js";
export { formatTrim } from "./format-trim.js";
export { formatUpper } from "./format-upper.js";

import { formatBullets } from "./format-bullets.js";
import { formatCodeBlock } from "./format-code-block.js";
import { formatJson } from "./format-json.js";
import { formatLines } from "./format-lines.js";
import { formatTrim } from "./format-trim.js";
import { formatUpper } from "./format-upper.js";

/**
 * Built-in prompt template formatters.
 *
 * Formatter signature: (value: unknown, ctx?: { args?: string[] }) => string
 */
export const DEFAULT_FORMATTERS = {
  bullets: (value, ctx) => formatBullets(value, { indent: "", bullet: "- ", ...(ctx?.args?.length ? {} : {}) }),
  code: (value, ctx) => formatCodeBlock(value, { lang: ctx?.args?.[0] || "" }),
  json: (value, ctx) => formatJson(value, { space: ctx?.args?.[0] ? Number(ctx.args[0]) : 2 }),
  lines: (value) => formatLines(value),
  trim: (value) => formatTrim(value),
  upper: (value) => formatUpper(value),
};

