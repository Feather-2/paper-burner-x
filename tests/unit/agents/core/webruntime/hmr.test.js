import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HmrClient, createHmrClient } from '../../../../../js/agents/core/webruntime/hmr.js';

function createMockVfs() {
  const listeners = new Map();

  return {
    on(event, callback) {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event).add(callback);
    },
    off(event, callback) {
      const callbacks = listeners.get(event);
      if (!callbacks) return;
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        listeners.delete(event);
      }
    },
    emit(event, ...args) {
      const callbacks = listeners.get(event);
      if (!callbacks) return;
      for (const callback of [...callbacks]) {
        callback(...args);
      }
    },
    listenerCount(event) {
      return listeners.get(event)?.size || 0;
    },
  };
}

describe('HmrClient', () => {
  let moduleCache;
  let vfs;

  beforeEach(() => {
    moduleCache = new Map();
    vfs = createMockVfs();
  });

  it('createHmrClient returns HmrClient instance', () => {
    const client = createHmrClient({ moduleCache, vfs });
    expect(client).toBeInstanceOf(HmrClient);
  });

  it('createHotContext returns import.meta.hot compatible API', () => {
    const client = new HmrClient({ moduleCache, vfs });
    const hot = client.createHotContext('/entry.js');

    expect(typeof hot.accept).toBe('function');
    expect(typeof hot.dispose).toBe('function');
    expect(typeof hot.invalidate).toBe('function');
    expect(typeof hot.decline).toBe('function');
    expect(hot.data).toEqual({});

    hot.data.renderCount = 1;
    const hotAgain = client.createHotContext('/entry.js');
    expect(hotAgain.data.renderCount).toBe(1);
  });

  it('self-accept callback handles js update', async () => {
    const client = new HmrClient({ moduleCache, vfs });
    const acceptSpy = vi.fn();
    client.createHotContext('/mod.js').accept(acceptSpy);

    const updateSpy = vi.fn();
    client.on('hmr:update', updateSpy);

    const update = await client.handleFileChange('/mod.js', 'export const v = 1;');
    expect(update.type).toBe('update');
    expect(updateSpy).toHaveBeenCalledOnce();
    expect(acceptSpy).toHaveBeenCalledOnce();
  });

  it('accept() without callback still marks module as self-accepted', async () => {
    const client = new HmrClient({ moduleCache, vfs });
    client.createHotContext('/self.js').accept();

    const update = await client.handleFileChange('/self.js', 'console.log(1);');
    expect(update.type).toBe('update');
  });

  it('dependency accept callback runs when accepted dependency changes', async () => {
    const client = new HmrClient({ moduleCache, vfs });
    const depAcceptSpy = vi.fn();

    client.createHotContext('/importer.js').accept('/dep.js', depAcceptSpy);
    const update = await client.handleFileChange('/dep.js', 'export const dep = 2;');

    expect(update.type).toBe('update');
    expect(depAcceptSpy).toHaveBeenCalledOnce();
    expect(depAcceptSpy.mock.calls[0][0][0].path).toBe('/dep.js');
  });

  it('dependency accept supports array form', async () => {
    const client = new HmrClient({ moduleCache, vfs });
    const depAcceptSpy = vi.fn();

    client.createHotContext('/importer.js').accept(['/a.js', '/b.js'], depAcceptSpy);

    const first = await client.handleFileChange('/a.js', 'export const a = 1;');
    const second = await client.handleFileChange('/b.js', 'export const b = 2;');

    expect(first.type).toBe('update');
    expect(second.type).toBe('update');
    expect(depAcceptSpy).toHaveBeenCalledTimes(2);
  });

  it('dispose callback executes before accept callback and receives hot data', async () => {
    const client = new HmrClient({ moduleCache, vfs });
    const callOrder = [];

    const hot = client.createHotContext('/ordered.js');
    hot.data.count = 0;
    hot.dispose((data) => {
      data.count += 1;
      callOrder.push(`dispose:${data.count}`);
    });
    hot.accept(() => {
      callOrder.push('accept');
    });

    await client.handleFileChange('/ordered.js', 'console.log("ordered");');

    expect(callOrder).toEqual(['dispose:1', 'accept']);
    expect(client.createHotContext('/ordered.js').data.count).toBe(1);
  });

  it('update clears normalized module cache entries', async () => {
    moduleCache.set('/app/main.js?version=42', { exports: {} });
    const client = new HmrClient({ moduleCache, vfs });
    client.createHotContext('/app/main.js').accept(() => {});

    await client.handleFileChange('/app/main.js', 'export default 1;');

    expect(moduleCache.size).toBe(0);
  });

  it('css change emits css-update and does not trigger full reload', async () => {
    const onFullReload = vi.fn();
    const client = new HmrClient({ moduleCache, vfs, onFullReload });
    const cssSpy = vi.fn();
    const fullReloadSpy = vi.fn();

    client.on('hmr:css-update', cssSpy);
    client.on('hmr:full-reload', fullReloadSpy);

    const update = await client.handleFileChange('/styles/site.css', 'body {}');

    expect(update.type).toBe('css-update');
    expect(cssSpy).toHaveBeenCalledOnce();
    expect(fullReloadSpy).not.toHaveBeenCalled();
    expect(onFullReload).not.toHaveBeenCalled();
  });

  it('js/mjs without accept falls back to full reload', async () => {
    const onFullReload = vi.fn();
    const client = new HmrClient({ moduleCache, vfs, onFullReload });
    const fullReloadSpy = vi.fn();

    client.on('hmr:full-reload', fullReloadSpy);

    const jsUpdate = await client.handleFileChange('/plain.js', 'export default 1;');
    const mjsUpdate = await client.handleFileChange('/plain.mjs', 'export default 2;');

    expect(jsUpdate.type).toBe('full-reload');
    expect(mjsUpdate.type).toBe('full-reload');
    expect(fullReloadSpy).toHaveBeenCalledTimes(2);
    expect(onFullReload).toHaveBeenCalledTimes(2);
  });

  it('declined module refuses updates and forces full reload', async () => {
    const client = new HmrClient({ moduleCache, vfs });
    const fullReloadSpy = vi.fn();

    const hot = client.createHotContext('/declined.js');
    hot.accept(() => {});
    hot.decline();

    client.on('hmr:full-reload', fullReloadSpy);

    const update = await client.handleFileChange('/declined.js', 'export const v = 3;');

    expect(update.type).toBe('full-reload');
    expect(fullReloadSpy).toHaveBeenCalledOnce();
  });

  it('unknown extension triggers full reload', async () => {
    const client = new HmrClient({ moduleCache, vfs });
    const fullReloadSpy = vi.fn();
    client.on('hmr:full-reload', fullReloadSpy);

    const update = await client.handleFileChange('/assets/data.json', '{"ok":true}');

    expect(update.type).toBe('full-reload');
    expect(fullReloadSpy).toHaveBeenCalledOnce();
  });

  it('delete event forces full reload even for self-accepted modules', async () => {
    const onFullReload = vi.fn();
    const client = new HmrClient({ moduleCache, vfs, onFullReload });
    const fullReloadSpy = vi.fn();

    client.createHotContext('/delete-me.js').accept(() => {});
    client.on('hmr:full-reload', fullReloadSpy);

    const update = await client.handleFileDelete('/delete-me.js?x=1#h');

    expect(update.type).toBe('full-reload');
    expect(update.path).toBe('/delete-me.js');
    expect(fullReloadSpy).toHaveBeenCalledOnce();
    expect(onFullReload).toHaveBeenCalledOnce();
  });

  it('off removes event listener', async () => {
    const client = new HmrClient({ moduleCache, vfs });
    const updateSpy = vi.fn();

    client.createHotContext('/off.js').accept(() => {});
    client.on('hmr:update', updateSpy);
    client.off('hmr:update', updateSpy);

    await client.handleFileChange('/off.js', 'export const off = true;');

    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('accept callback errors emit hmr:error', async () => {
    const client = new HmrClient({ moduleCache, vfs });
    const errorSpy = vi.fn();

    client.createHotContext('/error.js').accept(() => {
      throw new Error('accept failed');
    });
    client.on('hmr:error', errorSpy);

    await client.handleFileChange('/error.js', 'export const err = 1;');

    expect(errorSpy).toHaveBeenCalledOnce();
    expect(errorSpy.mock.calls[0][0].phase).toBe('accept');
  });

  it('applyUpdate reports unsupported update types as hmr:error', async () => {
    const client = new HmrClient({ moduleCache, vfs });
    const errorSpy = vi.fn();
    client.on('hmr:error', errorSpy);

    const ok = await client.applyUpdate({
      type: 'bad-update-type',
      path: '/bad.js',
      timestamp: Date.now(),
    });

    expect(ok).toBe(false);
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(String(errorSpy.mock.calls[0][0].error.message)).toContain('Unsupported update type');
    expect(client.lastError).toBeInstanceOf(Error);
  });

  it('deduplicates dependency accept callbacks across dependency graph', async () => {
    const client = new HmrClient({ moduleCache, vfs });
    const sharedCallback = vi.fn();

    client.createHotContext('/a.js').accept('/dep.js', sharedCallback);
    client.createHotContext('/b.js').accept('/dep.js', sharedCallback);

    await client.handleFileChange('/dep.js', 'export const dep = 1;');
    expect(sharedCallback).toHaveBeenCalledTimes(1);
  });

  it('can throw update errors when throwOnError is enabled', async () => {
    const client = new HmrClient({ moduleCache, vfs, throwOnError: true });
    await expect(client.applyUpdate({ type: 'bad-update-type', path: '/x.js' })).rejects.toThrow(/Unsupported update type/);
  });

  it('auto-listens to vfs change/delete events and dispose detaches listeners', async () => {
    const client = new HmrClient({ moduleCache, vfs });
    const updateSpy = vi.fn();
    const reloadSpy = vi.fn();

    client.createHotContext('/vfs.js').accept(() => {});
    client.on('hmr:update', updateSpy);
    client.on('hmr:full-reload', reloadSpy);

    expect(vfs.listenerCount('change')).toBe(1);
    expect(vfs.listenerCount('delete')).toBe(1);

    vfs.emit('change', '/vfs.js', 'export const v = 1;');
    await Promise.resolve();
    expect(updateSpy).toHaveBeenCalledOnce();

    vfs.emit('delete', '/vfs.js');
    await Promise.resolve();
    expect(reloadSpy).toHaveBeenCalledOnce();

    client.dispose();
    expect(vfs.listenerCount('change')).toBe(0);
    expect(vfs.listenerCount('delete')).toBe(0);

    vfs.emit('change', '/vfs.js', 'export const v = 2;');
    vfs.emit('delete', '/vfs.js');
    await Promise.resolve();
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });
});
