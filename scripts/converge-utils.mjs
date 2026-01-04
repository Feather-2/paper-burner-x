#!/usr/bin/env node
/**
 * 工具函数收敛脚本
 *
 * 将本地定义的 isPlainObject/toNonEmptyString 替换为从 value-utils.js 导入
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, relative, dirname } from "path";

const AGENTS_DIR = new URL("../js/agents", import.meta.url).pathname;
const VALUE_UTILS_PATH = "shared/utils/value-utils.js";

// 要跳过的文件
const SKIP_FILES = new Set([
  "shared/utils/value-utils.js",
]);

// 匹配本地函数定义的正则
const FUNC_PATTERNS = {
  isPlainObject: /\n*function isPlainObject\s*\([^)]*\)\s*\{[^}]*\}\n*/g,
  toNonEmptyString: /\n*function toNonEmptyString\s*\([^)]*\)\s*\{[^}]*(?:\{[^}]*\}[^}]*)?\}\n*/g,
};

function findJsFiles(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      findJsFiles(fullPath, files);
    } else if (entry.endsWith(".js") && !entry.endsWith(".test.js")) {
      files.push(fullPath);
    }
  }
  return files;
}

function calculateRelativePath(fromFile, toPath) {
  const fromDir = dirname(fromFile);
  const toFullPath = join(AGENTS_DIR, toPath);
  let rel = relative(fromDir, toFullPath);
  if (!rel.startsWith(".")) {
    rel = "./" + rel;
  }
  return rel.replace(/\\/g, "/");
}

function hasImportFrom(content, importPath) {
  const escaped = importPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`from\\s*["']${escaped}["']`);
  return regex.test(content);
}

function addImport(content, funcs, importPath) {
  const funcList = funcs.join(", ");
  const importStatement = `import { ${funcList} } from "${importPath}";`;

  // 找到最后一个 import 语句的位置
  const importMatches = [...content.matchAll(/^import\s+.*?from\s+["'][^"']+["'];?\s*$/gm)];

  if (importMatches.length > 0) {
    const lastImport = importMatches[importMatches.length - 1];
    const insertPos = lastImport.index + lastImport[0].length;
    return content.slice(0, insertPos) + "\n" + importStatement + content.slice(insertPos);
  } else {
    // 没有 import，在文件开头添加
    return importStatement + "\n\n" + content;
  }
}

function processFile(filePath) {
  const relPath = relative(AGENTS_DIR, filePath).replace(/\\/g, "/");

  if (SKIP_FILES.has(relPath)) {
    return { skipped: true, reason: "in skip list" };
  }

  let content = readFileSync(filePath, "utf-8");
  const originalContent = content;

  const funcsToImport = [];

  // 检查并删除本地定义
  for (const [funcName, pattern] of Object.entries(FUNC_PATTERNS)) {
    if (pattern.test(content)) {
      content = content.replace(pattern, "\n\n");
      funcsToImport.push(funcName);
    }
    // 重置 regex lastIndex
    pattern.lastIndex = 0;
  }

  if (funcsToImport.length === 0) {
    return { skipped: true, reason: "no local definitions" };
  }

  // 计算相对路径
  const importPath = calculateRelativePath(filePath, VALUE_UTILS_PATH);

  // 检查是否已经有 import
  if (hasImportFrom(content, importPath)) {
    // 已有 import，需要扩展它
    const importRegex = new RegExp(
      `import\\s*\\{([^}]*)\\}\\s*from\\s*["']${importPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`
    );
    const match = content.match(importRegex);
    if (match) {
      const existingImports = match[1].split(",").map(s => s.trim()).filter(Boolean);
      const newImports = [...new Set([...existingImports, ...funcsToImport])];
      const newImportClause = newImports.join(", ");
      content = content.replace(importRegex, `import { ${newImportClause} } from "${importPath}"`);
    }
  } else {
    // 添加新 import
    content = addImport(content, funcsToImport, importPath);
  }

  // 清理多余空行
  content = content.replace(/\n{3,}/g, "\n\n");

  if (content !== originalContent) {
    writeFileSync(filePath, content, "utf-8");
    return { modified: true, funcs: funcsToImport };
  }

  return { skipped: true, reason: "no changes needed" };
}

// Main
const files = findJsFiles(AGENTS_DIR);
let modified = 0;
let skipped = 0;
const results = [];

for (const file of files) {
  const relPath = relative(AGENTS_DIR, file).replace(/\\/g, "/");
  const result = processFile(file);

  if (result.modified) {
    modified++;
    results.push({ file: relPath, ...result });
    console.log(`✓ ${relPath}: imported ${result.funcs.join(", ")}`);
  } else {
    skipped++;
  }
}

console.log(`\nDone: ${modified} files modified, ${skipped} files skipped`);
