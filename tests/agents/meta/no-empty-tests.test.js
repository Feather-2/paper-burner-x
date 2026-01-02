import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.isFile() && /\.(test|spec)\.[cm]?js$/i.test(entry.name)) out.push(p);
  }
  return out;
}

function findEmptyTests(text) {
  const EMPTY_RE = new RegExp(
    String.raw`\\b(?:it|test)\\s*\\(\\s*(["'])[^"']+\\1\\s*,\\s*(?:async\\s*)?(?:\\(\\s*\\)\\s*=>|function\\s*\\(\\s*\\))\\s*\\{(?:(?:\\s|\\r|\\n|\\t)|(?:\\/\\/[^\\n]*\\n)|(?:\\/\\*[\\s\\S]*?\\*\\/))*\\}\\s*\\)\\s*;?`,
    "g"
  );
  const matches = [];
  let m;
  while ((m = EMPTY_RE.exec(text))) {
    const before = text.slice(0, m.index);
    const line = before.split(/\\r?\\n/).length;
    matches.push({ line, snippet: m[0].split(/\\r?\\n/)[0] });
  }
  return matches;
}

describe("audit: tests", () => {
  it("contains no empty it()/test() blocks", () => {
    const roots = [path.join("tests"), path.join("test")].filter((p) => fs.existsSync(p));
    const offenders = [];

    for (const root of roots) {
      for (const file of walk(root)) {
        const text = fs.readFileSync(file, "utf8");
        const hits = findEmptyTests(text);
        for (const h of hits) offenders.push(`${file}:${h.line}: ${h.snippet}`.slice(0, 240));
      }
    }

    assert.deepEqual(offenders, []);
  });
});
