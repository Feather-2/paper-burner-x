import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryVfs } from '../../../../../js/agents/vfs/vfs.memory.js';
import {
  toSnapshot,
  fromSnapshot,
  diffSnapshots,
  uint8ToBase64,
  base64ToUint8,
} from '../../../../../js/agents/core/sandbox/vfs-snapshot.js';

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
      assert.deepStrictEqual(restored, original);
    });

    it('round-trips binary data with all byte values', () => {
      const original = new Uint8Array(256);
      for (let i = 0; i < 256; i++) original[i] = i;
      const b64 = uint8ToBase64(original);
      const restored = base64ToUint8(b64);
      assert.deepStrictEqual(restored, original);
    });

    it('round-trips empty array', () => {
      const original = new Uint8Array(0);
      const b64 = uint8ToBase64(original);
      const restored = base64ToUint8(b64);
      assert.deepStrictEqual(restored, original);
    });
  });

  // --- empty VFS snapshot ---

  it('toSnapshot on empty VFS returns empty files array', async () => {
    const snap = await toSnapshot(vfs);
    assert.ok(Array.isArray(snap.files));
    assert.strictEqual(snap.files.length, 0);
  });

  // --- text file round-trip ---

  it('text file survives snapshot round-trip', async () => {
    await vfs.writeText('notes.txt', 'some text content');
    const snap = await toSnapshot(vfs);
    const restored = await fromSnapshot(snap);
    const text = await restored.readText('notes.txt');
    assert.strictEqual(text, 'some text content');
  });

  // --- binary file round-trip ---

  it('binary file survives snapshot round-trip', async () => {
    const bin = new Uint8Array([0, 1, 127, 128, 255]);
    await vfs.writeFile('data.bin', bin);
    const snap = await toSnapshot(vfs);
    const restored = await fromSnapshot(snap);
    const read = await restored.readFile('data.bin');
    assert.deepStrictEqual(read, bin);
  });

  // --- directory structure preserved ---

  it('nested directory structure is preserved after round-trip', async () => {
    await vfs.mkdir('a/b/c', { recursive: true });
    await vfs.writeText('a/b/c/deep.txt', 'deep');
    const snap = await toSnapshot(vfs);
    const restored = await fromSnapshot(snap);
    const text = await restored.readText('a/b/c/deep.txt');
    assert.strictEqual(text, 'deep');
    const exists = await restored.exists('a/b/c');
    assert.ok(exists);
  });

  // --- multi-file round-trip ---

  it('multiple files and directories survive round-trip', async () => {
    await vfs.mkdir('src', { recursive: true });
    await vfs.writeText('src/index.js', 'export default 1;');
    await vfs.writeText('src/util.js', 'export const x = 2;');
    await vfs.writeText('README.md', '# Hello');
    const snap = await toSnapshot(vfs);
    const restored = await fromSnapshot(snap);

    assert.strictEqual(await restored.readText('src/index.js'), 'export default 1;');
    assert.strictEqual(await restored.readText('src/util.js'), 'export const x = 2;');
    assert.strictEqual(await restored.readText('README.md'), '# Hello');
  });

  // --- fromSnapshot into existing VFS ---

  it('fromSnapshot merges into an existing VFS instance', async () => {
    const target = new MemoryVfs();
    await target.writeText('existing.txt', 'keep me');

    await vfs.writeText('new.txt', 'added');
    const snap = await toSnapshot(vfs);
    const result = await fromSnapshot(snap, target);

    assert.strictEqual(result, target);
    assert.strictEqual(await target.readText('existing.txt'), 'keep me');
    assert.strictEqual(await target.readText('new.txt'), 'added');
  });

  // --- diffSnapshots ---

  describe('diffSnapshots', () => {
    it('detects added files', async () => {
      await vfs.writeText('a.txt', 'a');
      const snapA = await toSnapshot(vfs);

      await vfs.writeText('b.txt', 'b');
      const snapB = await toSnapshot(vfs);

      const diff = diffSnapshots(snapA, snapB);
      assert.deepStrictEqual(diff.added, ['b.txt']);
      assert.deepStrictEqual(diff.modified, []);
      assert.deepStrictEqual(diff.deleted, []);
    });

    it('detects modified files', async () => {
      await vfs.writeText('file.txt', 'v1');
      const snapA = await toSnapshot(vfs);

      await vfs.writeText('file.txt', 'v2');
      const snapB = await toSnapshot(vfs);

      const diff = diffSnapshots(snapA, snapB);
      assert.deepStrictEqual(diff.added, []);
      assert.deepStrictEqual(diff.modified, ['file.txt']);
      assert.deepStrictEqual(diff.deleted, []);
    });

    it('detects deleted files', async () => {
      await vfs.writeText('keep.txt', 'k');
      await vfs.writeText('gone.txt', 'g');
      const snapA = await toSnapshot(vfs);

      await vfs.unlink('gone.txt');
      const snapB = await toSnapshot(vfs);

      const diff = diffSnapshots(snapA, snapB);
      assert.deepStrictEqual(diff.added, []);
      assert.deepStrictEqual(diff.modified, []);
      assert.deepStrictEqual(diff.deleted, ['gone.txt']);
    });
  });
});