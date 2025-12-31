function toPosix(input) {
  return String(input ?? "").replaceAll("\\", "/");
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

  const parts = [];
  for (const seg of p.split("/")) {
    const s = seg.trim();
    if (!s || s === ".") continue;
    if (s === "..") {
      throw new Error(`Invalid VFS path traversal: ${raw}`);
    }
    parts.push(s);
  }

  return parts.join("/");
}

export function dirnameVfsPath(inputPath) {
  const p = normalizeVfsPath(inputPath);
  if (!p) return "";
  const idx = p.lastIndexOf("/");
  return idx >= 0 ? p.slice(0, idx) : "";
}

export function basenameVfsPath(inputPath) {
  const p = normalizeVfsPath(inputPath);
  if (!p) return "";
  const idx = p.lastIndexOf("/");
  return idx >= 0 ? p.slice(idx + 1) : p;
}

export function joinVfsPath(base, child) {
  const b = normalizeVfsPath(base);
  const c = normalizeVfsPath(child);
  if (!b) return c;
  if (!c) return b;
  return `${b}/${c}`;
}

