#!/usr/bin/env node
/**
 * Test Scaffold Generator - AI 友好的测试脚手架
 * 
 * 生成源文件与测试文件的映射，输出适合作为 AI 上下文的提示词
 * 
 * Usage:
 *   node test-scaffold.js js/agents/core           # 模块脚手架
 *   node test-scaffold.js js/agents/core --diff    # 只显示缺失/过期
 *   node test-scaffold.js js/agents/core --prompt  # 生成 AI 提示词
 */

import { promises as fs } from 'fs';
import path from 'path';

const ROOT = process.cwd();

const TEST_TYPES = {
  unit: { base: 'tests/unit', suffix: '.test.js', desc: '单元测试 (1:1 源文件映射)' },
  integration: { base: 'tests/integration', suffix: '.test.js', desc: '集成测试 (跨模块功能)' },
  e2e: { base: 'tests/e2e', suffix: '.e2e.test.js', desc: '端到端测试 (完整流程)' }
};

async function findFiles(dir, pattern = /\.js$/) {
  const results = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        results.push(...await findFiles(fullPath, pattern));
      } else if (entry.isFile() && pattern.test(entry.name)) {
        results.push(fullPath);
      }
    }
  } catch {}
  return results;
}

async function getFileMtime(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.mtime;
  } catch {
    return null;
  }
}

async function readFileHead(filePath, lines = 30) {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return content.split('\n').slice(0, lines).join('\n');
  } catch {
    return null;
  }
}

