#!/usr/bin/env node
/**
 * context-stale-fix-plan.js — stale 文档治理待办计划
 *
 * 基于 context-stale --all 输出，生成可执行的模块治理清单。
 *
 * Usage:
 *   node scripts/context-stale-fix-plan.js
 *   node scripts/context-stale-fix-plan.js --limit 20
 * @module context-stale-fix-plan
 */

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { ROOT, output, today } from './context-utils.js';

const args = process.argv.slice(2);
const flags = {
  limit: 15,
  outputDir: '.context/.generated',
};

for (let i = 0; i < args.length; i++) {
  const cur = args[i];
  if (cur === '--limit' && args[i + 1]) flags.limit = Number(args[++i]);
  else if (cur === '--output-dir' && args[i + 1]) flags.outputDir = args[++i];
  else if (cur === '--help' || cur === '-h') {
    printHelp();
    process.exit(0);
  }
}

try {
  const result = await run(flags);
  output(result);
  process.exit(result.ok ? 0 : 1);
} catch (err) {
  output({ ok: false, error: err.message });
  process.exit(1);
}

async function run(flags) {
  const stale = runStaleAll();
  const rows = (stale.results || [])
    .filter(r => r.module && r.module !== '(global)')
    .sort((a, b) => b.stale.length - a.stale.length)
    .slice(0, Math.max(1, flags.limit));

  const todos = rows.map((r, idx) => ({
    priority: idx + 1,
    module: r.module,
    stale_count: r.stale.length,
    reasons: r.stale.map(s => s.reason),
    commands: {
      inspect: `pb-context load ${r.module} --scenario edit --format human`,
      stale: `pb-context stale ${r.module} --format human`,
      finalize: 'pb-context finalize --check-supersedes',
    },
  }));

  const outDirAbs = toAbs(flags.outputDir);
  const outJson = join(outDirAbs, `stale-fix-plan-${today()}.json`);
  const outMd = join(outDirAbs, `stale-fix-plan-${today()}.md`);
  await mkdir(dirname(outJson), { recursive: true });

  const payload = {
    generated_at: new Date().toISOString(),
    total_candidates: stale.stale_modules || 0,
    selected: todos.length,
    todos,
  };
  const markdown = renderMarkdown(payload);

  await writeFile(outJson, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  await writeFile(outMd, markdown, 'utf8');

  return {
    ok: true,
    selected: todos.length,
    output: {
      json: relativize(outJson),
      md: relativize(outMd),
    },
  };
}

function runStaleAll() {
  const stdout = execFileSync('node', [join(ROOT, 'scripts', 'context-stale.js'), '--all'], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim();
  const lines = stdout.split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i]);
    } catch {
      // continue
    }
  }
  throw new Error('failed to parse context-stale output');
}

function renderMarkdown(payload) {
  const lines = [];
  lines.push('# Stale Fix Plan');
  lines.push('');
  lines.push(`- Generated: ${payload.generated_at}`);
  lines.push(`- Candidates: ${payload.total_candidates}`);
  lines.push(`- Selected: ${payload.selected}`);
  lines.push('');

  for (const t of payload.todos) {
    lines.push(`## P${t.priority} · ${t.module}`);
    lines.push(`- stale items: ${t.stale_count}`);
    for (const r of t.reasons.slice(0, 5)) lines.push(`- reason: ${r}`);
    lines.push(`- inspect: \`${t.commands.inspect}\``);
    lines.push(`- stale-check: \`${t.commands.stale}\``);
    lines.push(`- finalize-check: \`${t.commands.finalize}\``);
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function toAbs(path) {
  return path.startsWith('/') ? path : join(ROOT, path);
}

function relativize(absPath) {
  const norm = absPath.replace(/\\/g, '/');
  const root = `${ROOT.replace(/\\/g, '/')}/`;
  return norm.startsWith(root) ? norm.slice(root.length) : absPath;
}

function printHelp() {
  console.log('Usage: node scripts/context-stale-fix-plan.js [options]');
  console.log('');
  console.log('Options:');
  console.log('  --limit <n>          number of modules in plan (default: 15)');
  console.log('  --output-dir <path>  output directory (default: .context/.generated)');
}
