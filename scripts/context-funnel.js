#!/usr/bin/env node
/**
 * context-funnel.js — Phase 4 并发漏斗 MVP
 *
 * 输入 issue 清单，按依赖图做扇出分组，并生成并发执行计划与冲突清单。
 * 当前实现覆盖 L1/L2，并提供 L3-lite 深度冲突评估（零 LLM 规则版）。
 *
 * Usage:
 *   node scripts/context-funnel.js --input .context/.generated/issue-triage-2026-02-20.json
 *   node scripts/context-funnel.js --max-parallel 4 --dry-run
 * @module context-funnel
 */

import { join, dirname } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { CTX_DIR, ROOT, output, today } from './context-utils.js';

const args = process.argv.slice(2);
const flags = {
  input: null,
  outputDir: '.context/.generated',
  maxParallel: 4,
  dryRun: false,
};

for (let i = 0; i < args.length; i++) {
  const cur = args[i];
  if (cur === '--input' && args[i + 1]) flags.input = args[++i];
  else if (cur === '--output-dir' && args[i + 1]) flags.outputDir = args[++i];
  else if (cur === '--max-parallel' && args[i + 1]) flags.maxParallel = Number(args[++i]);
  else if (cur === '--dry-run') flags.dryRun = true;
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
  const inputPath = await resolveInput(flags.input);
  if (!inputPath) return { ok: false, error: 'no input file found (use --input)' };

  const payload = JSON.parse(await readFile(inputPath, 'utf8'));
  const issues = normalizeIssues(payload);
  if (issues.length === 0) {
    return { ok: false, error: 'input has no issues (expect top_priority or array)' };
  }

  const moduleGraph = await loadModuleGraph();
  const groups = buildConnectedGroups(issues, moduleGraph);
  const plan = buildExecutionPlan(groups, Math.max(1, flags.maxParallel));
  const conflicts = detectConflicts(groups);
  const summary = renderSummary({ inputPath, issues, groups, plan, conflicts });

  const baseName = `context-funnel-${today()}`;
  const outDirAbs = toAbs(flags.outputDir);
  const outPlan = join(outDirAbs, `${baseName}.plan.json`);
  const outConflicts = join(outDirAbs, `${baseName}.conflicts.json`);
  const outSummary = join(outDirAbs, `${baseName}.summary.md`);

  if (!flags.dryRun) {
    await mkdir(dirname(outPlan), { recursive: true });
    await writeFile(outPlan, JSON.stringify(plan, null, 2) + '\n', 'utf8');
    await writeFile(outConflicts, JSON.stringify(conflicts, null, 2) + '\n', 'utf8');
    await writeFile(outSummary, summary, 'utf8');
  }

  return {
    ok: true,
    mode: flags.dryRun ? 'dry_run' : 'write',
    input: relativize(inputPath),
    totals: {
      issues: issues.length,
      groups: groups.length,
      conflict_modules: conflicts.l1.module_conflicts.length,
      conflict_pairs: conflicts.l2.group_pairs.length,
      waves: plan.waves.length,
    },
    output: {
      plan: relativize(outPlan),
      conflicts: relativize(outConflicts),
      summary: relativize(outSummary),
    },
  };
}

async function resolveInput(explicit) {
  if (explicit) {
    const abs = toAbs(explicit);
    try {
      await readFile(abs, 'utf8');
      return abs;
    } catch {
      return null;
    }
  }

  const fallback = join(CTX_DIR, '.generated', `issue-triage-${today()}.json`);
  try {
    await readFile(fallback, 'utf8');
    return fallback;
  } catch {
    return null;
  }
}

function normalizeIssues(payload) {
  if (Array.isArray(payload)) return payload.map(normalizeIssue).filter(Boolean);
  if (Array.isArray(payload.top_priority)) return payload.top_priority.map(normalizeIssue).filter(Boolean);
  if (Array.isArray(payload.issues)) return payload.issues.map(normalizeIssue).filter(Boolean);
  return [];
}

function normalizeIssue(row) {
  const module = String(row.module || '').trim();
  const key = String(row.key || row.id || '');
  if (!module) return null;
  return {
    key: key || `anon:${module}:${hashish(String(row.summary || ''))}`,
    module,
    kind: row.kind || 'hardening',
    severity: row.severity || 'low',
    summary: row.summary || '',
    score: Number.isFinite(row.score) ? row.score : 0,
  };
}

async function loadModuleGraph() {
  try {
    const text = await readFile(join(CTX_DIR, 'deps', 'module-graph.json'), 'utf8');
    return JSON.parse(text);
  } catch {
    return { edges: [] };
  }
}

