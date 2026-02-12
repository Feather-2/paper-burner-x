/**
 * @file Runtime ESM → CJS regex transformer for browser-side module system.
 * Covers common ESM patterns via ordered regex replacements.
 */

/* eslint-disable no-plusplus */

/**
 * Detect whether code contains ESM syntax (top-level import/export).
 * @param {string} code
 * @returns {boolean}
 */
export function hasESMSyntax(code) {
  return /^\s*(import\s|export\s)/m.test(code) ||
    /import\.meta\b/.test(code) ||
    /\bimport\(/.test(code);
}

/**
 * Transform ESM code to CJS. Returns code unchanged if no ESM syntax detected.
 * @param {string} code
 * @param {string} [filename='<anonymous>']
 * @returns {string}
 */
export function transformESMtoCJS(code, filename = '<anonymous>') {
  if (!hasESMSyntax(code)) return code;

  let _counter = 0;
  const _protected = [];
  let out = code;

  /** Stash a literal/comment and return a placeholder. */
  function protect(match) {
    const idx = _protected.length;
    _protected.push(match);
    return `___PROT_${idx}___`;
  }

  /** Resolve a placeholder back to its original string. */
  function restore(ph) {
    const m = /___PROT_(\d+)___/.exec(ph);
    return m ? _protected[Number(m[1])] : ph;
  }

  // --- Protect string literals and comments ---
  out = out.replace(/`(?:[^`\\]|\\.)*`/gs, protect);
  out = out.replace(/"(?:[^"\\]|\\.)*"/g, protect);
  out = out.replace(/'(?:[^'\\]|\\.)*'/g, protect);
  out = out.replace(/\/\/[^\n]*/g, protect);
  out = out.replace(/\/\*[\s\S]*?\*\//g, protect);

  // --- Collect exported declaration names from protected code ---
  const exportedDecls = [];
  const defaultExportNames = [];
  let rm;

  const SCAN_EXPORT_DECL = /^export\s+(const|let|var|function|class)\s+(\w+)/gm;
  while ((rm = SCAN_EXPORT_DECL.exec(out)) !== null) {
    exportedDecls.push(rm[2]);
  }
  const SCAN_DEF_FUNC = /^export\s+default\s+function\s+(\w+)/gm;
  while ((rm = SCAN_DEF_FUNC.exec(out)) !== null) {
    defaultExportNames.push(rm[1]);
  }
  const SCAN_DEF_CLASS = /^export\s+default\s+class\s+(\w+)/gm;
  while ((rm = SCAN_DEF_CLASS.exec(out)) !== null) {
    defaultExportNames.push(rm[1]);
  }

  // --- Transform imports ---

  // Named imports: import { a, b as c } from 'x'
  out = out.replace(
    /^import\s+\{([^}]+)\}\s+from\s+(___PROT_\d+___);?$/gm,
    (_, names, ph) => {
      const spec = names.split(',').map(n => {
        const parts = n.trim().split(/\s+as\s+/);
        return parts.length === 2
          ? `${parts[0].trim()}: ${parts[1].trim()}`
          : parts[0].trim();
      }).join(', ');
      return `const { ${spec} } = require(${restore(ph)});`;
    }
  );

  // Star import: import * as x from 'y'
  out = out.replace(
    /^import\s+\*\s+as\s+(\w+)\s+from\s+(___PROT_\d+___);?$/gm,
    (_, name, ph) => `const ${name} = require(${restore(ph)});`
  );

  // Default import: import x from 'y'
  out = out.replace(
    /^import\s+(\w+)\s+from\s+(___PROT_\d+___);?$/gm,
    (_, name, ph) => {
      const tmp = `_$imp_${_counter++}`;
      return `const ${tmp} = require(${restore(ph)}); const ${name} = ${tmp}.default !== undefined ? ${tmp}.default : ${tmp};`;
    }
  );

  // Side-effect import: import 'x'
  out = out.replace(
    /^import\s+(___PROT_\d+___);?$/gm,
    (_, ph) => `require(${restore(ph)});`
  );

  // --- Transform exports ---

  // export default function name
  out = out.replace(
    /^export\s+default\s+function\s+(\w+)/gm,
    (_, name) => `function ${name}`
  );

  // export default class name
  out = out.replace(
    /^export\s+default\s+class\s+(\w+)/gm,
    (_, name) => `class ${name}`
  );

  // export default <expr>
  out = out.replace(
    /^export\s+default\s+/gm,
    'module.exports = '
  );

  // export const/let/var name
  out = out.replace(
    /^export\s+(const|let|var)\s+(\w+)/gm,
    (_, decl, name) => `${decl} ${name}`
  );

  // export function/class name
  out = out.replace(
    /^export\s+(function|class)\s+(\w+)/gm,
    (_, kind, name) => `${kind} ${name}`
  );

  // Named export list: export { a, b as c }
  out = out.replace(
    /^export\s+\{([^}]+)\};?$/gm,
    (_, names) => names.split(',').map(n => {
      const parts = n.trim().split(/\s+as\s+/);
      if (parts.length === 2) {
        return `module.exports.${parts[1].trim()} = ${parts[0].trim()};`;
      }
      return `module.exports.${parts[0].trim()} = ${parts[0].trim()};`;
    }).join(' ')
  );

  // --- Re-exports ---

  // export * from 'module'
  out = out.replace(
    /^export\s+\*\s+from\s+(___PROT_\d+___);?$/gm,
    (_, ph) => `Object.assign(module.exports, require(${restore(ph)}));`
  );

  // --- Misc transforms ---

  // import.meta (specific before bare)
  const _dir = filename.includes('/') ? filename.slice(0, filename.lastIndexOf('/')) : '';
  out = out.replace(/import\.meta\.url/g, `"file://${filename}"`);
  out = out.replace(/import\.meta\.dirname/g, `"${_dir}"`);
  out = out.replace(/import\.meta\.filename/g, `"${filename}"`);
  out = out.replace(/import\.meta\b/g, `({ url: "file://${filename}", dirname: "${_dir}", filename: "${filename}" })`);

  // Dynamic import: import(x) → __dynamicImport(x)
  out = out.replace(/\bimport\(([^)]+)\)/g, '__dynamicImport($1)');

  // --- Append module.exports for exported declarations ---
  if (exportedDecls.length > 0) {
    out += '\n' + exportedDecls.map(n => `module.exports.${n} = ${n};`).join('\n');
  }
  if (defaultExportNames.length > 0) {
    out += '\n' + defaultExportNames.map(n => `module.exports = ${n};`).join('\n');
  }

  // --- __esModule marker ---
  out = 'Object.defineProperty(exports, "__esModule", { value: true });\n' + out;

  // --- Restore protected tokens ---
  out = out.replace(/___PROT_(\d+)___/g, (_, idx) => _protected[Number(idx)]);

  return out;
}
