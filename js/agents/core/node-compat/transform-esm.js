/**
 * @file Runtime ESM → CJS AST-based transformer for browser-side module system.
 * Uses acorn parser for robust syntax tree transformation.
 */

/* eslint-disable no-plusplus */

let _acorn = null;

/**
 * Lazy-load acorn parser.
 * @returns {Promise<Function>}
 */
async function getAcorn() {
  if (_acorn) return _acorn;
  try {
    const acorn = await import('acorn');
    _acorn = acorn.parse;
    return _acorn;
  } catch {
    return null;
  }
}

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
 * Transform ESM code to CJS using AST parsing.
 * @param {string} code
 * @param {string} [filename='<anonymous>']
 * @returns {Promise<string>}
 */
export async function transformESMtoCJS(code, filename = '<anonymous>') {
  if (!hasESMSyntax(code)) return code;

  const parse = await getAcorn();
  if (!parse) {
    // Fallback to regex-based transformation if acorn not available
    return transformESMtoCJSRegex(code, filename);
  }

  try {
    const ast = parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      locations: true,
    });

    const chunks = [];
    const exportedNames = new Set();
    let defaultExportName = null;
    let counter = 0;

    // Add __esModule marker
    chunks.push('Object.defineProperty(exports, "__esModule", { value: true });\n');

    // Process each top-level statement
    for (const node of ast.body) {
      const start = node.start;
      const end = node.end;
      const nodeCode = code.slice(start, end);

      if (node.type === 'ImportDeclaration') {
        // Transform import statements
        const source = node.source.value;
        const specifiers = node.specifiers;

        if (specifiers.length === 0) {
          // Side-effect import: import 'module'
          chunks.push(`require(${JSON.stringify(source)});\n`);
        } else {
          const parts = [];
          let hasDefault = false;
          let hasNamespace = false;
          const named = [];

          for (const spec of specifiers) {
            if (spec.type === 'ImportDefaultSpecifier') {
              hasDefault = true;
              const local = spec.local.name;
              const tmp = `_$imp_${counter++}`;
              parts.push(`const ${tmp} = require(${JSON.stringify(source)});`);
              parts.push(`const ${local} = ${tmp}.default !== undefined ? ${tmp}.default : ${tmp};`);
            } else if (spec.type === 'ImportNamespaceSpecifier') {
              hasNamespace = true;
              const local = spec.local.name;
              parts.push(`const ${local} = require(${JSON.stringify(source)});`);
            } else if (spec.type === 'ImportSpecifier') {
              const imported = spec.imported.name;
              const local = spec.local.name;
              named.push(imported === local ? imported : `${imported}: ${local}`);
            }
          }

          if (named.length > 0 && !hasDefault && !hasNamespace) {
            parts.push(`const { ${named.join(', ')} } = require(${JSON.stringify(source)});`);
          } else if (named.length > 0) {
            const tmp = `_$imp_${counter++}`;
            parts.unshift(`const ${tmp} = require(${JSON.stringify(source)});`);
            parts.push(`const { ${named.join(', ')} } = ${tmp};`);
          }

          chunks.push(parts.join(' ') + '\n');
        }
      } else if (node.type === 'ExportNamedDeclaration') {
        if (node.declaration) {
          // export const/let/var/function/class
          const decl = node.declaration;
          const declCode = code.slice(decl.start, decl.end);
          chunks.push(declCode + '\n');

          if (decl.type === 'VariableDeclaration') {
            for (const declarator of decl.declarations) {
              if (declarator.id.type === 'Identifier') {
                exportedNames.add(declarator.id.name);
              }
            }
          } else if (decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') {
            if (decl.id) {
              exportedNames.add(decl.id.name);
            }
          }
        } else if (node.specifiers.length > 0) {
          // export { a, b as c }
          for (const spec of node.specifiers) {
            const local = spec.local.name;
            const exported = spec.exported.name;
            chunks.push(`module.exports.${exported} = ${local};\n`);
          }
        } else if (node.source) {
          // export { a } from 'module'
          const source = node.source.value;
          const tmp = `_$exp_${counter++}`;
          chunks.push(`const ${tmp} = require(${JSON.stringify(source)});\n`);
          for (const spec of node.specifiers) {
            const imported = spec.local.name;
            const exported = spec.exported.name;
            chunks.push(`module.exports.${exported} = ${tmp}.${imported};\n`);
          }
        }
      } else if (node.type === 'ExportDefaultDeclaration') {
        const decl = node.declaration;
        if (decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') {
          if (decl.id) {
            // export default function name() {}
            const declCode = code.slice(decl.start, decl.end);
            chunks.push(declCode + '\n');
            defaultExportName = decl.id.name;
          } else {
            // export default function() {}
            const declCode = code.slice(decl.start, decl.end);
            chunks.push(`module.exports = ${declCode};\n`);
          }
        } else {
          // export default expression
          const exprCode = code.slice(decl.start, decl.end);
          chunks.push(`module.exports = ${exprCode};\n`);
        }
      } else if (node.type === 'ExportAllDeclaration') {
        // export * from 'module'
        const source = node.source.value;
        chunks.push(`Object.assign(module.exports, require(${JSON.stringify(source)}));\n`);
      } else {
        // Regular statement
        chunks.push(nodeCode + '\n');
      }
    }

    // Append module.exports for named exports
    for (const name of exportedNames) {
      chunks.push(`module.exports.${name} = ${name};\n`);
    }

    // Append default export if named function/class
    if (defaultExportName) {
      chunks.push(`module.exports = ${defaultExportName};\n`);
    }

    // Handle import.meta
    const _dir = filename.includes('/') ? filename.slice(0, filename.lastIndexOf('/')) : '';
    let result = chunks.join('');
    result = result.replace(/import\.meta\.url/g, `"file://${filename}"`);
    result = result.replace(/import\.meta\.dirname/g, `"${_dir}"`);
    result = result.replace(/import\.meta\.filename/g, `"${filename}"`);
    result = result.replace(/import\.meta\b/g, `({ url: "file://${filename}", dirname: "${_dir}", filename: "${filename}" })`);

    // Handle dynamic import
    result = result.replace(/\bimport\(([^)]+)\)/g, '__dynamicImport($1)');

    return result;
  } catch (err) {
    // Parse error - fallback to regex
    return transformESMtoCJSRegex(code, filename);
  }
}