function buildConnectedGroups(issues, graph) {
  const modules = [...new Set(issues.map(i => i.module))];
  const adj = new Map(modules.map(m => [m, new Set()]));

  for (const edge of graph.edges || []) {
    if (!adj.has(edge.from) || !adj.has(edge.to)) continue;
    adj.get(edge.from).add(edge.to);
    adj.get(edge.to).add(edge.from);
  }

  const byModule = new Map();
  for (const i of issues) {
    const arr = byModule.get(i.module) || [];
    arr.push(i);
    byModule.set(i.module, arr);
  }

  const seen = new Set();
  const groups = [];
  for (const module of modules) {
    if (seen.has(module)) continue;
    const queue = [module];
    const component = [];
    seen.add(module);

    while (queue.length > 0) {
      const cur = queue.shift();
      component.push(cur);
      for (const nxt of adj.get(cur) || []) {
        if (seen.has(nxt)) continue;
        seen.add(nxt);
        queue.push(nxt);
      }
    }

    const groupIssues = component.flatMap(m => byModule.get(m) || []);
    const byKind = { bug: 0, hardening: 0 };
    for (const i of groupIssues) byKind[i.kind] = (byKind[i.kind] || 0) + 1;
    const score = groupIssues.reduce((sum, i) => sum + (i.score || 0), 0);

    groups.push({
      id: `g-${groups.length + 1}`,
      modules: component.sort(),
      issue_keys: groupIssues.map(i => i.key),
      issue_count: groupIssues.length,
      by_kind: byKind,
      score,
    });
  }

  groups.sort((a, b) => b.score - a.score || b.issue_count - a.issue_count);
  return groups;
}

function buildExecutionPlan(groups, maxParallel) {
  const waves = [];
  for (let i = 0; i < groups.length; i += maxParallel) {
    const slice = groups.slice(i, i + maxParallel);
    waves.push({
      wave: waves.length + 1,
      groups: slice.map(g => g.id),
      total_issues: slice.reduce((n, g) => n + g.issue_count, 0),
    });
  }

  return {
    generated_at: new Date().toISOString(),
    mode: 'mvp',
    max_parallel: maxParallel,
    groups,
    waves,
    notes: [
      'L1/L2 conflict detection enabled',
      'L3-lite deep conflict analysis enabled (rule-based)',
    ],
  };
}

function detectConflicts(groups) {
  const moduleOwners = new Map();
  for (const g of groups) {
    for (const m of g.modules) {
      const owners = moduleOwners.get(m) || [];
      owners.push(g.id);
      moduleOwners.set(m, owners);
    }
  }

  const moduleConflicts = [];
  for (const [module, owners] of moduleOwners) {
    if (owners.length <= 1) continue;
    moduleConflicts.push({ module, owners: [...new Set(owners)] });
  }

  const groupPairs = [];
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const a = groups[i];
      const b = groups[j];
      const overlap = a.modules.filter(m => b.modules.includes(m));
      if (overlap.length === 0) continue;
      groupPairs.push({
        left: a.id,
        right: b.id,
        overlap_modules: overlap,
        summary: `shared modules=${overlap.length}; left issues=${a.issue_count}, right issues=${b.issue_count}`,
      });
    }
  }

  const l3Pairs = groupPairs.map((pair) => {
    const left = groups.find(g => g.id === pair.left);
    const right = groups.find(g => g.id === pair.right);
    const overlapCount = pair.overlap_modules.length;
    const issueLoad = (left?.issue_count || 0) + (right?.issue_count || 0);
    const score = (overlapCount * 3) + (issueLoad >= 10 ? 2 : issueLoad >= 5 ? 1 : 0);
    const risk = score >= 8 ? 'high' : score >= 5 ? 'medium' : 'low';
    return {
      ...pair,
      risk,
      score,
      recommendation: risk === 'high'
        ? 'serialize groups or split overlapping modules before execution'
        : risk === 'medium'
          ? 'add review checkpoint before merge'
          : 'parallel execution is acceptable',
    };
  });

  return {
    generated_at: new Date().toISOString(),
    l1: { module_conflicts: moduleConflicts },
    l2: { group_pairs: groupPairs },
    l3: {
      pending: false,
      analyzed_pairs: l3Pairs.length,
      deep_pairs: l3Pairs,
    },
  };
}

function renderSummary({ inputPath, issues, groups, plan, conflicts }) {
  const lines = [];
  lines.push('# Context Funnel Summary');
  lines.push('');
  lines.push(`- Generated: ${new Date().toISOString()}`);
  lines.push(`- Input: ${relativize(inputPath)}`);
  lines.push(`- Issues: ${issues.length}`);
  lines.push(`- Groups: ${groups.length}`);
  lines.push(`- Waves: ${plan.waves.length}`);
  lines.push(`- L1 conflicts: ${conflicts.l1.module_conflicts.length}`);
  lines.push(`- L2 pairs: ${conflicts.l2.group_pairs.length}`);
  lines.push(`- L3-lite analyzed pairs: ${conflicts.l3.analyzed_pairs || 0}`);
  lines.push('');
  lines.push('## Waves');
  for (const w of plan.waves) {
    lines.push(`- Wave ${w.wave}: ${w.groups.join(', ')} (issues=${w.total_issues})`);
  }
  lines.push('');
  lines.push('## Top Groups');
  for (const g of groups.slice(0, 10)) {
    lines.push(`- ${g.id}: score=${g.score.toFixed(2)}, issues=${g.issue_count}, modules=${g.modules.slice(0, 5).join(', ')}`);
  }
  lines.push('');
  lines.push('## Notes');
  lines.push('- Use this output as scheduling input for kanban-batch / gh-issue-batch integration.');
  lines.push('- L3-lite recommendations provide deterministic conflict triage without model calls.');
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

function hashish(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) - h) + text.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}

function printHelp() {
  console.log('Usage: node scripts/context-funnel.js [options]');
  console.log('');
  console.log('Options:');
  console.log('  --input <file>         input issue snapshot (issue-triage output)');
  console.log('  --output-dir <dir>     output directory (default: .context/.generated)');
  console.log('  --max-parallel <n>     groups per wave (default: 4)');
  console.log('  --dry-run              analyze only, do not write artifacts');
}
