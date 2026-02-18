import { afterEach, describe, expect, it, vi } from 'vitest';
import { createExecutionContext } from '../../../../../js/agents/core/node-compat/execution-strategy.js';

const originalDocument = globalThis.document;

afterEach(() => {
  if (originalDocument === undefined) {
    delete globalThis.document;
  } else {
    globalThis.document = originalDocument;
  }
});

describe('node-compat/execution-strategy', () => {
  it('supports timeout control for eval mode', async () => {
    const context = await createExecutionContext('eval', { timeoutMs: 10 });
    await expect(context.execute('new Promise((resolve) => setTimeout(resolve, 50))'))
      .rejects
      .toMatchObject({ code: 'ERR_EXEC_TIMEOUT' });
    context.dispose();
  });

  it('supports abort control for eval mode', async () => {
    const context = await createExecutionContext('eval');
    const controller = new AbortController();
    controller.abort();

    await expect(context.execute('1 + 1', { signal: controller.signal }))
      .rejects
      .toMatchObject({ name: 'AbortError', code: 'ERR_EXEC_ABORTED' });
    context.dispose();
  });

  it('waits for document.body before creating iframe context', async () => {
    let domReadyHandler = null;
    const body = { appendChild: vi.fn() };
    const iframe = {
      style: {},
      sandbox: '',
      contentWindow: { eval: vi.fn(() => 3) },
      remove: vi.fn(),
    };

    globalThis.document = {
      body: null,
      createElement: vi.fn(() => iframe),
      addEventListener: vi.fn((event, handler) => {
        if (event === 'DOMContentLoaded') domReadyHandler = handler;
      }),
      removeEventListener: vi.fn(),
    };

    const contextPromise = createExecutionContext('iframe', { domReadyTimeoutMs: 100 });
    await Promise.resolve();
    expect(body.appendChild).not.toHaveBeenCalled();

    globalThis.document.body = body;
    domReadyHandler?.();

    const context = await contextPromise;
    expect(body.appendChild).toHaveBeenCalledWith(iframe);
    await expect(context.execute('1+2')).resolves.toBe(3);
    context.dispose();
    expect(iframe.remove).toHaveBeenCalled();
  });

  it('fails when document.body does not become available in time', async () => {
    globalThis.document = {
      body: null,
      createElement: vi.fn(() => ({
        style: {},
        sandbox: '',
        contentWindow: { eval: vi.fn(() => 0) },
        remove: vi.fn(),
      })),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    await expect(createExecutionContext('iframe', { domReadyTimeoutMs: 5 }))
      .rejects
      .toThrow('document.body is not ready');
  });
});
