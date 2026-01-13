import { isNodeLike } from "../shared/platform.js";

function splitLines(text) {
  const s = typeof text === "string" ? text : String(text ?? "");
  const lines = s.split("\n");
  if (lines.length && s.endsWith("\n")) lines.pop();
  return lines;
}

function myersDiff(a, b) {
  const N = a.length;
  const M = b.length;
  const max = N + M;
  const offset = max;
  let v = new Array(2 * max + 1).fill(0);
  const trace = [];

  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      const kIdx = k + offset;
      let x;
      if (k === -d || (k !== d && v[kIdx - 1] < v[kIdx + 1])) {
        x = v[kIdx + 1];
      } else {
        x = v[kIdx - 1] + 1;
      }
      let y = x - k;
      while (x < N && y < M && a[x] === b[y]) {
        x++;
        y++;
      }
      v[kIdx] = x;
      if (x >= N && y >= M) {
        return backtrack(trace, a, b, offset);
      }
    }
  }

  return [];
}

function backtrack(trace, a, b, offset) {
  let x = a.length;
  let y = b.length;
  const out = [];

  for (let d = trace.length - 1; d >= 0; d--) {
    const v = trace[d];
    const k = x - y;
    const kIdx = k + offset;

    let prevK;
    if (k === -d || (k !== d && v[kIdx - 1] < v[kIdx + 1])) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = v[prevK + offset];
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      out.push({ type: "equal", line: a[x - 1] });
      x--;
      y--;
    }

    if (d === 0) break;

    if (x === prevX) {
      out.push({ type: "insert", line: b[y - 1] });
      y--;
    } else {
      out.push({ type: "delete", line: a[x - 1] });
      x--;
    }
  }

  out.reverse();
  return out;
}

/**
 * @param {{ aStart?: number, aCount?: number, bStart?: number, bCount?: number }} [hunk]
 * @returns {string}
 */
function formatHunkHeader({ aStart, aCount, bStart, bCount } = {}) {
  const aRange = `${aStart},${aCount}`;
  const bRange = `${bStart},${bCount}`;
  return `@@ -${aRange} +${bRange} @@`;
}

/**
 * Create a unified diff (multi-hunk) for two texts.
 *
 * @param {{ path?: string, beforeText?: string, afterText?: string, context?: number }} [options]
 * @returns {{hunks:Array, text:string}}
 */
export function createUnifiedDiff({ path = "file", beforeText = "", afterText = "", context = 3 } = {}) {
  const a = splitLines(beforeText);
  const b = splitLines(afterText);
  const ops = myersDiff(a, b);
  const ctx = Number.isFinite(context) ? Math.max(0, Math.floor(context)) : 3;

  let aIndex = 0;
  let bIndex = 0;
  let preContext = [];
  /** @type {any|null} */
  let hunk = null;
  let trailing = [];
  const hunks = [];

  const startHunk = () => {
    hunk = {
      aStart: aIndex - preContext.length + 1,
      bStart: bIndex - preContext.length + 1,
      aCount: 0,
      bCount: 0,
      lines: [],
    };
    for (const line of preContext) {
      hunk.lines.push({ tag: " ", line });
      hunk.aCount += 1;
      hunk.bCount += 1;
    }
    preContext = [];
    trailing = [];
  };

  const flushTrailingIntoHunk = (max) => {
    const take = trailing.slice(0, max);
    for (const line of take) {
      hunk.lines.push({ tag: " ", line });
      hunk.aCount += 1;
      hunk.bCount += 1;
    }
    trailing = trailing.slice(max);
  };

  const finalizeHunk = () => {
    if (!hunk) return;
    // include remaining trailing context lines up to ctx
    flushTrailingIntoHunk(ctx);
    hunks.push(hunk);
    hunk = null;
  };

  const commitTrailingAsContext = () => {
    if (!hunk || trailing.length === 0) return;
    for (const line of trailing) {
      hunk.lines.push({ tag: " ", line });
      hunk.aCount += 1;
      hunk.bCount += 1;
    }
    trailing = [];
  };

  for (const op of ops) {
    if (op.type === "equal") {
      if (hunk) {
        trailing.push(op.line);
        if (trailing.length > ctx) {
          // close hunk after ctx lines; keep the extra equals as preContext for next hunk
          flushTrailingIntoHunk(ctx);
          finalizeHunk();
          preContext = trailing.slice(-ctx);
          trailing = [];
        }
      } else {
        preContext.push(op.line);
        if (preContext.length > ctx) preContext.shift();
      }
      aIndex += 1;
      bIndex += 1;
      continue;
    }

    // change: merge any pending trailing equals into current hunk as context
    if (hunk) commitTrailingAsContext();
    else startHunk();
    if (!hunk) continue;

    if (op.type === "delete") {
      hunk.lines.push({ tag: "-", line: op.line });
      hunk.aCount += 1;
      aIndex += 1;
      continue;
    }
    if (op.type === "insert") {
      hunk.lines.push({ tag: "+", line: op.line });
      hunk.bCount += 1;
      bIndex += 1;
      continue;
    }
  }

  if (hunk) finalizeHunk();

  const header = [
    `--- a/${String(path || "file")}`,
    `+++ b/${String(path || "file")}`,
  ];
  const body = [];
  for (const h of hunks) {
    body.push(formatHunkHeader(h));
    for (const line of h.lines) {
      body.push(`${line.tag}${line.line}`);
    }
  }

  return { hunks, text: [...header, ...body].join("\n") + (body.length ? "\n" : "") };
}

