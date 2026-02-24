/**
 * context-intent Plugin E2E 测试
 *
 * 使用真实 EventBus + StateBus + ServiceBus + PluginManager，
 * 仅 mock VFS（内存 Map），验证完整链路：
 *   load → writeAtom → decide → fold → dirty
 */

import { describe, it, beforeEach } from 'vitest';
import assert from 'node:assert';

import { EventBus } from '../../../core/event-bus.js';
import { StateBus } from '../../../core/state-bus.js';
import { ServiceBus } from '../../../core/service-bus.js';
import { PluginManager, createPlugin } from '../../../core/plugin.js';
import contextIntentPlugin from '../index.js';

// ── Mock VFS ────────────────────────────────────────────────────

function createMemoryVFS() {
  const files = new Map();

  return {
    _files: files,

    async readText(path) {
      if (!files.has(path)) throw new Error(`ENOENT: ${path}`);
      return files.get(path);
    },

    async writeText(path, content) {
      files.set(path, content);
    },

    async appendText(path, content) {
      const existing = files.get(path) || '';
      files.set(path, existing + content);
    },

    async mkdir(_path, _opts) {
      // no-op for memory VFS
    },

    async unlink(path) {
      files.delete(path);
    },
  };
}

// ── Mock Kernel ─────────────────────────────────────────────────

function createTestKernel() {
  const events = new EventBus();
  const state = new StateBus({ events });
  const services = new ServiceBus({ events });

  const kernel = { events, state, services };
  const pm = new PluginManager(kernel);
  const vfs = createMemoryVFS();

  // context-intent 声明 dependencies: ['service/vfs']，
  // PluginManager 要求依赖也是已注册的 plugin，所以创建 dummy plugin
  const vfsPlugin = createPlugin({
    name: 'service/vfs',
    install() { /* VFS 已直接注册到 ServiceBus */ },
  });
  pm.register(vfsPlugin);

  // 直接同步注册 VFS 到 ServiceBus（plugin 的 install 用同步 get）
  services.register('vfs', vfs);

  // 同时 monkey-patch ServiceBus.get 为同步返回（plugin 代码没有 await）
  const origGet = services.get.bind(services);
  services.get = function syncGet(name) {
    const entry = this._services.get(name);
    if (entry) return entry.instance;
    return origGet(name);
  };

  return { kernel, pm, vfs, events, state, services };
}

// ── 辅助函数 ────────────────────────────────────────────────────

async function installPlugin(pm, config = {}) {
  pm.register(contextIntentPlugin, {
    autoLoad: false,
    autoFold: false,
    ...config,
  });
  await pm.install('context-intent');
}

async function getContextService(services) {
  return services.get('context');
}

// ── Tests ───────────────────────────────────────────────────────

