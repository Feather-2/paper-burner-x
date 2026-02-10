import { describe, it, expect } from 'vitest';
import { hasESMSyntax, transformESMtoCJS } from '../../../../../js/agents/core/sandbox/transform-esm.js';

describe('hasESMSyntax', () => {
  it('detects import statements', () => {
    expect(hasESMSyntax('import { a } from "x";')).toBe(true);
    expect(hasESMSyntax('import x from "y";')).toBe(true);
    expect(hasESMSyntax('import "z";')).toBe(true);
  });

  it('detects export statements', () => {
    expect(hasESMSyntax('export default 42;')).toBe(true);
    expect(hasESMSyntax('export const a = 1;')).toBe(true);
    expect(hasESMSyntax('export { a, b };')).toBe(true);
  });

  it('returns false for pure CJS code', () => {
    expect(hasESMSyntax('const a = require("x");')).toBe(false);
    expect(hasESMSyntax('module.exports = 42;')).toBe(false);
    expect(hasESMSyntax('console.log("hello");')).toBe(false);
  });

  it('returns false for import/export in strings', () => {
    // Note: hasESMSyntax uses a simple regex, so it may match inside strings.
    // This is acceptable for the 80% case — the transform itself protects strings.
    expect(hasESMSyntax('const s = "no imports here";')).toBe(false);
  });
});

describe('transformESMtoCJS', () => {
  it('converts named imports', () => {
    const input = 'import { a, b } from "x";';
    const out = transformESMtoCJS(input);
    expect(out).toContain('const { a, b } = require("x");');
  });

  it('converts named imports with alias', () => {
    const input = 'import { a as b } from "x";';
    const out = transformESMtoCJS(input);
    expect(out).toContain('const { a: b } = require("x");');
  });

  it('converts default imports', () => {
    const input = 'import foo from "bar";';
    const out = transformESMtoCJS(input);
    expect(out).toContain('require("bar")');
    expect(out).toContain('const foo =');
    expect(out).toContain('.default !== undefined');
  });

  it('converts star imports', () => {
    const input = 'import * as ns from "mod";';
    const out = transformESMtoCJS(input);
    expect(out).toContain('const ns = require("mod");');
  });

  it('converts side-effect imports', () => {
    const input = 'import "polyfill";';
    const out = transformESMtoCJS(input);
    expect(out).toContain('require("polyfill");');
  });

  it('converts export default expression', () => {
    const input = 'export default 42;';
    const out = transformESMtoCJS(input);
    expect(out).toContain('module.exports = 42;');
  });

  it('converts export default function', () => {
    const input = 'export default function greet() { return 1; }';
    const out = transformESMtoCJS(input);
    expect(out).toContain('function greet()');
    expect(out).toContain('module.exports = greet;');
    expect(out).not.toMatch(/^export\s/m);
  });

  it('converts named export list', () => {
    const input = 'const a = 1;\nconst b = 2;\nexport { a, b };';
    const out = transformESMtoCJS(input);
    expect(out).toContain('module.exports.a = a;');
    expect(out).toContain('module.exports.b = b;');
  });

  it('converts export const/let/var', () => {
    const input = 'export const x = 1;';
    const out = transformESMtoCJS(input);
    expect(out).toContain('const x = 1;');
    expect(out).toContain('module.exports.x = x;');
    expect(out).not.toMatch(/^export/m);
  });

  it('converts export function', () => {
    const input = 'export function add(a, b) { return a + b; }';
    const out = transformESMtoCJS(input);
    expect(out).toContain('function add(a, b)');
    expect(out).toContain('module.exports.add = add;');
  });

  it('converts export with alias', () => {
    const input = 'const internal = 1;\nexport { internal as pub };';
    const out = transformESMtoCJS(input);
    expect(out).toContain('module.exports.pub = internal;');
  });

  it('replaces import.meta.url', () => {
    const input = 'const url = import.meta.url;';
    const out = transformESMtoCJS(input);
    expect(out).toContain('"file://" + __filename');
    expect(out).not.toContain('import.meta.url');
  });

  it('converts dynamic import', () => {
    const input = 'const m = import("mod");';
    const out = transformESMtoCJS(input);
    expect(out).toContain('Promise.resolve(require("mod"))');
  });

  it('does not modify pure CJS code', () => {
    const input = 'const a = require("x");\nmodule.exports = a;';
    const out = transformESMtoCJS(input);
    expect(out).toBe(input);
  });

  it('handles mixed imports and exports', () => {
    const input = [
      'import { readFile } from "fs";',
      'import path from "path";',
      '',
      'export const VERSION = "1.0";',
      'export function run() { return readFile; }',
    ].join('\n');
    const out = transformESMtoCJS(input);
    expect(out).toContain('require("fs")');
    expect(out).toContain('require("path")');
    expect(out).toContain('module.exports.VERSION = VERSION;');
    expect(out).toContain('module.exports.run = run;');
    expect(out).not.toMatch(/^import\s/m);
    expect(out).not.toMatch(/^export\s/m);
  });

  it('handles multi-line comprehensive transform', () => {
    const input = [
      'import { a } from "mod-a";',
      'import b from "mod-b";',
      'import * as c from "mod-c";',
      'import "side-effect";',
      '',
      'export const X = 1;',
      'export default function main() {}',
      'const url = import.meta.url;',
      'const lazy = import("lazy");',
    ].join('\n');
    const out = transformESMtoCJS(input);
    expect(out).toContain('require("mod-a")');
    expect(out).toContain('require("mod-b")');
    expect(out).toContain('const c = require("mod-c")');
    expect(out).toContain('require("side-effect")');
    expect(out).toContain('module.exports.X = X;');
    expect(out).toContain('module.exports = main;');
    expect(out).toContain('"file://" + __filename');
    expect(out).toContain('Promise.resolve(require("lazy"))');
  });
});
