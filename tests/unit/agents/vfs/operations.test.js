import { describe, it, expect, vi, beforeEach } from 'vitest';

const { recordVfsCheckpoint, cryptoRandomHex, isPlainObject } = vi.hoisted(() => ({
  recordVfsCheckpoint: vi.fn(async () => ({ artifactId: 'ckpt_1' })),
  cryptoRandomHex: vi.fn(() => 'abc123'),
  isPlainObject: vi.fn((value) => {
    if (!value || typeof value !== 'object') return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }),
}));

vi.mock('../../../../js/agents/vfs/checkpoints.js', () => ({ recordVfsCheckpoint }));
vi.mock('../../../../js/agents/shared/index.js', () => ({ cryptoRandomHex, isPlainObject }));
vi.mock('../../../../js/agents/vfs/path.js', async () => {
  const actual = await vi.importActual('../../../../js/agents/vfs/path.js');
  return { ...actual, normalizeVfsPath: vi.fn(actual.normalizeVfsPath) };
});

import * as operations from '../../../../js/agents/vfs/operations.js';

const {
  writeTextFileWithPolicy,
  multiEditTextFileWithPolicy,
  atomicWriteText,
  atomicWriteFile,
  atomicWrite,
} = operations;

beforeEach(() => {
  vi.clearAllMocks();
});

function createGate() {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  return { gate, release };
}

