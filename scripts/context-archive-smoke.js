#!/usr/bin/env node
/**
 * context-archive-smoke.js — 归档阈值场景验证辅助脚本
 *
 * seed: 生成高重复 atom_key 的分片数据，触发 compact 归档路径
 * verify: 校验 compact 后主分片与 archive 分片分离成功
 *
 * Usage:
 *   node scripts/context-archive-smoke.js --mode seed --token abc123 --module scripts
 *   node scripts/context-archive-smoke.js --mode verify --token abc123 --module scripts --threshold 200
 * @module context-archive-smoke
 */

import { join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { INTENT_DIR, moduleToShard, output, ulid } from './context-utils.js';

const args = process.argv.slice(2);
const flags = {
  mode: 'seed',
  token: null,
  module: 'scripts',
  threshold: 200,
  keys: 40,
  versions: 6,
};

for (let i = 0; i < args.length; i++) {
  const cur = args[i];
  if (cur === '--mode' && args[i + 1]) flags.mode = args[++i];
  else if (cur === '--token' && args[i + 1]) flags.token = args[++i];
  else if (cur === '--module' && args[i + 1]) flags.module = args[++i];
  else if (cur === '--threshold' && args[i + 1]) flags.threshold = Number(args[++i]);
  else if (cur === '--keys' && args[i + 1]) flags.keys = Number(args[++i]);
  else if (cur === '--versions' && args[i + 1]) flags.versions = Number(args[++i]);
  else if (cur === '--help' || cur === '-h') {
    printHelp();
    process.exit(0);
  }
}

if (!flags.token) {
  output({ ok: false, error: '--token is required' });
  process.exit(1);
}

try {
  const result = flags.mode === 'verify'
    ? await verify(flags)
    : await seed(flags);
  output(result);
  process.exit(result.ok ? 0 : 1);
} catch (err) {
  output({ ok: false, error: err.message });
  process.exit(1);
}

async function seed(flags) {
  const shard = moduleToShard(flags.module);
  const shardPath = join(INTENT_DIR, 'atoms', shard);
  await mkdir(join(INTENT_DIR, 'atoms'), { recursive: true });

  const rows = [];
  for (let k = 0; k < Math.max(1, flags.keys); k++) {
    const atomKey = `dec-archive-smoke-${flags.token}-k${String(k).padStart(3, '0')}#maintenance`;
    for (let v = 0; v < Math.max(2, flags.versions); v++) {
      rows.push({
        v: 1,
        type: 'atom',
        id: ulid(),
        atom_key: atomKey,
        content: `archive smoke token=${flags.token} key=${k} version=${v}`,
        content_hash: `${flags.token}-${k}-${v}`,
        perspective: 'maintenance',
        status: v === flags.versions - 1 ? 'confirmed' : 'draft',
        source: 'context-archive-smoke',
        related_modules: [flags.module],
        related_decisions: [],
        created: new Date(Date.now() + v).toISOString(),
      });
    }
  }

  await writeFile(shardPath, rows.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  return {
    ok: true,
    mode: 'seed',
    token: flags.token,
    module: flags.module,
    shard: `.context/intent/atoms/${shard}`,
    rows: rows.length,
  };
}

async function verify(flags) {
  const shard = moduleToShard(flags.module);
  const shardPath = join(INTENT_DIR, 'atoms', shard);
  const archivePath = join(INTENT_DIR, 'atoms', shard.replace(/\.jsonl$/, '.archive.jsonl'));
  const active = await readJsonlSafe(shardPath);
  const archived = await readJsonlSafe(archivePath);
  const activeAtoms = active.filter(r => r.type === 'atom');
  const archivedAtoms = archived.filter(r => r.type === 'atom');
  const archivedHit = archivedAtoms.some(r => String(r.content || '').includes(flags.token));
  const activeHit = activeAtoms.some(r => String(r.content || '').includes(flags.token));
  const withinThreshold = activeAtoms.length <= Math.max(1, flags.threshold);

  return {
    ok: archivedHit && activeHit && withinThreshold,
    mode: 'verify',
    token: flags.token,
    module: flags.module,
    shard: `.context/intent/atoms/${shard}`,
    archive: `.context/intent/atoms/${shard.replace(/\.jsonl$/, '.archive.jsonl')}`,
    active_atoms: activeAtoms.length,
    archived_atoms: archivedAtoms.length,
    checks: {
      archived_hit: archivedHit,
      active_hit: activeHit,
      active_within_threshold: withinThreshold,
    },
  };
}

async function readJsonlSafe(path) {
  try {
    const text = await readFile(path, 'utf8');
    return text.split('\n').filter(Boolean).map(line => JSON.parse(line));
  } catch {
    return [];
  }
}

function printHelp() {
  console.log('Usage: node scripts/context-archive-smoke.js [options]');
  console.log('');
  console.log('Options:');
  console.log('  --mode <seed|verify>   default: seed');
  console.log('  --token <id>           required test token');
  console.log('  --module <path>        target module (default: scripts)');
  console.log('  --threshold <n>        verify active shard <= threshold (default: 200)');
  console.log('  --keys <n>             number of atom keys in seed mode (default: 40)');
  console.log('  --versions <n>         versions per key in seed mode (default: 6)');
}
