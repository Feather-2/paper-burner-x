/**
 * Service/proxy plugin integration tests (PLUG-02)
 *
 * Coverage focus:
 * - plugins/index.js registry API
 * - resilience/retry proxy retries + event emission + stats service
 * - service/scheduler priority queue + concurrency + cancellation + timeout
 * - service/vfs file operations + events + glob fallback
 * - debug/inspector service registration (+ optional global exposure)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Kernel } from '../../../../js/agents/core/index.js';

import pluginsIndexDefault, {
  createPluginLoader,
  hasPlugin,
  listAvailablePlugins,
  loadPlugin,
  registerPlugin,
} from '../../../../js/agents/plugins/index.js';

import retryPlugin from '../../../../js/agents/plugins/resilience/retry.js';
import schedulerPlugin, { TaskPriority } from '../../../../js/agents/plugins/services/scheduler.js';
import vfsPlugin from '../../../../js/agents/plugins/services/vfs.js';
import inspectorPlugin from '../../../../js/agents/plugins/debug/inspector.js';

let createVfsOverride = null;

vi.mock('../../../../js/agents/vfs/index.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    createVfs: async (options = {}) => {
      if (typeof createVfsOverride === 'function') {
        return await createVfsOverride(options);
      }
      return original.createVfs(options);
    },
  };
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitUntil(predicate, timeoutMs = 500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error('waitUntil: timeout');
}

async function createKernel(options = {}) {
  return new Kernel({
    enableRetry: false,
    enableTimeout: false,
    keepHistory: true,
    keepLog: true,
    ...options,
  });
}

describe('Service/proxy plugins (PLUG-02)', () => {
  let kernel = null;

  beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});

    if (typeof globalThis !== 'undefined' && globalThis.__kernelInspector) {
      delete globalThis.__kernelInspector;
    }

    createVfsOverride = null;
  });

  afterEach(async () => {
    if (kernel) {
      await kernel.stop().catch(() => {});
      kernel = null;
    }

    if (typeof globalThis !== 'undefined' && globalThis.__kernelInspector) {
      delete globalThis.__kernelInspector;
    }

    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('plugins/index.js: loadPlugin/hasPlugin/listAvailablePlugins/registerPlugin (+ createPluginLoader)', async () => {
    expect(hasPlugin('resilience/retry')).toBe(true);
    expect(hasPlugin('does/not-exist')).toBe(false);

    const list = listAvailablePlugins();
    expect(Array.isArray(list)).toBe(true);
    expect(list).toContain('resilience/retry');
    expect(list).toContain('service/scheduler');
    expect(list).toContain('service/vfs');
    expect(list).toContain('debug/inspector');

    // Execute all builtin loaders in the registry to keep coverage high.
    const loadedAll = await Promise.all(list.map((name) => loadPlugin(name)));
    const loadedNamed = loadedAll.map((p) => p?.name).filter((name) => typeof name === 'string');
    expect(list).toEqual(expect.arrayContaining(loadedNamed));

    const loadedRetry = await loadPlugin('resilience/retry');
    expect(loadedRetry?.name).toBe('resilience/retry');

    const loader = createPluginLoader();
    await expect(loader('resilience/retry')).resolves.toEqual(expect.objectContaining({ name: 'resilience/retry' }));

    const customPlugin = { name: 'custom/test', version: '0.0.0', install: () => {} };
    registerPlugin('custom/test', async () => ({ default: customPlugin }));
    expect(hasPlugin('custom/test')).toBe(true);
    expect(listAvailablePlugins()).toContain('custom/test');
    await expect(loadPlugin('custom/test')).resolves.toBe(customPlugin);

    await expect(loadPlugin('unknown/plugin')).rejects.toThrow(/Unknown plugin/i);

    // Default export should be wired to the same API surface.
    expect(typeof pluginsIndexDefault.load).toBe('function');
    expect(typeof pluginsIndexDefault.has).toBe('function');
    expect(typeof pluginsIndexDefault.list).toBe('function');
    expect(typeof pluginsIndexDefault.register).toBe('function');
    expect(typeof pluginsIndexDefault.createLoader).toBe('function');
  });

  it('resilience/retry: retries retryable errors, emits events, and updates stats service', async () => {
    kernel = await createKernel();
    await kernel.use(retryPlugin, { maxRetries: 2, baseDelay: 0, retryableErrors: ['ETIMEDOUT'] });

    let attempts = 0;
    kernel.registerService('unstable', {
      run: () => {
        attempts++;
        if (attempts < 3) {
          const err = new Error('temporary');
          err.code = 'ETIMEDOUT';
          throw err;
        }
        return 'ok';
      },
    });

    const retryEvents = [];
    kernel.events.on('resilience:retry', (evt) => retryEvents.push(evt.payload));
    const exhaustedSpy = vi.fn();
    kernel.events.on('resilience:exhausted', exhaustedSpy);

    await kernel.start();

    await expect(kernel.services.call('unstable', 'run', [])).resolves.toBe('ok');
    expect(attempts).toBe(3);

    expect(retryEvents).toEqual([
      { service: 'unstable', method: 'run', attempt: 2 },
      { service: 'unstable', method: 'run', attempt: 3 },
    ]);
    expect(exhaustedSpy).toHaveBeenCalledTimes(0);

    await expect(kernel.services.call('retry', 'getStats', [])).resolves.toEqual({ total: 2 });

    await expect(kernel.services.call('retry', 'resetStats', [])).resolves.toBe(true);
    await expect(kernel.services.call('retry', 'getStats', [])).resolves.toEqual({ total: 0 });
  });

  it('resilience/retry: does not retry non-retryable errors (shouldRetry gate)', async () => {
    kernel = await createKernel();
    await kernel.use(retryPlugin, { maxRetries: 3, baseDelay: 0, retryableErrors: ['ETIMEDOUT'] });

    let attempts = 0;
    kernel.registerService('unstable', {
      run: () => {
        attempts++;
        const err = new Error('fatal');
        err.code = 'FATAL';
        throw err;
      },
    });

    const retrySpy = vi.fn();
    const exhaustedSpy = vi.fn();
    kernel.events.on('resilience:retry', retrySpy);
    kernel.events.on('resilience:exhausted', exhaustedSpy);

    await kernel.start();

    await expect(kernel.services.call('unstable', 'run', [])).rejects.toThrow(/fatal/i);

    expect(attempts).toBe(1);
    expect(retrySpy).toHaveBeenCalledTimes(0);
    expect(exhaustedSpy).toHaveBeenCalledTimes(1);
    expect(exhaustedSpy.mock.calls[0][0].payload).toEqual(expect.objectContaining({
      service: 'unstable',
      method: 'run',
      attempts: 1,
    }));
  });

  it('service/scheduler: priority queue orders tasks (maxConcurrent=1)', async () => {
    kernel = await createKernel();
    await kernel.use(schedulerPlugin, { maxConcurrent: 1, defaultTimeout: 200 });
    await kernel.start();

    const scheduler = await kernel.services.get('scheduler');
    expect(scheduler).toEqual(expect.objectContaining({
      schedule: expect.any(Function),
      cancel: expect.any(Function),
      getStatus: expect.any(Function),
      getQueueLength: expect.any(Function),
    }));

    const starts = [];
    kernel.events.on('scheduler.task.start', (evt) => starts.push({ id: evt.payload.id, priority: evt.payload.priority }));

    const low = scheduler.schedule(() => 'low', TaskPriority.LOW);
    const high = scheduler.schedule(() => 'high', TaskPriority.HIGH);
    const normal = scheduler.schedule(() => 'normal', TaskPriority.NORMAL);

    // Tasks are queued synchronously; processing starts on next tick.
    expect(scheduler.getQueueLength()).toBe(3);
    expect(scheduler.getQueueLength(TaskPriority.HIGH)).toBe(1);

    const results = await Promise.all([low, high, normal]);
    expect(results.sort()).toEqual(['high', 'low', 'normal'].sort());

    expect(starts.map((s) => s.id)).toEqual([2, 3, 1]);
    expect(starts.map((s) => s.priority)).toEqual([TaskPriority.HIGH, TaskPriority.NORMAL, TaskPriority.LOW]);

    expect(scheduler.getQueueLength()).toBe(0);
    expect(scheduler.getStatus()).toEqual(expect.objectContaining({ running: 0, queued: 0, maxConcurrent: 1 }));
  });

  it('service/scheduler: enforces concurrency and supports cancellation', async () => {
    kernel = await createKernel();
    await kernel.use(schedulerPlugin, { maxConcurrent: 1, defaultTimeout: 200 });
    await kernel.start();

    const scheduler = await kernel.services.get('scheduler');

    const gate = deferred();

    const first = scheduler.schedule(async () => {
      await gate.promise;
      return 'first';
    }, TaskPriority.NORMAL);

    let secondId = null;
    kernel.events.on('scheduler.task.queued', (evt) => {
      if (evt.payload.id !== 1) secondId = evt.payload.id;
    });

    const second = scheduler.schedule(() => 'second', TaskPriority.LOW);

    await waitUntil(() => typeof secondId === 'number', 200);
    await waitUntil(() => scheduler.getStatus().running === 1, 200);
    expect(scheduler.getQueueLength()).toBe(1);

    const cancelledEvt = vi.fn();
    kernel.events.on('scheduler.task.cancelled', cancelledEvt);

    expect(scheduler.cancel(secondId)).toBe(true);
    await expect(second).rejects.toThrow(/cancelled/i);
    expect(cancelledEvt).toHaveBeenCalledTimes(1);

    gate.resolve();
    await expect(first).resolves.toBe('first');

    expect(scheduler.cancel(9999)).toBe(false);
  });

  it('service/scheduler: emits task.error on throw and times out long tasks', async () => {
    kernel = await createKernel();
    await kernel.use(schedulerPlugin, { maxConcurrent: 1, defaultTimeout: 10 });
    await kernel.start();

    const scheduler = await kernel.services.get('scheduler');

    const errors = [];
    kernel.events.on('scheduler.task.error', (evt) => errors.push(evt.payload));

    const boom = scheduler.schedule(() => {
      throw new Error('boom');
    }, TaskPriority.NORMAL);
    await expect(boom).rejects.toThrow(/boom/i);

    const timeout = scheduler.schedule(() => new Promise(() => {}), TaskPriority.NORMAL);
    await expect(timeout).rejects.toThrow(/Task timeout/);

    expect(errors.map((e) => e.error)).toEqual(expect.arrayContaining(['boom', 'Task timeout']));
  });

  it('service/vfs: basic file operations + events + glob fallback', async () => {
    kernel = await createKernel();
    await kernel.use(vfsPlugin, { kind: 'memory' });
    await kernel.start();

    const vfs = await kernel.services.get('vfs');
    expect(vfs).toEqual(expect.objectContaining({
      readFile: expect.any(Function),
      writeFile: expect.any(Function),
      exists: expect.any(Function),
      stat: expect.any(Function),
      readdir: expect.any(Function),
      getType: expect.any(Function),
      getInstance: expect.any(Function),
    }));
    expect(typeof vfs.getType).toBe('function');
    expect(vfs.getType()).toBe('MemoryVfs');

    const writeSpy = vi.fn();
    const deleteSpy = vi.fn();
    kernel.events.on('vfs.write', writeSpy);
    kernel.events.on('vfs.delete', deleteSpy);

    await expect(vfs.mkdir('dir')).resolves.toBe(true);
    await expect(vfs.writeFile('dir/a.txt', 'hello')).resolves.toBe(true);

    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy.mock.calls[0][0].payload).toEqual({ path: 'dir/a.txt' });

    const bytes = await vfs.readFile('dir/a.txt');
    expect(new TextDecoder().decode(bytes)).toBe('hello');

    await expect(vfs.exists('dir/a.txt')).resolves.toBe(true);
    await expect(vfs.exists('dir/missing.txt')).resolves.toBe(false);

    const st = await vfs.stat('dir/a.txt');
    expect(st.isFile()).toBe(true);
    expect(st.isDirectory()).toBe(false);
    expect(st.size).toBeGreaterThan(0);

    await expect(vfs.readdir('dir')).resolves.toEqual(['a.txt']);

    // Glob fallback uses createVfsGlobFn(vfs)
    await expect(vfs.writeFile('dir/b.md', '# b')).resolves.toBe(true);
    await expect(vfs.glob('**/*.txt', { path: '' })).resolves.toEqual(['dir/a.txt']);

    await expect(vfs.deleteFile('dir/a.txt')).resolves.toBe(true);
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy.mock.calls[0][0].payload).toEqual({ path: 'dir/a.txt' });
    await expect(vfs.exists('dir/a.txt')).resolves.toBe(false);

    await expect(vfs.rmdir('dir', { recursive: true })).resolves.toBe(true);

    const instance = vfs.getInstance();
    expect(instance && typeof instance.readFile).toBe('function');
  });

  it('service/vfs: deleteFile prefers vfs.deleteFile, then vfs.rm, and throws if unsupported', async () => {
    class DeleteFileVfs {
      async deleteFile() {
        return true;
      }
    }

    const deleteFileVfs = new DeleteFileVfs();
    const deleteSpy = vi.spyOn(deleteFileVfs, 'deleteFile');
    createVfsOverride = async () => deleteFileVfs;

    kernel = await createKernel();
    await kernel.use(vfsPlugin, { kind: 'memory' });
    await kernel.start();

    const vfs = await kernel.services.get('vfs');
    await expect(vfs.deleteFile('x.txt')).resolves.toBe(true);
    expect(deleteSpy).toHaveBeenCalledWith('x.txt');

    await kernel.stop();
    kernel = null;

    class RmOnlyVfs {
      async rm(_path, _options) {
        return true;
      }
    }

    const rmVfs = new RmOnlyVfs();
    const rmSpy = vi.spyOn(rmVfs, 'rm');
    createVfsOverride = async () => rmVfs;

    kernel = await createKernel();
    await kernel.use(vfsPlugin, { kind: 'memory' });
    await kernel.start();

    const vfs2 = await kernel.services.get('vfs');
    await expect(vfs2.deleteFile('y.txt')).resolves.toBe(true);
    expect(rmSpy).toHaveBeenCalledWith('y.txt', { recursive: false });

    await kernel.stop();
    kernel = null;

    class BareVfs {}
    createVfsOverride = async () => new BareVfs();

    kernel = await createKernel();
    await kernel.use(vfsPlugin, { kind: 'memory' });
    await kernel.start();

    const vfs3 = await kernel.services.get('vfs');
    await expect(vfs3.deleteFile('z.txt')).rejects.toThrow(/does not support/i);
  });

  it('service/vfs: glob delegates to vfs.glob when available', async () => {
    class GlobVfs {
      async glob(_pattern, _options) {
        return ['native.txt'];
      }
    }

    const globVfs = new GlobVfs();
    const globSpy = vi.spyOn(globVfs, 'glob');
    createVfsOverride = async () => globVfs;

    kernel = await createKernel();
    await kernel.use(vfsPlugin, { kind: 'memory' });
    await kernel.start();

    const vfs = await kernel.services.get('vfs');
    await expect(vfs.glob('**/*.txt', { path: '' })).resolves.toEqual(['native.txt']);
    expect(globSpy).toHaveBeenCalledWith('**/*.txt', { path: '' });
  });

  it('debug/inspector: registers inspector service, exposes APIs, and can expose global handle', async () => {
    kernel = await createKernel({ keepHistory: true, keepLog: true });
    await kernel.use(inspectorPlugin, { enabled: true, exposeGlobal: true });
    await kernel.start();

    expect(kernel.services.has('inspector')).toBe(true);
    const inspector = await kernel.services.get('inspector');

    expect(inspector.kernel.id).toBe(kernel.id);
    expect(inspector.kernel.status()).toBe(kernel.status);

    const snap = inspector.kernel.snapshot();
    expect(snap).toEqual(expect.objectContaining({ kernelId: kernel.id }));

    await expect(inspector.kernel.healthCheck()).resolves.toEqual(expect.objectContaining({ kernelId: kernel.id }));

    const waited = inspector.events.waitFor('custom.test', 200);
    inspector.events.emit('custom.test', { ok: true });
    await expect(waited).resolves.toMatchObject({ event: 'custom.test', data: { ok: true } });
    expect(inspector.events.history('custom.test')).toHaveLength(1);

    kernel.state.set('x.y', 1);
    expect(inspector.state.get('x.y')).toBe(1);

    inspector.state.set('local.flag', true);
    expect(kernel.state.get('plugins.debug/inspector.local.flag')).toBe(true);

    const snapId = inspector.state.snapshot('s1');
    kernel.state.set('x.y', 2);
    inspector.state.rollback(snapId);
    expect(kernel.state.get('x.y')).toBe(1);

    kernel.registerService('math', { add: (a, b) => a + b });
    await expect(inspector.services.call('math', 'add', [1, 2])).resolves.toBe(3);
    expect(inspector.services.list().some((s) => s.name === 'math')).toBe(true);
    expect(inspector.services.stats('math')).toEqual(expect.objectContaining({ calls: 1 }));

    const plugins = inspector.plugins.list();
    expect(plugins.some((p) => p.name === 'debug/inspector')).toBe(true);

    expect(inspector.state.changeLog(10).length).toBeGreaterThan(0);

    // Help prints usage text.
    inspector.help();
    expect(console.log).toHaveBeenCalled();

    expect(typeof globalThis.__kernelInspector).toBe('object');
    expect(globalThis.__kernelInspector).toBe(inspector);

    await kernel.stop();
    kernel = null;
    expect(globalThis.__kernelInspector).toBeUndefined();
  });

  it('debug/inspector: respects enabled=false (no service registration)', async () => {
    kernel = await createKernel();
    await kernel.use(inspectorPlugin, { enabled: false, exposeGlobal: true });
    await kernel.start();

    expect(kernel.services.has('inspector')).toBe(false);
    expect(globalThis.__kernelInspector).toBeUndefined();
  });
});
