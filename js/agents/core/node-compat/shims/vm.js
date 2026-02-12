/**
 * vm shim - Basic VM functionality using eval
 */

export class Script {
  constructor(code, _options) {
    this.code = code;
  }

  runInThisContext(_options) {
    return eval(this.code);
  }

  runInNewContext(contextObject, _options) {
    const keys = contextObject ? Object.keys(contextObject) : [];
    const values = contextObject ? Object.values(contextObject) : [];
    const fn = new Function(...keys, `return eval(${JSON.stringify(this.code)})`);
    return fn(...values);
  }

  runInContext(_context, _options) {
    return this.runInNewContext(_context, _options);
  }

  createCachedData() {
    return Buffer.from('');
  }
}

export function createContext(contextObject, _options) {
  return contextObject || {};
}

export function isContext(_sandbox) {
  return true;
}

export function runInThisContext(code, _options) {
  return eval(code);
}

export function runInNewContext(code, contextObject, _options) {
  const script = new Script(code);
  return script.runInNewContext(contextObject);
}

export function runInContext(code, context, _options) {
  return runInNewContext(code, context);
}

export function compileFunction(code, params, _options) {
  return new Function(...(params || []), code);
}

export class Module {
  constructor(_code, _options) {}
  link(_linker) { return Promise.resolve(); }
  evaluate(_options) { return Promise.resolve(); }
  get status() { return 'unlinked'; }
  get identifier() { return ''; }
  get context() { return {}; }
  get namespace() { return {}; }
}

export class SourceTextModule extends Module {}
export class SyntheticModule extends Module {
  setExport(_name, _value) {}
}

export default {
  Script,
  createContext,
  isContext,
  runInThisContext,
  runInNewContext,
  runInContext,
  compileFunction,
  Module,
  SourceTextModule,
  SyntheticModule,
};