describe('writeTextFileWithPolicy', () => {
  it('writes, records checkpoint, and emits policy metadata', async () => {
    const vfs = {
      readText: vi.fn(async () => 'before'),
      writeText: vi.fn(async () => true),
    };
    const policy = {
      authorize: vi.fn(async () => ({ allowed: true, reason: 'ok', meta: { nested: { ok: true } } })),
    };
    const emit = vi.fn();

    const res = await writeTextFileWithPolicy({
      vfs,
      path: '/a/b.txt',
      text: 'after',
      policy,
      runStore: {},
      runId: 'run_1',
      stageApi: { emit },
    });

    expect(res).toEqual({
      ok: true,
      path: 'a/b.txt',
      checkpoint: { artifactId: 'ckpt_1', type: 'vfs_checkpoint.json' },
    });
    expect(vfs.writeText).toHaveBeenCalledWith('a/b.txt', 'after');
    expect(recordVfsCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run_1',
        path: 'a/b.txt',
        before: 'before',
        after: 'after',
        op: 'writeText',
      })
    );
    expect(emit).toHaveBeenCalledWith(
      'vfs:write:completed',
      expect.objectContaining({
        path: 'a/b.txt',
        bytes: 5,
        checkpoint: { artifactId: 'ckpt_1', type: 'vfs_checkpoint.json' },
        policy: { allowed: true, reason: 'ok', meta: { nested: { ok: true } } },
      })
    );
  });

  it('throws when vfs.writeText is missing', async () => {
    await expect(writeTextFileWithPolicy({ path: 'a.txt', text: 'x' })).rejects.toThrow(
      /vfs\.writeText is required/i
    );
  });

  it('throws on empty or whitespace path', async () => {
    const vfs = { writeText: vi.fn(async () => true) };

    await expect(writeTextFileWithPolicy({ vfs, path: '', text: 'x' })).rejects.toThrow(
      /path must be a non-empty VFS path/i
    );
    await expect(writeTextFileWithPolicy({ vfs, path: '   ', text: 'x' })).rejects.toThrow(
      /path must be a non-empty VFS path/i
    );
  });

  it('stringifies nullish/number text and accepts numeric path boundaries', async () => {
    const vfs = { writeText: vi.fn(async () => true) };

    await writeTextFileWithPolicy({ vfs, path: 0, text: null, checkpoint: false });
    await writeTextFileWithPolicy({ vfs, path: -1, text: undefined, checkpoint: false });
    await writeTextFileWithPolicy({ vfs, path: Number.MAX_SAFE_INTEGER, text: 0, checkpoint: false });

    expect(vfs.writeText).toHaveBeenNthCalledWith(1, '0', '');
    expect(vfs.writeText).toHaveBeenNthCalledWith(2, '-1', '');
    expect(vfs.writeText).toHaveBeenNthCalledWith(3, String(Number.MAX_SAFE_INTEGER), '0');
  });

  it('rejects when policy denies access', async () => {
    const vfs = {
      readText: vi.fn(async () => ''),
      writeText: vi.fn(async () => true),
    };
    const policy = { authorize: vi.fn(async () => ({ allowed: false, reason: 'no' })) };

    await expect(writeTextFileWithPolicy({ vfs, path: 'a.txt', text: 'x', policy })).rejects.toThrow(
      'Policy denied: no'
    );
    expect(vfs.writeText).not.toHaveBeenCalled();
  });

  it('omits policy metadata for non-plain authorize results', async () => {
    const vfs = {
      readText: vi.fn(async () => ''),
      writeText: vi.fn(async () => true),
    };
    const policy = { authorize: vi.fn(async () => []) };
    const emit = vi.fn();

    await writeTextFileWithPolicy({ vfs, path: 'a.txt', text: 'x', policy, stageApi: { emit }, checkpoint: false });

    const payload = emit.mock.calls[0][1];
    expect(payload.policy).toBeUndefined();
  });

  it('falls back to readFile for checkpoint.before and handles read failures', async () => {
    const vfs = {
      readFile: vi.fn(async () => new TextEncoder().encode('before')),
      writeText: vi.fn(async () => true),
    };

    await writeTextFileWithPolicy({ vfs, path: 'a.txt', text: 'after', runId: 'run_1', runStore: {}, checkpoint: true });

    expect(recordVfsCheckpoint).toHaveBeenCalledWith(expect.objectContaining({ before: 'before', after: 'after' }));

    const vfsFail = {
      readText: vi.fn(async () => {
        throw new Error('boom');
      }),
      writeText: vi.fn(async () => true),
    };

    await writeTextFileWithPolicy({ vfs: vfsFail, path: 'b.txt', text: 'after', runId: 'run_2', runStore: {}, checkpoint: true });

    expect(recordVfsCheckpoint).toHaveBeenCalledWith(expect.objectContaining({ before: '', after: 'after' }));
  });

  it('ignores checkpoint failures', async () => {
    recordVfsCheckpoint.mockRejectedValueOnce(new Error('checkpoint failed'));
    const vfs = {
      readText: vi.fn(async () => 'before'),
      writeText: vi.fn(async () => true),
    };
    const emit = vi.fn();

    const res = await writeTextFileWithPolicy({
      vfs,
      path: 'a.txt',
      text: 'x',
      runId: 'run_1',
      runStore: {},
      stageApi: { emit },
    });

    expect(res).toEqual({ ok: true, path: 'a.txt' });
    expect(emit).toHaveBeenCalledWith('vfs:write:completed', expect.objectContaining({ path: 'a.txt', bytes: 1 }));
  });

  it('serializes concurrent writes per path', async () => {
    const { gate, release } = createGate();
    let started;
    const startedPromise = new Promise((resolve) => {
      started = resolve;
    });
    let callCount = 0;

    const vfs = {
      readText: vi.fn(async () => ''),
      writeText: vi.fn(async () => {
        callCount += 1;
        if (callCount === 1) {
          started();
          await gate;
        }
        return true;
      }),
    };

    const p1 = writeTextFileWithPolicy({ vfs, path: 'a.txt', text: 'one', checkpoint: false });
    await startedPromise;

    const p2 = writeTextFileWithPolicy({ vfs, path: 'a.txt', text: 'two', checkpoint: false });
    await Promise.resolve();

    expect(vfs.writeText).toHaveBeenCalledTimes(1);

    release();
    await expect(p1).resolves.toEqual({ ok: true, path: 'a.txt' });
    await expect(p2).resolves.toEqual({ ok: true, path: 'a.txt' });

    expect(vfs.writeText).toHaveBeenCalledTimes(2);
    expect(vfs.writeText.mock.calls[0][1]).toBe('one');
    expect(vfs.writeText.mock.calls[1][1]).toBe('two');
  });

  it('aborts while waiting on a lock', async () => {
    const { gate, release } = createGate();
    const vfs = {
      readText: vi.fn(async () => ''),
      writeText: vi.fn(async () => {
        await gate;
        return true;
      }),
    };

    const p1 = writeTextFileWithPolicy({ vfs, path: 'a.txt', text: 'one', checkpoint: false });

    const ac = new AbortController();
    const p2 = writeTextFileWithPolicy({ vfs, path: 'a.txt', text: 'two', checkpoint: false, signal: ac.signal });
    ac.abort('stop');

    await expect(p2).rejects.toThrow('stop');

    release();
    await expect(p1).resolves.toEqual({ ok: true, path: 'a.txt' });
  });

  it('handles very long strings', async () => {
    const vfs = { writeText: vi.fn(async () => true) };
    const longText = 'x'.repeat(100000);

    await writeTextFileWithPolicy({ vfs, path: 'long.txt', text: longText, checkpoint: false });

    expect(vfs.writeText).toHaveBeenCalledWith('long.txt', longText);
  });
});

