#!/usr/bin/env node
/**
 * Test Scaffold - 生成 AI 友好的测试提示词
 * 
 * Usage:
 *   node scripts/test-scaffold.js js/agents/core           # 模块脚手架
 *   node scripts/test-scaffold.js js/agents/core --diff    # 只显示缺失/过期
 */

import { promises as fs } from 'fs';
import path from 'path';

const ROOT = process.cwd();

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

async function countTestCases(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return (content.match(/\bit\s*\(/g) || []).length;
  } catch {
    return 0;
  }
}

function sourceToTestPath(sourcePath) {
  const relative = sourcePath.replace(/^js\//, '');
  const parsed = path.parse(relative);
  return path.join('tests/unit', parsed.dir, `${parsed.name}.test.js`);
}

async function analyzeModule(modulePath) {
  const absoluteModulePath = path.join(ROOT, modulePath);
  
  const sourceFiles = await findFiles(absoluteModulePath);
  const sources = sourceFiles
    .map(f => path.relative(ROOT, f))
    .filter(f => !f.includes('.test.') && !f.includes('.spec.') && !f.endsWith('.d.ts'))
    .sort();

  const analysis = [];
  
  for (const source of sources) {
    const expectedTest = sourceToTestPath(source);
    const testPath = path.join(ROOT, expectedTest);
    
    const sourceMtime = await getFileMtime(path.join(ROOT, source));
    const testMtime = await getFileMtime(testPath);
    const testCount = testMtime ? await countTestCases(testPath) : 0;
    
    let status = 'missing';
    if (testMtime) {
      if (testCount === 0) status = 'empty';
      else if (sourceMtime > testMtime) status = 'stale';
      else status = 'covered';
    }
    
    analysis.push({ source, expectedTest, status, testCount, sourceMtime, testMtime });
  }

  return { sources, analysis };
}

function formatPrompt(modulePath, result, diffOnly = false) {
  const lines = [];
  const moduleRelative = modulePath.replace(/^js\//, '');
  
  const missing = result.analysis.filter(a => a.status === 'missing');
  const empty = result.analysis.filter(a => a.status === 'empty');
  const stale = result.analysis.filter(a => a.status === 'stale');
  const covered = result.analysis.filter(a => a.status === 'covered');

  lines.push(`<test-context module="${moduleRelative}">`);
  lines.push('');
  lines.push('## 状态');
  lines.push(`源文件: ${result.sources.length} | 覆盖: ${covered.length} | 缺失: ${missing.length} | 空骨架: ${empty.length} | 过期: ${stale.length}`);
  lines.push('');
  
  lines.push('## 规范');
  lines.push('- 框架: vitest');
  lines.push('- 单元测试路径: `tests/unit/{module}/{file}.test.js`');
  lines.push('- 集成测试路径: `tests/integration/{module}/`');
  lines.push(`- 导入路径: 从 tests/unit/${moduleRelative}/ 到 js/${moduleRelative}/ 的相对路径`);
  lines.push('- 测试风格: 每个导出函数/类单独 describe，边界条件独立 it');
  lines.push('');

  if (missing.length > 0) {
    lines.push('## 需要创建');
    for (const m of missing) {
      lines.push(`- ${m.source} → ${m.expectedTest}`);
    }
    lines.push('');
  }

  if (empty.length > 0) {
    lines.push('## 空骨架 (需填充测试)');
    for (const e of empty) {
      lines.push(`- ${e.expectedTest}`);
    }
    lines.push('');
  }

  if (stale.length > 0) {
    lines.push('## 需要更新 (源文件已修改)');
    for (const s of stale) {
      lines.push(`- ${s.source} (${s.testCount} 用例)`);
    }
    lines.push('');
  }

  if (!diffOnly && covered.length > 0) {
    lines.push('## 已覆盖');
    for (const c of covered) {
      lines.push(`- ${path.basename(c.source)} (${c.testCount} 用例)`);
    }
    lines.push('');
  }

  lines.push('</test-context>');
  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const modulePath = args.find(a => !a.startsWith('-')) || 'js/agents';
  const diffOnly = args.includes('--diff');

  const result = await analyzeModule(modulePath);
  console.log(formatPrompt(modulePath, result, diffOnly));
}

main().catch(console.error);
