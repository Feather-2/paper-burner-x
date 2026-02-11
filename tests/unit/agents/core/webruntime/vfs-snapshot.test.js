import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryVfs } from '../../../../../js/agents/vfs/vfs.memory.js';
import {
  toSnapshot,
  fromSnapshot,
  diffSnapshots,
  uint8ToBase64,
  base64ToUint8,
} from '../../../../../js/agents/core/webruntime/vfs-snapshot.js';

describe('vfs-snapshot', () => {
  /** @type {MemoryVfs} */
  let vfs;

  beforeEach(() => {
    vfs = new MemoryVfs();
  });

  // --- base64 round-trip ---

  describe('uint8ToBase64 / base64ToUint8', () => {
    it('round-trips plain text bytes', () => {
      const original = new TextEncoder().encode('hello world');
      const b64 = uint8ToBase64(original);
      const restored = base64ToUint8(b64);
      expect(restored).toEqual(original);
    });

    it('round-trips binary data with all byte values', () => {
      const original = new Uint8Array(256);
      for (let i = 0; i < 256; i++) original[i] = i;
      const b64 = uint8ToBase64(original);
      const restored = base64ToUint8(b64);
      expect(restored).toEqual(original);
    });

    it('round-trips empty array', () => {
      const original = new Uint8Array(0);
      const b64 = uint8ToBase64(original);
      const restored = base64ToUint8(b64);
      expect(restored).toEqual(original);
    });
  });

  // --- empty VFS snapshot ---

  it('toSnapshot on empty VFS returns empty files array', async () => {
    const snap = await toSnapshot(vfs);
    expect(Array.isArray(snap.files)).toBe(true);
    expect(snap.files.length).toBe(0);
  });

  // --- text file round-trip ---

  it('text file survives snapshot round-trip', async () => {
    await vfs.writeText('notes.txt', 'some text content');
    const snap = await toSnapshot(vfs);
    const restored = await fromSnapshot(snap);
    const text = await restored.readText('notes.txt');
    expect(text).toBe('some text content');
  });

  // --- binary file round-trip ---

  it('binary file survives snapshot round-trip', async () => {
    const bin = new Uint8Array([0, 1, 127, 128, 255]);
    await vfs.writeFile('data.bin', bin);
    const snap = await toSnapshot(vfs);
    const restored = await fromSnapshot(snap);
    const read = await restored.readFile('data.bin');
    expect(read).toEqual(bin);
  });

  // --- directory structure preserved ---

  it('nested directory structure is preserved after round-trip', async () => {
    await vfs.mkdir('a/b/c', { recursive: true });
    await vfs.writeText('a/b/c/deep.txt', 'deep');
    const snap = await toSnapshot(vfs);
    const restored = await fromSnapshot(snap);
    const text = await restored.readText('a/b/c/deep.txt');
    expect(text).toBe('deep');
    const exists = await restored.exists('a/b/c');
    expect(exists).toBe(true);
  });

  // --- multi-file round-trip ---

  it('multiple files and directories survive round-trip', async () => {
    await vfs.mkdir('src', { recursive: true });
    await vfs.writeText('src/index.js', 'export default 1;');
    await vfs.writeText('src/util.js', 'export const x = 2;');
    await vfs.writeText('README.md', '# Hello');
    const snap = await toSnapshot(vfs);
    const restored = await fromSnapshot(snap);

    expect(await restored.readText('src/index.js')).toBe('export default 1;');
    expect(await restored.readText('src/util.js')).toBe('export const x = 2;');
    expect(await restored.readText('README.md')).toBe('# Hello');
  });

  // --- fromSnapshot into existing VFS ---

  it('fromSnapshot merges into an existing VFS instance', async () => {
    const target = new MemoryVfs();
    await target.writeText('existing.txt', 'keep me');

    await vfs.writeText('new.txt', 'added');
    const snap = await toSnapshot(vfs);
    const result = await fromSnapshot(snap, target);

    expect(result).toBe(target);
    expect(await target.readText('existing.txt')).toBe('keep me');
    expect(await target.readText('new.txt')).toBe('added');
  });

  // --- diffSnapshots ---

  describe('diffSnapshots', () => {
    it('detects added files', async () => {
      await vfs.writeText('a.txt', 'a');
      const snapA = await toSnapshot(vfs);

      await vfs.writeText('b.txt', 'b');
      const snapB = await toSnapshot(vfs);

      const diff = diffSnapshots(snapA, snapB);
      expect(diff.added).toEqual(['b.txt']);
      expect(diff.modified).toEqual([]);
      expect(diff.deleted).toEqual([]);
    });

    it('detects modified files', async () => {
      await vfs.writeText('file.txt', 'v1');
      const snapA = await toSnapshot(vfs);

      await vfs.writeText('file.txt', 'v2');
      const snapB = await toSnapshot(vfs);

      const diff = diffSnapshots(snapA, snapB);
      expect(diff.added).toEqual([]);
      expect(diff.modified).toEqual(['file.txt']);
      expect(diff.deleted).toEqual([]);
    });

    it('detects deleted files', async () => {
      await vfs.writeText('keep.txt', 'k');
      await vfs.writeText('gone.txt', 'g');
      const snapA = await toSnapshot(vfs);

      await vfs.unlink('gone.txt');
      const snapB = await toSnapshot(vfs);

      const diff = diffSnapshots(snapA, snapB);
      expect(diff.added).toEqual([]);
      expect(diff.modified).toEqual([]);
      expect(diff.deleted).toEqual(['gone.txt']);
    });
  });
});
