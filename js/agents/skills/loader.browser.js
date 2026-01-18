/**
 * Skill Loader (Browser) - 从静态 manifest 加载 Skills
 *
 * Browser-only 约束：
 * - 无法递归扫描目录（无 fs）
 * - 通过可 fetch 的 manifest.json 描述可用 skills
 *
 * 默认 manifest: public/skills/manifest.json
 */

import { SkillScope } from "./model.js";
import { initUserSkillStore, listUserSkills, getUserSkillBody } from "./user-store.js";
import { isPlainObject, toNonEmptyString } from "../shared/utils/value-utils.js";
import { createResponseTooLargeError, normalizeMaxBytes, readJsonWithLimit, readTextWithLimit } from "../shared/utils/response-limits.js";
import { createLogger } from "../shared/utils/logger.js";

const logger = createLogger("skills/loader.browser");

// Vite serves `public/` at the site root ("/skills/manifest.json").
// Some deployments may still expose it under "/public/skills/manifest.json".
const DEFAULT_MANIFEST_URL = "skills/manifest.json";
const DEFAULT_MANIFEST_URL_FALLBACK = "public/skills/manifest.json";

const DEFAULT_MAX_MANIFEST_BYTES = 512 * 1024; // 512 KiB
const DEFAULT_MAX_SKILL_BYTES = 2 * 1024 * 1024; // 2 MiB

let _manifestCache = null; // { url, data, ts, maxBytes }
const MANIFEST_CACHE_TTL_MS = 30_000;

function normalizeStringArray(value) {
  const arr = Array.isArray(value) ? value : value ? [value] : [];
  return arr.map((v) => String(v || "").trim()).filter(Boolean);
}

function resolveUrl(pathOrUrl) {
  const raw = toNonEmptyString(pathOrUrl);
  if (!raw) return "";
  try {
    return new URL(raw, globalThis.location?.href).toString();
  } catch {
    return raw;
  }
}

