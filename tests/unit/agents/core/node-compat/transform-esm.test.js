import { describe, it, expect } from 'vitest';
import { hasESMSyntax, transformESMtoCJS } from '../../../../../js/agents/core/node-compat/transform-esm.js';

describe('hasESMSyntax', () => {
  it('detects import statements', async () => {
    expect(hasESMSyntax('import { a } from "x";')).toBe(true);
    expect(hasESMSyntax('import x from "y";')).toBe(true);
    expect(hasESMSyntax('import "z";')).toBe(true);
  });

  it('detects export statements', async () => {
    expect(hasESMSyntax('export default 42;')).toBe(true);
    expect(hasESMSyntax('export const a = 1;')).toBe(true);
    expect(hasESMSyntax('export { a, b };')).toBe(true);
  });

  it('detects import.meta', async () => {
    expect(hasESMSyntax('const u = import.meta.url;')).toBe(true);
    expect(hasESMSyntax('console.log(import.meta.dirname);')).toBe(true);
  });

  it('detects dynamic import', async () => {
    expect(hasESMSyntax('const m = import("x");')).toBe(true);
  });

  it('returns false for pure CJS code', async () => {
    expect(hasESMSyntax('const a = require("x");')).toBe(false);
    expect(hasESMSyntax('module.exports = 42;')).toBe(false);
    expect(hasESMSyntax('console.log("hello");')).toBe(false);
  });

  it('returns false for import/export in strings', async () => {
    expect(hasESMSyntax('const s = "no imports here";')).toBe(false);
  });
});

