import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  isWorkerSupported: vi.fn(),
  createWorker: vi.fn(),
  terminateWorker: vi.fn(),
}));

vi.mock('../../../../../js/agents/runtime/core/worker-factory.js', () => ({
  isWorkerSupported: mocks.isWorkerSupported,
  createWorker: mocks.createWorker,
  terminateWorker: mocks.terminateWorker,
}));

import {
  isWorkerSupported,
  createWorker,
  terminateWorker,
} from '../../../../../js/agents/runtime/core/index.js';

const buildDeepObject = (depth) => {
  let root = {};
  let node = root;
  for (let i = 0; i < depth; i += 1) {
    node.next = {};
    node = node.next;
  }
  node.value = 'end';
  return root;
};

beforeEach(() => {
  mocks.isWorkerSupported.mockReset();
  mocks.createWorker.mockReset();
  mocks.terminateWorker.mockReset();
});

describe('isWorkerSupported', () => {
  it('returns the underlying result', () => {
    mocks.isWorkerSupported.mockReturnValue(true);

    const result = isWorkerSupported();

    expect(result).toBe(true);
    expect(isWorkerSupported).toBe(mocks.isWorkerSupported);
    expect(mocks.isWorkerSupported).toHaveBeenCalledTimes(1);
  });

  it('forwards nullish boundary inputs', () => {
    mocks.isWorkerSupported.mockImplementation((...args) => args);

    const cases = [null, undefined];
    for (const value of cases) {
      expect(isWorkerSupported(value)).toEqual([value]);
    }

    expect(mocks.isWorkerSupported).toHaveBeenCalledTimes(cases.length);
  });

  it('propagates errors from the worker factory', () => {
    const err = new Error('boom');
    mocks.isWorkerSupported.mockImplementation(() => {
      throw err;
    });

    expect(() => isWorkerSupported()).toThrow(err);
  });

  it('handles rapid consecutive calls', () => {
    mocks.isWorkerSupported
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);

    const results = [isWorkerSupported(), isWorkerSupported(), isWorkerSupported()];

    expect(results).toEqual([true, false, true]);
    expect(mocks.isWorkerSupported).toHaveBeenCalledTimes(3);
  });
});

describe('createWorker', () => {
  it('returns the worker from the factory', async () => {
    const worker = { id: 'w1' };
    mocks.createWorker.mockResolvedValue(worker);

    const result = await createWorker('worker.js', { type: 'module' });

    expect(result).toBe(worker);
    expect(createWorker).toBe(mocks.createWorker);
    expect(mocks.createWorker).toHaveBeenCalledWith('worker.js', { type: 'module' });
  });

  it('propagates factory rejections', async () => {
    const err = new Error('nope');
    mocks.createWorker.mockRejectedValue(err);

    await expect(createWorker('bad.js')).rejects.toThrow(err);
  });

  it('forwards boundary and resource-heavy inputs', async () => {
    const longString = 'x'.repeat(10000);
    const largeFile = { name: 'big.bin', size: 1024 * 1024 * 512 };
    const deepNested = buildDeepObject(24);

    const cases = [
      { scriptUrl: '', options: {} },
      { scriptUrl: '   ', options: {} },
      { scriptUrl: 0, options: {} },
      { scriptUrl: -1, options: {} },
      { scriptUrl: Number.MAX_SAFE_INTEGER, options: {} },
      { scriptUrl: 'worker.js', options: { timeoutMs: '1000' } },
      { scriptUrl: {}, options: {} },
      { scriptUrl: longString, options: {} },
      { scriptUrl: 'big-file.js', options: { file: largeFile } },
      { scriptUrl: 'deep.js', options: deepNested },
    ];

    mocks.createWorker.mockImplementation((scriptUrl, options) => ({
      scriptUrl,
      options,
    }));

    for (const { scriptUrl, options } of cases) {
      const result = await createWorker(scriptUrl, options);
      expect(result).toEqual({ scriptUrl, options });
    }

    expect(mocks.createWorker).toHaveBeenCalledTimes(cases.length);
    cases.forEach(({ scriptUrl, options }, index) => {
      expect(mocks.createWorker.mock.calls[index]).toEqual([scriptUrl, options]);
    });
  });

  it('handles simultaneous calls', async () => {
    mocks.createWorker.mockImplementation((scriptUrl) =>
      Promise.resolve({ id: scriptUrl })
    );

    const results = await Promise.all([
      createWorker('a.js'),
      createWorker('b.js'),
      createWorker('c.js'),
    ]);

    expect(results).toEqual([{ id: 'a.js' }, { id: 'b.js' }, { id: 'c.js' }]);
    expect(mocks.createWorker).toHaveBeenCalledTimes(3);
  });
});

describe('terminateWorker', () => {
  it('forwards the worker to the factory', async () => {
    const worker = { id: 'w2' };
    mocks.terminateWorker.mockResolvedValue(undefined);

    await terminateWorker(worker);

    expect(terminateWorker).toBe(mocks.terminateWorker);
    expect(mocks.terminateWorker).toHaveBeenCalledWith(worker);
  });

  it('propagates factory errors', () => {
    const err = new Error('terminate boom');
    mocks.terminateWorker.mockImplementation(() => {
      throw err;
    });

    expect(() => terminateWorker({})).toThrow(err);
  });

  it('forwards boundary worker values', async () => {
    const arrayLike = { 0: 'w', length: 1 };
    const cases = [[], arrayLike];

    mocks.terminateWorker.mockImplementation((worker) => worker);

    const results = await Promise.all(cases.map((worker) => terminateWorker(worker)));

    expect(results).toEqual(cases);
    expect(mocks.terminateWorker).toHaveBeenCalledTimes(cases.length);
    cases.forEach((worker, index) => {
      expect(mocks.terminateWorker.mock.calls[index]).toEqual([worker]);
    });
  });
});
