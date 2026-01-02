function escapeRegExp(s) {
  return String(s ?? "").replace(/[\\^$+?.()|[\]{}]/g, "\\$&");
}

function normalizePattern(pattern) {
  return String(pattern ?? "").replaceAll("\\", "/").trim();
}

function expandOneBrace(pattern) {
  const start = pattern.indexOf("{");
  if (start < 0) return [pattern];
  const end = pattern.indexOf("}", start + 1);
  if (end < 0) return [pattern];
  const inner = pattern.slice(start + 1, end);
  const parts = inner
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return [pattern];

  const head = pattern.slice(0, start);
  const tail = pattern.slice(end + 1);
  const out = [];
  for (const p of parts) out.push(`${head}${p}${tail}`);
  return out;
}

function expandBraces(pattern) {
  const p = normalizePattern(pattern);
  let acc = [p];
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
  return Array.from(new Set(acc));
}

function globToRegExp(globPattern) {
  const pattern = normalizePattern(globPattern);
  let re = "";

  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    const next = pattern[i + 1];
    if (ch === "*" && next === "*") {
      const after = pattern[i + 2];
      if (after === "/") {
        re += "(?:.*\\/)?";
        i += 2;
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

function compileGlobRegexes(globPattern) {
  const out = [];
  for (const expanded of expandBraces(globPattern)) out.push(globToRegExp(expanded));
  return out;
}

function normalizeBasePath(value) {
  const s = String(value ?? "").replaceAll("\\", "/").trim();
  if (!s) return "";
  return s.replace(/^\.\/+/, "").replace(/^\/+/, "").replace(/\/+$/, "");
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

self.onmessage = (event) => {
  const data = event?.data;
  const id = data?.id;
  if (!id) return;

  const opts = isPlainObject(data) ? data : {};
  const pattern = String(opts.pattern ?? "");
  const base = normalizeBasePath(opts.base);
  const files = Array.isArray(opts.files) ? opts.files : [];

  try {
    const regexes = compileGlobRegexes(pattern);
    const out = [];
    for (const file of files) {
      if (typeof file !== "string") continue;
      const rel = base ? (file.startsWith(`${base}/`) ? file.slice(base.length + 1) : file) : file;
      if (!rel) continue;
      if (regexes.some((re) => re.test(rel))) out.push(file);
    }
    self.postMessage({ id, ok: true, matches: out });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message || err) });
  }
};

