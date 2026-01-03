/**
 * State Diff - 增量状态更新
 *
 * 基于路径的 diff/patch 实现，支持结构共享。
 * 替代 deepClone 的全量拷贝，只拷贝变更路径的子树。
 */

// ─────────────────────────────────────────────────────────────────────────────
// Security
// ─────────────────────────────────────────────────────────────────────────────

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isUnsafeKey(key) {
  return UNSAFE_KEYS.has(key);
}

// ─────────────────────────────────────────────────────────────────────────────
// Clone Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Clone JSON-serializable value (prefers structuredClone)
 * @param {any} value
 * @returns {any}
 */
export function cloneJson(value) {
  if (value === null || typeof value !== "object") return value;
  try {
    return structuredClone(value);
  } catch {
    // Fallback for non-clonable values (functions, etc.)
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return value;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Path Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get value at path
 * @param {object} obj
 * @param {(string|number)[]} path
 * @returns {any}
 */
export function getAtPath(obj, path) {
  let current = obj;
  for (const key of path) {
    if (current === null || current === undefined) return undefined;
    current = current[key];
  }
  return current;
}

/**
 * Update value at path with structural sharing
 * @param {object} obj
 * @param {(string|number)[]} path
 * @param {function} updater - (oldValue) => newValue
 * @returns {object}
 */
export function updateAtPath(obj, path, updater) {
  if (path.length === 0) {
    return updater(obj);
  }

  const [head, ...tail] = path;
  const isArray = Array.isArray(obj);
  const clone = isArray ? [...obj] : { ...obj };

  if (tail.length === 0) {
    clone[head] = updater(clone[head]);
  } else {
    clone[head] = updateAtPath(clone[head], tail, updater);
  }

  return clone;
}

// ─────────────────────────────────────────────────────────────────────────────
// Patch Operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} PatchOp
 * @property {'add'|'remove'|'replace'} op
 * @property {(string|number)[]} path
 * @property {any} [value]
 */

/**
 * Apply patch operations to state (immutable)
 * @param {object} base
 * @param {PatchOp[]} patch
 * @returns {object}
 */
export function applyStatePatch(base, patch) {
  let result = base;

  for (const op of patch) {
    // Validate op
    if (!["add", "remove", "replace"].includes(op.op)) {
      throw new Error(`invalid_patch_op: ${op.op}`);
    }

    // Validate path
    for (const seg of op.path) {
      if (typeof seg === "string" && isUnsafeKey(seg)) {
        throw new Error(`unsafe_path_segment: ${seg}`);
      }
    }

    if (op.path.length === 0) {
      // Root operation
      if (op.op === "replace") {
        result = op.value;
      } else if (op.op === "remove") {
        result = undefined;
      } else if (op.op === "add") {
        result = op.value;
      }
      continue;
    }

    const parentPath = op.path.slice(0, -1);
    const key = op.path[op.path.length - 1];

    result = updateAtPath(result, parentPath, (parent) => {
      if (parent === null || parent === undefined) {
        parent = typeof key === "number" ? [] : {};
      }

      const isArr = Array.isArray(parent);
      const clone = isArr ? [...parent] : { ...parent };

      if (isArr && typeof key === "number") {
        if (key < 0) {
          throw new Error(`patch_path_invalid_array_index: ${key}`);
        }

        if (op.op === "remove") {
          clone.splice(key, 1);
        } else if (op.op === "add") {
          clone.splice(key, 0, op.value);
        } else if (op.op === "replace") {
          clone[key] = op.value;
        }
      } else {
        if (op.op === "remove") {
          delete clone[key];
        } else {
          clone[key] = op.value;
        }
      }

      return clone;
    });
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Diff Builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build patch from base to next state
 * @param {object} base
 * @param {object} next
 * @param {object} [options]
 * @param {number} [options.maxDepth=10]
 * @param {number} [options.maxOps=1000]
 * @param {number} [options.maxArrayOps=50]
 * @returns {PatchOp[]}
 */
export function buildStatePatch(base, next, options = {}) {
  const { maxDepth = 10, maxOps = 1000, maxArrayOps = 50 } = options;
  const ops = [];
  let aborted = false;

  function checkOpsLimit() {
    if (ops.length >= maxOps) {
      ops.length = 0;
      ops.push({ op: "replace", path: [], value: next });
      aborted = true;
      return true;
    }
    return false;
  }

  function diff(basePart, nextPart, path, depth) {
    if (aborted) return;

    // Same reference = no change
    if (basePart === nextPart) return;

    // Exceeded max ops - fallback to root replace
    if (checkOpsLimit()) return;

    // Exceeded depth - replace at current path (>= to match test expectations)
    if (depth >= maxDepth) {
      ops.push({ op: "replace", path, value: nextPart });
      return;
    }

    // Type mismatch or primitives
    if (
      typeof basePart !== typeof nextPart ||
      basePart === null ||
      nextPart === null ||
      typeof basePart !== "object"
    ) {
      ops.push({ op: "replace", path, value: nextPart });
      return;
    }

    // Array diff
    if (Array.isArray(basePart) && Array.isArray(nextPart)) {
      diffArray(basePart, nextPart, path, depth);
      return;
    }

    // Object diff
    if (Array.isArray(basePart) !== Array.isArray(nextPart)) {
      ops.push({ op: "replace", path, value: nextPart });
      return;
    }

    // Check for unsafe keys
    for (const key of Object.keys(nextPart)) {
      if (isUnsafeKey(key)) {
        ops.length = 0;
        ops.push({ op: "replace", path: [], value: next });
        aborted = true;
        return;
      }
    }

    // Removed keys
    for (const key of Object.keys(basePart)) {
      if (aborted) return;
      if (!(key in nextPart)) {
        ops.push({ op: "remove", path: [...path, key] });
        if (checkOpsLimit()) return;
      }
    }

    // Added or changed keys
    for (const key of Object.keys(nextPart)) {
      if (aborted) return;
      if (!(key in basePart)) {
        ops.push({ op: "add", path: [...path, key], value: nextPart[key] });
        if (checkOpsLimit()) return;
      } else if (basePart[key] !== nextPart[key]) {
        diff(basePart[key], nextPart[key], [...path, key], depth + 1);
      }
    }
  }

  function diffArray(baseArr, nextArr, path, depth) {
    if (aborted) return;
    const arrayOps = [];

    // Simple LCS-based diff for arrays
    let bi = 0;
    let ni = 0;

    while (bi < baseArr.length || ni < nextArr.length) {
      if (bi >= baseArr.length) {
        // Append remaining next items
        arrayOps.push({ op: "add", path: [...path, ni], value: nextArr[ni] });
        ni++;
      } else if (ni >= nextArr.length) {
        // Remove remaining base items
        arrayOps.push({ op: "remove", path: [...path, bi] });
        bi++;
      } else if (baseArr[bi] === nextArr[ni]) {
        // Same item, advance both
        bi++;
        ni++;
      } else {
        // Check if base item exists later in next
        const foundInNext = nextArr.indexOf(baseArr[bi], ni);
        // Check if next item exists later in base
        const foundInBase = baseArr.indexOf(nextArr[ni], bi);

        if (foundInNext === -1 && foundInBase === -1) {
          // Neither found, replace in place
          diff(baseArr[bi], nextArr[ni], [...path, ni], depth + 1);
          bi++;
          ni++;
        } else if (foundInNext === -1) {
          // Base item not in next, remove it
          arrayOps.push({ op: "remove", path: [...path, bi] });
          bi++;
        } else if (foundInBase === -1) {
          // Next item not in base, insert it
          arrayOps.push({ op: "add", path: [...path, ni], value: nextArr[ni] });
          ni++;
        } else {
          // Both exist somewhere, prefer smaller move
          if (foundInNext - ni <= foundInBase - bi) {
            arrayOps.push({ op: "remove", path: [...path, bi] });
            bi++;
          } else {
            arrayOps.push({ op: "add", path: [...path, ni], value: nextArr[ni] });
            ni++;
          }
        }
      }

      // Check after each op if we exceeded limit
      if (arrayOps.length > maxArrayOps) {
        // Too many ops, replace entire array
        ops.push({ op: "replace", path, value: nextArr });
        return;
      }
    }

    ops.push(...arrayOps);
  }

  diff(base, next, [], 0);
  return ops;
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Diff state layers by reference
 * @param {object} prev
 * @param {object} next
 * @returns {{L0: boolean, L1: boolean, L2: boolean, L3: boolean}}
 */
export function diffLayers(prev, next) {
  return {
    L0: prev.L0 !== next.L0,
    L1: prev.L1 !== next.L1,
    L2: prev.L2 !== next.L2,
    L3: prev.L3 !== next.L3,
  };
}

/**
 * Extract layer names from patch paths
 * @param {PatchOp[]} patch
 * @returns {Set<string>}
 */
export function getPatchLayers(patch) {
  const layers = new Set();
  for (const op of patch) {
    if (op.path.length > 0 && typeof op.path[0] === "string") {
      const first = op.path[0];
      if (first.startsWith("L") && first.length === 2) {
        layers.add(first);
      }
    }
  }
  return layers;
}

export default {
  cloneJson,
  getAtPath,
  updateAtPath,
  applyStatePatch,
  buildStatePatch,
  diffLayers,
  getPatchLayers,
};
