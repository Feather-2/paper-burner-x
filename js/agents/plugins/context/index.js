/**
 * context-intent Plugin — 跨对话长期记忆
 *
 * 将 @pb/context-cli 的五维度意图层集成到 js/agents 微内核，
 * 通过 VFS 实现 Browser (OPFS) / Node (nodefs) 双运行时。
 *
 * 职责划分：
 *   fold.js  — 纯折叠函数（零依赖）
 *   io.js   — VFS-backed JSONL I/O + 跨平台 ULID/Hash
 *   index.js — Plugin 入口：生命周期 + ServiceBus + EventBus
 *
 * @module plugins/context/index
 */

/** @typedef {import('../../core/plugin.js').PluginContext} PluginContext */

import { createPlugin } from '../../core/plugin.js';
import { foldDecisions, foldExcludedLatest, moduleMatches } from './fold.js';
import {
  readJsonl, appendJsonl, appendDirty, readDirty, clearDirty,
  ulid, contentHash, moduleToShard, today,
  PERSPECTIVES, DECISION_OPS, SIGNAL_TYPES,
} from './io.js';

// ── 路径常量 ─────────────────────────────────────────────────────

const CTX_ROOT   = '.context';
const INTENT_DIR = `${CTX_ROOT}/intent`;
const ATOMS_DIR  = `${INTENT_DIR}/atoms`;
const DEC_DIR    = `${INTENT_DIR}/decisions`;
const EXCL_DIR   = `${INTENT_DIR}/excluded`;
const SIG_DIR    = `${INTENT_DIR}/signals`;
const OPS_PATH   = `${DEC_DIR}/ops.jsonl`;
const EXCL_PATH  = `${EXCL_DIR}/excluded.jsonl`;
const SIG_PATH   = `${SIG_DIR}/signals.jsonl`;
const DIRTY_PATH = `${INTENT_DIR}/.dirty`;

// ── Plugin ───────────────────────────────────────────────────────