function canUseWorker() {
  return !isNodeLike() && typeof Worker !== "undefined" && typeof URL !== "undefined";
}

let _diffWorker = null;
let _diffWorkerSeq = 0;
const _diffPending = new Map(); // id -> {resolve,reject}

function getDiffWorker() {
  if (_diffWorker) return _diffWorker;
  if (!canUseWorker()) return null;

  try {
    const worker = new Worker(new URL("./diff.worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (event) => {
      const msg = event?.data;
      const id = msg?.id;
      const pending = _diffPending.get(id);
      if (!pending) return;
      _diffPending.delete(id);
      if (msg?.ok) pending.resolve(msg.diff);
      else pending.reject(new Error(msg?.error || "diff worker error"));
    };
    worker.onerror = (err) => {
      for (const pending of _diffPending.values()) {
        try {
          pending.reject(err instanceof Error ? err : new Error(String(err?.message || err)));
        } catch {
          // ignore
        }
      }
      _diffPending.clear();
      try {
        worker.terminate();
      } catch {
        // ignore
      }
      _diffWorker = null;
    };
    _diffWorker = worker;
    return worker;
  } catch {
    return null;
  }
}

function estimateChars(value) {
  const s = typeof value === "string" ? value : String(value ?? "");
  return s.length;
}

/**
 * Best-effort async diff for large texts.
 * - Uses a Web Worker when available
 * - Falls back to sync createUnifiedDiff otherwise
 *
 * @param {object} options Same options as createUnifiedDiff()
 * @param {{signal?:AbortSignal,useWorker?:boolean,workerThresholdChars?:number}=} runtime
 * @returns {Promise<{hunks:Array,text:string}>}
 */
export async function createUnifiedDiffAsync(options = {}, runtime = {}) {
  const opts = options && typeof options === "object" ? options : {};
  const rt = runtime && typeof runtime === "object" ? runtime : {};
  const signal = rt.signal;
  if (signal?.aborted) throw new Error("createUnifiedDiffAsync: aborted");

  const threshold =
    typeof rt.workerThresholdChars === "number" && Number.isFinite(rt.workerThresholdChars) && rt.workerThresholdChars > 0
      ? Math.floor(rt.workerThresholdChars)
      : 120_000;

  const useWorker = rt.useWorker !== false;
  const worker = useWorker ? getDiffWorker() : null;

  const size = estimateChars(opts.beforeText) + estimateChars(opts.afterText);
  if (!worker || size < threshold) return createUnifiedDiff(opts);

  const id = `diff_${Date.now().toString(36)}_${++_diffWorkerSeq}`;
  const promise = new Promise((resolve, reject) => {
    _diffPending.set(id, { resolve, reject });
  });

  const abort = () => {
    const pending = _diffPending.get(id);
    if (!pending) return;
    _diffPending.delete(id);
    pending.reject(new Error("createUnifiedDiffAsync: aborted"));
  };

  if (signal) signal.addEventListener?.("abort", abort, { once: true });
  try {
    worker.postMessage({ id, options: opts });
    return await promise;
  } finally {
    if (signal) signal.removeEventListener?.("abort", abort);
  }
}

export default { createUnifiedDiff, createUnifiedDiffAsync };
