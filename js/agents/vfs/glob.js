import { normalizeVfsPath } from "./path.js";

function escapeRegExp(s) {
  return s.replace(/[\\^$+?.()|[\]{}]/g, "\\$&");
}

function normalizePattern(pattern) {
  return String(pattern ?? "").replaceAll("\\", "/").trim();
}

function firstGlobWildcardIndex(pattern) {
  const p = normalizePattern(pattern);
  let idx = -1;
  for (const ch of ["*", "?", "{", "["]) {
    const i = p.indexOf(ch);
    if (i < 0) continue;
    if (idx < 0 || i < idx) idx = i;
  }
  return idx;
}

function staticDirPrefixFromPattern(pattern) {
  const p = normalizePattern(pattern);
  const firstWildcard = firstGlobWildcardIndex(p);
  const head = firstWildcard >= 0 ? p.slice(0, firstWildcard) : p;
  const slash = head.lastIndexOf("/");
  const dir = slash >= 0 ? head.slice(0, slash) : "";
  return normalizeVfsPath(dir);
}

function expandOneBrace(pattern) {
  const start = pattern.indexOf("{");
  if (start < 0) return [pattern];
  const end = pattern.indexOf("}", start + 1);
  if (end < 0) return [pattern];
  const inner = pattern.slice(start + 1, end);
  const parts = inner.split(",").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return [pattern];

  const head = pattern.slice(0, start);
  const tail = pattern.slice(end + 1);
  const out = [];
  for (const p of parts) out.push(`${head}${p}${tail}`);
  return out;
}

export function expandBraces(pattern) {
  const p = normalizePattern(pattern);
  let acc = [p];
  // Expand repeatedly to support multiple brace groups.
  for (let i = 0; i < 8; i++) {
    let changed = false;
    const next = [];
    for (const item of acc) {
      const expanded = expandOneBrace(item);
      if (expanded.length !== 1 || expanded[0] !== item) changed = true;
      next.push(...expanded);
    }
    acc = next;
    if (!changed) break;
  }
  // De-dup
  return Array.from(new Set(acc));
}

export function globToRegExp(globPattern) {
  const pattern = normalizePattern(globPattern);
  let re = "";

  // We implement a minimal glob dialect:
  // - ** matches any characters (including '/')
  // - * matches any characters except '/'
  // - ? matches one character except '/'
  // - {a,b} expansion is handled separately
  // - other regex characters are escaped
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    const next = pattern[i + 1];
    if (ch === "*" && next === "*") {
      const after = pattern[i + 2];
      if (after === "/") {
        // Treat "**/" as "any directories, including none".
        re += "(?:.*\\/)?";
        i += 2; // consume "**/"
      } else {
        re += ".*";
        i++;
      }
      continue;
    }
    if (ch === "*") {
      re += "[^/]*";
      continue;
    }
    if (ch === "?") {
      re += "[^/]";
      continue;
    }
    re += escapeRegExp(ch);
  }
  return new RegExp(`^${re}$`);
}

export function matchGlob(globPattern, path) {
  const p = normalizeVfsPath(path);
  for (const expanded of expandBraces(globPattern)) {
    const re = globToRegExp(expanded);
    if (re.test(p)) return true;
  }
  return false;
}

function compileGlobRegexes(globPattern) {
  const out = [];
  for (const expanded of expandBraces(globPattern)) {
    out.push(globToRegExp(expanded));
  }
  return out;
}

/**
 * Create a simple glob function compatible with CodeSearch tools.
 *
 * @param {object} vfs VFS-like object with listFiles({prefix,recursive})
 * @param {object} [options]
 * @param {number} [options.maxScanFiles=20000]
 */
export function createVfsGlobFn(vfs, { maxScanFiles = 20000 } = {}) {
  if (!vfs) return null;
  const hasList = typeof vfs.listFiles === "function";
  const hasWalk = typeof vfs.walkFiles === "function";
  if (!hasList && !hasWalk) return null;

  return async function globFn({ pattern, path } = {}) {
    const base = normalizeVfsPath(path || "");
    const regexes = compileGlobRegexes(pattern);
    const maxScan = Math.max(0, Math.floor(maxScanFiles));

    const relDir = staticDirPrefixFromPattern(pattern);
    const scanPrefix = base ? (relDir ? `${base}/${relDir}` : base) : relDir;

    const out = [];
    let scanned = 0;

    if (hasWalk) {
      for await (const file of vfs.walkFiles({ prefix: scanPrefix, recursive: true })) {
        scanned += 1;
        if (maxScan && scanned > maxScan) break;
        const rel = base ? file.slice(base.length + 1) : file;
        if (!rel) continue;
        if (regexes.some((re) => re.test(rel))) out.push(file);
      }
      return out;
    }

    const files = await vfs.listFiles({ prefix: scanPrefix || base, recursive: true });
    const capped = files.slice(0, maxScan);
    for (const file of capped) {
      const rel = base ? file.slice(base.length + 1) : file;
      if (!rel) continue;
      if (regexes.some((re) => re.test(rel))) out.push(file);
    }
    return out;
  };
}

export default {
  expandBraces,
  globToRegExp,
  matchGlob,
  createVfsGlobFn,
};
