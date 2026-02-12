/**
 * Sentry SDK shim for browser-based runtime
 * Provides no-op implementations since error tracking to Sentry isn't useful in our environment
 */

const noop = () => {};
const noopPromise = () => Promise.resolve();

class Scope {
  setTag = noop;
  setTags = noop;
  setUser = noop;
  setContext = noop;
  setExtra = noop;
  setExtras = noop;
  setLevel = noop;
  setTransactionName = noop;
  setFingerprint = noop;
  addBreadcrumb = noop;
  clearBreadcrumbs = noop;
  addEventProcessor = noop;
  addAttachment = noop;
  clear = noop;
  update() { return this; }
  clone() { return new Scope(); }
}

class Hub {
  getClient() { return undefined; }
  getScope() { return new Scope(); }
  pushScope() { return new Scope(); }
  popScope = noop;
  withScope(callback) { callback(new Scope()); }
  captureException() { return ''; }
  captureMessage() { return ''; }
  captureEvent() { return ''; }
  addBreadcrumb = noop;
  setUser = noop;
  setTags = noop;
  setTag = noop;
  setExtra = noop;
  setExtras = noop;
  setContext = noop;
}

class Transaction {
  name = '';
  spanId = '';
  traceId = '';
  op = '';
  finish = noop;
  setTag = noop;
  setData = noop;
  setStatus = noop;
  startChild() { return new Transaction(); }
  toTraceparent() { return ''; }
}

const currentHub = new Hub();

export const init = noop;
export const close = noopPromise;
export const flush = noopPromise;
export const captureException = () => '';
export const captureMessage = () => '';
export const captureEvent = () => '';
export const addBreadcrumb = noop;
export const setUser = noop;
export const setTag = noop;
export const setTags = noop;
export const setExtra = noop;
export const setExtras = noop;
export const setContext = noop;
export const configureScope = (callback) => callback(new Scope());
export const withScope = (callback) => callback(new Scope());
export const getCurrentHub = () => currentHub;
export const getHubFromCarrier = () => currentHub;
export const startTransaction = () => new Transaction();
export const lastEventId = () => undefined;

export { Scope, Hub };

export const Integrations = {
  Http: class {},
  OnUncaughtException: class {},
  OnUnhandledRejection: class {},
  Console: class {},
  Context: class {},
  ContextLines: class {},
  Modules: class {},
  RequestData: class {},
  LinkedErrors: class {},
};

export const Handlers = {
  requestHandler: () => (_req, _res, next) => next(),
  errorHandler: () => (_err, _req, _res, next) => next(),
  tracingHandler: () => (_req, _res, next) => next(),
};

export default {
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
  startTransaction,
  lastEventId,
  Scope,
  Hub,
  Integrations,
  Handlers,
};
