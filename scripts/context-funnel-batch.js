#!/usr/bin/env node
/**
 * context-funnel-batch.js — funnel → batch skill 编排桥
 *
 * 读取 context-funnel 产物，生成可直接用于 kanban-batch / gh-issue-batch 的执行手册。
 * 若本地 planner 可用，会附带 planner 输出摘要。
 *
 * Usage:
 *   node scripts/context-funnel-batch.js --plan .context/.generated/context-funnel-2026-02-21.plan.json
 *   node scripts/context-funnel-batch.js --target both
 * @module context-funnel-batch
 */

import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { ROOT, output, today } from './context-utils.js';

const args = process.argv.slice(2);
const flags = {
  plan: null,
  target: 'both', // kanban | gh | both
  outputDir: '.context/.generated',
};

for (let i = 0; i < args.length; i++) {
  const cur = args[i];
  if (cur === '--plan' && args[i + 1]) flags.plan = args[++i];
  else if (cur === '--target' && args[i + 1]) flags.target = args[++i];
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
  const planPath = await resolvePlan(flags.plan);
  if (!planPath) return { ok: false, error: 'funnel plan not found (use --plan)' };

  const plan = JSON.parse(await readFile(planPath, 'utf8'));
  const waves = Array.isArray(plan.waves) ? plan.waves : [];
  const maxParallel = Number(plan.max_parallel) || 4;

  const planners = [];
  if (flags.target === 'both' || flags.target === 'kanban') {
    planners.push(runPlanner('kanban'));
  }
  if (flags.target === 'both' || flags.target === 'gh') {
    planners.push(runPlanner('gh'));
  }

  const plannerResults = planners;
  const markdown = renderHandoff({
    planPath,
    waves,
    maxParallel,
    target: flags.target,
    plannerResults,
  });

  const outDirAbs = toAbs(flags.outputDir);
  const outPath = join(outDirAbs, `context-funnel-batch-${today()}.md`);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, markdown, 'utf8');

  return {
    ok: true,
    target: flags.target,
    plan: relativize(planPath),
    waves: waves.length,
    output: relativize(outPath),
    planners: plannerResults,
  };
}

async function resolvePlan(explicit) {
  if (explicit) {
    const abs = toAbs(explicit);
    try {
      await readFile(abs, 'utf8');
      return abs;
    } catch {
      return null;
    }
  }

  const dir = toAbs('.context/.generated');
  let files = [];
  try {
    files = (await readdir(dir))
      .filter(name => name.startsWith('context-funnel-') && name.endsWith('.plan.json'))
      .sort();
  } catch {
    return null;
  }
  if (files.length === 0) return null;
  return join(dir, files[files.length - 1]);
}

function runPlanner(kind) {
  const spec = kind === 'kanban'
    ? ['node', ['/home/wing/.claude/skills/kanban-batch/kanban-planner.js', '--dry-run']]
    : ['node', ['/home/wing/.claude/skills/gh-issue-batch/issue-batch-planner.js', '--dry-run']];

  const [bin, args] = spec;
  try {
    const stdout = execFileSync(bin, args, { cwd: ROOT, encoding: 'utf8', timeout: 30_000 });
    return {
      kind,
      ok: true,
      preview: stdout.split('\n').slice(0, 20).join('\n'),
      note: 'planner dry-run executed',
    };
  } catch (err) {
    const text = String(err.stdout || err.stderr || err.message || '').trim();
    return {
      kind,
      ok: false,
      preview: text.split('\n').slice(0, 20).join('\n'),
      note: 'planner unavailable or dependency missing (expected in some environments)',
    };
  }
}

function renderHandoff(ctx) {
  const lines = [];
  lines.push('# Funnel Batch Handoff');
  lines.push('');
  lines.push(`- Generated: ${new Date().toISOString()}`);
  lines.push(`- Funnel plan: ${relativize(ctx.planPath)}`);
  lines.push(`- Waves: ${ctx.waves.length}`);
  lines.push(`- Max parallel: ${ctx.maxParallel}`);
  lines.push(`- Target: ${ctx.target}`);
  lines.push('');

  lines.push('## Wave Mapping');
  for (const wave of ctx.waves) {
    lines.push(`- Wave ${wave.wave}: ${wave.groups.join(', ')} (issues=${wave.total_issues})`);
  }
  lines.push('');

  lines.push('## Execution Commands');
  if (ctx.target === 'both' || ctx.target === 'kanban') {
    lines.push(`- Kanban batch: \`/kanban-batch --max=${ctx.maxParallel} --dry-run\``);
    lines.push(`- Kanban execute: \`/kanban-batch --max=${ctx.maxParallel}\``);
  }
  if (ctx.target === 'both' || ctx.target === 'gh') {
    lines.push(`- GH issue batch: \`/gh-issue-batch --max=${ctx.maxParallel} --dry-run\``);
    lines.push(`- GH execute: \`/gh-issue-batch --max=${ctx.maxParallel}\``);
  }
  lines.push('');

  lines.push('## Planner Probes');
  for (const p of ctx.plannerResults) {
    lines.push(`### ${p.kind}`);
    lines.push(`- status: ${p.ok ? 'ok' : 'unavailable'}`);
    lines.push(`- note: ${p.note}`);
    if (p.preview) {
      lines.push('```');
      lines.push(p.preview);
      lines.push('```');
    }
    lines.push('');
  }

  lines.push('## Notes');
  lines.push('- This bridge keeps funnel planning as SSOT and projects it to batch execution entrypoints.');
  lines.push('- If planner probe fails, run commands manually in the skill environment.');
  lines.push('');
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
  console.log('Usage: node scripts/context-funnel-batch.js [options]');
  console.log('');
  console.log('Options:');
  console.log('  --plan <path>         funnel plan file (*.plan.json)');
  console.log('  --target <kind>       kanban | gh | both (default: both)');
  console.log('  --output-dir <dir>    output directory (default: .context/.generated)');
}