describe('multiEditTextFileWithPolicy', () => {
  it('applies edits, records checkpoint, and emits via eventBus', async () => {
    const vfs = {
      readText: vi.fn(async () => 'hello world'),
      writeText: vi.fn(async () => true),
    };
    const policy = { authorize: vi.fn(async () => ({ allowed: true })) };
    const emit = vi.fn();

    const res = await multiEditTextFileWithPolicy({
      vfs,
      path: '/a/b.txt',
      edits: [
        { old_string: 'hello', new_string: 'hi' },
        { oldString: 'world', newString: 'earth' },
      ],
      policy,
      runStore: {},
      runId: 'run_1',
      stageApi: { eventBus: { emit } },
    });

    expect(res).toEqual({
      ok: true,
      path: 'a/b.txt',
      checkpoint: { artifactId: 'ckpt_1', type: 'vfs_checkpoint.json' },
    });
    expect(vfs.writeText).toHaveBeenCalledWith('a/b.txt', 'hi earth');
    expect(recordVfsCheckpoint).toHaveBeenCalledWith(expect.objectContaining({ op: 'multi_edit' }));
    expect(emit).toHaveBeenCalledWith(
      'vfs:write:completed',
      expect.objectContaining({ path: 'a/b.txt', bytes: 'hi earth'.length, policy: { allowed: true } })
    );
  });

  it('rejects when edits is an empty array or non-array object', async () => {
    const vfs = { readText: vi.fn(async () => 'x'), writeText: vi.fn(async () => true) };

    await expect(multiEditTextFileWithPolicy({ vfs, path: 'a.txt', edits: [] })).rejects.toThrow(
      /edits must be a non-empty array/i
    );
    await expect(multiEditTextFileWithPolicy({ vfs, path: 'a.txt', edits: {} })).rejects.toThrow(
      /edits must be a non-empty array/i
    );
  });

  it('errors when file is missing', async () => {
    const vfs = {
      readText: vi.fn(async () => {
        throw new Error('not found');
      }),
      writeText: vi.fn(async () => true),
    };

    await expect(multiEditTextFileWithPolicy({ vfs, path: 'a.txt', edits: [{ old_string: 'x', new_string: 'y' }] })).rejects.toThrow(
      /file not found/i
    );
  });

  it('validates edit operations (empty old_string / no-op)', async () => {
    const vfs = { readText: vi.fn(async () => 'abc'), writeText: vi.fn(async () => true) };

    await expect(multiEditTextFileWithPolicy({ vfs, path: 'a.txt', edits: [{ old_string: '', new_string: 'x' }] })).rejects.toThrow(
      /old_string must be a non-empty string/i
    );
    await expect(multiEditTextFileWithPolicy({ vfs, path: 'a.txt', edits: [{ old_string: 'a', new_string: 'a' }] })).rejects.toThrow(
      /old_string equals new_string/i
    );
  });

  it('rejects duplicate old_string values', async () => {
    const vfs = { readText: vi.fn(async () => 'abc'), writeText: vi.fn(async () => true) };

    await expect(
      multiEditTextFileWithPolicy({
        vfs,
        path: 'a.txt',
        edits: [
          { old_string: 'a', new_string: 'b' },
          { old_string: 'a', new_string: 'c' },
        ],
      })
    ).rejects.toThrow(/duplicate old_string/i);
  });

  it('rejects when old_string is missing or ambiguous', async () => {
    const vfs = { readText: vi.fn(async () => 'repeat repeat'), writeText: vi.fn(async () => true) };

    await expect(multiEditTextFileWithPolicy({ vfs, path: 'a.txt', edits: [{ old_string: 'absent', new_string: 'x' }] })).rejects.toThrow(
      /old_string not found/i
    );
    await expect(multiEditTextFileWithPolicy({ vfs, path: 'a.txt', edits: [{ old_string: 'repeat', new_string: 'x' }] })).rejects.toThrow(
      /found 2 times/i
    );
  });

  it('uses whitespace-normalized block matching when exact match fails', async () => {
    const vfs = {
      readText: vi.fn(async () => 'function test() {\n  const x = 1;\n  const y = 2;\n}'),
      writeText: vi.fn(async () => true),
    };

    const res = await multiEditTextFileWithPolicy({
      vfs,
      path: 'a.txt',
      edits: [
        {
          old_string: '\n    const x = 1;\n    const y = 2;\n',
          new_string: '  const x = 10;\n  const y = 20;',
        },
      ],
      checkpoint: false,
    });

    expect(res).toEqual({ ok: true, path: 'a.txt' });
    expect(vfs.writeText).toHaveBeenCalledWith(
      'a.txt',
      'function test() {\n  const x = 10;\n  const y = 20;}'
    );
  });

  it('detects overlapping edit ranges', async () => {
    const vfs = { readText: vi.fn(async () => 'abc'), writeText: vi.fn(async () => true) };

    await expect(
      multiEditTextFileWithPolicy({
        vfs,
        path: 'a.txt',
        edits: [
          { old_string: 'ab', new_string: 'AB' },
          { old_string: 'bc', new_string: 'BC' },
        ],
      })
    ).rejects.toThrow(/overlap/i);
  });

  it('detects conflicts when new_string contains another old_string', async () => {
    const vfs = { readText: vi.fn(async () => 'foo bar'), writeText: vi.fn(async () => true) };

    await expect(
      multiEditTextFileWithPolicy({
        vfs,
        path: 'a.txt',
        edits: [
          { old_string: 'foo', new_string: 'foo bar' },
          { old_string: 'bar', new_string: 'baz' },
        ],
      })
    ).rejects.toThrow(/contains Edit/i);
  });

  it('rolls back when writeText fails', async () => {
    const vfs = {
      readText: vi.fn(async () => 'hello world'),
      writeText: vi.fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce(true),
    };

    await expect(
      multiEditTextFileWithPolicy({
        vfs,
        path: 'a.txt',
        edits: [{ old_string: 'hello', new_string: 'hi' }],
      })
    ).rejects.toThrow('boom');

    expect(vfs.writeText).toHaveBeenCalledTimes(2);
    expect(vfs.writeText.mock.calls[0][1]).toBe('hi world');
    expect(vfs.writeText.mock.calls[1][1]).toBe('hello world');
  });

  it('rejects when policy denies access', async () => {
    const vfs = {
      readText: vi.fn(async () => 'hello world'),
      writeText: vi.fn(async () => true),
    };
    const policy = { authorize: vi.fn(async () => ({ allowed: false, reason: 'nope' })) };

    await expect(
      multiEditTextFileWithPolicy({ vfs, path: 'a.txt', edits: [{ old_string: 'hello', new_string: 'hi' }], policy })
    ).rejects.toThrow('Policy denied: nope');
    expect(vfs.writeText).not.toHaveBeenCalled();
  });

  it('serializes concurrent edits per path', async () => {
    const { gate, release } = createGate();
    let started;
    const startedPromise = new Promise((resolve) => {
      started = resolve;
    });
    let callCount = 0;

    const vfs = {
      readText: vi.fn(async () => 'hello world'),
      writeText: vi.fn(async () => {
        callCount += 1;
        if (callCount === 1) {
          started();
          await gate;
        }
        return true;
      }),
    };

    const p1 = multiEditTextFileWithPolicy({
      vfs,
      path: 'a.txt',
      edits: [{ old_string: 'hello', new_string: 'hi' }],
      checkpoint: false,
    });
    await startedPromise;

    const p2 = multiEditTextFileWithPolicy({
      vfs,
      path: 'a.txt',
      edits: [{ old_string: 'world', new_string: 'earth' }],
      checkpoint: false,
    });

    await Promise.resolve();
    expect(vfs.writeText).toHaveBeenCalledTimes(1);

    release();
    await expect(p1).resolves.toEqual({ ok: true, path: 'a.txt' });
    await expect(p2).resolves.toEqual({ ok: true, path: 'a.txt' });
  });

  it('aborts while waiting on a lock', async () => {
    const { gate, release } = createGate();
    const vfs = {
      readText: vi.fn(async () => 'hello world'),
      writeText: vi.fn(async () => {
        await gate;
        return true;
      }),
    };

    const p1 = multiEditTextFileWithPolicy({
      vfs,
      path: 'a.txt',
      edits: [{ old_string: 'hello', new_string: 'hi' }],
      checkpoint: false,
    });

    const ac = new AbortController();
    const p2 = multiEditTextFileWithPolicy({
      vfs,
      path: 'a.txt',
      edits: [{ old_string: 'world', new_string: 'earth' }],
      checkpoint: false,
      signal: ac.signal,
    });
    ac.abort('stop');

    await expect(p2).rejects.toThrow('stop');

    release();
    await expect(p1).resolves.toEqual({ ok: true, path: 'a.txt' });
  });
});

