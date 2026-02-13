/**
 * REPL context with persistent variable scope across eval calls.
 *
 * Uses Function constructor + eval trick to capture var declarations
 * while keeping a shared context object between invocations.
 *
 * @module repl
 */

import { createLogger } from '../../shared/utils/logger.js';

const logger = createLogger('node-compat/repl');

// ── Types ────────────────────────────────────────────────────

/**
 * @typedef {object} ReplResult
 * @property {boolean} ok
 * @property {*} [value]  - expression evaluation result
 * @property {string} [error] - error message
 */

/**
 * @typedef {object} ReplContext
 * @property {(code: string) => ReplResult} eval  - execute code
 * @property {() => void} reset                   - reset scope
 * @property {Record<string, *>} scope            - readonly snapshot
 */

// ── Helpers ──────────────────────────────────────────────────

const VAR_DECL_RE = /\bvar\s+(\w+)/g;

/**
 * Extract variable names declared with `var` from transformed code.
 * @param {string} code
 * @returns {string[]}
 */
function extractVarNames(code) {
  const names = [];
  for (const m of code.matchAll(VAR_DECL_RE)) {
    if (!names.includes(m[1])) names.push(m[1]);
  }
  return names;
}

// ── Public API ───────────────────────────────────────────────

/**
 * Create a REPL context.
 *
 * @param {object} [options]
 * @param {Record<string, *>} [options.globals] - injected globals
 * @returns {ReplContext}
 */
export function createREPL(options = {}) {
  const { globals = {} } = options;
  /** @type {Record<string, *>} */
  let ctx = { ...globals };

  /**
   * @param {string} code
   * @returns {ReplResult}
   */
  function evalCode(code) {
    try {
      const keys = Object.keys(ctx);
      const vals = keys.map(k => ctx[k]);

      // 1. Try as expression first
      try {
        // eslint-disable-next-line no-new-func
        const exprFn = new Function(...keys, `return (${code})`);
        const result = exprFn(...vals);
        return { ok: true, value: result };
      } catch (err) {
        logger.debug('Code is not an expression, trying as statement', { error: err.message });
      }

      // 2. Execute as statement(s) — const/let → var for persistence
      const transformed = code.replace(/\b(const|let)\s+/g, 'var ');
      const varNames = extractVarNames(transformed);

      // Build collector lines for each declared var
      const collector = varNames.map(
        n => `try { __v[${JSON.stringify(n)}] = eval(${JSON.stringify(n)}); } catch(_) {}`
      ).join('\n');

      // eslint-disable-next-line no-new-func
      const stmtFn = new Function(...keys, `
        var __v = {};
        eval(${JSON.stringify(transformed)});
        ${collector}
        return __v;
      `);

      const newVars = stmtFn(...vals);
      Object.assign(ctx, newVars);
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  function reset() {
    ctx = { ...globals };
  }

  return {
    eval: evalCode,
    reset,
    get scope() { return { ...ctx }; },
  };
}
