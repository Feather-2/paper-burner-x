import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockedFileUtils = vi.hoisted(() => ({
  getFileIdentifier: vi.fn(),
}));

const mockedKeyProvider = vi.hoisted(() => {
  const instances = [];

  class KeyProvider {
    constructor(modelName) {
      this.modelName = modelName;
      this.init = vi.fn(async () => {});
      this.getNextKey = vi.fn(async () => ({ id: 'key_1' }));
      this.markKeyAsInvalid = vi.fn(async () => {});
      this.recordSuccess = vi.fn(async () => {});

      instances.push(this);
    }
  }

  return { instances, KeyProvider };
});

const mockedSemaphore = vi.hoisted(() => {
  const instances = [];

  class Semaphore {
    constructor(limit = 2) {
      this._limit = limit;
      this._active = 0;
      this._queue = [];
      instances.push(this);
    }

    get limit() {
      return this._limit;
    }

    set limit(value) {
      this._limit = value;
      this._drain();
    }

    get active() {
      return this._active;
    }

    async run(fn) {
      await this._acquire();
      try {
        return await fn();
      } finally {
        this._release();
      }
    }

    async _acquire() {
      if (this._active < this._limit) {
        this._active++;
        return;
      }

      await new Promise((resolve) => this._queue.push(resolve));
    }

    _release() {
      this._active--;
      this._drain();
    }

    _drain() {
      while (this._queue.length > 0 && this._active < this._limit) {
        this._active++;
        const nextResolve = this._queue.shift();
        nextResolve();
      }
    }
  }

  return { instances, Semaphore };
});

vi.mock('../../js/core/api/key-provider.js', () => ({
  KeyProvider: mockedKeyProvider.KeyProvider,
}));

vi.mock('../../js/core/file/file-utils.js', () => ({
  getFileIdentifier: mockedFileUtils.getFileIdentifier,
}));

vi.mock('../../js/core/processing/semaphore.js', () => ({
  Semaphore: mockedSemaphore.Semaphore,
}));