describe('atomicWriteText', () => {
  it('writes via temp file and rename with deep nested paths', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1);
    const vfs = {
      writeText: vi.fn(async () => true),
      readText: vi.fn(async () => 'content'),
      rename: vi.fn(async () => true),
    };

    const res = await atomicWriteText(vfs, 'a/b/c/d/e/f/g/h/i/j.txt', 'content');

    expect(res).toEqual({ ok: true, path: 'a/b/c/d/e/f/g/h/i/j.txt' });
    expect(vfs.writeText).toHaveBeenCalledWith('a/b/c/d/e/f/g/h/i/j.txt.tmp_1_abc123', 'content');
    expect(vfs.rename).toHaveBeenCalledWith('a/b/c/d/e/f/g/h/i/j.txt.tmp_1_abc123', 'a/b/c/d/e/f/g/h/i/j.txt');

    nowSpy.mockRestore();
  });

  it('returns ok:false and cleans temp file on verification failure', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1);
    const vfs = {
      writeText: vi.fn(async () => true),
      readText: vi.fn(async () => 'wrong'),
      rename: vi.fn(async () => true),
      delete: vi.fn(async () => true),
    };

    const res = await atomicWriteText(vfs, 'a.txt', 'expected');

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/verification failed/i);
    expect(vfs.delete).toHaveBeenCalledWith('a.txt.tmp_1_abc123');

    nowSpy.mockRestore();
  });

  it('falls back when rename is missing and removes temp file', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1);
    const vfs = {
      writeText: vi.fn(async () => true),
      readText: vi.fn(async () => 'content'),
      exists: vi.fn(async () => true),
      delete: vi.fn(async () => true),
    };

    const res = await atomicWriteText(vfs, 'a.txt', 'content');

    expect(res).toEqual({ ok: true, path: 'a.txt' });
    expect(vfs.writeText).toHaveBeenCalledTimes(2);
    expect(vfs.delete).toHaveBeenCalledWith('a.txt');
    expect(vfs.delete).toHaveBeenCalledWith('a.txt.tmp_1_abc123');

    nowSpy.mockRestore();
  });

  it('aborts after temp write and cleans up', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1);
    const ac = new AbortController();
    const vfs = {
      writeText: vi.fn(async (p) => {
        if (p.includes('.tmp_1_abc123')) ac.abort('stop');
        return true;
      }),
      readText: vi.fn(async () => 'content'),
      rename: vi.fn(async () => true),
      delete: vi.fn(async () => true),
    };

    const res = await atomicWriteText(vfs, 'a.txt', 'content', { signal: ac.signal });

    expect(res.ok).toBe(false);
    expect(res.error).toBe('stop');
    expect(vfs.readText).not.toHaveBeenCalled();
    expect(vfs.delete).toHaveBeenCalledWith('a.txt.tmp_1_abc123');

    nowSpy.mockRestore();
  });
});

