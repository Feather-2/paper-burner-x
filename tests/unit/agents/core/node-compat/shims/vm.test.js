import { describe, it, expect } from 'vitest';
import vm, {
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
} from '../../../../../../js/agents/core/node-compat/shims/vm.js';

describe('vm shim', () => {
  it('Script runs code in this context and new context', () => {
    const localScript = new Script('1 + 2');
    expect(localScript.runInThisContext()).toBe(3);

    const contextualScript = new Script('a + b');
    expect(contextualScript.runInNewContext({ a: 2, b: 3 })).toBe(5);
    expect(contextualScript.runInContext({ a: 4, b: 6 })).toBe(10);
  });

  it('Script.createCachedData returns empty buffer', () => {
    const script = new Script('42');
    const cached = script.createCachedData();
    expect(Buffer.isBuffer(cached)).toBe(true);
    expect(cached.length).toBe(0);
  });

  it('context helpers return browser-safe defaults', () => {
    const sandbox = { value: 1 };
    expect(createContext(sandbox)).toBe(sandbox);
    expect(createContext()).toEqual({});
    expect(isContext({})).toBe(true);
  });

  it('top-level run helpers execute code', () => {
    expect(runInThisContext('40 + 2')).toBe(42);
    expect(runInNewContext('n * 2', { n: 7 })).toBe(14);
    expect(runInContext('n * 3', { n: 7 })).toBe(21);
  });

  it('compileFunction creates executable functions', () => {
    const sum = compileFunction('return a + b;', ['a', 'b']);
    expect(sum(4, 5)).toBe(9);

    const constant = compileFunction('return 7;');
    expect(constant()).toBe(7);
  });

  it('Module classes expose minimal API contract', async () => {
    const mod = new Module('code', {});
    await expect(mod.link(() => Promise.resolve())).resolves.toBeUndefined();
    await expect(mod.evaluate()).resolves.toBeUndefined();
    expect(mod.status).toBe('unlinked');
    expect(mod.identifier).toBe('');
    expect(mod.context).toEqual({});
    expect(mod.namespace).toEqual({});

    const source = new SourceTextModule('code', {});
    expect(source).toBeInstanceOf(Module);

    const synthetic = new SyntheticModule('code', {});
    expect(synthetic).toBeInstanceOf(Module);
    expect(() => synthetic.setExport('name', 1)).not.toThrow();
  });

  it('default export mirrors named exports', () => {
    expect(vm.Script).toBe(Script);
    expect(vm.createContext).toBe(createContext);
    expect(vm.isContext).toBe(isContext);
    expect(vm.runInThisContext).toBe(runInThisContext);
    expect(vm.runInNewContext).toBe(runInNewContext);
    expect(vm.runInContext).toBe(runInContext);
    expect(vm.compileFunction).toBe(compileFunction);
    expect(vm.Module).toBe(Module);
    expect(vm.SourceTextModule).toBe(SourceTextModule);
    expect(vm.SyntheticModule).toBe(SyntheticModule);
  });
});