async function loadProcessQueue() {
  return await import('../../js/core/processing/process-queue.js');
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitUntil(predicate, timeoutMs = 500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error('waitUntil: timeout');
}

function makeFile(name, size = 100, lastModified = 1) {
  return { name, size, lastModified };
}

describe('core/processing/process-queue (ProcessQueue)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();

    mockedKeyProvider.instances.length = 0;
    mockedSemaphore.instances.length = 0;

    mockedFileUtils.getFileIdentifier.mockReset();
    mockedFileUtils.getFileIdentifier.mockImplementation((file) => `id:${file.name}`);

    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('constructor sets default values', async () => {
    const { ProcessQueue } = await loadProcessQueue();
    const queue = new ProcessQueue();

    expect(queue.isProcessing).toBe(false);
    expect(queue.length).toBe(0);
    expect(queue.results).toEqual([]);

    expect(queue._concurrency).toBe(3);
    expect(queue._maxRetries).toBe(3);
    expect(queue._processor).toBe(null);

    expect(typeof queue._onProgress).toBe('function');
    expect(typeof queue._onFileComplete).toBe('function');
    expect(typeof queue._onError).toBe('function');

    expect(Array.isArray(queue._queue)).toBe(true);
    expect(queue._queue).toHaveLength(0);
    expect(queue._retryAttempts instanceof Map).toBe(true);
    expect(queue._retryAttempts.size).toBe(0);

    expect(mockedSemaphore.instances).toHaveLength(1);
    expect(mockedSemaphore.instances[0].limit).toBe(3);
  });

  it('constructor clamps invalid concurrency/maxRetries', async () => {
    const { ProcessQueue } = await loadProcessQueue();
    const queue = new ProcessQueue({ concurrency: 0, maxRetries: -1 });

    expect(queue._concurrency).toBe(1);
    expect(queue._maxRetries).toBe(0);
    expect(mockedSemaphore.instances).toHaveLength(1);
    expect(mockedSemaphore.instances[0].limit).toBe(1);
  });

  it('addFiles() adds files to the queue with identifiers and indices', async () => {
    const { ProcessQueue } = await loadProcessQueue();
    const queue = new ProcessQueue();

    const file1 = makeFile('a.pdf');
    const file2 = makeFile('b.pdf');

    mockedFileUtils.getFileIdentifier
      .mockImplementationOnce(() => 'id-a')
      .mockImplementationOnce(() => 'id-b');

    queue.addFiles([file1, file2]);

    expect(queue.length).toBe(2);
    expect(mockedFileUtils.getFileIdentifier).toHaveBeenCalledTimes(2);
    expect(queue._queue[0]).toEqual({ file: file1, index: 0, identifier: 'id-a' });
    expect(queue._queue[1]).toEqual({ file: file2, index: 1, identifier: 'id-b' });

    const file3 = makeFile('c.pdf');
    mockedFileUtils.getFileIdentifier.mockImplementationOnce(() => 'id-c');
    queue.addFiles([file3]);

    expect(queue.length).toBe(3);
    expect(queue._queue[2]).toEqual({ file: file3, index: 2, identifier: 'id-c' });
  });

  it('clear() resets queue/results/retry state', async () => {
    const { ProcessQueue } = await loadProcessQueue();
    const queue = new ProcessQueue();

    const file1 = makeFile('a.pdf');
    mockedFileUtils.getFileIdentifier.mockImplementationOnce(() => 'id-a');
    queue.addFiles([file1]);

    queue._results = [{ ok: true }];
    queue._retryAttempts.set(0, 2);

    queue.clear();

    expect(queue.length).toBe(0);
    expect(queue.results).toEqual([]);
    expect(queue._retryAttempts.size).toBe(0);
  });

  it('setConcurrency() updates both internal concurrency and semaphore limit', async () => {
    const { ProcessQueue } = await loadProcessQueue();
    const queue = new ProcessQueue({ concurrency: 2 });

    expect(mockedSemaphore.instances).toHaveLength(1);
    expect(mockedSemaphore.instances[0].limit).toBe(2);

    queue.setConcurrency(5);

    expect(queue._concurrency).toBe(5);
    expect(mockedSemaphore.instances[0].limit).toBe(5);
  });

  it('start() processes pending items via custom processor and KeyProvider', async () => {
    const { ProcessQueue } = await loadProcessQueue();

    const onProgress = vi.fn();
    const onFileComplete = vi.fn();
    const onError = vi.fn();

    const processor = vi.fn(async (file, keyObj) => ({
      fileName: file.name,
      usedKeyId: keyObj?.id || null,
    }));

    const queue = new ProcessQueue({ processor, onProgress, onFileComplete, onError });
    const file1 = makeFile('a.pdf');
    const file2 = makeFile('b.pdf');

    mockedFileUtils.getFileIdentifier
      .mockImplementationOnce(() => 'id-a')
      .mockImplementationOnce(() => 'id-b');

    queue.addFiles([file1, file2]);

    const results = await queue.start({
      translationModel: 'gpt',
      processedFilesRecord: { 'id-a': true },
    });

    expect(mockedKeyProvider.instances).toHaveLength(1);
    const keyProvider = mockedKeyProvider.instances[0];
    expect(keyProvider.modelName).toBe('gpt');
    expect(keyProvider.init).toHaveBeenCalledTimes(1);
    expect(keyProvider.getNextKey).toHaveBeenCalledTimes(1);

    expect(processor).toHaveBeenCalledTimes(1);
    expect(processor).toHaveBeenCalledWith(file2, { id: 'key_1' }, expect.any(Object));
    expect(keyProvider.recordSuccess).toHaveBeenCalledWith('key_1');

    expect(onFileComplete).toHaveBeenCalledTimes(1);
    expect(onFileComplete).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: 'b.pdf', usedKeyId: 'key_1' }),
      file2,
      1,
    );

    expect(onError).not.toHaveBeenCalled();
    expect(onProgress).toHaveBeenCalled();

    expect(results).toEqual([expect.objectContaining({ fileName: 'b.pdf', usedKeyId: 'key_1' })]);
    expect(queue.isProcessing).toBe(false);
  });

  it('start() throws when called while already processing', async () => {
    const { ProcessQueue } = await loadProcessQueue();

    const gate = deferred();
    const processor = vi.fn(async () => {
      await gate.promise;
      return { ok: true };
    });

    const queue = new ProcessQueue({ concurrency: 1, processor });
    const file1 = makeFile('a.pdf');

    mockedFileUtils.getFileIdentifier.mockImplementationOnce(() => 'id-a');
    queue.addFiles([file1]);

    const startPromise = queue.start({ translationModel: 'none', processedFilesRecord: {} });

    await expect(
      queue.start({ translationModel: 'none', processedFilesRecord: {} }),
    ).rejects.toThrow('Queue is already processing');

    gate.resolve();
    await startPromise;
    expect(queue.isProcessing).toBe(false);
  });

  it('uses window.processSinglePdf when processor is not provided', async () => {
    const { ProcessQueue } = await loadProcessQueue();

    const processSinglePdf = vi.fn(async (file, keyObj) => ({
      fileName: file.name,
      usedKeyId: keyObj?.id || null,
    }));

    globalThis.window = { processSinglePdf };

    try {
      const queue = new ProcessQueue();
      const file1 = makeFile('a.pdf');
      mockedFileUtils.getFileIdentifier.mockImplementationOnce(() => 'id-a');
      queue.addFiles([file1]);

      const results = await queue.start({ translationModel: 'none', processedFilesRecord: {} });

      expect(processSinglePdf).toHaveBeenCalledTimes(1);
      expect(processSinglePdf).toHaveBeenCalledWith(file1, null, expect.any(Object));
      expect(results).toEqual([expect.objectContaining({ fileName: 'a.pdf', usedKeyId: null })]);
    } finally {
      Reflect.deleteProperty(globalThis, 'window');
    }
  });

  it('records an error result when no processor is available', async () => {
    const { ProcessQueue } = await loadProcessQueue();

    Reflect.deleteProperty(globalThis, 'window');

    const onError = vi.fn();
    const queue = new ProcessQueue({ maxRetries: 0, onError });
    const file1 = makeFile('a.pdf');

    mockedFileUtils.getFileIdentifier.mockImplementationOnce(() => 'id-a');
    queue.addFiles([file1]);

    const results = await queue.start({ translationModel: 'none', processedFilesRecord: {} });

    expect(console.warn).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(queue.results[0]).toEqual(expect.objectContaining({ error: 'No processor available', file: file1 }));
    expect(results).toEqual([expect.objectContaining({ error: 'No processor available', file: file1 })]);
  });

  it('marks key invalid when processor reports keyInvalid', async () => {
    const { ProcessQueue } = await loadProcessQueue();

    const onError = vi.fn();
    const processor = vi.fn(async (_file, keyObj) => ({
      keyInvalid: { keyId: keyObj.id },
      usedKeyId: keyObj.id,
    }));

    const queue = new ProcessQueue({ maxRetries: 0, processor, onError });
    const file1 = makeFile('a.pdf');
    mockedFileUtils.getFileIdentifier.mockImplementationOnce(() => 'id-a');
    queue.addFiles([file1]);

    const results = await queue.start({ translationModel: 'gpt', processedFilesRecord: {} });

    expect(mockedKeyProvider.instances).toHaveLength(1);
    const keyProvider = mockedKeyProvider.instances[0];
    expect(keyProvider.markKeyAsInvalid).toHaveBeenCalledTimes(1);
    expect(keyProvider.markKeyAsInvalid).toHaveBeenCalledWith('key_1');
    expect(keyProvider.recordSuccess).not.toHaveBeenCalled();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(queue.results[0]).toEqual(expect.objectContaining({ error: 'API key invalid', file: file1 }));
    expect(results).toEqual([expect.objectContaining({ error: 'API key invalid', file: file1 })]);
  });

  it('stop() prevents queued items from starting', async () => {
    const { ProcessQueue } = await loadProcessQueue();

    const gate = deferred();
    const processor = vi.fn(async (file) => {
      if (file.name === 'a.pdf') {
        await gate.promise;
      }
      return { done: file.name };
    });

    const queue = new ProcessQueue({ concurrency: 1, processor });
    const file1 = makeFile('a.pdf');
    const file2 = makeFile('b.pdf');

    mockedFileUtils.getFileIdentifier
      .mockImplementationOnce(() => 'id-a')
      .mockImplementationOnce(() => 'id-b');

    queue.addFiles([file1, file2]);

    const startPromise = queue.start({ translationModel: 'none', processedFilesRecord: {} });

    await waitUntil(() => processor.mock.calls.length === 1);
    expect(processor).toHaveBeenCalledWith(file1, null, expect.any(Object));

    queue.stop();
    gate.resolve();

    const results = await startPromise;

    expect(processor).toHaveBeenCalledTimes(1);
    expect(results).toEqual([expect.objectContaining({ done: 'a.pdf' })]);
    expect(queue.results[0]).toEqual(expect.objectContaining({ done: 'a.pdf' }));
    expect(queue.results[1]).toBeNull();
  });

  it('retries failed items up to maxRetries and eventually succeeds', async () => {
    const { ProcessQueue } = await loadProcessQueue();

    const processor = vi.fn();
    processor
      .mockRejectedValueOnce(new Error('temporary'))
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce({ ok: true });

    const queue = new ProcessQueue({ maxRetries: 3, processor });
    const file1 = makeFile('a.pdf');
    mockedFileUtils.getFileIdentifier.mockImplementationOnce(() => 'id-a');
    queue.addFiles([file1]);

    const results = await queue.start({ translationModel: 'none', processedFilesRecord: {} });

    expect(processor).toHaveBeenCalledTimes(3);
    expect(console.warn).toHaveBeenCalledTimes(2);
    expect(queue._retryAttempts.get(0)).toBe(2);
    expect(results).toEqual([expect.objectContaining({ ok: true })]);
  });

  it('retries exhausted: records error result and calls onError once', async () => {
    const { ProcessQueue } = await loadProcessQueue();

    const onError = vi.fn();
    const processor = vi.fn(async () => {
      throw new Error('permanent');
    });

    const queue = new ProcessQueue({ maxRetries: 2, processor, onError });
    const file1 = makeFile('a.pdf');
    mockedFileUtils.getFileIdentifier.mockImplementationOnce(() => 'id-a');
    queue.addFiles([file1]);

    const results = await queue.start({ translationModel: 'none', processedFilesRecord: {} });

    // maxRetries=2 => 3 total attempts (1 initial + 2 retries)
    expect(processor).toHaveBeenCalledTimes(3);
    expect(console.warn).toHaveBeenCalledTimes(2);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), file1, 0);

    expect(queue.results[0]).toEqual(expect.objectContaining({ error: 'permanent', file: file1 }));
    expect(results).toEqual([expect.objectContaining({ error: 'permanent', file: file1 })]);
  });
});
