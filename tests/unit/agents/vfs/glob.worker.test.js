import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../js/agents/shared/index.js', () => ({
  isPlainObject: vi.fn(() => true),
}));

const WORKER_PATH = '../../../../js/agents/vfs/glob.worker.js';
const SHARED_PATH = '../../../../js/agents/shared/index.js';

/** @type {any} */
let workerSelf;
/** @type {import('vitest').Mock} */
let postMessage;
/** @type {import('vitest').Mock} */
let isPlainObject;

beforeEach(async () => {
  vi.resetModules();

  if (typeof globalThis.self === 'undefined') {
    globalThis.self = {};
  }

  workerSelf = globalThis.self;
  postMessage = vi.fn();
  workerSelf.postMessage = postMessage;
  workerSelf.onmessage = undefined;

  const shared = await import(SHARED_PATH);
  isPlainObject = shared.isPlainObject;
  isPlainObject.mockReturnValue(true);

  await import(WORKER_PATH);

  expect(typeof workerSelf.onmessage).toBe('function');
});

describe('self.onmessage (glob.worker.js)', () => {
  it('ignores events without a truthy id (no postMessage, no isPlainObject)', () => {
    workerSelf.onmessage(undefined);
    workerSelf.onmessage({ data: undefined });
    workerSelf.onmessage({ data: null });
    workerSelf.onmessage({ data: {} });
    workerSelf.onmessage({ data: { id: '' } });
    workerSelf.onmessage({ data: { id: 0 } });

    expect(postMessage).not.toHaveBeenCalled();
    expect(isPlainObject).not.toHaveBeenCalled();
  });

  it('responds ok with empty values (empty object/pattern/base/files)', () => {
    workerSelf.onmessage({ data: { id: 'empty', pattern: '   ', base: '   ', files: [] } });

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0][0]).toEqual({ id: 'empty', ok: true, matches: [] });
  });

  it('treats non-array `files` values as an empty list', () => {
    workerSelf.onmessage({
      data: {
        id: 'files-not-array',
        pattern: '*.js',
        files: { 0: 'a.js', length: 1 },
      },
    });

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0][0]).toEqual({ id: 'files-not-array', ok: true, matches: [] });
  });

  it('uses `isPlainObject` to guard options (non-plain data falls back to defaults)', () => {
    isPlainObject.mockReturnValueOnce(false);

    const data = Object.assign([], {
      id: -1,
      pattern: '*.js',
      base: 'src',
      files: ['a.js'],
    });

    workerSelf.onmessage({ data });

    expect(isPlainObject).toHaveBeenCalledTimes(1);
    expect(isPlainObject).toHaveBeenCalledWith(data);
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0][0]).toEqual({ id: -1, ok: true, matches: [] });
  });

  it('normalizes base path and matches against a relative path when possible', () => {
    workerSelf.onmessage({
      data: {
        id: 'base',
        pattern: 'index.js',
        base: ' .\\src\\ ',
        files: ['src/index.js', 'src/nested/index.js', 'lib/index.js', '/src/index.js', 'src/index.ts'],
      },
    });

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0][0]).toEqual({ id: 'base', ok: true, matches: ['src/index.js'] });
  });

  it('supports backslashes in patterns plus ?, brace expansion, and trimming', () => {
    workerSelf.onmessage({
      data: {
        id: 'pattern',
        pattern: ' dir\\file?.{ js , ts } ',
        files: ['dir/file1.js', 'dir/file2.ts', 'dir/fileA.js', 'dir/file12.js', 'dir/sub/file1.js'],
      },
    });

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0][0]).toEqual({
      id: 'pattern',
      ok: true,
      matches: ['dir/file1.js', 'dir/file2.ts', 'dir/fileA.js'],
    });
  });

  it('supports **/ globstar matching both root and nested paths', () => {
    workerSelf.onmessage({
      data: {
        id: 'globstar',
        pattern: '**/a.txt',
        files: ['a.txt', 'x/a.txt', 'x/y/a.txt', 'a.tx', 'x/a.txt/b'],
      },
    });

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0][0]).toEqual({
      id: 'globstar',
      ok: true,
      matches: ['a.txt', 'x/a.txt', 'x/y/a.txt'],
    });
  });

  it('handles type boundaries and skips empty/non-string file entries', () => {
    workerSelf.onmessage({
      data: {
        id: Number.MAX_SAFE_INTEGER,
        base: 0,
        pattern: 0,
        files: [0, '0', '00', '0/0', '', null, undefined, {}, []],
      },
    });

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0][0]).toEqual({
      id: Number.MAX_SAFE_INTEGER,
      ok: true,
      matches: ['0', '0/0'],
    });

    postMessage.mockClear();

    workerSelf.onmessage({
      data: {
        id: 'empty-file',
        pattern: '*',
        files: ['', 'a', 'b/c'],
      },
    });

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0][0]).toEqual({ id: 'empty-file', ok: true, matches: ['a'] });
  });

  it('handles rapid consecutive calls without leaking state between requests', () => {
    workerSelf.onmessage({ data: { id: '1', pattern: '*.js', files: ['a.js', 'a.ts', 'dir/a.js'] } });
    workerSelf.onmessage({
      data: { id: '2', pattern: '**/*.js', files: ['a.js', 'dir/a.js', 'dir/sub/a.js', 'a.ts'] },
    });
    workerSelf.onmessage({
      data: { id: '3', base: 'dir', pattern: '*.js', files: ['dir/a.js', 'dir/sub/a.js', 'a.js'] },
    });

    expect(postMessage).toHaveBeenCalledTimes(3);
    expect(postMessage.mock.calls.map((c) => c[0])).toEqual([
      { id: '1', ok: true, matches: ['a.js'] },
      { id: '2', ok: true, matches: ['a.js', 'dir/a.js', 'dir/sub/a.js'] },
      { id: '3', ok: true, matches: ['dir/a.js', 'a.js'] },
    ]);
  });

  it('handles large inputs: deep nesting, long strings, and big file lists', () => {
    const longSegment = 'a'.repeat(4096);
    const deepPath = Array.from({ length: 60 }, (_, i) => `d${i}`).join('/') + '/end.txt';
    const filler = Array.from({ length: 2500 }, (_, i) => `tmp/${i}.bin`);

    workerSelf.onmessage({
      data: {
        id: 'big',
        pattern: `**/{end,${longSegment}}.txt`,
        files: [...filler, deepPath, `${longSegment}.txt`, `${longSegment}.log`],
      },
    });

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0][0]).toEqual({
      id: 'big',
      ok: true,
      matches: [deepPath, `${longSegment}.txt`],
    });
  });

  it('posts an ok:false response when an exception happens during processing', () => {
    postMessage.mockImplementationOnce(() => {
      throw new Error('post failed');
    });

    workerSelf.onmessage({ data: { id: 'err', pattern: '*.js', files: ['a.js'] } });

    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(postMessage.mock.calls[0][0]).toEqual({ id: 'err', ok: true, matches: ['a.js'] });
    expect(postMessage.mock.calls[1][0]).toEqual({ id: 'err', ok: false, error: 'post failed' });
  });
});