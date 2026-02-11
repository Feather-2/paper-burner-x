import { describe, it, expect, beforeEach } from 'vitest';
import { createREPL } from '../../../../../js/agents/core/node-compat/repl.js';

describe('createREPL', () => {
  /** @type {import('../../../../../js/agents/core/node-compat/repl.js').ReplContext} */
  let repl;

  beforeEach(() => {
    repl = createREPL();
  });

  it('evaluates expressions and returns result', () => {
    const r = repl.eval('1 + 1');
    expect(r).toEqual({ ok: true, value: 2 });
  });

  it('persists variables across eval calls', () => {
    repl.eval('var x = 10');
    const r = repl.eval('x * 2');
    expect(r).toEqual({ ok: true, value: 20 });
  });

  it('converts const/let to var for persistence', () => {
    repl.eval('const a = 3');
    const r1 = repl.eval('a');
    expect(r1).toEqual({ ok: true, value: 3 });

    repl.eval('let b = 7');
    const r2 = repl.eval('b');
    expect(r2).toEqual({ ok: true, value: 7 });
  });

  it('returns ok:false on syntax error without breaking state', () => {
    repl.eval('var x = 5');
    const bad = repl.eval('if (');
    expect(bad.ok).toBe(false);
    expect(typeof bad.error).toBe('string');

    // subsequent eval still works
    const r = repl.eval('x + 1');
    expect(r).toEqual({ ok: true, value: 6 });
  });

  it('makes injected globals available', () => {
    const r = createREPL({ globals: { answer: 42 } });
    expect(r.eval('answer')).toEqual({ ok: true, value: 42 });
  });

  it('resets scope to initial globals', () => {
    const r = createREPL({ globals: { g: 1 } });
    r.eval('var x = 99');
    expect(r.scope.x).toBe(99);

    r.reset();
    expect(r.scope).toEqual({ g: 1 });
  });

  it('returns a snapshot of current scope', () => {
    repl.eval('var a = 1');
    repl.eval('var b = 2');
    const snap = repl.scope;
    expect(snap).toEqual({ a: 1, b: 2 });

    // snapshot is detached — mutating it does not affect repl
    snap.a = 999;
    expect(repl.scope.a).toBe(1);
  });

  it('supports function definitions and subsequent calls', () => {
    repl.eval('var add = function(a, b) { return a + b; }');
    const r = repl.eval('add(1, 2)');
    expect(r).toEqual({ ok: true, value: 3 });
  });

  it('handles multi-line code', () => {
    const code = [
      'var x = 10;',
      'var y = 20;',
      'var z = x + y;',
    ].join('\n');
    repl.eval(code);
    const r = repl.eval('z');
    expect(r).toEqual({ ok: true, value: 30 });
  });
});
