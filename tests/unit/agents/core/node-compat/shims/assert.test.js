import { describe, it, expect } from 'vitest';
import assert, { AssertionError } from '../../../../../../js/agents/core/node-compat/shims/assert.js';

describe('assert shim', () => {
  describe('assert()', () => {
    it('passes for truthy values', () => {
      expect(() => assert(true)).not.toThrow();
      expect(() => assert(1)).not.toThrow();
      expect(() => assert('string')).not.toThrow();
    });

    it('throws AssertionError for falsy values', () => {
      expect(() => assert(false)).toThrow(AssertionError);
      expect(() => assert(0)).toThrow(AssertionError);
      expect(() => assert('')).toThrow(AssertionError);
    });

    it('throws with custom message', () => {
      expect(() => assert(false, 'Custom error')).toThrow('Custom error');
    });
  });

  describe('assert.ok()', () => {
    it('passes for truthy values', () => {
      expect(() => assert.ok(true)).not.toThrow();
      expect(() => assert.ok(1)).not.toThrow();
    });

    it('throws for falsy values', () => {
      expect(() => assert.ok(false)).toThrow(AssertionError);
    });
  });

  describe('assert.strictEqual()', () => {
    it('passes for strictly equal values', () => {
      expect(() => assert.strictEqual(1, 1)).not.toThrow();
      expect(() => assert.strictEqual('a', 'a')).not.toThrow();
    });

    it('throws for non-strictly equal values', () => {
      expect(() => assert.strictEqual(1, '1')).toThrow(AssertionError);
      expect(() => assert.strictEqual(1, 2)).toThrow(AssertionError);
    });
  });

  describe('assert.notStrictEqual()', () => {
    it('passes for non-strictly equal values', () => {
      expect(() => assert.notStrictEqual(1, 2)).not.toThrow();
      expect(() => assert.notStrictEqual(1, '1')).not.toThrow();
    });

    it('throws for strictly equal values', () => {
      expect(() => assert.notStrictEqual(1, 1)).toThrow(AssertionError);
    });
  });

  describe('assert.deepStrictEqual()', () => {
    it('passes for deeply equal objects', () => {
      expect(() => assert.deepStrictEqual({ a: 1 }, { a: 1 })).not.toThrow();
      expect(() => assert.deepStrictEqual([1, 2], [1, 2])).not.toThrow();
    });

    it('passes for deeply equal arrays', () => {
      expect(() => assert.deepStrictEqual([1, [2, 3]], [1, [2, 3]])).not.toThrow();
    });

    it('passes for equal Maps', () => {
      const map1 = new Map([['a', 1], ['b', 2]]);
      const map2 = new Map([['a', 1], ['b', 2]]);
      expect(() => assert.deepStrictEqual(map1, map2)).not.toThrow();
    });

    it('passes for equal Sets', () => {
      const set1 = new Set([1, 2, 3]);
      const set2 = new Set([1, 2, 3]);
      expect(() => assert.deepStrictEqual(set1, set2)).not.toThrow();
    });

    it('throws for non-deeply equal objects', () => {
      expect(() => assert.deepStrictEqual({ a: 1 }, { a: 2 })).toThrow(AssertionError);
      expect(() => assert.deepStrictEqual([1, 2], [1, 3])).toThrow(AssertionError);
    });
  });

  describe('assert.throws()', () => {
    it('passes when function throws', () => {
      expect(() => assert.throws(() => { throw new Error('test'); })).not.toThrow();
    });

    it('throws when function does not throw', () => {
      expect(() => assert.throws(() => {})).toThrow(AssertionError);
    });

    it('validates error message with RegExp', () => {
      expect(() => assert.throws(
        () => { throw new Error('test error'); },
        /test/
      )).not.toThrow();
    });

    it('validates error type', () => {
      expect(() => assert.throws(
        () => { throw new TypeError('test'); },
        TypeError
      )).not.toThrow();
    });

    it('validates error properties', () => {
      const err = new Error('test');
      err.code = 'ERR_TEST';
      expect(() => assert.throws(
        () => { throw err; },
        { message: 'test', code: 'ERR_TEST' }
      )).not.toThrow();
    });
  });

  describe('assert.doesNotThrow()', () => {
    it('passes when function does not throw', () => {
      expect(() => assert.doesNotThrow(() => {})).not.toThrow();
    });

    it('throws when function throws', () => {
      expect(() => assert.doesNotThrow(() => { throw new Error('test'); })).toThrow(AssertionError);
    });
  });

  describe('assert.rejects()', () => {
    it('passes when promise rejects', async () => {
      await expect(assert.rejects(Promise.reject(new Error('test')))).resolves.not.toThrow();
    });

    it('throws when promise resolves', async () => {
      await expect(assert.rejects(Promise.resolve())).rejects.toThrow(AssertionError);
    });

    it('validates rejection message with RegExp', async () => {
      await expect(assert.rejects(
        Promise.reject(new Error('test error')),
        /test/
      )).resolves.not.toThrow();
    });
  });

  describe('assert.doesNotReject()', () => {
    it('passes when promise resolves', async () => {
      await expect(assert.doesNotReject(Promise.resolve())).resolves.not.toThrow();
    });

    it('throws when promise rejects', async () => {
      await expect(assert.doesNotReject(Promise.reject(new Error('test')))).rejects.toThrow(AssertionError);
    });
  });

  describe('assert.fail()', () => {
    it('throws AssertionError', () => {
      expect(() => assert.fail()).toThrow(AssertionError);
    });

    it('throws with custom message', () => {
      expect(() => assert.fail('Custom failure')).toThrow('Custom failure');
    });
  });

  describe('assert.match()', () => {
    it('passes when string matches regexp', () => {
      expect(() => assert.match('hello world', /world/)).not.toThrow();
    });

    it('throws when string does not match', () => {
      expect(() => assert.match('hello', /world/)).toThrow(AssertionError);
    });
  });

  describe('assert.doesNotMatch()', () => {
    it('passes when string does not match regexp', () => {
      expect(() => assert.doesNotMatch('hello', /world/)).not.toThrow();
    });

    it('throws when string matches', () => {
      expect(() => assert.doesNotMatch('hello world', /world/)).toThrow(AssertionError);
    });
  });

  describe('assert.ifError()', () => {
    it('passes for null or undefined', () => {
      expect(() => assert.ifError(null)).not.toThrow();
      expect(() => assert.ifError(undefined)).not.toThrow();
    });

    it('throws for truthy values', () => {
      expect(() => assert.ifError(new Error('test'))).toThrow(Error);
      expect(() => assert.ifError('error')).toThrow(AssertionError);
    });
  });

  describe('AssertionError', () => {
    it('creates error with correct properties', () => {
      const err = new AssertionError({
        message: 'test',
        actual: 1,
        expected: 2,
        operator: '===',
      });
      expect(err.name).toBe('AssertionError');
      expect(err.actual).toBe(1);
      expect(err.expected).toBe(2);
      expect(err.operator).toBe('===');
      expect(err.code).toBe('ERR_ASSERTION');
    });
  });
});
