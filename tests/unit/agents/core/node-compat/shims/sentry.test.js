import { describe, it, expect, vi } from 'vitest';
import sentry, {
  init,
  close,
  flush,
  captureException,
  captureMessage,
  captureEvent,
  addBreadcrumb,
  setUser,
  setTag,
  setTags,
  setExtra,
  setExtras,
  setContext,
  configureScope,
  withScope,
  getCurrentHub,
  getHubFromCarrier,
  startTransaction,
  lastEventId,
  Scope,
  Hub,
  Integrations,
  Handlers,
} from '../../../../../../js/agents/core/node-compat/shims/sentry.js';

describe('sentry shim', () => {
  it('top-level APIs are safe no-ops in browser runtime', async () => {
    expect(init({ dsn: 'https://example.invalid/1' })).toBeUndefined();
    await expect(close()).resolves.toBeUndefined();
    await expect(flush()).resolves.toBeUndefined();

    expect(captureException(new Error('boom'))).toBe('');
    expect(captureMessage('hello')).toBe('');
    expect(captureEvent({ message: 'event' })).toBe('');
    expect(lastEventId()).toBeUndefined();

    expect(() => addBreadcrumb({ category: 'ui' })).not.toThrow();
    expect(() => setUser({ id: 'u1' })).not.toThrow();
    expect(() => setTag('env', 'test')).not.toThrow();
    expect(() => setTags({ env: 'test' })).not.toThrow();
    expect(() => setExtra('debug', true)).not.toThrow();
    expect(() => setExtras({ debug: true })).not.toThrow();
    expect(() => setContext('runtime', { browser: true })).not.toThrow();
  });

  it('Scope supports fluent clone/update and no-op mutators', () => {
    const scope = new Scope();
    expect(() => scope.setTag('k', 'v')).not.toThrow();
    expect(() => scope.setTags({ env: 'test' })).not.toThrow();
    expect(() => scope.setUser({ id: '1' })).not.toThrow();
    expect(() => scope.setContext('ctx', {})).not.toThrow();
    expect(() => scope.setExtra('x', 1)).not.toThrow();
    expect(() => scope.setExtras({ x: 1 })).not.toThrow();
    expect(() => scope.setLevel('error')).not.toThrow();
    expect(() => scope.setTransactionName('tx')).not.toThrow();
    expect(() => scope.setFingerprint(['abc'])).not.toThrow();
    expect(() => scope.addBreadcrumb({ message: 'b' })).not.toThrow();
    expect(() => scope.clearBreadcrumbs()).not.toThrow();
    expect(() => scope.addEventProcessor(() => {})).not.toThrow();
    expect(() => scope.addAttachment({ filename: 'a.txt' })).not.toThrow();
    expect(() => scope.clear()).not.toThrow();
    expect(scope.update()).toBe(scope);

    const clone = scope.clone();
    expect(clone).toBeInstanceOf(Scope);
    expect(clone).not.toBe(scope);
  });

  it('Hub exposes inert client/scope helpers and capture shortcuts', () => {
    const hub = new Hub();
    expect(hub.getClient()).toBeUndefined();
    expect(hub.getScope()).toBeInstanceOf(Scope);
    expect(hub.pushScope()).toBeInstanceOf(Scope);
    expect(() => hub.popScope()).not.toThrow();

    const scopeCallback = vi.fn();
    hub.withScope(scopeCallback);
    expect(scopeCallback).toHaveBeenCalledWith(expect.any(Scope));

    expect(hub.captureException(new Error('x'))).toBe('');
    expect(hub.captureMessage('x')).toBe('');
    expect(hub.captureEvent({})).toBe('');
    expect(() => hub.addBreadcrumb({})).not.toThrow();
    expect(() => hub.setUser({ id: 'u' })).not.toThrow();
    expect(() => hub.setTags({ env: 't' })).not.toThrow();
    expect(() => hub.setTag('k', 'v')).not.toThrow();
    expect(() => hub.setExtra('k', 1)).not.toThrow();
    expect(() => hub.setExtras({ k: 1 })).not.toThrow();
    expect(() => hub.setContext('ctx', {})).not.toThrow();
  });

  it('scope wrappers provide Scope objects to callbacks', () => {
    const configureCallback = vi.fn();
    const withScopeCallback = vi.fn();
    configureScope(configureCallback);
    withScope(withScopeCallback);

    expect(configureCallback).toHaveBeenCalledWith(expect.any(Scope));
    expect(withScopeCallback).toHaveBeenCalledWith(expect.any(Scope));
  });

  it('hub getters return stable singleton hub', () => {
    const first = getCurrentHub();
    const second = getCurrentHub();
    const fromCarrier = getHubFromCarrier({});

    expect(first).toBeInstanceOf(Hub);
    expect(first).toBe(second);
    expect(first).toBe(fromCarrier);
  });

  it('startTransaction returns transaction-like object', () => {
    const tx = startTransaction({ name: 'tx' });
    expect(tx.name).toBe('');
    expect(tx.spanId).toBe('');
    expect(tx.traceId).toBe('');
    expect(tx.op).toBe('');
    expect(() => tx.finish()).not.toThrow();
    expect(() => tx.setTag('k', 'v')).not.toThrow();
    expect(() => tx.setData('k', 'v')).not.toThrow();
    expect(() => tx.setStatus('ok')).not.toThrow();
    expect(tx.startChild()).toEqual(expect.objectContaining({ toTraceparent: expect.any(Function) }));
    expect(tx.toTraceparent()).toBe('');
  });

  it('integrations are constructible and handlers forward next()', () => {
    for (const Integration of Object.values(Integrations)) {
      expect(new Integration()).toBeInstanceOf(Integration);
    }

    const next = vi.fn();
    const req = {};
    const res = {};
    const err = new Error('test');

    Handlers.requestHandler()(req, res, next);
    Handlers.errorHandler()(err, req, res, next);
    Handlers.tracingHandler()(req, res, next);
    expect(next).toHaveBeenCalledTimes(3);
  });

  it('default export mirrors named exports', () => {
    expect(sentry.init).toBe(init);
    expect(sentry.close).toBe(close);
    expect(sentry.flush).toBe(flush);
    expect(sentry.captureException).toBe(captureException);
    expect(sentry.captureMessage).toBe(captureMessage);
    expect(sentry.captureEvent).toBe(captureEvent);
    expect(sentry.addBreadcrumb).toBe(addBreadcrumb);
    expect(sentry.setUser).toBe(setUser);
    expect(sentry.setTag).toBe(setTag);
    expect(sentry.setTags).toBe(setTags);
    expect(sentry.setExtra).toBe(setExtra);
    expect(sentry.setExtras).toBe(setExtras);
    expect(sentry.setContext).toBe(setContext);
    expect(sentry.configureScope).toBe(configureScope);
    expect(sentry.withScope).toBe(withScope);
    expect(sentry.getCurrentHub).toBe(getCurrentHub);
    expect(sentry.startTransaction).toBe(startTransaction);
    expect(sentry.lastEventId).toBe(lastEventId);
    expect(sentry.Scope).toBe(Scope);
    expect(sentry.Hub).toBe(Hub);
    expect(sentry.Integrations).toBe(Integrations);
    expect(sentry.Handlers).toBe(Handlers);
  });
});
