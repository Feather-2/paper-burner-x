#!/usr/bin/env node
/**
 * Migrate node:test files to vitest
 * Usage: node scripts/migrate-to-vitest.js [file or directory]
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, basename, dirname } from "path";

const targetPath = process.argv[2] || "tests/agents";

function migrateFile(filePath) {
  let content = readFileSync(filePath, "utf-8");

  // Skip if already vitest
  if (content.includes('from "vitest"') || content.includes("from 'vitest'")) {
    return false;
  }

  // Skip if not node:test
  if (!content.includes("node:test") && !content.includes("node:assert")) {
    return false;
  }

  const original = content;

  // 1. Replace node:test imports
  // Handle: import test from "node:test"
  content = content.replace(
    /import\s+test\s+from\s+["']node:test["'];?\n?/g,
    ""
  );

  // Handle: import { describe, it, ... } from "node:test"
  content = content.replace(
    /import\s*\{[^}]*\}\s*from\s*["']node:test["'];?\n?/g,
    ""
  );

  // 2. Replace assert imports
  content = content.replace(
    /import\s+assert\s+from\s+["']node:assert(?:\/strict)?["'];?\n?/g,
    ""
  );

  // 3. Add vitest imports at the top (after any 'use strict' or initial comments)
  const vitestImports = `import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";\n`;

  // Find insertion point (after initial comments/directives)
  const lines = content.split("\n");
  let insertIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("//") || line.startsWith("/*") || line.startsWith("*") || line === "" || line.startsWith("'use strict'") || line.startsWith('"use strict"')) {
      insertIndex = i + 1;
    } else {
      break;
    }
  }
  lines.splice(insertIndex, 0, vitestImports);
  content = lines.join("\n");

  // 4. Convert assert.* to expect()
  // assert.strictEqual(a, b) -> expect(a).toBe(b)
  content = content.replace(
    /assert\.strictEqual\s*\(\s*([^,]+),\s*([^)]+)\)/g,
    "expect($1).toBe($2)"
  );

  // assert.deepStrictEqual(a, b) -> expect(a).toEqual(b)
  content = content.replace(
    /assert\.deepStrictEqual\s*\(\s*([^,]+),\s*([^)]+)\)/g,
    "expect($1).toEqual($2)"
  );

  // assert.equal(a, b) -> expect(a).toBe(b)
  content = content.replace(
    /assert\.equal\s*\(\s*([^,]+),\s*([^)]+)\)/g,
    "expect($1).toBe($2)"
  );

  // assert.deepEqual(a, b) -> expect(a).toEqual(b)
  content = content.replace(
    /assert\.deepEqual\s*\(\s*([^,]+),\s*([^)]+)\)/g,
    "expect($1).toEqual($2)"
  );

  // assert.ok(x) -> expect(x).toBeTruthy()
  content = content.replace(
    /assert\.ok\s*\(\s*([^)]+)\)/g,
    "expect($1).toBeTruthy()"
  );

  // assert.notStrictEqual(a, b) -> expect(a).not.toBe(b)
  content = content.replace(
    /assert\.notStrictEqual\s*\(\s*([^,]+),\s*([^)]+)\)/g,
    "expect($1).not.toBe($2)"
  );

  // assert.notEqual(a, b) -> expect(a).not.toBe(b)
  content = content.replace(
    /assert\.notEqual\s*\(\s*([^,]+),\s*([^)]+)\)/g,
    "expect($1).not.toBe($2)"
  );

  // assert.notDeepStrictEqual(a, b) -> expect(a).not.toEqual(b)
  content = content.replace(
    /assert\.notDeepStrictEqual\s*\(\s*([^,]+),\s*([^)]+)\)/g,
    "expect($1).not.toEqual($2)"
  );

  // assert.throws(() => ...) -> expect(() => ...).toThrow()
  content = content.replace(
    /assert\.throws\s*\(\s*([^,)]+)(?:,\s*([^)]+))?\)/g,
    (match, fn, errorMatch) => {
      if (errorMatch) {
        return `expect(${fn}).toThrow(${errorMatch})`;
      }
      return `expect(${fn}).toThrow()`;
    }
  );

  // await assert.rejects(async () => ...) -> await expect(async () => ...).rejects.toThrow()
  content = content.replace(
    /await\s+assert\.rejects\s*\(\s*([^,)]+)(?:,\s*([^)]+))?\)/g,
    (match, fn, errorMatch) => {
      if (errorMatch) {
        return `await expect(${fn}).rejects.toThrow(${errorMatch})`;
      }
      return `await expect(${fn}).rejects.toThrow()`;
    }
  );

  // assert.doesNotThrow(() => ...) -> expect(() => ...).not.toThrow()
  content = content.replace(
    /assert\.doesNotThrow\s*\(\s*([^)]+)\)/g,
    "expect($1).not.toThrow()"
  );

  // assert.fail(msg) -> throw new Error(msg) or expect.fail(msg)
  content = content.replace(
    /assert\.fail\s*\(\s*([^)]*)\)/g,
    "throw new Error($1 || 'Test failed')"
  );

  // assert.match(str, regex) -> expect(str).toMatch(regex)
  content = content.replace(
    /assert\.match\s*\(\s*([^,]+),\s*([^)]+)\)/g,
    "expect($1).toMatch($2)"
  );

  // assert.doesNotMatch(str, regex) -> expect(str).not.toMatch(regex)
  content = content.replace(
    /assert\.doesNotMatch\s*\(\s*([^,]+),\s*([^)]+)\)/g,
    "expect($1).not.toMatch($2)"
  );

  // assert(x) -> expect(x).toBeTruthy()
  content = content.replace(
    /\bassert\s*\(\s*([^)]+)\)/g,
    "expect($1).toBeTruthy()"
  );

  // 5. Convert test() to it() if standalone
  content = content.replace(
    /\btest\s*\(\s*["'`]/g,
    'it("'
  );

  // 6. Convert mock.fn() to vi.fn() if any mock usage
  content = content.replace(/\bmock\.fn\s*\(/g, "vi.fn(");
  content = content.replace(/\bmock\.method\s*\(/g, "vi.spyOn(");

  // 7. Clean up unused imports
  if (!content.includes("beforeEach")) {
    content = content.replace(/, beforeEach/g, "");
  }
  if (!content.includes("afterEach")) {
    content = content.replace(/, afterEach/g, "");
  }
  if (!content.includes("vi.")) {
    content = content.replace(/, vi/g, "");
  }

  // 8. Clean up multiple empty lines
  content = content.replace(/\n{3,}/g, "\n\n");

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
    } else if (entry.endsWith(".test.js") && !entry.includes(".vitest.")) {
      if (migrateFile(fullPath)) {
        console.log(`Migrated: ${fullPath}`);
        count++;
      }
    }
  }
  return count;
}

// Main
const stat = statSync(targetPath);
if (stat.isDirectory()) {
  const count = processDirectory(targetPath);
  console.log(`\nTotal migrated: ${count} files`);
} else {
  if (migrateFile(targetPath)) {
    console.log(`Migrated: ${targetPath}`);
  } else {
    console.log(`Skipped: ${targetPath}`);
  }
}
