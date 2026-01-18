function toPosix(input) {
  return String(input ?? "").replaceAll("\\", "/");
}

const INVALID_SEGMENT_CHARS = /[<>:"|?*\u0000-\u001f]/;
const WINDOWS_RESERVED_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

function isReservedWindowsName(seg) {
  const s = String(seg || "").trim();
  if (!s) return false;
  const base = s.split(".")[0].toLowerCase();
  return WINDOWS_RESERVED_NAMES.has(base);
}

/**
 * Normalize a VFS path:
 * - Always POSIX separators
 * - Always relative (no leading '/')
 * - No '..' traversal
 * - Collapses '.' segments and duplicate slashes
 *
 * @param {string} inputPath
 * @returns {string} normalized relative path ("" means root)
 */
export function normalizeVfsPath(inputPath) {
  const raw = toPosix(inputPath).trim();
  if (!raw || raw === "." || raw === "./") return "";

  let p = raw;
  while (p.startsWith("./")) p = p.slice(2);
  while (p.startsWith("/")) p = p.slice(1);

  // Block Windows-style absolute path injection (e.g. "C:/...").
  if (/^[a-zA-Z]:/.test(p)) {
    throw new Error(`Invalid VFS absolute path: ${raw}`);
  }

  const parts = [];
  for (const seg of p.split("/")) {
    const s = seg.trim();
    if (!s || s === ".") continue;
    if (s === "..") {
      throw new Error(`Invalid VFS path traversal: ${raw}`);
    }
    if (INVALID_SEGMENT_CHARS.test(s)) {
      throw new Error(`Invalid VFS path segment: ${raw}`);
    }
    if (isReservedWindowsName(s)) {
      throw new Error(`Invalid VFS reserved name: ${raw}`);
    }
    parts.push(s);
  }

  return parts.join("/");
}

/**
 * Returns the directory portion of a VFS path.
 * @param {string} inputPath - The path to process.
 * @returns {string} Directory path, or empty string if no directory.
 */
export function dirnameVfsPath(inputPath) {
  const p = normalizeVfsPath(inputPath);
  if (!p) return "";
  const idx = p.lastIndexOf("/");
  return idx >= 0 ? p.slice(0, idx) : "";
}

/**
 * Returns the base name (final segment) of a VFS path.
 * @param {string} inputPath - The path to process.
 * @returns {string} Base name, or empty string if path is empty.
 */
export function basenameVfsPath(inputPath) {
  const p = normalizeVfsPath(inputPath);
  if (!p) return "";
  const idx = p.lastIndexOf("/");
  return idx >= 0 ? p.slice(idx + 1) : p;
}

/**
 * Joins two VFS path segments.
 * @param {string} base - Base path.
 * @param {string} child - Child path to append.
 * @returns {string} Combined path.
 */
export function joinVfsPath(base, child) {
  const b = normalizeVfsPath(base);
  const c = normalizeVfsPath(child);
  if (!b) return c;
  if (!c) return b;
  return `${b}/${c}`;
}
