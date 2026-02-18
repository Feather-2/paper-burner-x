import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:util', async () => {
  const actual = await vi.importActual('node:util');
  return { ...actual };
});

import { TextDecoder as UtilTextDecoder, TextEncoder as UtilTextEncoder } from 'node:util';
import { VfsProxy, default as VfsProxyDefault } from '../../../../../js/agents/runtime/core/vfs-proxy.js';
import { VFS_OPS, VFS_REQUEST } from '../../../../../js/agents/runtime/core/vfs-proxy-protocol.js';

const encoder = new UtilTextEncoder();
const decoder = new UtilTextDecoder();

beforeEach(() => {
  if (typeof TextEncoder === 'undefined') {
    vi.stubGlobal('TextEncoder', UtilTextEncoder);
  }
  if (typeof TextDecoder === 'undefined') {
    vi.stubGlobal('TextDecoder', UtilTextDecoder);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function readSharedResponse(sharedBuffer) {
  const header = new Int32Array(sharedBuffer, 0, 4);
  const status = header[0];
  const len = header[1];
  const requiredBytes = header[2];
  const payloadLength = Math.max(0, Math.min(len, sharedBuffer.byteLength - 16));
  const payload = new Uint8Array(sharedBuffer, 16, payloadLength);
  const text = decoder.decode(payload.subarray(0, Math.max(0, len)));
  return { status, len, requiredBytes, payload, text };
}

function stubAtomicsWithResponses(responses) {
  vi.stubGlobal('Atomics', {
    store: (arr, index, value) => {
      arr[index] = value;
      return value;
    },
    load: (arr, index) => arr[index],
    notify: vi.fn(() => 0),
    wait: (arr) => {
      const response = responses.shift() || {};
      if (response.waitResult === 'timed-out') {
        return 'timed-out';
      }
      const shared = arr.buffer;
      const payload = new Uint8Array(shared, 16);
      let bytes = response.bytes;
      if (!bytes && typeof response.message === 'string') {
        bytes = encoder.encode(response.message);
      }
      if (bytes) {
        payload.set(bytes.subarray(0, payload.byteLength));
        arr[1] = bytes.length;
      } else if (typeof response.len === 'number') {
        arr[1] = response.len;
      } else {
        arr[1] = 0;
      }
      arr[2] = response.requiredBytes ?? 0;
      arr[0] = response.status ?? 1;
      return response.waitResult ?? 'ok';
    },
  });
}

describe('VfsProxy', () => {
  describe('constructor/setRunId', () => {
    it('sets defaults and allows overrides', () => {
      const proxy = new VfsProxy();
      expect(proxy.role).toBeUndefined();
      expect(proxy.postMessage).toBeUndefined();
      expect(proxy.getVfs).toBeUndefined();
      expect(proxy.timeoutMs).toBe(30000);
      expect(proxy.maxJsonBytes).toBe(256 * 1024);
      expect(proxy._runId).toBe(null);

      const postMessage = () => {};
      const getVfs = () => ({});
      const proxyCustom = new VfsProxy({
        role: 'client',
        postMessage,
        getVfs,
        timeoutMs: 0,
        maxJsonBytes: 0,
      });
      expect(proxyCustom.role).toBe('client');
      expect(proxyCustom.postMessage).toBe(postMessage);
      expect(proxyCustom.getVfs).toBe(getVfs);
      expect(proxyCustom.timeoutMs).toBe(0);
      expect(proxyCustom.maxJsonBytes).toBe(0);
    });

    it('normalizes runId inputs', () => {
      const proxy = new VfsProxy();
      proxy.setRunId(0);
      expect(proxy._runId).toBe(0);
      proxy.setRunId(-1);
      expect(proxy._runId).toBe(-1);
      proxy.setRunId(Number.MAX_SAFE_INTEGER);
      expect(proxy._runId).toBe(Number.MAX_SAFE_INTEGER);
      proxy.setRunId('42');
      expect(proxy._runId).toBe(42);
      proxy.setRunId(' ');
      expect(proxy._runId).toBe(0);
      proxy.setRunId(null);
      expect(proxy._runId).toBe(0);
      proxy.setRunId(undefined);
      expect(proxy._runId).toBe(null);
      proxy.setRunId('not-a-number');
      expect(proxy._runId).toBe(null);
    });
  });

  describe('handleServerMessage', () => {
    it('returns false for non-request or non-server messages', async () => {
      const clientProxy = new VfsProxy({ role: 'client' });
      await expect(clientProxy.handleServerMessage(null)).resolves.toBe(false);
      await expect(clientProxy.handleServerMessage({ type: 'other' })).resolves.toBe(false);
      await expect(
        clientProxy.handleServerMessage({
          type: 'vfs:request',
          buffer: new SharedArrayBuffer(32),
        })
      ).resolves.toBe(false);
    });

    it('returns false for non-shared buffers and reports protocol errors', async () => {
      const getVfs = vi.fn();
      const onProtocolError = vi.fn();
      const proxy = new VfsProxy({ role: 'server', getVfs, onProtocolError });
      const handled = await proxy.handleServerMessage({
        type: 'vfs:request',
        op: 'readFile',
        runId: 1,
        path: 'file.txt',
        buffer: new ArrayBuffer(32),
      });
      expect(handled).toBe(false);
      expect(getVfs).not.toHaveBeenCalled();
      expect(onProtocolError).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'ERR_VFS_PROTOCOL_BUFFER' })
      );
    });

    it('writes error when VFS is unavailable', async () => {
      const proxy = new VfsProxy({ role: 'server', getVfs: () => null });
      const shared = new SharedArrayBuffer(16 + 128);
      const handled = await proxy.handleServerMessage({
        type: 'vfs:request',
        op: 'readFile',
        runId: 99,
        path: 'missing.txt',
        buffer: shared,
      });
      expect(handled).toBe(true);
      const { status, text } = readSharedResponse(shared);
      expect(status).toBe(-1);
      expect(text).toContain('VFS unavailable');
    });

    it('rejects absolute paths by default for explicit semantics', async () => {
      const readFile = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
      const proxy = new VfsProxy({ role: 'server', getVfs: () => ({ readFile }) });
      const shared = new SharedArrayBuffer(16 + 128);
      await proxy.handleServerMessage({
        type: 'vfs:request',
        op: 'readFile',
        runId: 1,
        path: '/foo/bar',
        buffer: shared,
      });
      expect(readFile).not.toHaveBeenCalled();
      const { status, text } = readSharedResponse(shared);
      expect(status).toBe(-1);
      expect(text).toContain('Absolute VFS paths are not allowed');
    });

    it('handles readFile with strip mode for legacy absolute paths', async () => {
      const readFile = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
      const proxy = new VfsProxy({
        role: 'server',
        getVfs: () => ({ readFile }),
        absolutePathMode: 'strip',
      });
      const shared = new SharedArrayBuffer(16 + 8);
      await proxy.handleServerMessage({
        type: 'vfs:request',
        op: 'readFile',
        runId: 1,
        path: '/foo/bar',
        buffer: shared,
      });
      expect(readFile).toHaveBeenCalledWith('foo/bar');
      const { status, len, payload } = readSharedResponse(shared);
      expect(status).toBe(1);
      expect(len).toBe(3);
      expect(Array.from(payload)).toEqual([1, 2, 3]);
    });

    it('accepts protocol op names for read/list operations', async () => {
      const readFile = vi.fn().mockResolvedValue(encoder.encode('ok'));
      const readdir = vi.fn().mockResolvedValue([{ name: 'a.txt', isFile: () => true }]);
      const proxy = new VfsProxy({ role: 'server', getVfs: () => ({ readFile, readdir }) });
      const sharedRead = new SharedArrayBuffer(16 + 64);
      const sharedList = new SharedArrayBuffer(16 + 128);

      await proxy.handleServerMessage({
        type: VFS_REQUEST,
        op: VFS_OPS.READ,
        runId: 1,
        path: 'doc.txt',
        buffer: sharedRead,
      });
      await proxy.handleServerMessage({
        type: VFS_REQUEST,
        op: VFS_OPS.LIST,
        runId: 1,
        path: 'dir',
        buffer: sharedList,
      });

      expect(readFile).toHaveBeenCalledWith('doc.txt');
      expect(readdir).toHaveBeenCalledWith('dir', { withFileTypes: true });
      expect(readSharedResponse(sharedRead).status).toBe(1);
      expect(JSON.parse(readSharedResponse(sharedList).text)).toEqual({
        exists: true,
        entries: [{ name: 'a.txt', kind: 'file' }],
      });
    });

    it('handles readFile overflow with requiredBytes', async () => {
      const bigBytes = new Uint8Array(1024);
      bigBytes.fill(7);
      const readFile = vi.fn().mockResolvedValue(bigBytes);
      const proxy = new VfsProxy({ role: 'server', getVfs: () => ({ readFile }) });
      const shared = new SharedArrayBuffer(16 + 16);
      await proxy.handleServerMessage({
        type: 'vfs:request',
        op: 'readFile',
        runId: 1,
        path: 'large.bin',
        buffer: shared,
      });
      const { status, requiredBytes, text } = readSharedResponse(shared);
      expect(status).toBe(-1);
      expect(requiredBytes).toBe(bigBytes.byteLength);
      expect(text).toContain('EOVERFLOW');
    });

    it('handles stat success and missing paths', async () => {
      const stat = vi.fn().mockResolvedValue({
        size: 123,
        mtimeMs: 456,
        isFile: () => true,
        isDirectory: () => false,
      });
      const proxy = new VfsProxy({ role: 'server', getVfs: () => ({ stat }) });
      const shared = new SharedArrayBuffer(16 + 256);
      await proxy.handleServerMessage({
        type: 'vfs:request',
        op: 'stat',
        runId: 1,
        path: 'file.txt',
        buffer: shared,
      });
      const { status, text } = readSharedResponse(shared);
      expect(status).toBe(1);
      expect(JSON.parse(text)).toEqual({
        exists: true,
        size: 123,
        mtimeMs: 456,
        isFile: true,
        isDirectory: false,
      });

      const missing = new Error('ENOENT: not found');
      missing.code = 'ENOENT';
      const statMissing = vi.fn().mockRejectedValue(missing);
      const proxyMissing = new VfsProxy({ role: 'server', getVfs: () => ({ stat: statMissing }) });
      const sharedMissing = new SharedArrayBuffer(16 + 128);
      await proxyMissing.handleServerMessage({
        type: 'vfs:request',
        op: 'stat',
        runId: 1,
        path: 'missing.txt',
        buffer: sharedMissing,
      });
      const { status: missStatus, text: missText } = readSharedResponse(sharedMissing);
      expect(missStatus).toBe(1);
      expect(JSON.parse(missText)).toEqual({ exists: false });
    });

    it('handles readdir with entry normalization and missing paths', async () => {
      const entries = [
        'file.txt',
        { name: 'dir', isDirectory: () => true },
        { name: '', isFile: () => true },
        { name: 123, isFile: () => true },
        { name: 'unknown', isFile: () => false, isDirectory: () => false },
      ];
      const readdir = vi.fn().mockResolvedValue(entries);
      const proxy = new VfsProxy({ role: 'server', getVfs: () => ({ readdir }) });
      const shared = new SharedArrayBuffer(16 + 512);
      await proxy.handleServerMessage({
        type: 'vfs:request',
        op: 'readdir',
        runId: 1,
        path: 'root',
        buffer: shared,
      });
      const { status, text } = readSharedResponse(shared);
      expect(status).toBe(1);
      expect(JSON.parse(text)).toEqual({
        exists: true,
        entries: [
          { name: 'file.txt', kind: 'unknown' },
          { name: 'dir', kind: 'directory' },
          { name: '123', kind: 'file' },
          { name: 'unknown', kind: 'unknown' },
        ],
      });

      const missing = new Error('ENOENT missing');
      const readdirMissing = vi.fn().mockRejectedValue(missing);
      const proxyMissing = new VfsProxy({ role: 'server', getVfs: () => ({ readdir: readdirMissing }) });
      const sharedMissing = new SharedArrayBuffer(16 + 128);
      await proxyMissing.handleServerMessage({
        type: 'vfs:request',
        op: 'readdir',
        runId: 1,
        path: 'missing',
        buffer: sharedMissing,
      });
      const { status: missStatus, text: missText } = readSharedResponse(sharedMissing);
      expect(missStatus).toBe(1);
      expect(JSON.parse(missText)).toEqual({ exists: false, entries: [] });
    });

    it('writes errors for unsupported ops and thrown exceptions', async () => {
      const proxy = new VfsProxy({ role: 'server', getVfs: () => ({}) });
      const shared = new SharedArrayBuffer(16 + 128);
      await proxy.handleServerMessage({
        type: 'vfs:request',
        op: 'nope',
        runId: 1,
        path: 'file',
        buffer: shared,
      });
      const { status, text } = readSharedResponse(shared);
      expect(status).toBe(-1);
      expect(text).toContain('Unsupported VFS op');

      const readFile = vi.fn().mockRejectedValue(new Error('boom'));
      const proxyError = new VfsProxy({ role: 'server', getVfs: () => ({ readFile }) });
      const sharedError = new SharedArrayBuffer(16 + 128);
      await proxyError.handleServerMessage({
        type: 'vfs:request',
        op: 'readFile',
        runId: 1,
        path: null,
        buffer: sharedError,
      });
      const { status: errStatus, text: errText } = readSharedResponse(sharedError);
      expect(errStatus).toBe(-1);
      expect(errText).toContain('boom');
      expect(readFile).toHaveBeenCalledWith('');
    });

    it('handles concurrent server requests independently', async () => {
      const readFile = vi.fn(async (path) => encoder.encode(`data:${path}`));
      const proxy = new VfsProxy({ role: 'server', getVfs: () => ({ readFile }) });
      const sharedA = new SharedArrayBuffer(16 + 64);
      const sharedB = new SharedArrayBuffer(16 + 64);
      await Promise.all([
        proxy.handleServerMessage({
          type: 'vfs:request',
          op: 'readFile',
          runId: 1,
          path: 'a',
          buffer: sharedA,
        }),
        proxy.handleServerMessage({
          type: 'vfs:request',
          op: 'readFile',
          runId: 1,
          path: 'b',
          buffer: sharedB,
        }),
      ]);
      const payloadA = readSharedResponse(sharedA).text;
      const payloadB = readSharedResponse(sharedB).text;
      expect(payloadA).toBe('data:a');
      expect(payloadB).toBe('data:b');
    });
  });

  describe('_assertClientSyncSupport', () => {
    it('throws when role is not client', () => {
      const proxy = new VfsProxy({ role: 'server' });
      expect(() => proxy._assertClientSyncSupport()).toThrow(/role="client"/i);
    });

    it('throws when SharedArrayBuffer is unavailable', () => {
      const proxy = new VfsProxy({ role: 'client', postMessage: () => {} });
      vi.stubGlobal('SharedArrayBuffer', undefined);
      expect(() => proxy._assertClientSyncSupport()).toThrow(/SharedArrayBuffer/i);
    });

    it('throws when Atomics.wait is missing', () => {
      const proxy = new VfsProxy({ role: 'client', postMessage: () => {} });
      vi.stubGlobal('Atomics', {});
      expect(() => proxy._assertClientSyncSupport()).toThrow(/Atomics\.wait/i);
    });

    it('throws when postMessage is missing', () => {
      const proxy = new VfsProxy({ role: 'client' });
      expect(() => proxy._assertClientSyncSupport()).toThrow(/postMessage/i);
    });

    it('passes when required globals exist', () => {
      const proxy = new VfsProxy({ role: 'client', postMessage: () => {} });
      vi.stubGlobal('Atomics', { wait: () => 'ok' });
      expect(() => proxy._assertClientSyncSupport()).not.toThrow();
    });
  });

  describe('_requestBytesSync', () => {
    it('throws when runId is not set', () => {
      const proxy = new VfsProxy({ role: 'client', postMessage: () => {} });
      vi.stubGlobal('Atomics', { wait: () => 'ok' });
      expect(() => proxy._requestBytesSync('stat', '/x', { payloadBytes: 1 })).toThrow(/runId not set/i);
    });

    it('sends request and returns payload on success', () => {
      const responses = [{ status: 1, bytes: encoder.encode('ok') }];
      stubAtomicsWithResponses(responses);
      const postMessage = vi.fn();
      const proxy = new VfsProxy({ role: 'client', postMessage });
      proxy.setRunId(123);
      const result = proxy._requestBytesSync('stat', ' ', { payloadBytes: 4 });
      expect(decoder.decode(result)).toBe('ok');
      expect(postMessage).toHaveBeenCalledTimes(1);
      const msg = postMessage.mock.calls[0][0];
      expect(msg.type).toBe('vfs:request');
      expect(msg.op).toBe('stat');
      expect(msg.runId).toBe(123);
      expect(msg.path).toBe(' ');
    });

    it('uses default payload size for invalid payloadBytes', () => {
      const responses = [{ status: 1, bytes: encoder.encode('done') }];
      stubAtomicsWithResponses(responses);
      const postMessage = vi.fn();
      const proxy = new VfsProxy({ role: 'client', postMessage });
      proxy.setRunId(1);
      proxy._requestBytesSync('stat', '', { payloadBytes: -1 });
      const msg = postMessage.mock.calls[0][0];
      expect(msg.buffer.byteLength).toBe(16 + 1024);
    });

    it('throws timeout errors from Atomics.wait', () => {
      stubAtomicsWithResponses([{ waitResult: 'timed-out' }]);
      const proxy = new VfsProxy({ role: 'client', postMessage: () => {} });
      proxy.setRunId(1);
      expect(() => proxy._requestBytesSync('stat', '/x', { payloadBytes: 4 })).toThrow(/timed out/i);
    });

    it('throws EVFS when status is not success', () => {
      stubAtomicsWithResponses([{ status: 0, message: 'fail', requiredBytes: 0 }]);
      const proxy = new VfsProxy({ role: 'client', postMessage: () => {} });
      proxy.setRunId(1);
      try {
        proxy._requestBytesSync('stat', '/x', { payloadBytes: 4 });
        throw new Error('expected error');
      } catch (err) {
        expect(err.code).toBe('EVFS');
        expect(err.requiredBytes).toBeUndefined();
        expect(err.message).toContain('fail');
      }
    });

    it('throws EOVERFLOW with requiredBytes', () => {
      stubAtomicsWithResponses([{ status: -1, message: 'overflow', requiredBytes: 2048 }]);
      const proxy = new VfsProxy({ role: 'client', postMessage: () => {} });
      proxy.setRunId(1);
      try {
        proxy._requestBytesSync('readFile', '/big', { payloadBytes: 4 });
        throw new Error('expected error');
      } catch (err) {
        expect(err.code).toBe('EOVERFLOW');
        expect(err.requiredBytes).toBe(2048);
      }
    });

    it('handles rapid consecutive calls with queued responses', () => {
      const responses = [
        { status: 1, bytes: encoder.encode('first') },
        { status: 1, bytes: encoder.encode('second') },
      ];
      stubAtomicsWithResponses(responses);
      const proxy = new VfsProxy({ role: 'client', postMessage: () => {} });
      proxy.setRunId(1);
      const first = decoder.decode(proxy._requestBytesSync('stat', '/a', { payloadBytes: 8 }));
      const second = decoder.decode(proxy._requestBytesSync('stat', '/b', { payloadBytes: 8 }));
      expect(first).toBe('first');
      expect(second).toBe('second');
    });

    it('reuses SharedArrayBuffer across sync calls when capacity is sufficient', () => {
      const responses = [
        { status: 1, bytes: encoder.encode('one') },
        { status: 1, bytes: encoder.encode('two') },
      ];
      stubAtomicsWithResponses(responses);
      const postMessage = vi.fn();
      const proxy = new VfsProxy({ role: 'client', postMessage });
      proxy.setRunId(1);

      proxy._requestBytesSync(VFS_OPS.STAT, '/a', { payloadBytes: 16 });
      proxy._requestBytesSync(VFS_OPS.STAT, '/b', { payloadBytes: 8 });

      expect(postMessage).toHaveBeenCalledTimes(2);
      const firstBuffer = postMessage.mock.calls[0][0].buffer;
      const secondBuffer = postMessage.mock.calls[1][0].buffer;
      expect(firstBuffer).toBe(secondBuffer);
    });
  });

  describe('statSync', () => {
    it('returns validated payload with deep nesting', () => {
      const proxy = new VfsProxy({ role: 'client', postMessage: () => {} });
      const payload = {
        exists: true,
        size: 0,
        mtimeMs: 1,
        isFile: false,
        isDirectory: true,
        meta: { a: { b: { c: 1 } } },
      };
      const spy = vi
        .spyOn(proxy, '_requestBytesSync')
        .mockReturnValue(encoder.encode(JSON.stringify(payload)));
      const result = proxy.statSync('');
      expect(result).toEqual(payload);
      expect(spy).toHaveBeenCalledWith('stat', '', { payloadBytes: proxy.maxJsonBytes });
    });

    it('throws for invalid JSON responses', () => {
      const proxy = new VfsProxy({ role: 'client', postMessage: () => {} });
      vi.spyOn(proxy, '_requestBytesSync').mockReturnValue(encoder.encode('{bad json'));
      expect(() => proxy.statSync('/file')).toThrow(/invalid JSON/i);
    });

    it('throws for invalid payload shapes', () => {
      const proxy = new VfsProxy({ role: 'client', postMessage: () => {} });
      vi.spyOn(proxy, '_requestBytesSync').mockReturnValue(
        encoder.encode(JSON.stringify({ exists: 'yes', size: '10' }))
      );
      expect(() => proxy.statSync('/file')).toThrow(/invalid payload/i);
    });

    it('throws for empty payload objects', () => {
      const proxy = new VfsProxy({ role: 'client', postMessage: () => {} });
      vi.spyOn(proxy, '_requestBytesSync').mockReturnValue(encoder.encode(JSON.stringify({})));
      expect(() => proxy.statSync('/file')).toThrow(/invalid payload/i);
    });
  });

  describe('readdirSync', () => {
    it('returns validated payload including long entry names', () => {
      const proxy = new VfsProxy({ role: 'client', postMessage: () => {} });
      const longName = 'a'.repeat(10000);
      const payload = { exists: true, entries: [{ name: longName, kind: 'file' }] };
      vi.spyOn(proxy, '_requestBytesSync').mockReturnValue(encoder.encode(JSON.stringify(payload)));
      const result = proxy.readdirSync('   ');
      expect(result).toEqual(payload);
    });

    it('throws for invalid JSON responses', () => {
      const proxy = new VfsProxy({ role: 'client', postMessage: () => {} });
      vi.spyOn(proxy, '_requestBytesSync').mockReturnValue(encoder.encode('not json'));
      expect(() => proxy.readdirSync('/dir')).toThrow(/invalid JSON/i);
    });

    it('throws for invalid payload entries', () => {
      const proxy = new VfsProxy({ role: 'client', postMessage: () => {} });
      vi.spyOn(proxy, '_requestBytesSync').mockReturnValue(
        encoder.encode(JSON.stringify({ exists: true, entries: {} }))
      );
      expect(() => proxy.readdirSync('/dir')).toThrow(/invalid payload/i);
    });

    it('accepts empty entries arrays', () => {
      const proxy = new VfsProxy({ role: 'client', postMessage: () => {} });
      const payload = { exists: false, entries: [] };
      vi.spyOn(proxy, '_requestBytesSync').mockReturnValue(encoder.encode(JSON.stringify(payload)));
      expect(proxy.readdirSync('/dir')).toEqual(payload);
    });
  });

  describe('readFileSync', () => {
    it('honors sizeHint and enforces minimum buffer', () => {
      const proxy = new VfsProxy({ role: 'client', postMessage: () => {} });
      const spy = vi.spyOn(proxy, '_requestBytesSync').mockReturnValue(new Uint8Array([1]));
      const result = proxy.readFileSync('/file', { sizeHint: 0 });
      expect(Array.from(result)).toEqual([1]);
      expect(spy).toHaveBeenCalledWith(VFS_OPS.READ, '/file', { payloadBytes: 64 });
    });

    it('defaults sizeHint when provided a string', () => {
      const proxy = new VfsProxy({ role: 'client', postMessage: () => {} });
      const spy = vi.spyOn(proxy, '_requestBytesSync').mockReturnValue(new Uint8Array([2]));
      proxy.readFileSync('/file', { sizeHint: '1024' });
      expect(spy).toHaveBeenCalledWith(VFS_OPS.READ, '/file', { payloadBytes: 4 * 1024 * 1024 });
    });

    it('retries on EOVERFLOW and succeeds with larger buffer', () => {
      const proxy = new VfsProxy({ role: 'client', postMessage: () => {} });
      const overflow = new Error('overflow');
      overflow.code = 'EOVERFLOW';
      overflow.requiredBytes = 128 * 1024;
      const largeBytes = new Uint8Array(overflow.requiredBytes);
      largeBytes.fill(5);
      const spy = vi
        .spyOn(proxy, '_requestBytesSync')
        .mockImplementationOnce(() => {
          throw overflow;
        })
        .mockReturnValueOnce(largeBytes);
      const result = proxy.readFileSync('/large.bin', { sizeHint: 64 });
      expect(result.byteLength).toBe(overflow.requiredBytes);
      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy.mock.calls[0][2]).toEqual({ payloadBytes: 64 });
      expect(spy.mock.calls[1][2]).toEqual({ payloadBytes: overflow.requiredBytes });
    });

    it('throws after too many overflow attempts', () => {
      const proxy = new VfsProxy({ role: 'client', postMessage: () => {} });
      const makeOverflow = (bytes) => {
        const err = new Error('overflow');
        err.code = 'EOVERFLOW';
        err.requiredBytes = bytes;
        return err;
      };
      const spy = vi
        .spyOn(proxy, '_requestBytesSync')
        .mockImplementationOnce(() => {
          throw makeOverflow(128);
        })
        .mockImplementationOnce(() => {
          throw makeOverflow(256);
        })
        .mockImplementationOnce(() => {
          throw makeOverflow(512);
        });
      expect(() => proxy.readFileSync('/loop.bin', { sizeHint: 64 })).toThrow(/too many attempts/i);
      expect(spy).toHaveBeenCalledTimes(3);
    });

    it('propagates non-overflow errors', () => {
      const proxy = new VfsProxy({ role: 'client', postMessage: () => {} });
      const failure = new Error('EVFS error');
      failure.code = 'EVFS';
      vi.spyOn(proxy, '_requestBytesSync').mockImplementation(() => {
        throw failure;
      });
      expect(() => proxy.readFileSync('/file')).toThrow(/EVFS error/);
    });

    it('handles rapid successive calls independently', () => {
      const proxy = new VfsProxy({ role: 'client', postMessage: () => {} });
      const spy = vi
        .spyOn(proxy, '_requestBytesSync')
        .mockReturnValueOnce(new Uint8Array([1]))
        .mockReturnValueOnce(new Uint8Array([2]));
      const first = proxy.readFileSync('/a');
      const second = proxy.readFileSync('/b');
      expect(Array.from(first)).toEqual([1]);
      expect(Array.from(second)).toEqual([2]);
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });
});

describe('default export', () => {
  it('matches the VfsProxy named export', () => {
    expect(VfsProxyDefault).toBe(VfsProxy);
  });
});