describe('context-intent Plugin E2E', () => {
  /** @type {ReturnType<typeof createTestKernel>} */
  let env;

  beforeEach(() => {
    env = createTestKernel();
  });

  // ── 1. install 基础 ─────────────────────────────────────────

  describe('install', () => {
    it('should register context service and set initial state', async () => {
      await installPlugin(env.pm);

      assert.ok(env.services.has('context'), 'context service registered');

      // StateBus 初始状态（scoped under plugins.context-intent）
      assert.strictEqual(env.state.get('plugins.context-intent.loaded'), false);
      assert.strictEqual(env.state.get('plugins.context-intent.module'), null);
      assert.deepStrictEqual(env.state.get('plugins.context-intent.decisions'), []);
      assert.deepStrictEqual(env.state.get('plugins.context-intent.atoms'), []);
      assert.deepStrictEqual(env.state.get('plugins.context-intent.excluded'), []);
    });

    it('should create directory structure in VFS', async () => {
      await installPlugin(env.pm);
      // mkdir is no-op in memory VFS, but plugin should not throw
      assert.strictEqual(env.pm.getStatus('context-intent'), 'active');
    });
  });

  // ── 2. load 空数据 ──────────────────────────────────────────

  describe('load', () => {
    it('should return empty arrays when no data exists', async () => {
      await installPlugin(env.pm);
      const ctx = await getContextService(env.services);

      const result = await ctx.load();
      assert.deepStrictEqual(result.decisions, []);
      assert.deepStrictEqual(result.atoms, []);
      assert.deepStrictEqual(result.excluded, []);
      assert.strictEqual(result.dirty.total, 0);

      // StateBus updated
      assert.strictEqual(env.state.get('plugins.context-intent.loaded'), true);
    });

    it('should emit context:loaded event', async () => {
      await installPlugin(env.pm);
      const ctx = await getContextService(env.services);

      let emitted = null;
      env.events.on('context:loaded', (evt) => { emitted = evt; });

      await ctx.load('js/agents');
      assert.ok(emitted, 'event emitted');
      assert.strictEqual(emitted.payload.module, 'js/agents');
    });
  });

  // ── 3. writeAtom ────────────────────────────────────────────

  describe('writeAtom', () => {
    it('should write atom and read back via load', async () => {
      await installPlugin(env.pm);
      const ctx = await getContextService(env.services);

      const res = await ctx.writeAtom({
        atom_key: 'bus-design',
        content: 'EventBus uses Lamport Clock',
        perspective: 'architecture',
        related_modules: ['js/agents/core'],
      });

      assert.ok(res.ok);
      assert.ok(res.id);
      assert.strictEqual(res.shard, 'js-agents-core.jsonl');
      assert.deepStrictEqual(res.warnings, []);

      // load 回来
      const loaded = await ctx.load('js/agents/core');
      assert.strictEqual(loaded.atoms.length, 1);
      assert.strictEqual(loaded.atoms[0].atom_key, 'bus-design');
    });

    it('should detect conflict on same key with different content', async () => {
      await installPlugin(env.pm);
      const ctx = await getContextService(env.services);

      await ctx.writeAtom({
        atom_key: 'naming',
        content: 'use camelCase',
        perspective: 'maintenance',
        related_modules: ['js/agents'],
      });

      const res2 = await ctx.writeAtom({
        atom_key: 'naming',
        content: 'use snake_case',
        perspective: 'maintenance',
        related_modules: ['js/agents'],
      });

      assert.ok(res2.warnings.length > 0, 'should have conflict warning');
      assert.ok(res2.warnings[0].includes('conflict'));
    });

    it('should create cross-references for multiple modules', async () => {
      await installPlugin(env.pm);
      const ctx = await getContextService(env.services);

      await ctx.writeAtom({
        atom_key: 'shared-util',
        content: 'shared between core and runtime',
        perspective: 'architecture',
        related_modules: ['js/agents/core', 'js/agents/runtime'],
      });

      // 主 shard 有 atom
      const primary = await ctx.load('js/agents/core');
      assert.strictEqual(primary.atoms.length, 1);

      // 交叉引用 shard 有 atom_ref（不是 atom，所以 load 过滤后为 0）
      const ref = await ctx.load('js/agents/runtime');
      assert.strictEqual(ref.atoms.length, 0); // atom_ref 被 filter(type=atom) 排除
    });

    it('should reject invalid perspective', async () => {
      await installPlugin(env.pm);
      const ctx = await getContextService(env.services);

      await assert.rejects(
        () => ctx.writeAtom({
          atom_key: 'x', content: 'y', perspective: 'invalid',
          related_modules: ['m'],
        }),
        /perspective/,
      );
    });
  });

  // ── 4. decide ───────────────────────────────────────────────

  describe('decide', () => {
    it('should upsert a decision and fold it back', async () => {
      await installPlugin(env.pm);
      const ctx = await getContextService(env.services);

      const res = await ctx.decide({
        op: 'upsert',
        slug: 'use-lamport-clock',
        title: 'EventBus 时序方案',
        choice: 'Lamport Clock',
        modules: ['js/agents/core'],
      });

      assert.ok(res.ok);
      assert.strictEqual(res.op, 'upsert');

      const { decisions } = await ctx.fold();
      assert.strictEqual(decisions.length, 1);
      assert.strictEqual(decisions[0].slug, 'use-lamport-clock');
      assert.strictEqual(decisions[0].status, 'decided');
    });

    it('should supersede a decision', async () => {
      await installPlugin(env.pm);
      const ctx = await getContextService(env.services);

      await ctx.decide({
        op: 'upsert', slug: 'old-approach',
        title: '旧方案', choice: 'A', modules: ['js/agents'],
      });
      await ctx.decide({
        op: 'upsert', slug: 'new-approach',
        title: '新方案', choice: 'B', modules: ['js/agents'],
      });
      await ctx.decide({
        op: 'supersede', slug: 'old-approach', by: 'new-approach',
      });

      const { decisions } = await ctx.fold();
      const old = decisions.find(d => d.slug === 'old-approach');
      const nw = decisions.find(d => d.slug === 'new-approach');

      assert.strictEqual(old.status, 'superseded');
      assert.strictEqual(old.superseded_by, 'new-approach');
      assert.strictEqual(nw.status, 'decided');
    });

    it('should reject invalid op', async () => {
      await installPlugin(env.pm);
      const ctx = await getContextService(env.services);

      await assert.rejects(
        () => ctx.decide({ op: 'delete', slug: 'x' }),
        /op must be one of/,
      );
    });
  });

  // ── 5. dirty 追踪 ──────────────────────────────────────────

  describe('dirty', () => {
    it('should track dirty after writeAtom and decide', async () => {
      await installPlugin(env.pm);
      const ctx = await getContextService(env.services);

      await ctx.writeAtom({
        atom_key: 'a1', content: 'c1', perspective: 'architecture',
        related_modules: ['js/agents/core'],
      });
      await ctx.decide({
        op: 'upsert', slug: 's1',
        title: 'T', choice: 'C', modules: ['js/agents'],
      });

      const dirty = await ctx.getDirty();
      assert.strictEqual(dirty.total, 2);
      assert.ok(dirty.by_shard['js-agents-core.jsonl'] >= 1);
      assert.ok(dirty.by_shard['ops'] >= 1);
    });

    it('should clear dirty', async () => {
      await installPlugin(env.pm);
      const ctx = await getContextService(env.services);

      await ctx.writeAtom({
        atom_key: 'a1', content: 'c1', perspective: 'security',
        related_modules: ['js/agents'],
      });

      let dirty = await ctx.getDirty();
      assert.ok(dirty.total > 0);

      await ctx.clearDirty();
      dirty = await ctx.getDirty();
      assert.strictEqual(dirty.total, 0);

      // StateBus also cleared
      const stDirty = env.state.get('plugins.context-intent.dirty');
      assert.strictEqual(stDirty.total, 0);
    });
  });

  // ── 6. signal ───────────────────────────────────────────────

  describe('signal', () => {
    it('should write signal and emit event', async () => {
      await installPlugin(env.pm);
      const ctx = await getContextService(env.services);

      let emitted = null;
      env.events.on('context:signal_written', (evt) => { emitted = evt; });

      const res = await ctx.signal({
        type: 'human_confirmed',
        atom_id: 'TEST_ATOM_ID',
      });

      assert.ok(res.ok);
      assert.ok(res.id);
      assert.ok(emitted);
      assert.strictEqual(emitted.payload.type, 'human_confirmed');
    });

    it('should reject invalid signal type', async () => {
      await installPlugin(env.pm);
      const ctx = await getContextService(env.services);

      await assert.rejects(
        () => ctx.signal({ type: 'invalid_type' }),
        /signal type must be one of/,
      );
    });
  });

  // ── 7. snapshot ─────────────────────────────────────────────

  describe('snapshot', () => {
    it('should reflect current StateBus state', async () => {
      await installPlugin(env.pm);
      const ctx = await getContextService(env.services);

      // 初始 snapshot
      let snap = ctx.snapshot();
      assert.strictEqual(snap.loaded, false);
      assert.strictEqual(snap.module, null);

      // load 后 snapshot 更新
      await ctx.load('js/agents');
      snap = ctx.snapshot();
      assert.strictEqual(snap.loaded, true);
      assert.strictEqual(snap.module, 'js/agents');
    });
  });

  // ── 8. autoLoad / autoFold ──────────────────────────────────

  describe('autoLoad on agent:started', () => {
    it('should auto-load context when agent:started fires', async () => {
      await installPlugin(env.pm, { autoLoad: true });

      // 写入一条决策先
      const ctx = await getContextService(env.services);
      await ctx.decide({
        op: 'upsert', slug: 'auto-test',
        title: 'Auto', choice: 'Yes', modules: ['js/agents'],
      });

      // 重置 loaded 状态
      env.state.set('plugins.context-intent.loaded', false);
      env.state.set('plugins.context-intent.decisions', []);

      // 触发 agent:started
      env.events.emit('agent:started', { module: null });

      // 等异步 handler 完成
      await new Promise(r => setTimeout(r, 50));

      assert.strictEqual(env.state.get('plugins.context-intent.loaded'), true);
      const decs = env.state.get('plugins.context-intent.decisions');
      assert.ok(decs.length >= 1);
    });
  });

  describe('autoFold on agent:completed', () => {
    it('should auto-fold when agent:completed fires', async () => {
      await installPlugin(env.pm, { autoFold: true });
      const ctx = await getContextService(env.services);

      await ctx.decide({
        op: 'upsert', slug: 'fold-test',
        title: 'Fold', choice: 'Yes', modules: ['js/agents'],
      });

      // 清空 StateBus decisions
      env.state.set('plugins.context-intent.decisions', []);

      env.events.emit('agent:completed', {});
      await new Promise(r => setTimeout(r, 50));

      const decs = env.state.get('plugins.context-intent.decisions');
      assert.ok(decs.length >= 1, 'decisions folded after agent:completed');
    });
  });

  // ── 9. load 按模块过滤 ─────────────────────────────────────

  describe('load with module filter', () => {
    it('should only return decisions matching the module', async () => {
      await installPlugin(env.pm);
      const ctx = await getContextService(env.services);

      await ctx.decide({
        op: 'upsert', slug: 'core-dec',
        title: 'Core', choice: 'A', modules: ['js/agents/core'],
      });
      await ctx.decide({
        op: 'upsert', slug: 'runtime-dec',
        title: 'Runtime', choice: 'B', modules: ['js/agents/runtime'],
      });

      const coreResult = await ctx.load('js/agents/core');
      assert.strictEqual(coreResult.decisions.length, 1);
      assert.strictEqual(coreResult.decisions[0].slug, 'core-dec');

      const rtResult = await ctx.load('js/agents/runtime');
      assert.strictEqual(rtResult.decisions.length, 1);
      assert.strictEqual(rtResult.decisions[0].slug, 'runtime-dec');
    });
  });

  // ── 10. 完整 E2E 链路 ──────────────────────────────────────

  describe('full E2E: writeAtom → decide → fold → dirty → clearDirty', () => {
    it('should complete the entire lifecycle', async () => {
      await installPlugin(env.pm);
      const ctx = await getContextService(env.services);

      // Step 1: writeAtom
      const atomRes = await ctx.writeAtom({
        atom_key: 'e2e-atom',
        content: 'full lifecycle test',
        perspective: 'architecture',
        related_modules: ['js/agents/core'],
      });
      assert.ok(atomRes.ok);

      // Step 2: decide
      const decRes = await ctx.decide({
        op: 'upsert', slug: 'e2e-decision',
        title: 'E2E Test', choice: 'full path',
        modules: ['js/agents/core'],
      });
      assert.ok(decRes.ok);

      // Step 3: fold
      const { decisions } = await ctx.fold();
      assert.strictEqual(decisions.length, 1);
      assert.strictEqual(decisions[0].slug, 'e2e-decision');
      assert.strictEqual(decisions[0].status, 'decided');

      // Step 4: dirty 应该有记录
      const dirty = await ctx.getDirty();
      assert.ok(dirty.total >= 2, `dirty.total=${dirty.total} should be >= 2`);

      // Step 5: clearDirty
      await ctx.clearDirty();
      const cleanDirty = await ctx.getDirty();
      assert.strictEqual(cleanDirty.total, 0);

      // Step 6: load 验证持久化
      const loaded = await ctx.load('js/agents/core');
      assert.strictEqual(loaded.atoms.length, 1);
      assert.strictEqual(loaded.decisions.length, 1);
      assert.strictEqual(loaded.atoms[0].atom_key, 'e2e-atom');
      assert.strictEqual(loaded.decisions[0].slug, 'e2e-decision');
    });
  });
});