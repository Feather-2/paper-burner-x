import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryVfs } from '../../../../../js/agents/vfs/vfs.memory.js';
import {
  withVfsEvents,
  createVfsEventBridge,
} from '../../../../../js/agents/core/webruntime/vfs-events.js';

describe('vfs-events', () => {
  /** @type {MemoryVfs} */
  let raw;
  /** @type {ReturnType<typeof withVfsEvents>} */
  let vfs;

  beforeEach(() => {
    raw = new MemoryVfs();
    vfs = withVfsEvents(raw);
  });

  // 1. writeFile triggers change
  it('writeFile triggers change event with path and data', async () => {
    const events = [];
    vfs.on('change', (path, data) => events.push({ path, data }));
    const data = new Uint8Array([1, 2, 3]);
    await vfs.writeFile('foo.bin', data);
    expect(events).toHaveLength(1);
    expect(events[0].path).toBe('foo.bin');
    expect(events[0].data).toEqual(data);
  });

  // 2. writeText triggers change
  it('writeText triggers change event', async () => {
    const events = [];
    vfs.on('change', (path, data) => events.push({ path, data }));
    await vfs.writeText('hello.txt', 'world');
    expect(events).toHaveLength(1);
    expect(events[0].path).toBe('hello.txt');
    expect(events[0].data).toBe('world');
  });

  // 3. unlink triggers delete
  it('unlink triggers delete event', async () => {
    await vfs.writeText('tmp.txt', 'x');
    const events = [];
    vfs.on('delete', (path) => events.push(path));
    await vfs.unlink('tmp.txt');
    expect(events).toEqual(['tmp.txt']);
  });

  // 4. rmdir triggers delete
  it('rmdir triggers delete event', async () => {
    await vfs.mkdir('mydir');
    const events = [];
    vfs.on('delete', (path) => events.push(path));
    await vfs.rmdir('mydir');
    expect(events).toEqual(['mydir']);
  });

  // 5. move triggers delete on src and change on dest
  it('move triggers delete for src and change for dest', async () => {
    await vfs.writeText('old.txt', 'content');
    const deleted = [];
    const changed = [];
    vfs.on('delete', (p) => deleted.push(p));
    vfs.on('change', (p) => changed.push(p));
    await vfs.move('old.txt', 'new.txt');
    expect(deleted).toEqual(['old.txt']);
    expect(changed).toEqual(['new.txt']);
  });

  // 6. copy triggers change on dest
  it('copy triggers change for dest', async () => {
    await vfs.writeText('src.txt', 'data');
    const changed = [];
    vfs.on('change', (p) => changed.push(p));
    await vfs.copy('src.txt', 'dst.txt');
    expect(changed).toEqual(['dst.txt']);
  });

  // 7. appendText triggers change
  it('appendText triggers change event', async () => {
    await vfs.writeText('log.txt', 'line1');
    const events = [];
    vfs.on('change', (p, d) => events.push({ p, d }));
    await vfs.appendText('log.txt', '\nline2');
    expect(events).toHaveLength(1);
    expect(events[0].p).toBe('log.txt');
  });

  // 8. failed operation does not trigger event
  it('unlink on non-existent file does not trigger delete', async () => {
    const events = [];
    vfs.on('delete', (p) => events.push(p));
    await expect(vfs.unlink('nope.txt')).rejects.toThrow();
    expect(events).toHaveLength(0);
  });

  // 9. off removes listener
  it('off removes a listener so it no longer fires', async () => {
    const events = [];
    const listener = (p) => events.push(p);
    vfs.on('change', listener);
    await vfs.writeText('a.txt', '1');
    vfs.off('change', listener);
    await vfs.writeText('b.txt', '2');
    expect(events).toHaveLength(1);
    expect(events[0]).toBe('a.txt');
  });

  // 10. once fires only once
  it('once listener fires exactly once', async () => {
    const events = [];
    vfs.once('change', (p) => events.push(p));
    await vfs.writeText('x.txt', '1');
    await vfs.writeText('y.txt', '2');
    expect(events).toEqual(['x.txt']);
  });

  // 11. removeAllListeners
  it('removeAllListeners clears all listeners', async () => {
    const events = [];
    vfs.on('change', (p) => events.push(p));
    vfs.on('delete', (p) => events.push(p));
    vfs.removeAllListeners();
    await vfs.writeText('z.txt', 'data');
    expect(events).toHaveLength(0);
  });

  it('removeAllListeners with event name clears only that event', async () => {
    const changes = [];
    const deletes = [];
    vfs.on('change', (p) => changes.push(p));
    vfs.on('delete', (p) => deletes.push(p));
    vfs.removeAllListeners('change');
    await vfs.writeText('a.txt', '1');
    await vfs.unlink('a.txt');
    expect(changes).toHaveLength(0);
    expect(deletes).toHaveLength(1);
  });

  // 12. listener exception does not break VFS operation
  it('listener throwing does not prevent writeFile from succeeding', async () => {
    vfs.on('change', () => { throw new Error('boom'); });
    await vfs.writeFile('safe.txt', new Uint8Array([42]));
    const text = await vfs.readText('safe.txt');
    expect(text).toBe('*'); // 42 == '*'
  });

  // 13. createVfsEventBridge syncs writes
  it('createVfsEventBridge replicates writes to target VFS', async () => {
    const target = new MemoryVfs();
    const bridge = createVfsEventBridge(vfs, target);
    await vfs.writeText('synced.txt', 'hello');
    // bridge onChange is async; give it a tick
    await new Promise((r) => setTimeout(r, 20));
    const text = await target.readText('synced.txt');
    expect(text).toBe('hello');
    bridge.dispose();
  });

  // 14. bridge dispose stops syncing
  it('bridge dispose stops further syncing', async () => {
    const target = new MemoryVfs();
    const bridge = createVfsEventBridge(vfs, target);
    await vfs.writeText('first.txt', '1');
    await new Promise((r) => setTimeout(r, 20));
    bridge.dispose();
    await vfs.writeText('second.txt', '2');
    await new Promise((r) => setTimeout(r, 20));
    expect(await target.exists('first.txt')).toBe(true);
    expect(await target.exists('second.txt')).toBe(false);
  });

  it('bridge delete falls back to rm/remove strategies', async () => {
    const listeners = new Map();
    const eventVfsStub = {
      on(event, fn) {
        listeners.set(event, fn);
      },
      off(event) {
        listeners.delete(event);
      },
    };
    const target = {
      unlink: async () => { throw new Error('unlink failed'); },
      rmdir: async () => { throw new Error('rmdir failed'); },
      rm: async () => true,
    };

    createVfsEventBridge(eventVfsStub, target);
    await listeners.get('delete')('folder');
    expect(listeners.has('delete')).toBe(true);
  });

  it('bridge writes string payload via writeText and object payload via writeFile', async () => {
    const listeners = new Map();
    const eventVfsStub = {
      on(event, fn) {
        listeners.set(event, fn);
      },
      off(event) {
        listeners.delete(event);
      },
      readFile: async () => new Uint8Array([1, 2, 3]),
    };
    const target = {
      writeText: async () => true,
      writeFile: async () => true,
    };
    const writeTextSpy = vi.spyOn(target, 'writeText');
    const writeFileSpy = vi.spyOn(target, 'writeFile');

    createVfsEventBridge(eventVfsStub, target);

    await listeners.get('change')('a.txt', 'hello');
    await listeners.get('change')('obj.json', { a: 1 });

    expect(writeTextSpy).toHaveBeenCalledWith('a.txt', 'hello');
    expect(writeFileSpy).toHaveBeenCalled();
    const payload = writeFileSpy.mock.calls[0][1];
    expect(payload).toBeInstanceOf(Uint8Array);
  });

  // 15. path normalization in events
  it('event paths are normalized', async () => {
    const events = [];
    vfs.on('change', (p) => events.push(p));
    await vfs.writeText('./foo/bar.txt', 'data');
    expect(events).toHaveLength(1);
    expect(events[0]).toBe('foo/bar.txt');
  });
});
