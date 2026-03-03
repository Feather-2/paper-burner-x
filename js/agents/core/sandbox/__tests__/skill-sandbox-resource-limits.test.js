import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { ResourceLimits } from '../constants.js';

function createSilentLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe('skill-sandbox resource limits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('node:worker_threads');
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('applies resource limits when creating a Node worker', async () => {
    /** @type {{ options?: { resourceLimits?: Record<string, number> } }} */
    const capture = {};

    vi.doMock('node:worker_threads', () => {
      class FakeWorker {
        constructor(_filename, options = {}) {
          capture.options = options;
          this.handlers = {};
        }

        on(event, handler) {
          this.handlers[event] = handler;
        }

        postMessage() {
          this.handlers.message?.({
            type: 'result',
            success: true,
            data: 'test',
            metrics: { duration: 1 },
          });
        }

        terminate() {
          return Promise.resolve(0);
        }
      }

      return { Worker: FakeWorker };
    });

    const { executeFallbackInNodeWorker } = await import('../skill-sandbox.js');
    const result = await executeFallbackInNodeWorker(
      {
        code: 'return "test";',
        timeoutMs: 5000,
      },
      createSilentLogger()
    );

    const standardMemoryMb = ResourceLimits.STANDARD.memoryLimit / (1024 * 1024);
    expect(result.ok).toBe(true);
    expect(capture.options?.resourceLimits).toEqual({
      maxOldGenerationSizeMb: standardMemoryMb * 8,
      maxYoungGenerationSizeMb: standardMemoryMb,
      codeRangeSizeMb: standardMemoryMb,
    });
  });

  it('respects memory limits for memory-intensive code', async () => {
    const script = `
      import('./js/agents/core/sandbox/skill-sandbox.js').then(async ({ executeFallbackInNodeWorker }) => {
        const logger = { debug() {}, info() {}, warn() {}, error() {} };
        const result = await executeFallbackInNodeWorker({
          code: 'const arr = new Array(35_000_000).fill(0); return arr.length;',
          timeoutMs: 15000,
        }, logger);
        console.log(JSON.stringify(result));
      }).catch((err) => {
        console.error(String(err?.stack || err));
        process.exit(1);
      });
    `;

    const child = spawnSync(process.execPath, ['-e', script], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
    });

    // Depending on Node/V8 version, memory pressure may either:
    // 1) return a failed worker result, or
    // 2) abort the child process with OOM.
    if (child.status === 0) {
      const lines = String(child.stdout || '').trim().split('\n').filter(Boolean);
      const payload = JSON.parse(lines.at(-1) || '{}');
      expect(payload.ok).toBe(false);
      expect(String(payload.error || '').toLowerCase()).toMatch(/memory|heap|out of memory|worker exited|oom/);
      return;
    }

    const combinedLogs = `${child.stdout || ''}\n${child.stderr || ''}`.toLowerCase();
    expect(combinedLogs).toMatch(/memory|heap|out of memory|allocation failed|oom|fatal error/);
  });
});
