import { describe, it, expect, vi, beforeEach } from 'vitest';
import { gzipSync } from 'node:zlib';
import {
  TarballManager,
  TarballIntegrityError,
  parseTarHeaders,
} from '../../../../../../js/agents/core/node-compat/npm/tarball.js';

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

  it('download verifies dist.shasum when expectedShasum is provided', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    fetchFn.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(toArrayBuffer(bytes)),
    });
    const manager = new TarballManager({ fetchFn });

    await expect(manager.download('https://registry.npmjs.org/react.tgz', {
      expectedShasum: '7037807198c22a7d2b0807371d763779a84fdfcf',
    })).resolves.toBeInstanceOf(ArrayBuffer);
  });

  it('download throws TarballIntegrityError and reports audit details on shasum mismatch', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    fetchFn.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(toArrayBuffer(bytes)),
    });
    const onIntegrityFailure = vi.fn();
    const manager = new TarballManager({ fetchFn, onIntegrityFailure });

    await expect(manager.download('https://registry.npmjs.org/react.tgz', {
      expectedShasum: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      auditContext: { packageName: 'react', packageVersion: '1.0.0' },
    })).rejects.toBeInstanceOf(TarballIntegrityError);

    expect(onIntegrityFailure).toHaveBeenCalledWith({
      url: 'https://registry.npmjs.org/react.tgz',
      expectedShasum: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      actualShasum: '7037807198c22a7d2b0807371d763779a84fdfcf',
      packageName: 'react',
      packageVersion: '1.0.0',
    });
  });

  it('download throws ERR_TARBALL_SHASUM_INVALID for malformed expected shasum', async () => {
    fetchFn.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    });
    const manager = new TarballManager({ fetchFn });

    await expect(manager.download('https://registry.npmjs.org/react.tgz', {
      expectedShasum: 'not-a-shasum',
    })).rejects.toMatchObject({ code: 'ERR_TARBALL_SHASUM_INVALID' });
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

  it('extract skips unsupported tar entry types (e.g. symlink)', async () => {
    const tar = createTar([
      { name: 'package/symlink', type: '2', content: 'target' },
      { name: 'package/lib/a.js', content: 'ok' },
    ]);
    const vfs = {
      mkdir: vi.fn().mockResolvedValue(true),
      writeFile: vi.fn().mockResolvedValue(true),
    };
    const manager = new TarballManager({ fetchFn });

    const written = await manager.extract(toArrayBuffer(tar), vfs, '/node_modules/demo');
    expect(written).toBe(1);
    expect(vfs.writeFile).toHaveBeenCalledWith('/node_modules/demo/lib/a.js', expect.any(Uint8Array));
    expect(vfs.writeFile).not.toHaveBeenCalledWith('/node_modules/demo/symlink', expect.anything());
  });

  it('extract rejects traversal paths instead of sanitizing them', async () => {
    const tar = createTar([
      { name: 'package/../escape.js', content: 'oops' },
      { name: 'package/safe.js', content: 'ok' },
    ]);
    const vfs = {
      mkdir: vi.fn().mockResolvedValue(true),
      writeFile: vi.fn().mockResolvedValue(true),
    };
    const manager = new TarballManager({ fetchFn });

    const written = await manager.extract(toArrayBuffer(tar), vfs, '/node_modules/demo');
    expect(written).toBe(1);
    expect(vfs.writeFile).toHaveBeenCalledWith('/node_modules/demo/safe.js', expect.any(Uint8Array));
    expect(vfs.writeFile).not.toHaveBeenCalledWith('/node_modules/demo/escape.js', expect.anything());
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

  it('extract creates node_modules/.bin stub for string bin entry', async () => {
    const tar = createTar([
      {
        name: 'package/package.json',
        content: JSON.stringify({
          name: 'demo-cli',
          version: '1.0.0',
          bin: './bin/cli.js',
        }),
      },
      { name: 'package/bin/cli.js', content: 'console.log("cli");' },
    ]);
    const vfs = {
      mkdir: vi.fn().mockResolvedValue(true),
      writeFile: vi.fn().mockResolvedValue(true),
    };
    const manager = new TarballManager({ fetchFn });

    await manager.extract(toArrayBuffer(tar), vfs, '/node_modules/demo-cli');
    expect(vfs.writeFile).toHaveBeenCalledWith(
      '/node_modules/.bin/demo-cli',
      '#!/usr/bin/env node\nrequire(\'/node_modules/demo-cli/bin/cli.js\');\n',
    );
  });

  it('extract creates multiple stubs for object-style bin entries', async () => {
    const tar = createTar([
      {
        name: 'package/package.json',
        content: JSON.stringify({
          name: '@scope/toolkit',
          version: '1.0.0',
          bin: {
            toolkit: './bin/toolkit.js',
            tk: 'bin/tk.js',
          },
        }),
      },
      { name: 'package/bin/toolkit.js', content: 'console.log("toolkit");' },
      { name: 'package/bin/tk.js', content: 'console.log("tk");' },
    ]);
    const vfs = {
      mkdir: vi.fn().mockResolvedValue(true),
      writeFile: vi.fn().mockResolvedValue(true),
    };
    const manager = new TarballManager({ fetchFn });

    await manager.extract(toArrayBuffer(tar), vfs, '/node_modules/@scope/toolkit');
    expect(vfs.writeFile).toHaveBeenCalledWith(
      '/node_modules/.bin/toolkit',
      '#!/usr/bin/env node\nrequire(\'/node_modules/@scope/toolkit/bin/toolkit.js\');\n',
    );
    expect(vfs.writeFile).toHaveBeenCalledWith(
      '/node_modules/.bin/tk',
      '#!/usr/bin/env node\nrequire(\'/node_modules/@scope/toolkit/bin/tk.js\');\n',
    );
  });

  it('extract skips bin stub creation for invalid package.json', async () => {
    const tar = createTar([
      { name: 'package/package.json', content: '{invalid' },
      { name: 'package/index.js', content: 'module.exports = 1;' },
    ]);
    const vfs = {
      mkdir: vi.fn().mockResolvedValue(true),
      writeFile: vi.fn().mockResolvedValue(true),
    };
    const manager = new TarballManager({ fetchFn });

    await manager.extract(toArrayBuffer(tar), vfs, '/node_modules/invalid');
    expect(vfs.writeFile).not.toHaveBeenCalledWith(
      '/node_modules/.bin/invalid',
      expect.any(String),
    );
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

  it('extract does not attempt pako inflate when source is not gzip', async () => {
    const rawTar = createTar([{ name: 'package/fallback.js', content: 'ok' }]);
    const inflate = vi.fn(() => {
      throw new Error('bad gzip');
    });
    globalThis.pako = { inflate };
    const vfs = {
      mkdir: vi.fn().mockResolvedValue(true),
      writeFile: vi.fn().mockResolvedValue(true),
    };
    const manager = new TarballManager({ fetchFn });

    const written = await manager.extract(toArrayBuffer(rawTar), vfs, '/node_modules/fallback');
    expect(written).toBe(1);
    expect(inflate).not.toHaveBeenCalled();
    expect(vfs.writeFile).toHaveBeenCalledWith('/node_modules/fallback/fallback.js', expect.any(Uint8Array));
  });

  it('extract fails fast on invalid gzip payload', async () => {
    const invalidGzipBytes = new Uint8Array([31, 139, 8, 0, 1, 2, 3, 4]);
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

    await expect(manager.extract(toArrayBuffer(invalidGzipBytes), vfs, '/node_modules/bad-gzip'))
      .rejects
      .toMatchObject({ code: 'ERR_TARBALL_GZIP_INVALID' });
    expect(vfs.writeFile).not.toHaveBeenCalled();
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
