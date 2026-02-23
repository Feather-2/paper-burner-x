#!/usr/bin/env node
/**
 * context-coldstart.js — 五维工具链 Phase 0 冷启动
 *
 * 从历史文档和 git log 提取种子决策/原子，并统一经 context-write 写入。
 * 零 LLM，规则化抽取。
 *
 * Usage:
 *   node scripts/context-coldstart.js
 *   node scripts/context-coldstart.js --dry-run
 *   node scripts/context-coldstart.js --max-issues 80 --git-commits 30
 *   node scripts/context-coldstart.js --source docs/agents-architecture-evaluation-2026-02-19-deepscan-166.md
 * @module context-coldstart
 */

import { execFile, execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { access, readFile, readdir } from 'node:fs/promises';
import { ROOT, INTENT_DIR, readJsonl, output, today } from './context-utils.js';

const WRITE_SCRIPT = join(import.meta.dirname, 'context-write.js');

const args = process.argv.slice(2);
const flags = {
  dryRun: false,
  maxIssues: 120,
  gitCommits: 20,
  includeGit: true,
  force: false,
  sources: [],
};

for (let i = 0; i < args.length; i++) {
  const cur = args[i];
  if (cur === '--dry-run') flags.dryRun = true;
  else if (cur === '--force') flags.force = true;
  else if (cur === '--no-git') flags.includeGit = false;
  else if (cur === '--max-issues' && args[i + 1]) flags.maxIssues = Number(args[++i]);
  else if (cur === '--git-commits' && args[i + 1]) flags.gitCommits = Number(args[++i]);
  else if (cur === '--source' && args[i + 1]) flags.sources.push(args[++i]);
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
  const sourceFiles = await resolveSources(flags.sources);
  if (sourceFiles.length === 0) {
    return {
      ok: false,
      error: 'no source markdown files found',
      hint: 'pass --source <path> or add docs/agents-architecture-evaluation-*.md',
    };
  }

  const parsedIssues = [];
  const parseWarnings = [];

  for (const source of sourceFiles) {
    try {
      const text = await readFile(join(ROOT, source), 'utf8');
      const dateHint = inferDate(source, text);
      parsedIssues.push(...extractIssues(text, source, dateHint));
    } catch (err) {
      parseWarnings.push(`failed to parse ${source}: ${err.message}`);
    }
  }

  const deduped = dedupeIssues(parsedIssues);
  deduped.sort((a, b) => numericIssue(a.issue) - numericIssue(b.issue));
  const selectedIssues = deduped.slice(0, Math.max(0, flags.maxIssues));

  const existingOps = await readJsonl(join(INTENT_DIR, 'decisions', 'ops.jsonl'));
  const existingSlugs = new Set(existingOps.filter(o => o.op === 'upsert').map(o => o.slug));

  const summary = {
    ok: true,
    mode: flags.dryRun ? 'dry_run' : 'apply',
    sources: sourceFiles,
    parse_warnings: parseWarnings,
    totals: {
      parsed_issues: parsedIssues.length,
      unique_issues: deduped.length,
      selected_issues: selectedIssues.length,
    },
    created: {
      decisions: 0,
      atoms: 0,
      git_decisions: 0,
      git_atoms: 0,
    },
    skipped: {
      existing_decisions: 0,
      write_failures: 0,
    },
    errors: [],
    sample: [],
  };

  for (const issue of selectedIssues) {
    const slug = `dec-${issue.date}-coldstart-${issue.issue.toLowerCase()}`;
    const modulePath = issue.file ? dirname(issue.file).replace(/\\/g, '/') : 'js/agents';
    const decision = {
      v: 1,
      type: 'decision_op',
      op: 'upsert',
      slug,
      title: `Coldstart import for ${issue.issue}`,
      choice: issue.file
        ? `记录历史问题 ${issue.issue}，定位到 ${issue.file}`
        : `记录历史问题 ${issue.issue} 的上下文`,
      trigger: { type: 'audit_issue', id: issue.issue },
      modules: [modulePath],
      note: `coldstart source: ${issue.source}`,
      date: issue.date,
    };

    const atom = {
      v: 1,
      type: 'atom',
      atom_key: `${slug}#maintenance`,
      content: buildIssueAtom(issue),
      perspective: 'maintenance',
      status: 'confirmed',
      source: `coldstart:${issue.source}`,
      related_modules: [modulePath],
      related_decisions: [slug],
    };

    if (existingSlugs.has(slug) && !flags.force) {
      summary.skipped.existing_decisions++;
      continue;
    }

    if (flags.dryRun) {
      summary.created.decisions++;
      summary.created.atoms++;
      if (summary.sample.length < 10) {
        summary.sample.push({ slug, issue: issue.issue, module: modulePath, source: issue.source });
      }
      continue;
    }

    const decisionRes = await callWrite('decision', decision);
    if (!decisionRes.ok) {
      summary.skipped.write_failures++;
      summary.errors.push({ step: 'decision', slug, error: decisionRes.error || 'unknown error' });
      continue;
    }
    summary.created.decisions++;
    existingSlugs.add(slug);

    const atomRes = await callWrite('atom', atom);
    if (!atomRes.ok) {
      summary.skipped.write_failures++;
      summary.errors.push({ step: 'atom', slug, error: atomRes.error || 'unknown error' });
      continue;
    }
    summary.created.atoms++;

    if (summary.sample.length < 10) {
      summary.sample.push({ slug, issue: issue.issue, module: modulePath, source: issue.source });
    }
  }

  const gitSeed = flags.includeGit
    ? await seedFromGit(flags, existingSlugs)
    : { created: { decisions: 0, atoms: 0 }, skippedExisting: 0, errors: [], considered: 0, selected: 0, slug: null };

  summary.created.git_decisions = gitSeed.created.decisions;
  summary.created.git_atoms = gitSeed.created.atoms;
  summary.skipped.existing_decisions += gitSeed.skippedExisting;
  summary.errors.push(...gitSeed.errors);
  summary.git = {
    considered: gitSeed.considered,
    selected: gitSeed.selected,
    slug: gitSeed.slug,
  };

  if (summary.errors.length > 0) summary.ok = false;
  return summary;
}

async function seedFromGit(flags, existingSlugs) {
  const commitRows = listRecentCommits(flags.gitCommits);
  const selected = commitRows.filter(c => /fix|refactor|hardening|memory|leak|dispose|orchestrator|stage|audit|security/i.test(c.subject)).slice(0, 12);

  const result = {
    created: { decisions: 0, atoms: 0 },
    skippedExisting: 0,
    errors: [],
    considered: commitRows.length,
    selected: selected.length,
    slug: null,
  };

  if (selected.length === 0) return result;

  const slug = `dec-${today()}-coldstart-git-history`;
  result.slug = slug;

  if (existingSlugs.has(slug) && !flags.force) {
    result.skippedExisting++;
    return result;
  }

  const summaryText = selected
    .map(c => `${c.date} ${c.hash}: ${trimSentence(c.subject, 90)}`)
    .join('; ');

  const decision = {
    v: 1,
    type: 'decision_op',
    op: 'upsert',
    slug,
    title: 'Coldstart import for git history',
    choice: '沉淀近期高信号 commit 作为历史决策语义背景',
    trigger: { type: 'manual', note: 'coldstart import from recent git history' },
    modules: ['js/agents'],
    note: `coldstart git commits: ${selected.length}`,
    date: today(),
  };

  const atom = {
    v: 1,
    type: 'atom',
    atom_key: `${slug}#architecture`,
    content: `Recent high-signal commits: ${summaryText}`,
    perspective: 'architecture',
    status: 'confirmed',
    source: 'coldstart:git-log',
    related_modules: ['js/agents'],
    related_decisions: [slug],
  };

  if (flags.dryRun) {
    result.created.decisions++;
    result.created.atoms++;
    return result;
  }

  const decisionRes = await callWrite('decision', decision);
  if (!decisionRes.ok) {
    result.errors.push({ step: 'git_decision', slug, error: decisionRes.error || 'unknown error' });
    return result;
  }
  result.created.decisions++;

  const atomRes = await callWrite('atom', atom);
  if (!atomRes.ok) {
    result.errors.push({ step: 'git_atom', slug, error: atomRes.error || 'unknown error' });
    return result;
  }
  result.created.atoms++;

  return result;
}

function listRecentCommits(limit) {
  try {
    const out = execSync(`git log -n ${Math.max(1, limit)} --date=short --pretty=format:%ad%x1f%h%x1f%s`, {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 15_000,
    }).trim();
    if (!out) return [];
    return out.split('\n').map(line => {
      const [date, hash, ...subjectParts] = line.split('\x1f');
      return {
        date,
        hash,
        subject: subjectParts.join('\x1f').trim(),
      };
    }).filter(r => r.date && r.hash && r.subject);
  } catch {
    return [];
  }
}

async function resolveSources(explicitSources) {
  const out = [];

  if (explicitSources.length > 0) {
    for (const src of explicitSources) {
      if (await exists(join(ROOT, src))) out.push(src);
    }
    return dedupePaths(out);
  }

  if (await exists(join(ROOT, 'AUDIT_HISTORY.md'))) {
    out.push('AUDIT_HISTORY.md');
  }

  const evalDocs = await listFilesByGitPattern('docs/agents-architecture-evaluation-*.md');
  out.push(...evalDocs);

  return dedupePaths(out);
}

async function listFilesByGitPattern(pattern) {
  // For ignored/untracked docs, fallback to plain filesystem scan.
  if (pattern === 'docs/agents-architecture-evaluation-*.md') {
    return listDocsByPrefix();
  }
  try {
    const out = execSync(`git ls-files -- '${pattern}'`, {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 10_000,
    }).trim();
    if (!out) return [];
    return out.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

async function listDocsByPrefix() {
  const [docsLower, docsUpper] = await Promise.all([
    listDocsInDir('docs'),
    listDocsInDir('Docs'),
  ]);
  return [...docsLower, ...docsUpper];
}

function dedupePaths(paths) {
  const byLower = new Map();
  for (const p of [...paths].sort()) {
    const key = p.toLowerCase();
    if (!byLower.has(key)) byLower.set(key, p);
  }
  return [...byLower.values()];
}

async function listDocsInDir(dirName) {
  const abs = join(ROOT, dirName);
  try {
    const entries = await readdir(abs, { withFileTypes: true });
    return entries
      .filter(e => e.isFile() && /^agents-architecture-evaluation-.*\.md$/i.test(e.name))
      .map(e => `${dirName}/${e.name}`);
  } catch {
    return [];
  }
}

function extractIssues(text, source, fallbackDate) {
  const seen = new Map();

  function upsert(issue, file, reason) {
    const key = issue;
    const normalizedFile = normalizeFile(file);
    const current = seen.get(key);
    const candidate = {
      issue,
      file: normalizedFile,
      reason: trimSentence(reason || '', 180),
      source,
      date: fallbackDate,
    };

    if (!current) {
      seen.set(key, candidate);
      return;
    }

    // Prefer entries with file path and richer reason.
    const curScore = scoreIssueCandidate(current);
    const nextScore = scoreIssueCandidate(candidate);
    if (nextScore > curScore) seen.set(key, candidate);
  }

  const mapStyle = /\b(I-\d+)\s*->\s*([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)/g;
  let match;
  while ((match = mapStyle.exec(text)) !== null) {
    upsert(match[1], match[2], null);
  }

  const dispositionStyle = /^([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)\s*\|\s*issue(?:_detected)?:\s*(I-\d+)$/gm;
  while ((match = dispositionStyle.exec(text)) !== null) {
    upsert(match[2], match[1], null);
  }

  const headings = [...text.matchAll(/^###\s*(I-\d+)([^\n]*)$/gm)];
  for (let i = 0; i < headings.length; i++) {
    const issue = headings[i][1];
    const tail = headings[i][2] || '';
    const sectionStart = headings[i].index || 0;
    const sectionEnd = i + 1 < headings.length ? (headings[i + 1].index || text.length) : text.length;
    const section = text.slice(sectionStart, sectionEnd);
    const fileFromHeading = firstFilePath(tail);
    const fileFromSection = firstFilePath(section);
    const risk = extractRisk(section);
    upsert(issue, fileFromHeading || fileFromSection, risk);
  }

  // Fallback: collect bare issue ids if no structured match.
  if (seen.size === 0) {
    for (const m of text.matchAll(/\b(I-\d+)\b/g)) {
      upsert(m[1], null, null);
    }
  }

  return [...seen.values()];
}

function dedupeIssues(items) {
  const byIssue = new Map();
  for (const item of items) {
    const current = byIssue.get(item.issue);
    if (!current) {
      byIssue.set(item.issue, item);
      continue;
    }
    if (scoreIssueCandidate(item) > scoreIssueCandidate(current)) {
      byIssue.set(item.issue, item);
    }
  }
  return [...byIssue.values()];
}

function scoreIssueCandidate(item) {
  let score = 0;
  if (item.file) score += 2;
  if (item.reason) score += 1;
  if (item.source?.includes('deepscan')) score += 1;
  return score;
}

function numericIssue(issueId) {
  const n = Number(issueId.replace(/^I-/, ''));
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

function inferDate(source, text) {
  const fromPath = source.match(/(20\d{2}-\d{2}-\d{2})/);
  if (fromPath) return fromPath[1];

  const fromText = text.match(/(?:日期|扫描日期|date)\s*[：:]\s*(20\d{2}-\d{2}-\d{2})/i);
  if (fromText) return fromText[1];

  return today();
}

function normalizeFile(filePath) {
  if (!filePath) return null;
  return filePath.replace(/`/g, '').replace(/^\.\//, '').replace(/\\/g, '/');
}

function firstFilePath(text) {
  if (!text) return null;
  const match = text.match(/([A-Za-z0-9_./-]+\.(?:js|mjs|cjs|ts|tsx|jsx|json|md))/);
  return match ? match[1] : null;
}

function extractRisk(section) {
  const m = section.match(/-\s*Risk\s*:\s*([^\n]+)/i);
  return m ? m[1].trim() : null;
}

function buildIssueAtom(issue) {
  const base = issue.file
    ? `Issue ${issue.issue} in ${issue.file}`
    : `Issue ${issue.issue}`;
  const reason = issue.reason ? `: ${issue.reason}` : ': historical risk captured from audit/evaluation records';
  return `${base}${reason}`;
}

function trimSentence(text, maxLen) {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen - 1) + '…';
}

async function callWrite(type, payload) {
  return new Promise((resolve, reject) => {
    execFile('node', [WRITE_SCRIPT, type, JSON.stringify(payload)], { cwd: ROOT, timeout: 30_000 }, (err, stdout, stderr) => {
      if (stderr) process.stderr.write(stderr);
      const out = (stdout || '').trim();
      if (!out) {
        if (err) return reject(err);
        return resolve({ ok: false, error: 'empty response from context-write' });
      }
      try {
        resolve(JSON.parse(out));
      } catch (parseErr) {
        reject(new Error(`invalid JSON from context-write: ${parseErr.message}`));
      }
    });
  });
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function printHelp() {
  console.log('Usage: node scripts/context-coldstart.js [options]');
  console.log('');
  console.log('Options:');
  console.log('  --dry-run              only collect and preview, do not write');
  console.log('  --source <path>        add source markdown file (repeatable)');
  console.log('  --max-issues <n>       cap imported issue decisions (default: 120)');
  console.log('  --git-commits <n>      scan recent commits for git seed (default: 20)');
  console.log('  --no-git               disable git history seed');
  console.log('  --force                allow writing even if slug already exists');
}
