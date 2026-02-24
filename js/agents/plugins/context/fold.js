/**
 * context/fold.js — 纯折叠函数
 *
 * 从 append-only JSONL 操作日志折叠出当前有效状态。
 * 零依赖，Browser / Node 通用。
 * 移植自 @pb/context-cli/lib/fold-ops.js。
 * @module plugins/context/fold
 */

/**
 * 将 ops.jsonl 的操作日志折叠为当前决策列表。
 * @param {object[]} ops  ops.jsonl 全部记录
 * @returns {{slug:string, status:string, superseded_by:string|null, restructures:object[]}[]}
 */
export function foldDecisions(ops) {
  const supersededBy = new Map();
  const restructuresBySlug = new Map();

  for (const op of ops) {
    if (op.op === 'supersede') supersededBy.set(op.slug, op.by);
    if (op.op === 'restructure') {
      const arr = restructuresBySlug.get(op.slug) || [];
      arr.push(op);
      restructuresBySlug.set(op.slug, arr);
    }
  }

  const latest = new Map();
  for (const op of ops) {
    if (op.op === 'upsert') latest.set(op.slug, { ...op });
  }

  const folded = [];
  for (const [slug, dec] of latest) {
    dec.status = supersededBy.has(slug) ? 'superseded' : 'decided';
    dec.superseded_by = supersededBy.get(slug) || null;
    dec.restructures = restructuresBySlug.get(slug) || [];
    folded.push(dec);
  }

  folded.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return folded;
}

/**
 * 将 excluded.jsonl 去重：同 excluded_key 只保留最新（ULID 最大）。
 * @param {object[]} rows  excluded.jsonl 全部记录
 * @returns {object[]}
 */
export function foldExcludedLatest(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const existing = byKey.get(row.excluded_key);
    if (!existing || row.id > existing.id) byKey.set(row.excluded_key, row);
  }
  return [...byKey.values()];
}

/**
 * 判断模块路径是否匹配（前缀匹配）。
 * @param {string} candidate
 * @param {string} target
 * @returns {boolean}
 */
export function moduleMatches(candidate, target) {
  return candidate === target
    || candidate.startsWith(target + '/')
    || target.startsWith(candidate + '/');
}

/**
 * 判断冲突是否已解决（通过 signal 判定）。
 * @param {object} conflict
 * @param {object[]} signals
 * @returns {boolean}
 */
export function isConflictResolved(conflict, signals) {
  const byType = new Map();
  for (const s of signals) {
    if (!s.atom_id) continue;
    const arr = byType.get(s.atom_id) || [];
    arr.push(s.type);
    byType.set(s.atom_id, arr);
  }
  const curTypes = byType.get(conflict.atom_id) || [];
  if (['human_confirmed', 'superseded', 'retracted', 'archived'].some(t => curTypes.includes(t))) {
    return true;
  }
  const existing = Array.isArray(conflict.existing_ids) ? conflict.existing_ids : [];
  if (existing.length === 0) return false;
  return existing.every(id => {
    const t = byType.get(id) || [];
    return t.includes('superseded') || t.includes('retracted') || t.includes('archived');
  });
}