async function fetchJson(url, { maxBytes, context } = {}) {
  if (typeof fetch !== "function") throw new Error("fetch is not available in this environment");
  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status}`);
  return await readJsonWithLimit(resp, { maxBytes, context: context || `JSON response: ${url}` });
}

/**
 * 解析 YAML Frontmatter（仅用于 loadSkillFromPath）
 */
function extractFrontmatter(contents) {
  const normalized = String(contents || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  if (lines[0]?.trim() !== "---") return null;

  const frontmatterLines = [];
  let foundClosing = false;

  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      foundClosing = true;
      break;
    }
    frontmatterLines.push(lines[i]);
  }

  if (!foundClosing || frontmatterLines.length === 0) return null;
  return frontmatterLines.join("\n");
}

function parseSimpleYaml(yaml) {
  const result = {};
  const lines = String(yaml || "").split("\n");
  let currentKey = null;
  let currentValue = [];
  let inMultiline = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^(\w+(?:-\w+)*):\s*(.*)$/);

    if (match && !inMultiline) {
      if (currentKey && currentValue.length > 0) {
        result[currentKey] = currentValue.join("\n").trim();
        currentValue = [];
      }

      const key = match[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      let value = match[2].trim();

      if (value === "|-" || value === "|" || value === ">-" || value === ">") {
        currentKey = key;
        inMultiline = true;
        continue;
      }

      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      } else if (value.startsWith("'") && value.endsWith("'")) {
        value = value.slice(1, -1);
      }

      result[key] = value;
      currentKey = null;
      continue;
    }

    if (inMultiline) {
      const trimmed = line.trimStart();
      const indent = line.length - trimmed.length;
      if (trimmed === "" || indent > 0) {
        currentValue.push(trimmed);
        continue;
      }
      if (trimmed !== "" && indent === 0) {
        if (currentKey) {
          result[currentKey] = currentValue.join(" ").trim();
          currentValue = [];
        }
        inMultiline = false;
        i--;
      }
    }
  }

  if (currentKey && currentValue.length > 0) {
    result[currentKey] = currentValue.join(" ").trim();
  }

  return result;
}

function parseSkillMarkdown(contents, filePath, scope) {
  const text = String(contents || "");
  const frontmatter = extractFrontmatter(text);
  if (!frontmatter) {
    throw new Error("missing YAML frontmatter delimited by ---");
  }

  const parsed = parseSimpleYaml(frontmatter);
  const name = toNonEmptyString(parsed.name);
  const description = toNonEmptyString(parsed.description);
  if (!name) throw new Error("missing field `name`");
  if (!description) throw new Error("missing field `description`");

  const keywords = parsed.keywords ? normalizeStringArray(String(parsed.keywords).split(",")) : [];
  const keywordsAll = parsed.keywordsAll ? normalizeStringArray(String(parsed.keywordsAll).split(",")) : [];
  const allowedTools = toNonEmptyString(parsed.allowedTools) || null;

  const tags = {};
  if (parsed.tags) {
    String(parsed.tags)
      .split(",")
      .map((pair) => pair.trim())
      .filter(Boolean)
      .forEach((pair) => {
        const [k, v] = pair.split(":").map((s) => s.trim());
        if (k) tags[k] = v || "";
      });
  }

  const traits = parsed.traits ? normalizeStringArray(String(parsed.traits).split(",")) : [];
  const priority = parsed.priority ? Number.parseInt(String(parsed.priority), 10) : 100;

  const bodyStart = text.indexOf("---", 4);
  const body = bodyStart > 3 ? text.slice(bodyStart + 3).trim() : "";

  return {
    metadata: {
      name,
      description,
      shortDescription: toNonEmptyString(parsed.shortDescription) || null,
      path: filePath,
      scope,
      keywords,
      keywordsAll,
      allowedTools,
      tags: Object.keys(tags).length ? tags : null,
      traits: traits.length ? traits : null,
      priority: Number.isFinite(priority) ? priority : 100,
    },
    body,
  };
}

async function loadManifest(manifestUrl, { maxManifestBytes } = {}) {
  const primary = resolveUrl(manifestUrl || DEFAULT_MANIFEST_URL);
  const fallback = resolveUrl(DEFAULT_MANIFEST_URL_FALLBACK);
  const candidates = [primary, fallback].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);

  const now = Date.now();
  const maxBytes = normalizeMaxBytes(maxManifestBytes, DEFAULT_MAX_MANIFEST_BYTES);
  if (
    _manifestCache &&
    _manifestCache.maxBytes === maxBytes &&
    candidates.includes(_manifestCache.url) &&
    now - _manifestCache.ts < MANIFEST_CACHE_TTL_MS
  ) {
    return _manifestCache.data;
  }

  let lastErr = null;
  for (const url of candidates) {
    try {
      const data = await fetchJson(url, { maxBytes, context: `Skills manifest: ${url}` });
      _manifestCache = { url, data, ts: now, maxBytes };
      return data;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("Failed to load skills manifest");
}

function normalizeSkillFromManifest(entry, { defaultScope = SkillScope.SYSTEM } = {}) {
  const raw = isPlainObject(entry) ? entry : {};
  const name = toNonEmptyString(raw.name);
  const description = toNonEmptyString(raw.description);
  const path = toNonEmptyString(raw.path);

  if (!name || !description || !path) return null;

  /** @type {any} */
  const scopeRaw = toNonEmptyString(raw.scope);
  const scope = scopeRaw && Object.values(SkillScope).includes(scopeRaw) ? scopeRaw : defaultScope;

  const priority = Number.isFinite(Number(raw.priority)) ? Number(raw.priority) : 100;

  return {
    metadata: {
      name,
      description,
      shortDescription: toNonEmptyString(raw.shortDescription) || null,
      path,
      scope,
      keywords: normalizeStringArray(raw.keywords),
      keywordsAll: normalizeStringArray(raw.keywordsAll),
      allowedTools: toNonEmptyString(raw.allowedTools) || null,
      tags: isPlainObject(raw.tags) ? raw.tags : null,
      traits: normalizeStringArray(raw.traits),
      priority,
    },
    body: null, // progressive disclosure: body 仅在 loadSkillFromPath 时加载
  };
}

function normalizeSkillFromUserStore(entry) {
  const raw = isPlainObject(entry) ? entry : {};
  const name = toNonEmptyString(raw.name);
  const description = toNonEmptyString(raw.description);
  if (!name || !description) return null;

  const priority = Number.isFinite(Number(raw.priority)) ? Number(raw.priority) : 100;
  return {
    metadata: {
      name,
      description,
      shortDescription: toNonEmptyString(raw.shortDescription) || null,
      path: `user:${name}`,
      scope: SkillScope.USER,
      keywords: normalizeStringArray(raw.keywords),
      keywordsAll: normalizeStringArray(raw.keywordsAll),
      allowedTools: toNonEmptyString(raw.allowedTools) || null,
      tags: isPlainObject(raw.tags) ? raw.tags : null,
      traits: normalizeStringArray(raw.traits),
      priority,
    },
    body: null,
  };
}

/**
 * 加载所有 Skills（Browser 版本）
 *
 * @param {Object} options
 * @param {string} [options.manifestUrl] - manifest.json URL（默认 public/skills/manifest.json）
 * @returns {Promise<{skills:Array,errors:Array}>}
 */
export async function loadSkills({ manifestUrl, maxManifestBytes } = {}) {
  const outcome = { skills: [], errors: [] };

  let manifest;
  try {
    manifest = await loadManifest(manifestUrl, { maxManifestBytes });
  } catch (err) {
    outcome.errors.push({
      path: toNonEmptyString(manifestUrl) || DEFAULT_MANIFEST_URL,
      message: err instanceof Error ? err.message : String(err),
    });
    return outcome;
  }

  const list = Array.isArray(manifest?.skills) ? manifest.skills : [];
  for (const item of list) {
    const skill = normalizeSkillFromManifest(item);
    if (skill) outcome.skills.push(skill);
  }

  // Merge user-installed skills (localStorage-backed) - allow overriding built-ins by name.
  try {
    await initUserSkillStore();
    const userList = listUserSkills();
    for (const item of userList) {
      const skill = normalizeSkillFromUserStore(item);
      if (skill) outcome.skills.push(skill);
    }
  } catch (err) {
    // Log user skill store errors for diagnostics instead of silently swallowing
    logger.warn("User skill store initialization failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const scopeRank = {
    [SkillScope.USER]: 3,
    [SkillScope.REPO]: 2,
    [SkillScope.SYSTEM]: 1,
    [SkillScope.REMOTE]: 0,
  };

  // 按名称去重（scope 优先级：user > repo > system > remote；再比较 priority）
  const byName = new Map();
  for (const skill of outcome.skills) {
    const n = skill?.metadata?.name;
    if (!n) continue;
    const existing = byName.get(n);
    if (!existing) {
      byName.set(n, skill);
      continue;
    }
    const aRank = scopeRank[skill.metadata.scope] ?? 0;
    const bRank = scopeRank[existing.metadata.scope] ?? 0;
    if (aRank > bRank) {
      byName.set(n, skill);
      continue;
    }
    if (aRank < bRank) continue;

    const aP = Number.isFinite(Number(skill.metadata.priority)) ? Number(skill.metadata.priority) : 100;
    const bP = Number.isFinite(Number(existing.metadata.priority)) ? Number(existing.metadata.priority) : 100;
    if (aP < bP) byName.set(n, skill);
  }

  outcome.skills = Array.from(byName.values()).sort((a, b) => String(a?.metadata?.name || "").localeCompare(String(b?.metadata?.name || "")));

  return outcome;
}

/**
 * Load skills from a Nexus remote provider.
 *
 * @param {Object} nexusProvider - Nexus provider instance with isAvailable/listSkills/getSkillContent methods
 * @param {() => Promise<boolean>} nexusProvider.isAvailable - Check if Nexus is available
 * @param {() => Promise<Array<{ name: string, description: string, allowedTools?: string[], priority?: number }>>} nexusProvider.listSkills - List available skills
 * @param {(name: string) => Promise<{ body: string, supportFiles?: Record<string, string> }>} nexusProvider.getSkillContent - Get skill content by name
 * @returns {Promise<{ skills: Array<{ metadata: Object, body: string | null, supportFiles?: Record<string, string> }>, errors: Array<{ path: string, message: string }> }>}
 */
export async function loadSkillsFromNexus(nexusProvider) {
  const outcome = { skills: [], errors: [] };
  if (!nexusProvider) return outcome;

  try {
    const available = await nexusProvider.isAvailable();
    if (!available) return outcome;

    const remoteSkills = await nexusProvider.listSkills();
    for (const skill of remoteSkills) {
      try {
        const content = await nexusProvider.getSkillContent(skill.name);
        outcome.skills.push({
          metadata: {
            name: skill.name,
            description: skill.description,
            shortDescription: null,
            path: `nexus://${skill.name}`,
            scope: SkillScope.REMOTE,
            keywords: [],
            keywordsAll: [],
            allowedTools: skill.allowedTools?.join?.(",") || null,
            tags: null,
            traits: null,
            priority: skill.priority || 200,
          },
          body: content.body,
          supportFiles: content.supportFiles,
        });
      } catch (err) {
        outcome.errors.push({
          path: `nexus://${skill.name}`,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    outcome.errors.push({
      path: "nexus://",
      message: `Failed to connect to Nexus: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return outcome;
}

/**
 * 加载所有 Skills（Browser 版本，合并 Nexus）
 *
 * @param {Object} [options]
 * @param {string} [options.manifestUrl]
 * @param {any} [options.nexusProvider]
 * @returns {Promise<{skills:Array,errors:Array}>}
 */
export async function loadAllSkills({ manifestUrl, nexusProvider, maxManifestBytes } = {}) {
  const localOutcome = await loadSkills({ manifestUrl, maxManifestBytes });
  const remoteOutcome = await loadSkillsFromNexus(nexusProvider);

  const seen = new Set(localOutcome.skills.map((s) => s.metadata.name));
  for (const skill of remoteOutcome.skills) {
    if (!seen.has(skill.metadata.name)) {
      localOutcome.skills.push(skill);
      seen.add(skill.metadata.name);
    }
  }
  localOutcome.errors.push(...remoteOutcome.errors);
  return localOutcome;
}

/**
 * 从指定路径加载单个 Skill（Browser 版本：fetch）
 *
 * @param {string} filePath - Skill file path or URL (supports "user:skillName" for user skills)
 * @param {import("./model.js").SkillScope | Object} [scope] - Skill scope or options object
 * @param {Object} [options] - Load options
 * @param {number} [options.maxSkillBytes] - Maximum skill body size in bytes
 * @returns {Promise<{ metadata: Object, body: string }>}
 * @throws {Error} If filePath is empty, fetch fails, or body is missing
 */
export async function loadSkillFromPath(filePath, scope = SkillScope.SYSTEM, options = {}) {
  /** @type {any} */
  let opts = options;
  /** @type {any} */
  let normalizedScope = scope;
  if (normalizedScope && typeof normalizedScope === "object" && !Array.isArray(normalizedScope)) {
    opts = normalizedScope;
    normalizedScope = SkillScope.SYSTEM;
  }

  const maxSkillBytes = normalizeMaxBytes(opts?.maxSkillBytes, DEFAULT_MAX_SKILL_BYTES);
  const raw = toNonEmptyString(filePath);
  if (!raw) throw new Error("loadSkillFromPath(filePath): filePath is required");

  if (raw.startsWith("user:")) {
    const name = toNonEmptyString(raw.slice("user:".length));
    if (!name) throw new Error("loadSkillFromPath(user:...): missing skill name");
    await initUserSkillStore();
    const text = getUserSkillBody(name);
    if (!text) throw new Error(`User skill missing body: ${name}`);
    if (maxSkillBytes !== Infinity && text.length > maxSkillBytes) {
      throw createResponseTooLargeError(`User skill body: ${name}`, maxSkillBytes, text.length);
    }
    return parseSkillMarkdown(text, `user:${name}`, SkillScope.USER);
  }

  const url = resolveUrl(raw);
  if (!url) throw new Error("loadSkillFromPath(filePath): filePath is required");

  if (typeof fetch !== "function") throw new Error("fetch is not available in this environment");
  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) throw new Error(`Failed to load skill: ${url} (${resp.status})`);
  const text = await readTextWithLimit(resp, { maxBytes: maxSkillBytes, context: `Skill content: ${url}` });
  if (typeof text !== "string" || !text) throw new Error(`Failed to load skill body: ${url}`);
  return parseSkillMarkdown(text, filePath, normalizedScope);
}

export default {
  loadSkills,
  loadSkillFromPath,
  loadSkillsFromNexus,
  loadAllSkills,
};
