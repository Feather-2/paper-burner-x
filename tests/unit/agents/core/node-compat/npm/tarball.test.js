import { describe, it, expect, vi, beforeEach } from 'vitest';
import { gzipSync } from 'node:zlib';
import {
  TarballManager,
  parseTarHeaders,
} from '../../../../../../js/agents/core/sandbox/npm/tarball.js';

const encoder = new TextEncoder();
const ORIGINAL_PAKO = globalThis.pako;
const ORIGINAL_DECOMPRESSION_STREAM = globalThis.DecompressionStream;

/**
 * @param {Uint8Array[]} parts
 * @returns {Uint8Array}
 */
function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const merged = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    merged.set(part, cursor);
    cursor += part.length;
  }
  return merged;
}

/**
 * @param {Uint8Array} header
 * @param {number} offset
 * @param {number} length
 * @param {string} value
 * @returns {void}
 */
function writeField(header, offset, length, value) {
  const bytes = encoder.encode(value);
  header.set(bytes.slice(0, length), offset);
}

/**
 * @param {Uint8Array} header
 * @param {number} offset
 * @param {number} length
 * @param {number} value
 * @returns {void}
 */
function writeOctal(header, offset, length, value) {
  const octal = value.toString(8).padStart(length - 1, '0') + '\0';
  writeField(header, offset, length, octal);
}

/**
 * @param {Array<{ name: string, content?: string|Uint8Array, type?: string, prefix?: string }>} entries
 * @returns {Uint8Array}
 */
function createTar(entries) {
  /** @type {Uint8Array[]} */
  const chunks = [];

  for (const entry of entries) {
    const type = entry.type || '0';
    const content = type === '5'
      ? new Uint8Array(0)
      : (entry.content instanceof Uint8Array ? entry.content : encoder.encode(entry.content || ''));
    const header = new Uint8Array(512);
    writeField(header, 0, 100, entry.name);
    if (entry.prefix) writeField(header, 345, 155, entry.prefix);
    writeOctal(header, 124, 12, content.length);
    header[156] = type.charCodeAt(0);
    chunks.push(header);

    if (type !== '5') {
      chunks.push(content);
      const pad = (512 - (content.length % 512)) % 512;
      if (pad > 0) chunks.push(new Uint8Array(pad));
    }
  }

  chunks.push(new Uint8Array(1024));
  return concatBytes(chunks);
}

/**
 * @param {Uint8Array} bytes
 * @returns {ArrayBuffer}
 */
function toArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