describe('transformESMtoCJS', () => {
  it('converts named imports', async () => {
    const input = 'import { a, b } from "x";';
    const out = await transformESMtoCJS(input);
    expect(out).toContain('const { a, b } = require("x");');
  });

  it('converts named imports with alias', async () => {
    const input = 'import { a as b } from "x";';
    const out = await transformESMtoCJS(input);
    expect(out).toContain('const { a: b } = require("x");');
  });

  it('converts default imports', async () => {
    const input = 'import foo from "bar";';
    const out = await transformESMtoCJS(input);
    expect(out).toContain('require("bar")');
    expect(out).toContain('const foo =');
    expect(out).toContain('.default !== undefined');
  });

  it('converts star imports', async () => {
    const input = 'import * as ns from "mod";';
    const out = await transformESMtoCJS(input);
    expect(out).toContain('const ns = require("mod");');
  });

  it('converts side-effect imports', async () => {
    const input = 'import "polyfill";';
    const out = await transformESMtoCJS(input);
    expect(out).toContain('require("polyfill");');
  });

  it('converts export default expression', async () => {
    const input = 'export default 42;';
    const out = await transformESMtoCJS(input);
    expect(out).toContain('module.exports = 42;');
  });

  it('converts export default function', async () => {
    const input = 'export default function greet() { return 1; }';
    const out = await transformESMtoCJS(input);
    expect(out).toContain('function greet()');
    expect(out).toContain('module.exports = greet;');
    expect(out).not.toMatch(/^export\s/m);
  });

  it('converts named export list', async () => {
    const input = 'const a = 1;\nconst b = 2;\nexport { a, b };';
    const out = await transformESMtoCJS(input);
    expect(out).toContain('module.exports.a = a;');
    expect(out).toContain('module.exports.b = b;');
  });

  it('converts export const/let/var', async () => {
    const input = 'export const x = 1;';
    const out = await transformESMtoCJS(input);
    expect(out).toContain('const x = 1;');
    expect(out).toContain('module.exports.x = x;');
    expect(out).not.toMatch(/^export/m);
  });

  it('converts export function', async () => {
    const input = 'export function add(a, b) { return a + b; }';
    const out = await transformESMtoCJS(input);
    expect(out).toContain('function add(a, b)');
    expect(out).toContain('module.exports.add = add;');
  });

  it('converts export class', async () => {
    const input = 'export class Foo { constructor() {} }';
    const out = await transformESMtoCJS(input);
    expect(out).toContain('class Foo');
    expect(out).toContain('module.exports.Foo = Foo;');
    expect(out).not.toMatch(/^export/m);
  });

  it('converts export with alias', async () => {
    const input = 'const internal = 1;\nexport { internal as pub };';
    const out = await transformESMtoCJS(input);
    expect(out).toContain('module.exports.pub = internal;');
  });

  it('replaces import.meta.url with file URL', async () => {
    const input = 'const url = import.meta.url;';
    const out = await transformESMtoCJS(input);
    expect(out).toContain('"file://<anonymous>"');
    expect(out).not.toContain('import.meta.url');
  });

  it('replaces import.meta.url with custom filename', async () => {
    const input = 'const url = import.meta.url;';
    const out = await transformESMtoCJS(input, 'src/lib/utils.js');
    expect(out).toContain('"file://src/lib/utils.js"');
  });

  it('replaces import.meta.dirname', async () => {
    const input = 'const d = import.meta.dirname;';
    const out = await transformESMtoCJS(input, 'src/lib/utils.js');
    expect(out).toContain('"src/lib"');
    expect(out).not.toContain('import.meta.dirname');
  });

  it('replaces import.meta.dirname with empty dir for root file', async () => {
    const input = 'const d = import.meta.dirname;';
    const out = await transformESMtoCJS(input, 'utils.js');
    expect(out).toContain('""');
  });

  it('replaces import.meta.filename', async () => {
    const input = 'const f = import.meta.filename;';
    const out = await transformESMtoCJS(input, 'src/lib/utils.js');
    expect(out).toContain('"src/lib/utils.js"');
    expect(out).not.toContain('import.meta.filename');
  });

  it('replaces bare import.meta with object', async () => {
    const input = 'const m = import.meta;';
    const out = await transformESMtoCJS(input, 'src/app.js');
    expect(out).toContain('url: "file://src/app.js"');
    expect(out).toContain('dirname: "src"');
    expect(out).toContain('filename: "src/app.js"');
    expect(out).not.toContain('import.meta');
  });

  it('converts dynamic import to __dynamicImport', async () => {
    const input = 'const m = import("mod");';
    const out = await transformESMtoCJS(input);
    expect(out).toContain('__dynamicImport("mod")');
    expect(out).not.toContain('import(');
  });

  it('adds __esModule marker', async () => {
    const input = 'export const x = 1;';
    const out = await transformESMtoCJS(input);
    expect(out).toMatch(/^Object\.defineProperty\(exports, "__esModule"/);
  });

  it('converts export * from re-export', async () => {
    const input = 'export * from "utils";';
    const out = await transformESMtoCJS(input);
    expect(out).toContain('Object.assign(module.exports, require("utils"))');
    expect(out).not.toMatch(/^export/m);
  });

  it('ignores export-like text inside protected literals/comments when collecting export names', async () => {
    const input = [
      'import "polyfill";',
      'const template = `',
      'export const fake = 1;',
      '`;',
      '// export const alsoFake = 2;',
      'export const real = 3;',
    ].join('\n');
    const out = await transformESMtoCJS(input);
    expect(out).toContain('module.exports.real = real;');
    expect(out).not.toContain('module.exports.fake = fake;');
    expect(out).not.toContain('module.exports.alsoFake = alsoFake;');
  });

  it('does not modify pure CJS code', async () => {
    const input = 'const a = require("x");\nmodule.exports = a;';
    const out = await transformESMtoCJS(input);
    expect(out).toBe(input);
  });

  it('handles mixed imports and exports', async () => {
    const input = [
      'import { readFile } from "fs";',
      'import path from "path";',
      '',
      'export const VERSION = "1.0";',
      'export function run() { return readFile; }',
    ].join('\n');
    const out = await transformESMtoCJS(input);
    expect(out).toContain('require("fs")');
    expect(out).toContain('require("path")');
    expect(out).toContain('module.exports.VERSION = VERSION;');
    expect(out).toContain('module.exports.run = run;');
    expect(out).not.toMatch(/^import\s/m);
    expect(out).not.toMatch(/^export\s/m);
  });

  it('handles multi-line comprehensive transform', async () => {
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
    const out = await transformESMtoCJS(input);
    expect(out).toContain('require("mod-a")');
    expect(out).toContain('require("mod-b")');
    expect(out).toContain('const c = require("mod-c")');
    expect(out).toContain('require("side-effect")');
    expect(out).toContain('module.exports.X = X;');
    expect(out).toContain('module.exports = main;');
    expect(out).toContain('"file://<anonymous>"');
    expect(out).toContain('__dynamicImport("lazy")');
    expect(out).toContain('__esModule');
  });
});
