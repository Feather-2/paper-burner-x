import { describe, expect, it } from 'vitest';

import { __test } from '../../../../js/agents/runtime/tools/tool-executor.js';

describe('runtime/tools/tool-executor: WorkerPool', () => {
  it('rejects queued acquirers if worker creation fails', async () => {
    const { WorkerPool } = __test;

    const boom = new Error('boom');
    /** @type {(err: any) => void} */
    let rejectCreate = () => {};

    const pool = new WorkerPool({
      maxWorkers: 1,
      createWorker: async () =>
        await new Promise((_resolve, reject) => {
          rejectCreate = reject;
        }),
    });

    const p1 = pool.acquire();
    const p2 = pool.acquire(); // will queue behind p1 while p1 is still "creating"

    rejectCreate(boom);

    await expect(p1).rejects.toThrow('boom');
    await expect(p2).rejects.toThrow('boom');
  });
});

