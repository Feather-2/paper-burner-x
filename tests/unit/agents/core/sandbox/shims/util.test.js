import { describe, it, expect, vi } from 'vitest';
import { format, inspect, promisify, callbackify, inherits, types } from '../../../../../../js/agents/core/sandbox/shims/util.js';

describe('util shim', () => {
  it('format with %s and %d', () => {
    expect(format('%s has %d items', 'list', 42)).toBe('list has 42 items');
  });

  it('format with %j', () => {
    expect(format('%j', { a: 1 })).toBe('{"a":1}');
  });

  it('format non-string first arg', () => {
    const result = format(42, 'x');
    expect(result).toContain('42');
    expect(result).toContain('x');
  });

  it('inspect returns JSON string', () => {
    expect(inspect({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  it('inspect handles circular refs gracefully', () => {
    const obj = {};
    obj.self = obj;
    expect(typeof inspect(obj)).toBe('string');
  });

  it('promisify converts callback fn', async () => {
    const fn = (a, b, cb) => cb(null, a + b);
    const p = promisify(fn);
    expect(await p(2, 3)).toBe(5);
  });

  it('promisify rejects on error', async () => {
    const fn = (cb) => cb(new Error('fail'));
    const p = promisify(fn);
    await expect(p()).rejects.toThrow('fail');
  });

  it('callbackify converts async fn', async () => {
    const fn = async (x) => x * 2;
    const cb = callbackify(fn);
    const result = await new Promise((resolve, reject) => {
      cb(5, (err, val) => err ? reject(err) : resolve(val));
    });
    expect(result).toBe(10);
  });

  it('inherits sets up prototype chain', () => {
    function Parent() {}
    Parent.prototype.hello = () => 'hi';
    function Child() {}
    inherits(Child, Parent);
    const c = new Child();
    expect(c.hello()).toBe('hi');
    expect(Child.super_).toBe(Parent);
  });

  it('types checks', () => {
    expect(types.isArray([1])).toBe(true);
    expect(types.isString('x')).toBe(true);
    expect(types.isNumber(1)).toBe(true);
    expect(types.isFunction(() => {})).toBe(true);
    expect(types.isPromise(Promise.resolve())).toBe(true);
    expect(types.isDate(new Date())).toBe(true);
    expect(types.isRegExp(/x/)).toBe(true);
    expect(types.isNull(null)).toBe(true);
    expect(types.isUndefined(undefined)).toBe(true);
    expect(types.isNullOrUndefined(null)).toBe(true);
    expect(types.isObject({})).toBe(true);
    expect(types.isBoolean(true)).toBe(true);
  });
});
