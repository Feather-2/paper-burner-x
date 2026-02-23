#!/usr/bin/env node
/**
 * 修复测试文件中的多种语法错误模式
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

function getAllTestFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...getAllTestFiles(full));
    } else if (entry.endsWith('.test.js')) {
      files.push(full);
    }
  }
  return files;
}

function fixFile(filePath) {
  let content = readFileSync(filePath, 'utf8');
  let original = content;

  // Pattern 1: expect(fn(x).toBeTruthy()) -> expect(fn(x)).toBeTruthy()
  // e.g. expect(isPlainObject({}).toBeTruthy())
  content = content.replace(/expect\(([a-zA-Z_][a-zA-Z0-9_]*)\(([^)]*)\)\.toBeTruthy\(\)\)/g,
    'expect($1($2)).toBeTruthy()');

  // Pattern 2: expect(x.includes("y").toBeTruthy()) -> expect(x.includes("y")).toBeTruthy()
  content = content.replace(/expect\(([^)]+)\.includes\(([^)]+)\)\.toBeTruthy\(\)\)/g,
    'expect($1.includes($2)).toBeTruthy()');

  // Pattern 3: .some((e).toBeTruthy() => ...) -> .some(e => ...)
  content = content.replace(/\.some\(\(([a-zA-Z_][a-zA-Z0-9_]*)\)\.toBeTruthy\(\)\s*=>/g, '.some($1 =>');

  // Pattern 4: .filter((e).toBeTruthy() => ...) -> .filter(e => ...)
  content = content.replace(/\.filter\(\(([a-zA-Z_][a-zA-Z0-9_]*)\)\.toBeTruthy\(\)\s*=>/g, '.filter($1 =>');

  // Pattern 5: .map((c) => [c.x).toEqual(c.y, c.z]) -> complex fix needed
  // Skip for now - needs manual

  // Pattern 6: await expect(vfs.fn("x").rejects.toThrow("y"), /regex/)
  // -> await expect(vfs.fn("x")).rejects.toThrow(/regex/)
  content = content.replace(/await expect\(([^)]+)\.(rejects)\.toThrow\([^)]*\),\s*(\/.+?\/[gim]*)\)/g,
    'await expect($1).$2.toThrow($3)');

  // Pattern 7: await expect(vfs.fn("x").rejects).toThrow(/regex/)
  // -> await expect(vfs.fn("x")).rejects.toThrow(/regex/)
  content = content.replace(/await expect\(([^)]+)\.(rejects)\)\.toThrow\((\/.+?\/[gim]*)\)/g,
    'await expect($1).$2.toThrow($3)');

  // Pattern 8: expect(x).toBeTruthy() || y) -> expect(x || y).toBeTruthy()
  content = content.replace(/expect\(([^)]+)\)\.toBeTruthy\(\)\s*\|\|\s*([^)]+)\)/g,
    'expect($1 || $2).toBeTruthy()');

  // Pattern 9: expect(fn.canTransition(X).toBe(Y), true) -> expect(fn.canTransition(X, Y)).toBe(true)
  content = content.replace(/expect\(([^)]+)\.canTransition\(([^)]+)\)\.toBe\(([^)]+)\),\s*(true|false)\)/g,
    'expect($1.canTransition($2, $3)).toBe($4)');

  // Pattern 10: expect(x.toBe(y), z) where it should be expect(fn(x, y)).toBe(z)
  // This is tricky - skip

  // Pattern 11: ().toThrow() => -> () =>
  content = content.replace(/\(\)\.toThrow\(\)\s*=>/g, '() =>');

  // Pattern 12: expect(Array.isArray(x && y).toBeTruthy() -> expect(Array.isArray(x) && y).toBeTruthy()
  content = content.replace(/expect\(Array\.isArray\(([^&]+)\s*&&\s*([^)]+)\)\.toBeTruthy\(\)/g,
    'expect(Array.isArray($1) && $2).toBeTruthy()');

  // Pattern 13: expect(typeof x === "y" && z).toBeTruthy() - keep as is but fix parentheses

  // Pattern 14: Fix .toBe after .includes in complex expressions
  content = content.replace(/expect\(([a-zA-Z_][a-zA-Z0-9_]*)\[(\d+)\)\.toBe\((\d+),\s*(\d+)\],\s*(\w+)\)/g,
    'expect($1[$2, $3]).toBe($5)');

  if (content !== original) {
    writeFileSync(filePath, content);
    return true;
  }
  return false;
}

const testDir = process.argv[2] || 'tests/agents';
const files = getAllTestFiles(testDir);
let fixed = 0;

for (const file of files) {
  if (fixFile(file)) {
    console.log('Fixed:', file);
    fixed++;
  }
}

console.log(`\nFixed ${fixed} files`);
