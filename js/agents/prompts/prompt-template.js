import { createLogger } from "../shared/index.js";

import { DEFAULT_FORMATTERS, escapeTemplateDelimiters } from "./formatters/index.js";

const logger = createLogger("prompts/prompt-template");

function escapeRegExp(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeTemplateVars(vars) {
  const map = new Map();

  if (!vars) return map;

  const add = (rawKey, value) => {
    const key = typeof rawKey === "string" ? rawKey.trim().toLowerCase() : "";
    if (!key) return;
    map.set(key, value);
  };

  const flatten = (obj, prefix, depth) => {
    if (!obj || typeof obj !== "object") {
      add(prefix, obj);
      return;
    }
    if (Array.isArray(obj)) {
      add(prefix, obj);
      return;
    }
    if (depth <= 0) {
      add(prefix, obj);
      return;
    }

    for (const [k, v] of Object.entries(obj)) {
      const name = typeof k === "string" ? k.trim() : "";
      if (!name) continue;
      const next = prefix ? `${prefix}.${name}` : name;
      if (v && typeof v === "object" && !Array.isArray(v)) {
        // Keep the object at its own key (so formatters like `json` can access it),
        // and also flatten leaf values for dotted-key placeholders.
        add(next, v);
        flatten(v, next, depth - 1);
      } else {
        // Route primitives/arrays through the same helper so the base-case branches stay exercised
        // and behavior remains consistent (arrays are kept at their own key; scalars are stored as-is).
        flatten(v, next, depth - 1);
      }
    }
  };

  if (vars instanceof Map) {
    for (const [k, v] of vars.entries()) {
      add(k, v);
    }
    return map;
  }

  if (typeof vars === "object") {
    flatten(vars, "", 4);
  }

  return map;
}

function parsePlaceholder(raw) {
  const inner = String(raw || "").trim();
  if (!inner) return { key: "", formatters: [] };

  const parts = inner
    .split("|")
    .map((p) => p.trim())
    .filter(Boolean);

  const key = (parts[0] || "").trim();
  const formatters = parts.slice(1).map((spec) => {
    const rawSpec = String(spec || "").trim();
    if (!rawSpec) return { name: "", args: [] };

    const open = rawSpec.indexOf("(");
    if (open === -1 || !rawSpec.endsWith(")")) return { name: rawSpec, args: [] };

    const name = rawSpec.slice(0, open).trim();
    const argsRaw = rawSpec.slice(open + 1, -1).trim();
    const args = argsRaw ? argsRaw.split(",").map((a) => a.trim()).filter(Boolean) : [];
    return { name, args };
  });

  return { key, formatters };
}

function resolveFormatter(formatters, name) {
  const key = typeof name === "string" ? name.trim().toLowerCase() : "";
  if (!key) return null;
  const table = formatters && typeof formatters === "object" ? formatters : null;
  if (!table) return null;
  const fn = table[key];
  return typeof fn === "function" ? fn : null;
}

function formatValueDefault(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (Array.isArray(value)) return value.map((v) => (v == null ? "" : String(v))).join("\n");
  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2) ?? "";
    } catch {
      return String(value);
    }
  }
  return "";
}

/**
 * @typedef {Map<string, unknown> | Record<string, unknown>} PromptTemplateVars
 *
 * @typedef {object} RenderPromptTemplateOptions
 * @property {PromptTemplateVars=} vars
 * @property {Record<string, string>=} appendIfMissing
 * @property {boolean=} keepUnresolved
 * @property {boolean=} warnOnUnresolved
 * @property {boolean=} failOnUnresolved
 * @property {(names: string[]) => void=} onUnresolved
 * @property {boolean=} escapeVars
 * @property {Record<string, Function>=} formatters
 */