describe('npm/tarball', () => {
  let fetchFn;

  beforeEach(() => {
    fetchFn = vi.fn();
    globalThis.pako = ORIGINAL_PAKO;
    globalThis.DecompressionStream = ORIGINAL_DECOMPRESSION_STREAM;
  });

  it('constructor stores fetchFn and corsProxy', () => {
    const manager = new TarballManager({ fetchFn, corsProxy: 'https://proxy/?' });
    expect(manager.fetchFn).toBe(fetchFn);
    expect(manager.corsProxy).toBe('https://proxy/?');
  });

  it('download fetches tarball URL directly when no proxy', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    fetchFn.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(toArrayBuffer(bytes)),
    });
    const manager = new TarballManager({ fetchFn });

    const buffer = await manager.download('https://registry.npmjs.org/react.tgz');
    expect(fetchFn).toHaveBeenCalledWith('https://registry.npmjs.org/react.tgz');
    expect(new Uint8Array(buffer)).toEqual(bytes);
  });

  it('download prepends corsProxy and encodes target URL', async () => {
    fetchFn.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    });
    const manager = new TarballManager({ fetchFn, corsProxy: 'https://proxy.local/?url=' });

    await manager.download('https://registry.npmjs.org/@scope/pkg/-/pkg.tgz');
    expect(fetchFn).toHaveBeenCalledWith(
      'https://proxy.local/?url='
      + encodeURIComponent('https://registry.npmjs.org/@scope/pkg/-/pkg.tgz'),
    );
  });

  it('download throws when response is non-OK', async () => {
    fetchFn.mockResolvedValueOnce({ ok: false, status: 403 });
    const manager = new TarballManager({ fetchFn });
    await expect(manager.download('https://x.tgz')).rejects.toThrow('HTTP 403');
  });

  it('download propagates fetch errors', async () => {
    fetchFn.mockRejectedValueOnce(new Error('network down'));
    const manager = new TarballManager({ fetchFn });
    await expect(manager.download('https://x.tgz')).rejects.toThrow('network down');
  });

  it('parseTarHeaders parses a single file entry', () => {
    const tar = createTar([{ name: 'package/index.js', content: 'console.log(1);' }]);
    const headers = parseTarHeaders(tar);
    expect(headers).toHaveLength(1);
    expect(headers[0].name).toBe('index.js');
    expect(headers[0].size).toBe('console.log(1);'.length);
  });

  it('parseTarHeaders preserves directory entries with type flag', () => {
    const tar = createTar([{ name: 'package/lib/', type: '5' }]);
    const headers = parseTarHeaders(tar);
    expect(headers).toHaveLength(1);
    expect(headers[0].type).toBe('5');
    expect(headers[0].name).toBe('lib/');
  });

  it('parseTarHeaders handles multiple entries and offsets', () => {
    const tar = createTar([
      { name: 'package/a.txt', content: 'A' },
      { name: 'package/b.txt', content: 'BBBB' },
    ]);
    const headers = parseTarHeaders(tar);
    expect(headers).toHaveLength(2);
    expect(headers[0].offset).toBe(512);
    expect(headers[1].offset).toBeGreaterThan(headers[0].offset);
  });

  it('parseTarHeaders supports ustar prefix field', () => {
    const tar = createTar([
      { name: 'index.js', content: 'export{}', prefix: 'package/nested/path' },
    ]);
    const headers = parseTarHeaders(tar);
    expect(headers[0].name).toBe('nested/path/index.js');
  });

  it('parseTarHeaders skips null blocks', () => {
    const empty = new Uint8Array(1024);
    expect(parseTarHeaders(empty)).toEqual([]);
  });

  it('extract writes raw tar files to VFS', async () => {
    const tar = createTar([{ name: 'package/readme.md', content: '# Hello' }]);
    const vfs = {
      mkdir: vi.fn().mockResolvedValue(true),
      writeFile: vi.fn().mockResolvedValue(true),
    };
    const manager = new TarballManager({ fetchFn });

    const written = await manager.extract(toArrayBuffer(tar), vfs, '/node_modules/demo');
    expect(written).toBe(1);
    expect(vfs.writeFile).toHaveBeenCalledWith('/node_modules/demo/readme.md', expect.any(Uint8Array));
  });

  it('extract writes multiple files from tar', async () => {
    const tar = createTar([
      { name: 'package/a.js', content: 'a' },
      { name: 'package/b.js', content: 'b' },
    ]);
    const vfs = {
      mkdir: vi.fn().mockResolvedValue(true),
      writeFile: vi.fn().mockResolvedValue(true),
    };
    const manager = new TarballManager({ fetchFn });

    const written = await manager.extract(toArrayBuffer(tar), vfs, '/node_modules/demo');
    expect(written).toBe(2);
    expect(vfs.writeFile).toHaveBeenCalledTimes(2);
  });

  it('extract ignores directory entries', async () => {
    const tar = createTar([
      { name: 'package/lib/', type: '5' },
      { name: 'package/lib/a.js', content: 'ok' },
    ]);
    const vfs = {
      mkdir: vi.fn().mockResolvedValue(true),
      writeFile: vi.fn().mockResolvedValue(true),
    };
    const manager = new TarballManager({ fetchFn });

    const written = await manager.extract(toArrayBuffer(tar), vfs, '/node_modules/demo');
    expect(written).toBe(1);
    expect(vfs.writeFile).toHaveBeenCalledTimes(1);
  });

  it('extract creates parent directories when vfs.mkdir exists', async () => {
    const tar = createTar([{ name: 'package/lib/nested/a.js', content: 'ok' }]);
    const vfs = {
      mkdir: vi.fn().mockResolvedValue(true),
      writeFile: vi.fn().mockResolvedValue(true),
    };
    const manager = new TarballManager({ fetchFn });

    await manager.extract(toArrayBuffer(tar), vfs, '/node_modules/demo');
    expect(vfs.mkdir).toHaveBeenCalledWith('/node_modules/demo/lib/nested', { recursive: true });
  });

  it('extract uses pako.inflate when available', async () => {
    const rawTar = createTar([{ name: 'package/main.js', content: 'ok' }]);
    const inflate = vi.fn().mockReturnValue(rawTar);
    globalThis.pako = { inflate };
    const vfs = {
      mkdir: vi.fn().mockResolvedValue(true),
      writeFile: vi.fn().mockResolvedValue(true),
    };
    const manager = new TarballManager({ fetchFn });

    const written = await manager.extract(toArrayBuffer(new Uint8Array([31, 139, 8])), vfs, '/node_modules/pako');
    expect(inflate).toHaveBeenCalledTimes(1);
    expect(written).toBe(1);
  });

  it('extract falls back to raw tar when pako.inflate fails', async () => {
    const rawTar = createTar([{ name: 'package/fallback.js', content: 'ok' }]);
    globalThis.pako = {
      inflate: vi.fn(() => {
        throw new Error('bad gzip');
      }),
    };
    const vfs = {
      mkdir: vi.fn().mockResolvedValue(true),
      writeFile: vi.fn().mockResolvedValue(true),
    };
    const manager = new TarballManager({ fetchFn });

    const written = await manager.extract(toArrayBuffer(rawTar), vfs, '/node_modules/fallback');
    expect(written).toBe(1);
    expect(vfs.writeFile).toHaveBeenCalledWith('/node_modules/fallback/fallback.js', expect.any(Uint8Array));
  });

  it('extract can decompress gzip tarball via DecompressionStream when available', async () => {
    if (typeof DecompressionStream !== 'function') {
      expect(true).toBe(true);
      return;
    }
    globalThis.pako = undefined;
    const rawTar = createTar([{ name: 'package/gzip.js', content: 'ok' }]);
    const gzipTar = gzipSync(rawTar);
    const vfs = {
      mkdir: vi.fn().mockResolvedValue(true),
      writeFile: vi.fn().mockResolvedValue(true),
    };
    const manager = new TarballManager({ fetchFn });

    const written = await manager.extract(toArrayBuffer(gzipTar), vfs, '/node_modules/gzip');
    expect(written).toBe(1);
    expect(vfs.writeFile).toHaveBeenCalledWith('/node_modules/gzip/gzip.js', expect.any(Uint8Array));
  });

  it('instance parseTarHeaders delegates to exported parser', () => {
    const tar = createTar([{ name: 'package/a.js', content: 'x' }]);
    const manager = new TarballManager({ fetchFn });
    expect(manager.parseTarHeaders(tar)).toEqual(parseTarHeaders(tar));
  });
});