/**
 * Regex-based fallback transformation (original implementation).
 * @param {string} code
 * @param {string} [filename='<anonymous>']
 * @returns {string}
 */
function transformESMtoCJSRegex(code, filename = '<anonymous>') {
  let _counter = 0;
  const _protected = [];
  let out = code;

  function protect(match) {
    const idx = _protected.length;
    _protected.push(match);
    return `___PROT_${idx}___`;
  }

  function restore(ph) {
    const m = /___PROT_(\d+)___/.exec(ph);
    return m ? _protected[Number(m[1])] : ph;
  }

  out = out.replace(/`(?:[^`\\]|\\.)*`/gs, protect);
  out = out.replace(/"(?:[^"\\]|\\.)*"/g, protect);
  out = out.replace(/'(?:[^'\\]|\\.)*'/g, protect);
  out = out.replace(/\/\/[^\n]*/g, protect);
  out = out.replace(/\/\*[\s\S]*?\*\//g, protect);

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

  out = out.replace(
    /^import\s+\*\s+as\s+(\w+)\s+from\s+(___PROT_\d+___);?$/gm,
    (_, name, ph) => `const ${name} = require(${restore(ph)});`
  );

  out = out.replace(
    /^import\s+(\w+)\s+from\s+(___PROT_\d+___);?$/gm,
    (_, name, ph) => {
      const tmp = `_$imp_${_counter++}`;
      return `const ${tmp} = require(${restore(ph)}); const ${name} = ${tmp}.default !== undefined ? ${tmp}.default : ${tmp};`;
    }
  );

  out = out.replace(
    /^import\s+(___PROT_\d+___);?$/gm,
    (_, ph) => `require(${restore(ph)});`
  );

  out = out.replace(
    /^export\s+default\s+function\s+(\w+)/gm,
    (_, name) => `function ${name}`
  );

  out = out.replace(
    /^export\s+default\s+class\s+(\w+)/gm,
    (_, name) => `class ${name}`
  );

  out = out.replace(
    /^export\s+default\s+/gm,
    'module.exports = '
  );

  out = out.replace(
    /^export\s+(const|let|var)\s+(\w+)/gm,
    (_, decl, name) => `${decl} ${name}`
  );

  out = out.replace(
    /^export\s+(function|class)\s+(\w+)/gm,
    (_, kind, name) => `${kind} ${name}`
  );

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

  out = out.replace(
    /^export\s+\*\s+from\s+(___PROT_\d+___);?$/gm,
    (_, ph) => `Object.assign(module.exports, require(${restore(ph)}));`
  );

  const _dir = filename.includes('/') ? filename.slice(0, filename.lastIndexOf('/')) : '';
  out = out.replace(/import\.meta\.url/g, `"file://${filename}"`);
  out = out.replace(/import\.meta\.dirname/g, `"${_dir}"`);
  out = out.replace(/import\.meta\.filename/g, `"${filename}"`);
  out = out.replace(/import\.meta\b/g, `({ url: "file://${filename}", dirname: "${_dir}", filename: "${filename}" })`);

  out = out.replace(/\bimport\(([^)]+)\)/g, '__dynamicImport($1)');

  if (exportedDecls.length > 0) {
    out += '\n' + exportedDecls.map(n => `module.exports.${n} = ${n};`).join('\n');
  }
  if (defaultExportNames.length > 0) {
    out += '\n' + defaultExportNames.map(n => `module.exports = ${n};`).join('\n');
  }

  out = 'Object.defineProperty(exports, "__esModule", { value: true });\n' + out;

  out = out.replace(/___PROT_(\d+)___/g, (_, idx) => _protected[Number(idx)]);

  return out;
}
