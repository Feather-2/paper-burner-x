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

function formatHunkHeader({ aStart, aCount, bStart, bCount } = {}) {
  const aRange = `${aStart},${aCount}`;
  const bRange = `${bStart},${bCount}`;
  return `@@ -${aRange} +${bRange} @@`;
}

/**
 * Create a unified diff (multi-hunk) for two texts.
 *
 * @param {object} options
 * @param {string} options.path file path (used in header)
 * @param {string} options.beforeText
 * @param {string} options.afterText
 * @param {number} [options.context=3] context lines per hunk
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

export default { createUnifiedDiff };

