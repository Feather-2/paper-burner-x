import { isPlainObject, toPositiveInt, deepClone } from "../../shared/utils/value-utils.js";

const DEFAULT_PATCH_MAX_DEPTH = 12;
const DEFAULT_PATCH_MAX_OPS = 5000;

export function safeJsonSize(value) {
  try {
    const s = JSON.stringify(value);
    return typeof s === "string" ? s.length : 0;
  } catch {
    return 0;
  }
}

function isUnsafePathSegment(seg) {
  const s = String(seg || "");
  return s === "__proto__" || s === "prototype" || s === "constructor";
}

function encodePointerSegment(seg) {
  return String(seg).replace(/~/g, "~0").replace(/\//g, "~1");
}

function decodePointerSegment(seg) {
  return String(seg).replace(/~1/g, "/").replace(/~0/g, "~");
}

function toJsonPointer(segments) {
  const parts = Array.isArray(segments) ? segments : [];
  if (parts.length === 0) return "";
  return "/" + parts.map(encodePointerSegment).join("/");
}

function parseJsonPointer(ptr) {
  const p = typeof ptr === "string" ? ptr : "";
  if (!p) return [];
  if (!p.startsWith("/")) throw new Error(`Invalid JSON pointer: ${p}`);
  return p
    .slice(1)
    .split("/")
    .map(decodePointerSegment);
}

function deepEqualLimited(a, b, depth) {
  if (Object.is(a, b)) return true;
  if (depth <= 0) return false;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqualLimited(a[i], b[i], depth - 1)) return false;
    }
    return true;
  }
  if (!isPlainObject(a) || !isPlainObject(b)) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  const bSet = new Set(bKeys);
  for (const k of aKeys) {
    if (!bSet.has(k)) return false;
    if (!deepEqualLimited(a[k], b[k], depth - 1)) return false;
  }
  return true;
}

/**
 * @param {any} base
 * @param {any} next
 * @param {{ maxDepth?: number, maxOps?: number }} [options]
 * @returns {any[]}
 */
export function buildJsonPatch(base, next, { maxDepth, maxOps } = {}) {
  const depth = toPositiveInt(maxDepth, DEFAULT_PATCH_MAX_DEPTH);
  const opsLimit = toPositiveInt(maxOps, DEFAULT_PATCH_MAX_OPS);
  const ops = [];

  const pushOp = (op) => {
    if (ops.length >= opsLimit) throw new Error("patch_ops_limit");
    ops.push(op);
  };

  const walk = (a, b, path, remainingDepth) => {
    if (Object.is(a, b)) return;
    if (remainingDepth <= 0) {
      pushOp({ op: "replace", path: toJsonPointer(path), value: deepClone(b) });
      return;
    }

    const aIsArr = Array.isArray(a);
    const bIsArr = Array.isArray(b);
    if (aIsArr || bIsArr) {
      if (!deepEqualLimited(a, b, remainingDepth - 1)) {
        pushOp({ op: "replace", path: toJsonPointer(path), value: deepClone(b) });
      }
      return;
    }

    const aObj = isPlainObject(a);
    const bObj = isPlainObject(b);
    if (!aObj || !bObj) {
      pushOp({ op: "replace", path: toJsonPointer(path), value: deepClone(b) });
      return;
    }

    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    const bSet = new Set(bKeys);

    for (const k of aKeys) {
      if (isUnsafePathSegment(k)) throw new Error("unsafe_path_segment");
      if (!bSet.has(k)) {
        pushOp({ op: "remove", path: toJsonPointer([...path, k]) });
      }
    }

    const aSet = new Set(aKeys);
    for (const k of bKeys) {
      if (isUnsafePathSegment(k)) throw new Error("unsafe_path_segment");
      if (!aSet.has(k)) {
        pushOp({ op: "add", path: toJsonPointer([...path, k]), value: deepClone(b[k]) });
      }
    }

    for (const k of bKeys) {
      if (!aSet.has(k)) continue;
      walk(a[k], b[k], [...path, k], remainingDepth - 1);
    }
  };

  walk(base, next, [], depth);
  return ops;
}

export function applyJsonPatch(base, ops) {
  const doc = deepClone(base);
  const list = Array.isArray(ops) ? ops : [];
  let root = doc;

  const getParent = (segments) => {
    let obj = root;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (isUnsafePathSegment(seg)) throw new Error("unsafe_path_segment");
      if (obj === null || obj === undefined) throw new Error("patch_path_missing");
      if (typeof obj !== "object") throw new Error("patch_path_not_object");
      obj = obj[seg];
    }
    return obj;
  };

  for (const raw of list) {
    const op = raw && typeof raw === "object" ? raw : null;
    const kind = typeof op?.op === "string" ? op.op : "";
    const segments = parseJsonPointer(op?.path);

    if (segments.length === 0) {
      if (kind === "replace" || kind === "add") {
        root = deepClone(op.value);
        continue;
      }
      if (kind === "remove") {
        root = undefined;
        continue;
      }
      throw new Error(`Unsupported patch op: ${kind}`);
    }

    const parentSegments = segments.slice(0, -1);
    const leaf = segments[segments.length - 1];
    if (isUnsafePathSegment(leaf)) throw new Error("unsafe_path_segment");

    const parent = getParent(parentSegments);
    if (parent === null || parent === undefined || typeof parent !== "object") throw new Error("patch_parent_not_object");

    if (kind === "remove") {
      if (Array.isArray(parent)) {
        const idx = Number(leaf);
        if (!Number.isFinite(idx) || idx < 0 || idx >= parent.length) continue;
        parent.splice(idx, 1);
      } else {
        delete parent[leaf];
      }
      continue;
    }

    if (kind === "add" || kind === "replace") {
      if (Array.isArray(parent)) {
        const idx = Number(leaf);
        if (!Number.isFinite(idx) || idx < 0) continue;
        if (idx >= parent.length) parent.push(deepClone(op.value));
        else parent[idx] = deepClone(op.value);
      } else {
        parent[leaf] = deepClone(op.value);
      }
      continue;
    }

    throw new Error(`Unsupported patch op: ${kind}`);
  }

  return root;
}
