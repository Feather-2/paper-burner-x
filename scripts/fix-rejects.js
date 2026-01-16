#!/usr/bin/env node
/**
 * Fix malformed assert.rejects conversions
 * Pattern: await expect(().rejects.toThrow() => fn, errorMatch)
 * Should be: await expect(() => fn).rejects.toThrow(errorMatch)
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const targetPath = process.argv[2] || "tests/agents";

function fixFile(filePath) {
  let content = readFileSync(filePath, "utf-8");
  const original = content;

  // Fix the malformed pattern:
  // await expect(().rejects.toThrow() => fn, errorMatch);
  // Should be: await expect(() => fn).rejects.toThrow(errorMatch);

  // Pattern 1: with error matcher
  content = content.replace(
    /await expect\(\(\)\.rejects\.toThrow\(\) => ([^,]+),\s*([^)]+)\);/g,
    "await expect(() => $1).rejects.toThrow($2);"
  );

  // Pattern 2: without error matcher (just closing paren)
  content = content.replace(
    /await expect\(\(\)\.rejects\.toThrow\(\) => ([^)]+)\);/g,
    "await expect(() => $1).rejects.toThrow();"
  );

  // Also fix throws pattern similarly
  content = content.replace(
    /expect\(\(\)\.toThrow\(\) => ([^)]+)\)/g,
    "expect(() => $1).toThrow()"
  );

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