function sourceToTestPath(sourcePath, type = 'unit') {
  const { base, suffix } = TEST_TYPES[type];
  const relative = sourcePath.replace(/^js\//, '');
  const parsed = path.parse(relative);
  return path.join(base, parsed.dir, `${parsed.name}${suffix}`);
}

async function analyzeModule(modulePath) {
  const absoluteModulePath = path.join(ROOT, modulePath);
  
  // 获取源文件
  const sourceFiles = await findFiles(absoluteModulePath);
  const sources = sourceFiles
    .map(f => path.relative(ROOT, f))
    .filter(f => !f.includes('.test.') && !f.includes('.spec.') && !f.endsWith('.d.ts'))
    .sort();

  // 分析每种测试类型
  const analysis = { unit: [], integration: [], e2e: [] };
  
  for (const type of Object.keys(TEST_TYPES)) {
    const testBase = path.join(ROOT, TEST_TYPES[type].base, modulePath.replace(/^js\//, ''));
    let testFiles = [];
    try {
      testFiles = await findFiles(testBase, /\.test\.js$/);
    } catch {}
    const tests = testFiles.map(f => path.relative(ROOT, f)).sort();

    for (const source of sources) {
      const expectedTest = sourceToTestPath(source, type);
      const sourceName = path.basename(source, '.js');
      const actualTest = tests.find(t => path.basename(t).includes(sourceName));
      
      const sourceMtime = await getFileMtime(path.join(ROOT, source));
      const testMtime = actualTest ? await getFileMtime(path.join(ROOT, actualTest)) : null;
      
      let status = 'missing';
      if (actualTest) {
        status = testMtime && sourceMtime && sourceMtime > testMtime ? 'stale' : 'covered';
      }
      
      analysis[type].push({ source, expectedTest, actualTest, status, sourceMtime, testMtime });
    }
  }

  return { sources, analysis };
}

function formatPrompt(modulePath, result) {
  const lines = [];
  const moduleRelative = modulePath.replace(/^js\//, '');
  
  // 统计
  const unitMissing = result.analysis.unit.filter(a => a.status === 'missing');
  const unitStale = result.analysis.unit.filter(a => a.status === 'stale');
  const unitCovered = result.analysis.unit.filter(a => a.status === 'covered');

  lines.push(`<test-scaffold module="${moduleRelative}">`);
  lines.push('');
  lines.push('## 模块概览');
  lines.push(`- 源文件: ${result.sources.length}`);
  lines.push(`- 单元测试: ${unitCovered.length} 覆盖, ${unitMissing.length} 缺失, ${unitStale.length} 过期`);
  lines.push('');
  
  lines.push('## 目录映射');
  lines.push('```');
  lines.push(`源目录: ${modulePath}/`);
  lines.push(`单元测试: tests/unit/${moduleRelative}/`);
  lines.push(`集成测试: tests/integration/${moduleRelative}/`);
  lines.push('```');
  lines.push('');

  if (unitMissing.length > 0) {
    lines.push('## 需要创建的单元测试');
    lines.push('');
    for (const m of unitMissing.slice(0, 15)) {
      const exports = '// TODO: 分析导出符号';
      lines.push(`### ${path.basename(m.source)}`);
      lines.push(`- 源: \`${m.source}\``);
      lines.push(`- 测试: \`${m.expectedTest}\``);
      lines.push('');
    }
    if (unitMissing.length > 15) {
      lines.push(`... 还有 ${unitMissing.length - 15} 个文件需要测试`);
      lines.push('');
    }
  }

  if (unitStale.length > 0) {
    lines.push('## 需要更新的测试 (源文件已修改)');
    lines.push('');
    for (const s of unitStale) {
      lines.push(`- \`${s.source}\` → \`${s.actualTest}\``);
    }
    lines.push('');
  }

  lines.push('## 测试模板');
  lines.push('```javascript');
  lines.push(`import { describe, it, expect, vi, beforeEach } from 'vitest';`);
  lines.push(`import { /* exports */ } from '${getRelativeImport(modulePath)}';`);
  lines.push('');
  lines.push('describe("ModuleName", () => {');
  lines.push('  describe("functionName", () => {');
  lines.push('    it("should handle normal case", () => {});');
  lines.push('    it("should handle edge case", () => {});');
  lines.push('    it("should throw on invalid input", () => {});');
  lines.push('  });');
  lines.push('});');
  lines.push('```');
  lines.push('');
  lines.push('</test-scaffold>');

  return lines.join('\n');
}

function getRelativeImport(modulePath) {
  // 计算从 tests/unit/X 到 js/X 的相对路径
  const depth = modulePath.split('/').length + 1; // tests/unit 多 2 层
  return '../'.repeat(depth) + modulePath;
}

function formatDiff(modulePath, result) {
  const lines = [];
  const moduleRelative = modulePath.replace(/^js\//, '');
  
  const unitMissing = result.analysis.unit.filter(a => a.status === 'missing');
  const unitStale = result.analysis.unit.filter(a => a.status === 'stale');

  lines.push(`## ${moduleRelative} 测试差异`);
  lines.push('');
  lines.push(`| 状态 | 数量 |`);
  lines.push(`|------|------|`);
  lines.push(`| 缺失 | ${unitMissing.length} |`);
  lines.push(`| 过期 | ${unitStale.length} |`);
  lines.push('');

  if (unitMissing.length > 0) {
    lines.push('### 缺失');
    for (const m of unitMissing) {
      lines.push(`- ${path.basename(m.source)} → ${m.expectedTest}`);
    }
    lines.push('');
  }

  if (unitStale.length > 0) {
    lines.push('### 过期');
    for (const s of unitStale) {
      lines.push(`- ${path.basename(s.source)} (源文件更新于 ${s.sourceMtime?.toISOString().split('T')[0]})`);
    }
  }

  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const modulePath = args.find(a => !a.startsWith('-')) || 'js/agents';
  const promptMode = args.includes('--prompt');
  const diffMode = args.includes('--diff');

  const result = await analyzeModule(modulePath);
  
  if (promptMode) {
    console.log(formatPrompt(modulePath, result));
  } else if (diffMode) {
    console.log(formatDiff(modulePath, result));
  } else {
    console.log(formatPrompt(modulePath, result));
  }
}

main().catch(console.error);
