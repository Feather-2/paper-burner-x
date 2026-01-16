#!/usr/bin/env node
/**
 * Fix malformed expect patterns after migration
 * Main patterns:
 * 1. expect(x.toBeTruthy()) -> expect(x).toBeTruthy()
 * 2. expect(x.toBe(y), z) -> expect(x).toBe(y)
 * 3. expect(x.toEqual(y), z) -> expect(x).toEqual(y)
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const targetPath = process.argv[2] || "tests/agents";

function fixFile(filePath) {
  let content = readFileSync(filePath, "utf-8");
  const original = content;
  let changes = [];

  // Pattern 1: expect(something.toBeTruthy()) -> expect(something).toBeTruthy()
  // Need to handle nested calls like expect(x.includes("y").toBeTruthy())
  const toBeTruthyRegex = /expect\(([^)]+)\.toBeTruthy\(\)\)/g;
  content = content.replace(toBeTruthyRegex, (match, inner) => {
    // Check if inner already has balanced parentheses
    let depth = 0;
    for (const char of inner) {
      if (char === '(') depth++;
      if (char === ')') depth--;
    }
    if (depth === 0) {
      changes.push(`toBeTruthy: ${inner.substring(0, 30)}...`);
      return `expect(${inner}).toBeTruthy()`;
    }
    return match;
  });

  // Pattern 2: expect(something.toBe(value)) -> expect(something).toBe(value)
  const toBeRegex = /expect\(([^.]+(?:\.[^.]+)*)\.toBe\(([^)]+)\)\)/g;
  content = content.replace(toBeRegex, (match, inner, value) => {
    let depth = 0;
    for (const char of inner) {
      if (char === '(') depth++;
      if (char === ')') depth--;
    }
    if (depth === 0) {
      changes.push(`toBe: ${inner.substring(0, 30)}...`);
      return `expect(${inner}).toBe(${value})`;
    }
    return match;
  });

  // Pattern 3: expect(something.toEqual(value)) -> expect(something).toEqual(value)
  const toEqualRegex = /expect\(([^.]+(?:\.[^.]+)*)\.toEqual\(([^)]+)\)\)/g;
  content = content.replace(toEqualRegex, (match, inner, value) => {
    let depth = 0;
    for (const char of inner) {
      if (char === '(') depth++;
      if (char === ')') depth--;
    }
    if (depth === 0) {
      changes.push(`toEqual: ${inner.substring(0, 30)}...`);
      return `expect(${inner}).toEqual(${value})`;
    }
    return match;
  });

  if (content !== original) {
    writeFileSync(filePath, content);
    return changes;
  }
  return null;
}

function processDirectory(dirPath) {
  let totalChanges = 0;
  const entries = readdirSync(dirPath);

  for (const entry of entries) {
    const fullPath = join(dirPath, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      totalChanges += processDirectory(fullPath);
    } else if (entry.endsWith(".test.js")) {
      const changes = fixFile(fullPath);
      if (changes && changes.length > 0) {
        console.log(`Fixed ${fullPath}: ${changes.length} changes`);
        totalChanges += changes.length;
      }
    }
  }
  return totalChanges;
}

const stat = statSync(targetPath);
if (stat.isDirectory()) {
  const count = processDirectory(targetPath);
  console.log(`\nTotal changes: ${count}`);
} else {
  const changes = fixFile(targetPath);
  if (changes) {
    console.log(`Fixed: ${targetPath}`);
    changes.forEach(c => console.log(`  - ${c}`));
  }
}
