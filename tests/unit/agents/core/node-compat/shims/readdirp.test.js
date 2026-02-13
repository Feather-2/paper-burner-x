import { describe, it, expect, vi } from 'vitest';
import readdirpDefault, {
  setVFS,
  readdirp,
  readdirpPromise,
  ReaddirpStream,
} from '../../../../../../js/agents/core/node-compat/shims/readdirp.js';

describe('readdirp shim', () => {
  it('setVFS is an inert compatibility hook', () => {
    expect(() => setVFS({})).not.toThrow();
    expect(() => setVFS(null)).not.toThrow();
  });

  it('ReaddirpStream async iterator and toArray expose entries', async () => {
    const stream = new ReaddirpStream('/root', {});
    stream.entries.push({ path: 'a.txt' }, { path: 'b.txt' });

    const iterated = [];
    for await (const entry of stream) {
      iterated.push(entry);
    }

    expect(iterated).toEqual(stream.entries);
    await expect(stream.toArray()).resolves.toEqual(stream.entries);
  });

  it('emit/off work with listener map, and once/on are safe for edge usage', () => {
    const stream = new ReaddirpStream('/root', {});
    const handler = vi.fn();
    stream.listeners.set('custom', [handler]);

    stream.emit('custom', 1, 2);
    expect(handler).toHaveBeenCalledWith(1, 2);

    expect(stream.off('custom', handler)).toBe(stream);
    stream.emit('custom', 3);
    expect(handler).toHaveBeenCalledTimes(1);

    expect(stream.once('custom', vi.fn())).toBe(stream);
    expect(stream.off('missing', vi.fn())).toBe(stream);
  });

  it('on("data") emits entries and then end event', async () => {
    const stream = new ReaddirpStream('/root', {});
    stream.entries.push({ path: 'entry.txt' });
    const onData = vi.fn();
    const onEnd = vi.fn();
    stream.listeners.set('end', [onEnd]);

    stream.on('data', onData);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onData).toHaveBeenCalledWith({ path: 'entry.txt' });
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('factory helpers return stream and promise-compatible output', async () => {
    const stream = readdirp('/workspace', { type: 'files' });
    expect(stream).toBeInstanceOf(ReaddirpStream);
    await expect(readdirpPromise('/workspace', { type: 'files' })).resolves.toEqual([]);
  });

  it('default export points to readdirp factory', () => {
    expect(readdirpDefault).toBe(readdirp);
  });
});
