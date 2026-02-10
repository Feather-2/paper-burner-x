import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HmrEngine } from '../../../../../js/agents/core/sandbox/hmr.js';

function createMockVfs() {
  const listeners = new Map();
  return {
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
    },
    off(event, fn) {
      const arr = listeners.get(event);
      if (arr) {
        const i = arr.indexOf(fn);
        if (i >= 0) arr.splice(i, 1);
      }
    },
    _emit(event, ...args) {
      (listeners.get(event) || []).forEach((fn) => fn(...args));
    },
  };
}

describe('HmrEngine', () => {
  /** @type {ReturnType<typeof createMockVfs>} */
  let vfs;
  /** @type {HmrEngine} */
  let hmr;

  beforeEach(() => {
    vfs = createMockVfs();
    hmr = new HmrEngine({ vfs });
  });

  it('CSS 文件变更触发 css-update', () => {
    hmr.start();
    const spy = vi.fn();
    hmr.on('css-update', spy);
    vfs._emit('change', '/app/style.css');
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toMatchObject({ type: 'css-update', path: '/app/style.css' });
  });

  it('JS 文件变更触发 update', () => {
    hmr.start();
    const spy = vi.fn();
    hmr.on('hmr', spy);
    hmr.accept('/app/main.js', () => {});
    vfs._emit('change', '/app/main.js');
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0][0]).toMatchObject({ type: 'update', path: '/app/main.js' });
  });

  it('HTML 文件变更触发 full-reload', () => {
    hmr.start();
    const spy = vi.fn();
    hmr.on('hmr', spy);
    vfs._emit('change', '/app/index.html');
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toMatchObject({ type: 'full-reload', path: '/app/index.html' });
  });

  it('accept handler 被调用', () => {
    hmr.start();
    const acceptCb = vi.fn();
    hmr.accept('/app/mod.js', acceptCb);
    vfs._emit('change', '/app/mod.js');
    expect(acceptCb).toHaveBeenCalledOnce();
    expect(acceptCb.mock.calls[0][0]).toMatchObject({ type: 'update', path: '/app/mod.js' });
  });

  it('无 accept handler 时触发 full-reload', () => {
    hmr.start();
    const spy = vi.fn();
    hmr.on('hmr', spy);
    vfs._emit('change', '/app/mod.js');
    // first call: update event, second call: full-reload fallback
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1][0]).toMatchObject({ type: 'full-reload', path: '/app/mod.js' });
  });

  it('stop 后不再触发事件', () => {
    hmr.start();
    const spy = vi.fn();
    hmr.on('hmr', spy);
    hmr.stop();
    vfs._emit('change', '/app/main.js');
    expect(spy).not.toHaveBeenCalled();
  });

  it('dispose callback 在 invalidate 时调用', () => {
    hmr.start();
    const disposeCb = vi.fn();
    hmr.dispose('/app/mod.js', disposeCb);
    hmr.accept('/app/mod.js', () => {});
    vfs._emit('change', '/app/mod.js');
    expect(disposeCb).toHaveBeenCalledOnce();
  });

  it('createHotContext 返回 accept/dispose/invalidate', () => {
    const hot = hmr.createHotContext('/app/comp.js');
    expect(typeof hot.accept).toBe('function');
    expect(typeof hot.dispose).toBe('function');
    expect(typeof hot.invalidate).toBe('function');
  });

  it('invalidate 触发 full-reload', () => {
    hmr.start();
    const spy = vi.fn();
    hmr.on('hmr', spy);
    const hot = hmr.createHotContext('/app/comp.js');
    hot.invalidate();
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toMatchObject({ type: 'full-reload', path: '/app/comp.js' });
  });

  it('_invalidateModule 清除缓存', () => {
    const cache = new Map([[ '/app/mod.js', { exports: {} } ]]);
    const engine = new HmrEngine({ vfs, moduleCache: cache });
    engine._invalidateModule('/app/mod.js');
    expect(cache.has('/app/mod.js')).toBe(false);
  });
});
