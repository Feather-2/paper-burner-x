#!/usr/bin/env node
/**
 * Fix malformed expect/toThrow patterns after migration
 * Pattern 1: expect(() => fn().toThrow(), /regex/) -> expect(() => fn()).toThrow(/regex/)
 * Pattern 2: expect(() => fn, /regex/) -> expect(() => fn).toThrow(/regex/)
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const targetPath = process.argv[2] || "tests/agents";

function fixFile(filePath) {
  let content = readFileSync(filePath, "utf-8");
  const original = content;

  // Pattern 1: expect(() => fn().toThrow(), /regex/); -> expect(() => fn()).toThrow(/regex/);
  // This handles single-line cases
  content = content.replace(
    /expect\((\(\) => [^.]+)\.toThrow\(\),\s*(\/.+?\/\w*)\);/g,
    "expect($1).toThrow($2);"
  );

  // Pattern 2: await expect(fn.rejects.toThrow(), /regex/) -> await expect(fn).rejects.toThrow(/regex/)
  content = content.replace(
    /await expect\(([^.]+)\.rejects\.toThrow\(\),\s*(\/.+?\/\w*)\);/g,
    "await expect($1).rejects.toThrow($2);"
  );

  // Pattern 3: Multi-line expect(...),\n  /regex/\n);
  // This is harder to fix with regex, so we'll use a different approach

  if (content !== original) {
    writeFileSync(filePath, content);
    return true;
  }
  return false;
}

function processDirectory(dirPath) {
  let count = 0;
  const entries = readdirSync(dirPath);

  for (const entry of entries) {
    const fullPath = join(dirPath, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      count += processDirectory(fullPath);
    } else if (entry.endsWith(".test.js")) {
      if (fixFile(fullPath)) {
        console.log(`Fixed: ${fullPath}`);
        count++;
      }
    }
  }
  return count;
}

const stat = statSync(targetPath);
if (stat.isDirectory()) {
  const count = processDirectory(targetPath);
  console.log(`\nTotal fixed: ${count} files`);
} else {
  if (fixFile(targetPath)) {
    console.log(`Fixed: ${targetPath}`);
  }
}