export default createPlugin({
  name: 'context-intent',
  version: '1.0.0',
  description: '跨对话长期记忆 — @pb/context-cli VFS 桥接',
  dependencies: ['service/vfs'],

  defaultConfig: {
    /** 自动在 agent:started 时加载上下文 */
    autoLoad: true,
    /** 自动在 agent:completed 时 fold */
    autoFold: true,
    /** 自动从运行时事件提取 atoms/signals/excluded */
    autoExtract: true,
    /** flush 策略: eager | batched */
    flushPolicy: 'eager',
    /** batched 模式下的 dirty 阈值 */
    flushThreshold: 5,
    /** PreLLMCall 注入最大次数 (0=无限) */
    maxContextInjections: 1,
    /** PreLLMCall 注入 token 预算 (0=固定上限模式) */
    contextTokenBudget: 400,
  },

  async install(ctx) {
    const vfs = await ctx.services.get('vfs');
    if (!vfs) throw new Error('context-intent requires service/vfs');

    // 确保目录结构
    for (const dir of [ATOMS_DIR, DEC_DIR, EXCL_DIR, SIG_DIR]) {
      try { await vfs.mkdir(dir, { recursive: true }); } catch { /* exists */ }
    }

    // ── 初始状态 ──────────────────────────────────────────────

    ctx.state.set('loaded', false);
    ctx.state.set('module', null);
    ctx.state.set('decisions', []);
    ctx.state.set('atoms', []);
    ctx.state.set('excluded', []);
    ctx.state.set('dirty', { total: 0, by_shard: {} });

    // ── context 服务 ─────────────────────────────────────────

    ctx.registerService('context', {

      /**
       * 加载指定模块的意图上下文。
       * @param {string} [module]   模块路径（如 'js/agents/core'）
       * @param {string} [scenario] 场景 ('edit'|'resume'|'audit')
       * @returns {Promise<{decisions:object[], atoms:object[], excluded:object[], dirty:object}>}
       */
      async load(module, scenario) {
        const ops = await readJsonl(vfs, OPS_PATH);
        let decisions = foldDecisions(ops);

        // 按模块过滤
        if (module) {
          decisions = decisions.filter(d =>
            ((/** @type {{ modules?: string[] }} */ (d)).modules || []).some(m => moduleMatches(m, module))
          );
        }

        // 加载 atoms（按 shard 读取）
        let atoms = [];
        if (module) {
          const shard = moduleToShard(module);
          atoms = await readJsonl(vfs, `${ATOMS_DIR}/${shard}`);
          atoms = atoms.filter(a => a.type === 'atom');
        }

        // 加载 excluded
        const allExcluded = await readJsonl(vfs, EXCL_PATH);
        let excluded = foldExcludedLatest(allExcluded);
        if (module) {
          const relSlugs = new Set(decisions.map(d => d.slug));
          excluded = excluded.filter(e => relSlugs.has(e.decision));
        }

        // dirty 状态
        const dirty = await readDirty(vfs, DIRTY_PATH);

        // 更新 StateBus
        ctx.state.set('loaded', true);
        ctx.state.set('module', module || null);
        ctx.state.set('decisions', decisions);
        ctx.state.set('atoms', atoms);
        ctx.state.set('excluded', excluded);
        ctx.state.set('dirty', dirty);

        ctx.events.emit('context:loaded', {
          module, scenario, decisions: decisions.length,
          atoms: atoms.length, excluded: excluded.length,
        });

        return { decisions, atoms, excluded, dirty };
      },

      /**
       * 写入一条 atom 记录。
       * @param {object} data  { atom_key, content, perspective, related_modules, ... }
       * @returns {Promise<{ok:boolean, id:string, shard:string, warnings:string[]}>}
       */
      async writeAtom(data) {
        const warnings = [];
        if (!data.atom_key || !data.content || !data.perspective) {
          throw new Error('atom requires: atom_key, content, perspective');
        }
        if (!PERSPECTIVES.has(data.perspective)) {
          throw new Error(`perspective '${data.perspective}' not in allowed set`);
        }
        const modules = data.related_modules || [];
        if (modules.length === 0) throw new Error('related_modules must have >= 1 entry');

        const id = ulid();
        const hash = await contentHash(data.content);
        const record = {
          v: 1, type: 'atom', id,
          atom_key: data.atom_key,
          content: data.content,
          content_hash: hash,
          perspective: data.perspective,
          status: data.status || 'draft',
          source: data.source || null,
          related_modules: modules,
          related_decisions: data.related_decisions || [],
          created: new Date().toISOString(),
        };

        const shardName = moduleToShard(modules[0]);
        const shardPath = `${ATOMS_DIR}/${shardName}`;

        // 冲突检测
        const existing = await readJsonl(vfs, shardPath);
        const sameKey = existing.filter(r => r.atom_key === data.atom_key && r.type === 'atom');
        const hasConflict = sameKey.length > 0 && sameKey.every(r => r.content_hash !== hash);

        await appendJsonl(vfs, shardPath, record);
        await appendDirty(vfs, DIRTY_PATH, shardName, 'atom');

        if (hasConflict) {
          const sig = {
            atom_id: id, type: 'conflict',
            existing_ids: sameKey.map(r => r.id),
            date: today(),
          };
          await appendJsonl(vfs, SIG_PATH, sig);
          warnings.push(`conflict: atom_key ${data.atom_key} has divergent content`);
        }

        // 交叉引用
        for (let i = 1; i < modules.length; i++) {
          const refShard = moduleToShard(modules[i]);
          await appendJsonl(vfs, `${ATOMS_DIR}/${refShard}`, {
            v: 1, type: 'atom_ref', ref: id, see: shardName,
          });
        }

        ctx.events.emit('context:atom_written', { id, shard: shardName });
        return { ok: true, id, shard: shardName, warnings };
      },

      /**
       * 写入一条 decision 操作。
       * @param {object} data  { op:'upsert'|'supersede'|'restructure', slug, ... }
       * @returns {Promise<{ok:boolean, op:string, slug:string, warnings:string[]}>}
       */
      async decide(data) {
        const { op, slug } = data;
        if (!op || !DECISION_OPS.has(op)) {
          throw new Error(`op must be one of: ${[...DECISION_OPS].join(', ')}`);
        }
        if (!slug) throw new Error('missing slug');

        const existing = await readJsonl(vfs, OPS_PATH);
        const warnings = [];

        if (op === 'upsert') {
          if (!data.title || !data.choice) {
            throw new Error('upsert requires: title, choice');
          }
          const prevUpsert = existing.filter(o => o.slug === slug && o.op === 'upsert');
          if (prevUpsert.length > 0 && !data.note) {
            throw new Error('note required for subsequent upsert of same slug');
          }
          const record = {
            v: 1, type: 'decision_op', op: 'upsert',
            slug, title: data.title, choice: data.choice,
            trigger: data.trigger || { type: 'manual', note: 'agent-session' },
            modules: data.modules || [],
            date: data.date || today(),
          };
          if (data.assumptions) record.assumptions = data.assumptions;
          if (data.note) record.note = data.note;
          await appendJsonl(vfs, OPS_PATH, record);
        } else if (op === 'supersede') {
          if (!data.by) throw new Error('supersede requires: by');
          await appendJsonl(vfs, OPS_PATH, {
            v: 1, type: 'decision_op', op: 'supersede',
            slug, by: data.by, date: data.date || today(),
          });
        } else if (op === 'restructure') {
          if (!data.kind || !data.from || !data.to) {
            throw new Error('restructure requires: kind, from, to');
          }
          const record = {
            v: 1, type: 'decision_op', op: 'restructure',
            kind: data.kind, from: data.from, to: data.to,
            slug, date: data.date || today(),
          };
          if (data.note) record.note = data.note;
          await appendJsonl(vfs, OPS_PATH, record);
        }

        await appendDirty(vfs, DIRTY_PATH, 'ops', 'decision');
        ctx.events.emit('context:decision_written', { op, slug });
        return { ok: true, op, slug, warnings };
      },

      /**
       * 写入一条 signal。
       * @param {object} data  { type, atom_id?, ... }
       * @returns {Promise<{ok:boolean, id:string}>}
       */
      async signal(data) {
        if (!data.type || !SIGNAL_TYPES.has(data.type)) {
          throw new Error(`signal type must be one of: ${[...SIGNAL_TYPES].join(', ')}`);
        }
        const id = ulid();
        const record = { v: 1, ...data, id, created: new Date().toISOString() };
        await appendJsonl(vfs, SIG_PATH, record);
        await appendDirty(vfs, DIRTY_PATH, 'signals', 'signal');
        ctx.events.emit('context:signal_written', { id, type: data.type });
        return { ok: true, id };
      },

      /**
       * 折叠当前全部决策，返回有效状态。
       * @returns {Promise<{decisions:object[], excluded:object[]}>}
       */
      async fold() {
        const ops = await readJsonl(vfs, OPS_PATH);
        const decisions = foldDecisions(ops);
        const allExcl = await readJsonl(vfs, EXCL_PATH);
        const excluded = foldExcludedLatest(allExcl);
        ctx.state.set('decisions', decisions);
        ctx.state.set('excluded', excluded);
        return { decisions, excluded };
      },

      /**
       * 获取 dirty 状态。
       * @returns {Promise<{total:number, by_shard:Record<string,number>, entries:object[]}>}
       */
      async getDirty() {
        return readDirty(vfs, DIRTY_PATH);
      },

      /**
       * 清空 dirty 标记（flush 后调用）。
       */
      async clearDirty() {
        await clearDirty(vfs, DIRTY_PATH);
        ctx.state.set('dirty', { total: 0, by_shard: {} });
        ctx.events.emit('context:dirty_cleared', {});
      },

      /**
       * 获取 StateBus 中的当前快照。
       * @returns {{loaded:boolean, module:string|null, decisions:object[], atoms:object[], excluded:object[], dirty:object}}
       */
      snapshot() {
        return {
          loaded: ctx.state.get('loaded'),
          module: ctx.state.get('module'),
          decisions: ctx.state.get('decisions') || [],
          atoms: ctx.state.get('atoms') || [],
          excluded: ctx.state.get('excluded') || [],
          dirty: ctx.state.get('dirty') || { total: 0, by_shard: {} },
        };
      },
    });

    // ── EventBus 自动化 ──────────────────────────────────────

    if (ctx.config.autoLoad) {
      ctx.on('agent:started', async (evt) => {
        const module = evt?.module || evt?.config?.module || null;
        try {
          await ctx.services.call('context', 'load', [module]);
          injectionCount = 0; // reset for new agent run
          ctx.log.info(`context loaded for module=${module || '(global)'}`);
        } catch (e) {
          ctx.log.warn(`context auto-load failed: ${e.message}`);
        }
      });
    }

    if (ctx.config.autoFold) {
      ctx.on('agent:completed', async () => {
        try {
          const { decisions } = await ctx.services.call('context', 'fold', []);
          ctx.log.info(`context folded: ${decisions.length} decisions`);
        } catch (e) {
          ctx.log.warn(`context auto-fold failed: ${e.message}`);
        }
      });
    }

    // ── EventBus 写方向自动提取 (Write-Side Wiring) ────────────

    if (ctx.config.autoExtract) {
      // 1. compression:decisions → writeAtom for each decision
      ctx.on('compression:decisions', async (evt) => {
        try {
          const payload = evt?.payload || evt;
          const decisions = Array.isArray(payload?.decisions) ? payload.decisions : [];
          const stageKey = payload?.stageKey || 'js/agents';
          for (const decision of decisions.slice(0, 20)) {
            const text = typeof decision === 'string' ? decision : String(decision);
            if (!text) continue;
            const hash = await contentHash(text);
            await ctx.services.call('context', 'writeAtom', [{
              atom_key: `auto:compression:${hash.slice(0, 8)}`,
              content: text,
              perspective: 'architecture',
              related_modules: [stageKey],
              source: 'compression:decisions',
              status: 'draft',
            }]).catch(e => ctx.log.warn(`auto-extract writeAtom failed: ${e.message}`));
          }
        } catch (e) {
          ctx.log.warn(`compression:decisions handler error: ${e.message}`);
        }
      });

      // 2. memory:archived → writeAtom with summary
      ctx.on('memory:archived', async (evt) => {
        try {
          const payload = evt?.payload || evt;
          const summary = payload?.summary;
          if (!summary || typeof summary !== 'string') return;
          const stageKey = payload?.stageKey || 'js/agents';
          const hash = await contentHash(summary);
          await ctx.services.call('context', 'writeAtom', [{
            atom_key: `auto:archive:${hash.slice(0, 8)}`,
            content: summary,
            perspective: 'architecture',
            related_modules: [stageKey],
            source: 'memory:archived',
            status: 'draft',
          }]);
        } catch (e) {
          ctx.log.warn(`memory:archived handler error: ${e.message}`);
        }
      });

      // 3. tool:denied → appendJsonl to excluded
      ctx.on('tool:denied', async (evt) => {
        try {
          const payload = evt?.payload || evt;
          const tool = payload?.tool;
          if (!tool) return;
          await appendJsonl(vfs, EXCL_PATH, {
            v: 1,
            type: 'excluded',
            excluded: `tool:${tool}`,
            reason: payload?.reason || 'denied',
            decision: 'tool-policy',
            date: today(),
          });
        } catch (e) {
          ctx.log.warn(`tool:denied handler error: ${e.message}`);
        }
      });

      // 4. memory:recalled → signal with type 'referenced_by'
      ctx.on('memory:recalled', async (evt) => {
        try {
          const payload = evt?.payload || evt;
          const atomId = payload?.atomId || payload?.query || null;
          if (!atomId) return;
          await ctx.services.call('context', 'signal', [{
            type: 'referenced_by',
            atom_id: String(atomId),
            action: payload?.action || 'unknown',
            date: today(),
          }]);
        } catch (e) {
          ctx.log.warn(`memory:recalled handler error: ${e.message}`);
        }
      });

      ctx.log.info('auto-extract listeners registered (compression:decisions, memory:archived, tool:denied, memory:recalled)');
    }

    // ── PreCompression / PostCompression Hook — 洋葱圈压缩拦截 ──

    const CONTEXT_MARKER = '[context-intent]';
    const maxInjections = ctx.config.maxContextInjections || 0;
    const tokenBudget = typeof ctx.config.contextTokenBudget === 'number' && ctx.config.contextTokenBudget > 0
      ? ctx.config.contextTokenBudget : 0; // 0 = legacy fixed-limit mode
    /** @param {string} s @returns {number} */
    const _estTokens = (s) => Math.ceil((s || '').length / 4);
    let injectionCount = 0;

    if (typeof ctx.events?.registerHook === 'function') {
      // 压缩前：注入决策摘要保护关键信息
      ctx.events.registerHook('PreCompression', {
        type: 'command',
        blocking: false,
        handler(hookCtx) {
          const decisions = ctx.state.get('decisions') || [];
          const excluded = ctx.state.get('excluded') || [];
          const active = decisions.filter(d => d.status === 'decided');
          if (!active.length && !excluded.length) return;

          const messages = hookCtx?.messages;
          if (!Array.isArray(messages)) return;

          const lines = [`${CONTEXT_MARKER} Preserve during compaction:`];
          for (const d of active.slice(0, 10)) {
            lines.push(`- [${d.slug}] ${d.title}: ${d.choice}`);
          }
          if (excluded.length) {
            for (const e of excluded.slice(0, 5)) {
              lines.push(`- excluded: ${e.excluded} (${e.decision})`);
            }
          }
          messages.push({ role: 'system', content: lines.join('\n') });
          ctx.log.info('PreCompression: injected decision summary for preservation');
        },
      });

      // 压缩后：重置注入计数，下次 PreLLMCall 重新注入
      ctx.events.registerHook('PostCompression', {
        type: 'command',
        blocking: false,
        handler() {
          injectionCount = 0;
          ctx.log.info('PostCompression: injection count reset');
        },
      });

      ctx.log.info('Pre/PostCompression hooks registered');

      // ── PreLLMCall Hook — 决策上下文注入 ─────────────────────
      ctx.events.registerHook('PreLLMCall', {
        type: 'command',
        blocking: false,
        handler(hookCtx) {
          // Token 成本控制：超过 maxInjections 后跳过（0=无限）
          if (maxInjections > 0 && injectionCount >= maxInjections) return;

          const decisions = ctx.state.get('decisions') || [];
          const excluded = ctx.state.get('excluded') || [];
          const active = decisions.filter(d => d.status === 'decided');
          if (!active.length && !excluded.length) return;

          const messages = hookCtx?.messages;
          if (!Array.isArray(messages)) return;

          // 去重：移除上一轮注入的 context 消息
          for (let j = messages.length - 1; j >= 0; j--) {
            if (messages[j]?.role === 'system' &&
                typeof messages[j]?.content === 'string' &&
                messages[j].content.startsWith(CONTEXT_MARKER)) {
              messages.splice(j, 1);
            }
          }

          // 构造精简注入文本 — token 预算驱动渐进披露
          // 按最近决策时间排序（最新优先）
          const sorted = [...active].sort((a, b) => {
            const aT = typeof a?.ts === 'number' ? a.ts : 0;
            const bT = typeof b?.ts === 'number' ? b.ts : 0;
            return bT - aT;
          });

          const header = `${CONTEXT_MARKER} Active decisions:`;
          const footer = 'For full context: context.load(<module>) | context.fold() | context.decide()';
          let usedTokens = _estTokens(header) + _estTokens(footer) + 2;

          const lines = [header];
          let decisionCount = 0;
          const maxDec = tokenBudget > 0 ? sorted.length : 8; // legacy: cap at 8
          for (const d of sorted) {
            if (decisionCount >= maxDec) break;
            const line = `- [${d.slug}] ${d.title}: ${d.choice}`;
            const cost = _estTokens(line);
            if (tokenBudget > 0 && usedTokens + cost > tokenBudget) break;
            lines.push(line);
            usedTokens += cost;
            decisionCount++;
          }
          if (decisionCount < active.length) {
            lines.push(`  ... +${active.length - decisionCount} more`);
          }
          if (excluded.length) {
            const exclHeader = 'Excluded patterns:';
            usedTokens += _estTokens(exclHeader);
            lines.push(exclHeader);
            const maxExcl = tokenBudget > 0 ? excluded.length : 5;
            let exclCount = 0;
            for (const e of excluded) {
              if (exclCount >= maxExcl) break;
              const line = `- avoid: ${e.excluded} (see ${e.decision})`;
              const cost = _estTokens(line);
              if (tokenBudget > 0 && usedTokens + cost > tokenBudget) break;
              lines.push(line);
              usedTokens += cost;
              exclCount++;
            }
          }
          lines.push(footer);

          // 插入到最后一条 user/tool 消息之前
          let insertIdx = messages.length;
          for (let j = messages.length - 1; j >= 0; j--) {
            if (messages[j]?.role === 'user' || messages[j]?.role === 'tool') {
              insertIdx = j;
              break;
            }
          }
          messages.splice(insertIdx, 0, {
            role: 'system', content: lines.join('\n'),
          });
          injectionCount++;
        },
      });
      ctx.log.info('PreLLMCall hook registered for decision context injection');
    }

    ctx.log.info('context-intent plugin installed');
  },

  async uninstall(ctx) {
    ctx.log.info('context-intent plugin uninstalled');
  },
});
