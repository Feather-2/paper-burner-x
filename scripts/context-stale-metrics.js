#!/usr/bin/env node
/**
 * context-stale-metrics.js — stale 指标快照
 *
 * 调用 context-stale --all，并输出趋势与 top stale 模块。
 *
 * Usage:
 *   node scripts/context-stale-metrics.js
 *   node scripts/context-stale-metrics.js --top 20
 * @module context-stale-metrics
 */

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { ROOT, output, today } from './context-utils.js';

const args = process.argv.slice(2);
const flags = {
  top: 10,
  historyLimit: 30,
  outputPath: '.context/.generated/stale-metrics.json',
};

for (let i = 0; i < args.length; i++) {
  const cur = args[i];
  if (cur === '--top' && args[i + 1]) flags.top = Number(args[++i]);
  else if (cur === '--history-limit' && args[i + 1]) flags.historyLimit = Number(args[++i]);
  else if (cur === '--output' && args[i + 1]) flags.outputPath = args[++i];
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
  const rows = stale.results || [];
  const top = rows
    .map(r => ({ module: r.module, stale_items: r.stale.length }))
    .sort((a, b) => b.stale_items - a.stale_items)
    .slice(0, Math.max(1, flags.top));

  const snapshot = {
    date: today(),
    generated_at: new Date().toISOString(),
    modules_checked: stale.modules_checked || 0,
    stale_modules: stale.stale_modules || 0,
    top,
  };

  const abs = toAbs(flags.outputPath);
  await mkdir(dirname(abs), { recursive: true });
  const history = await loadHistory(abs);
  history.runs.push(snapshot);
  history.runs = history.runs.slice(-Math.max(1, flags.historyLimit));
  history.updated_at = new Date().toISOString();
  history.latest = snapshot;

  await writeFile(abs, JSON.stringify(history, null, 2) + '\n', 'utf8');

  const trend = computeTrend(history.runs);
  return {
    ok: true,
    output: relativize(abs),
    latest: snapshot,
    trend,
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

async function loadHistory(absPath) {
  try {
    const parsed = JSON.parse(await readFile(absPath, 'utf8'));
    if (Array.isArray(parsed.runs)) return parsed;
  } catch {
    // ignore
  }
  return { runs: [], latest: null, updated_at: null };
}

function computeTrend(runs) {
  if (!Array.isArray(runs) || runs.length < 2) {
    return { direction: 'flat', delta: 0 };
  }
  const prev = runs[runs.length - 2]?.stale_modules || 0;
  const curr = runs[runs.length - 1]?.stale_modules || 0;
  const delta = curr - prev;
  return {
    direction: delta < 0 ? 'improving' : delta > 0 ? 'regressing' : 'flat',
    delta,
  };
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
  console.log('Usage: node scripts/context-stale-metrics.js [options]');
  console.log('');
  console.log('Options:');
  console.log('  --top <n>            include top n stale modules (default: 10)');
  console.log('  --history-limit <n>  keep latest n snapshots (default: 30)');
  console.log('  --output <path>      metrics output path');
}