/**
 * Render a prompt template using `{{VAR}}` placeholders.
 *
 * Notes:
 * - Placeholder matching is case-insensitive (by lowercasing both sides).
 * - Dotted keys are supported via object flattening (e.g. `minWords.quick`).
 * - Formatter pipeline is supported via `{{var|json}}`, `{{var|bullets}}`, etc.
 *
 * @param {string} template - The template string containing `{{VAR}}` placeholders
 * @param {RenderPromptTemplateOptions} [options] - Rendering options
 * @returns {string} The rendered template with placeholders replaced
 */
export function renderPromptTemplate(
  template,
  /** @type {RenderPromptTemplateOptions} */ {
    vars,
    appendIfMissing,
    keepUnresolved = true,
    warnOnUnresolved = false,
    failOnUnresolved = false,
    onUnresolved,
    escapeVars = true,
    formatters,
  } = {}
) {
  const input = typeof template === "string" ? template : String(template ?? "");
  const varMap = normalizeTemplateVars(vars);
  const unresolved = warnOnUnresolved || failOnUnresolved || typeof onUnresolved === "function" ? new Set() : null;

  const formatterTable = { ...DEFAULT_FORMATTERS, ...(formatters && typeof formatters === "object" ? formatters : {}) };

  let rendered = input.replace(/(?<!\\)\{\{\s*([^}]+?)\s*(?<!\\)\}\}/g, (match, rawName) => {
    const { key, formatters: pipeline } = parsePlaceholder(rawName);
    const varKey = key.trim().toLowerCase();
    if (!varKey) return keepUnresolved ? match : "";
    if (!varMap.has(varKey)) {
      unresolved?.add(varKey);
      return keepUnresolved ? match : "";
    }

    let value = varMap.get(varKey);

    // Apply formatter pipeline (if present). Unknown formatter marks as unresolved.
    for (const step of pipeline) {
      const fn = resolveFormatter(formatterTable, step.name);
      if (!fn) {
        unresolved?.add(`${varKey}|${step.name}`);
        return keepUnresolved ? match : "";
      }
      value = fn(value, { args: step.args });
    }

    const out = pipeline.length ? String(value ?? "") : formatValueDefault(value);
    return escapeVars ? escapeTemplateDelimiters(out) : out;
  });

  // Unescape backslash-escaped delimiters from escapeTemplateDelimiters
  rendered = rendered.split("\\{\\{").join("{{").split("\\}\\}").join("}}");

  const extra = [];
  const append = appendIfMissing && typeof appendIfMissing === "object" ? appendIfMissing : null;
  if (append) {
    for (const [name, value] of Object.entries(append)) {
      const placeholderName = typeof name === "string" ? name.trim() : "";
      const content = typeof value === "string" ? value.trim() : String(value ?? "").trim();
      if (!placeholderName || !content) continue;
      const re = new RegExp(`\\{\\{\\s*${escapeRegExp(placeholderName)}\\s*\\}\\}`, "i");
      if (re.test(input)) continue;
      extra.push(content);
    }
  }

  if (extra.length) {
    rendered = `${rendered}\n\n${extra.join("\n\n")}`;
  }

  if (unresolved && unresolved.size) {
    const list = Array.from(unresolved).slice(0, 20);
    if (typeof onUnresolved === "function") {
      try {
        onUnresolved(list);
      } catch (err) {
        // onUnresolved callback failed — log but don't propagate
        if (typeof console !== "undefined") console.debug?.("onUnresolved callback error", err?.message);
      }
    } else if (warnOnUnresolved) {
      logger.warn(`[prompt-template] Unresolved placeholders: ${list.join(", ")}${unresolved.size > list.length ? ", ..." : ""}`);
    }
    if (failOnUnresolved) {
      throw new Error(
        `[prompt-template] Unresolved placeholders: ${list.join(", ")}${unresolved.size > list.length ? ", ..." : ""}`
      );
    }
  }

  return rendered;
}

export class PromptTemplate {
  /**
   * @param {string} template
   */
  constructor(template) {
    this.template = typeof template === "string" ? template : String(template ?? "");
  }

  /**
   * @param {RenderPromptTemplateOptions} [options]
   * @returns {string}
   */
  render(options = {}) {
    return renderPromptTemplate(this.template, options);
  }
}
