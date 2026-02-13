import { describe, it, expect } from 'vitest';
import inspector, {
  Session,
  open,
  close,
  url,
  waitForDebugger,
  console as inspectorConsole,
} from '../../../../../../js/agents/core/node-compat/shims/inspector.js';

describe('inspector shim', () => {
  it('Session exposes no-op connection lifecycle methods', () => {
    const session = new Session();
    expect(() => session.connect()).not.toThrow();
    expect(() => session.connectToMainThread()).not.toThrow();
    expect(() => session.disconnect()).not.toThrow();
  });

  it('Session.post invokes callback asynchronously with empty result', async () => {
    const session = new Session();
    await new Promise((done) => {
      session.post('Runtime.evaluate', { expression: '1+1' }, (err, result) => {
        expect(err).toBeNull();
        expect(result).toEqual({});
        done();
      });
    });
  });

  it('module-level APIs are browser-safe stubs', () => {
    expect(() => open(9229, '127.0.0.1', false)).not.toThrow();
    expect(() => close()).not.toThrow();
    expect(url()).toBeUndefined();
    expect(() => waitForDebugger()).not.toThrow();
    expect(inspectorConsole).toBe(globalThis.console);
  });

  it('default export mirrors named exports', () => {
    expect(inspector.Session).toBe(Session);
    expect(inspector.open).toBe(open);
    expect(inspector.close).toBe(close);
    expect(inspector.url).toBe(url);
    expect(inspector.waitForDebugger).toBe(waitForDebugger);
    expect(inspector.console).toBe(inspectorConsole);
  });
});
