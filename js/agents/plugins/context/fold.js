/**
 * context/fold.js — 意图折叠纯函数
 *
 * 零依赖，Browser / Node 通用。
 * 同步副本，唯一真源为 @pb/context-cli/lib/fold-core.js。
 *
 * @canonical @pb/context-cli/lib/fold-core.js
 * @sync-hash 请勿手动编辑，由 context-doctor 校验同步状态
 * @module plugins/context/fold
 */

// ── 决策折叠 ──────────────────────────────────────────────────────

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

// ── 排除折叠 ──────────────────────────────────────────────────────

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

// ── 决策权重 ──────────────────────────────────────────────────────

/**
 * 计算决策权重（读侧推断，不依赖显式标注）。
 * @param {object} d          folded decision
 * @param {Map<string,number>} excludedCountMap  slug → excluded 数量
 * @param {Map<string,number>} hitsMap           slug → 查询命中次数
 * @returns {number}  基础 1，最大 8
 */
export function decisionWeight(d, excludedCountMap, hitsMap) {
  let w = 1;
  if ((excludedCountMap?.get(d.slug) || 0) > 0) w += 2;  // 做了取舍
  if ((d.modules || []).length >= 2) w += 1;               // 跨模块
  if (d.supersedes || d.superseded_by) w += 1;             // 经历演进
  if (d.note) w += 1;                                      // 有备注
  const hits = hitsMap?.get(d.slug) || 0;
  if (hits >= 3) w += 2;                                   // 高频查询
  else if (hits >= 1) w += 1;                              // 有查询
  return w;
}

// ── 时间线压缩 ────────────────────────────────────────────────────

/**
 * 将决策 + 信号按时间压缩为 AI 友好的时间线。
 * @param {object[]} decisions  folded decisions (已按 date 降序)
 * @param {object[]} signals    signals.jsonl 记录
 * @param {Map<string,number>} excludedCountMap
 * @param {Map<string,number>} hitsMap
 * @param {number} [weightThreshold=3]
 * @returns {Array<{type:string, data?:object, count?:number, span?:string}>}
 */
export function compressTimeline(decisions, signals, excludedCountMap, hitsMap, weightThreshold = 3) {
  const events = [];
  for (const d of decisions) {
    if (d.status !== 'decided') continue;
    const w = decisionWeight(d, excludedCountMap, hitsMap);
    events.push({
      time: d.date || d.created || '',
      kind: 'decision',
      weight: w,
      data: { slug: d.slug, title: d.title, choice: d.choice, date: d.date },
    });
  }
  for (const s of signals) {
    if (s.type === 'session_start' || s.type === 'session_end') {
      events.push({ time: s.created || s.date || '', kind: 'signal', weight: 0, data: s });
    }
  }
  events.sort((a, b) => (a.time || '').localeCompare(b.time || ''));

  const timeline = [];
  let routineBuf = [];

  function flushRoutine() {
    if (routineBuf.length === 0) return;
    if (routineBuf.length === 1) {
      timeline.push({ type: routineBuf[0].kind, data: routineBuf[0].data });
    } else {
      const first = routineBuf[0].time?.slice(0, 10) || '?';
      const last = routineBuf[routineBuf.length - 1].time?.slice(0, 10) || '?';
      timeline.push({
        type: 'group',
        count: routineBuf.length,
        span: first === last ? first : `${first} ~ ${last}`,
        summary: `${routineBuf.length} routine events`,
      });
    }
    routineBuf = [];
  }

  for (const e of events) {
    if (e.weight >= weightThreshold) {
      flushRoutine();
      timeline.push({ type: e.kind, data: e.data, weight: e.weight });
    } else {
      routineBuf.push(e);
    }
  }
  flushRoutine();

  return timeline;
}

// ── 模块匹配 ──────────────────────────────────────────────────────

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

// ── 冲突解决判定 ──────────────────────────────────────────────────

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