describe('atomicWriteFile', () => {
  it('writes large data via temp file and rename', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1);
    const bytes = new Uint8Array(100000);
    bytes.fill(7);

    const vfs = {
      writeFile: vi.fn(async () => true),
      readFile: vi.fn(async () => new Uint8Array(bytes)),
      rename: vi.fn(async () => true),
    };

    const res = await atomicWriteFile(vfs, 'a.bin', bytes);

    expect(res).toEqual({ ok: true, path: 'a.bin' });
    expect(vfs.writeFile).toHaveBeenCalledWith('a.bin.tmp_1_abc123', bytes);
    expect(vfs.rename).toHaveBeenCalledWith('a.bin.tmp_1_abc123', 'a.bin');

    nowSpy.mockRestore();
  });

  it('returns ok:false when verification fails and removes temp file', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1);
    const bytes = new Uint8Array([1, 2, 3]);

    const vfs = {
      writeFile: vi.fn(async () => true),
      readFile: vi.fn(async () => new Uint8Array([1, 2])),
      rename: vi.fn(async () => true),
      delete: vi.fn(async () => true),
    };

    const res = await atomicWriteFile(vfs, 'a.bin', bytes);

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/size mismatch/i);
    expect(vfs.delete).toHaveBeenCalledWith('a.bin.tmp_1_abc123');

    nowSpy.mockRestore();
  });

  it('falls back when rename is missing and removes temp file', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1);
    const bytes = new Uint8Array([1, 2, 3]);

    const vfs = {
      writeFile: vi.fn(async () => true),
      readFile: vi.fn(async () => new Uint8Array(bytes)),
      exists: vi.fn(async () => true),
      delete: vi.fn(async () => true),
    };

    const res = await atomicWriteFile(vfs, 'a.bin', bytes);

    expect(res).toEqual({ ok: true, path: 'a.bin' });
    expect(vfs.writeFile).toHaveBeenCalledTimes(2);
    expect(vfs.delete).toHaveBeenCalledWith('a.bin');
    expect(vfs.delete).toHaveBeenCalledWith('a.bin.tmp_1_abc123');

    nowSpy.mockRestore();
  });

  it('treats non-bytes input as empty data', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1);

    const vfs = {
      writeFile: vi.fn(async () => true),
      readFile: vi.fn(async () => new Uint8Array(0)),
      rename: vi.fn(async () => true),
    };

    const res = await atomicWriteFile(vfs, 'a.bin', 'not-bytes', { verify: false });

    expect(res).toEqual({ ok: true, path: 'a.bin' });
    expect(vfs.writeFile).toHaveBeenCalledWith('a.bin.tmp_1_abc123', new Uint8Array(0));

    nowSpy.mockRestore();
  });
});

describe('atomicWrite', () => {
  it('dispatches to atomicWriteText for string data', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1);
    const vfs = {
      writeText: vi.fn(async () => true),
      writeFile: vi.fn(async () => true),
      rename: vi.fn(async () => true),
    };

    const res = await atomicWrite(vfs, 'a.txt', 'hello', { verify: false });

    expect(res).toEqual({ ok: true, path: 'a.txt' });
    expect(vfs.writeText).toHaveBeenCalledTimes(1);
    expect(vfs.writeFile).not.toHaveBeenCalled();

    nowSpy.mockRestore();
  });

  it('dispatches to atomicWriteFile for binary data', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1);
    const vfs = {
      writeText: vi.fn(async () => true),
      writeFile: vi.fn(async () => true),
      rename: vi.fn(async () => true),
    };

    const res = await atomicWrite(vfs, 'a.bin', bytes, { verify: false });

    expect(res).toEqual({ ok: true, path: 'a.bin' });
    expect(vfs.writeFile).toHaveBeenCalledTimes(1);
    expect(vfs.writeText).not.toHaveBeenCalled();

    nowSpy.mockRestore();
  });
});
