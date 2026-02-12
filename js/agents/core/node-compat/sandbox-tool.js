/**
 * @file Sandbox-backed code execution tool for ToolExecutor.
 *
 * Creates an `execute_code` tool that runs JavaScript in an isolated
 * Node.js-compatible environment (createNodeEnv + VFS + require).
 */

import { createNodeEnv } from './create-node-env.js';
import { createRequire } from './require.js';
import { createBuiltinModules } from './shims/index.js';
import { createIframeEvalBridge, isBrowserWithDOM } from '../sandbox/iframe-eval-bridge.js';

const CONSOLE_METHODS = ['log', 'warn', 'error', 'info', 'debug'];

/**
 * Parse npm package specifier (`name` or `name@version`) with scoped support.
 * @param {string} pkg
 * @returns {{ name: string, version: string | undefined }}
 */
function parseInstallSpecifier(pkg) {
  const value = String(pkg || '').trim();
  const atIdx = value.lastIndexOf('@');

  if (atIdx <= 0) {
    return { name: value, version: undefined };
  }

  return {
    name: value.slice(0, atIdx),
    version: value.slice(atIdx + 1) || undefined,
  };
}

/**
 * Convert console arguments to a single output line.
 * @param {unknown[]} args
 * @returns {string}
 */
function formatConsoleOutput(args) {
  const list = Array.isArray(args) ? args : [args];
  return list.map((item) => String(item)).join(' ');
}

/**
 * @typedef {object} SandboxToolConfig
 * @property {object} [vfs] - VFS instance; creates MemoryVfs if omitted
 * @property {Record<string, string>} [env] - Environment variables
 * @property {number} [timeout=30000] - Execution timeout in ms
 * @property {(method: string, args: unknown[]) => void} [onConsole] - Console callback
 * @property {object} [packageManager] - PackageManager for npm install
 */

/**
 * Tool definition for ToolExecutor registration.
 */
export const SANDBOX_TOOL_DEFINITION = {
  name: 'execute_code',
  description: 'Execute JavaScript code in an isolated Node.js-compatible sandbox with npm support.',
  parameters: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'JavaScript code to execute' },
      filename: { type: 'string', description: 'Virtual filename (default: "main.js")' },
      install: {
        type: 'array',
        items: { type: 'string' },
        description: 'npm packages to install before execution',
      },
    },
    required: ['code'],
  },
};

/**
 * Create a sandbox-backed execute_code tool for ToolExecutor.
 *
 * @param {SandboxToolConfig} [config]
 * @returns {{ definition: typeof SANDBOX_TOOL_DEFINITION, handler: Function }}
 */
export function createSandboxTool(config = {}) {
  const {
    timeout = 30000,
    env = {},
    onConsole,
    packageManager,
  } = config;

  let _env = null;
  let _require = null;
  let _iframeBridge = null;
  /** @type {string[] | null} */
  let _activeOutput = null;

  const hostConsole = typeof console !== 'undefined' ? console : null;
  const captureConsole = {};

  const emitConsole = (method, args) => {
    if (_activeOutput) {
      _activeOutput.push(formatConsoleOutput(args));
    }
    if (typeof onConsole === 'function') {
      onConsole(method, args);
    }
  };

  for (const method of CONSOLE_METHODS) {
    captureConsole[method] = (...args) => {
      emitConsole(method, args);
      hostConsole?.[method]?.(...args);
    };
  }

  async function getEnv() {
    if (_env) return { env: _env, require: _require };

    _env = await createNodeEnv({
      vfs: config.vfs,
      env,
      onConsole: emitConsole,
      timeout,
    });

    const builtinModules = createBuiltinModules({ vfs: _env.vfs });

    // Browser: route eval through sandboxed iframe (allow-scripts only,
    // no allow-same-origin) to prevent prototype-chain escape to host globalThis.
    // Node.js: no iframe available; reject host-side eval for security.
    let evaluate;
    if (isBrowserWithDOM()) {
      _iframeBridge = createIframeEvalBridge({ timeout, onConsole: emitConsole });
      evaluate = async (code, _filename) => {
        const result = await _iframeBridge.evaluate(code, _filename);
        if (!result.ok) throw new Error(result.error || 'iframe eval failed');
        return result.value;
      };
    } else {
      evaluate = async () => {
        throw new Error(
          'Code execution requires a browser sandbox (iframe). ' +
          'Node.js host-side eval is disabled for security.'
        );
      };
    }

    const { require: req } = createRequire({
      vfs: _env.vfs,
      builtinModules,
      evaluate,
      globals: {
        process: builtinModules.process,
        console: captureConsole,
        Buffer: builtinModules.buffer?.Buffer,
      },
    });

    _require = req;
    return { env: _env, require: _require };
  }

  /**
   * @param {{ code: string, filename?: string, install?: string[] }} args
   * @returns {Promise<{ success: boolean, output: string, error?: string }>}
   */
  async function handler(args) {
    const { code, filename = 'main.js', install } = args;
    const output = [];
    _activeOutput = output;

    try {
      const { env: nodeEnv, require: req } = await getEnv();

      if (install && install.length > 0 && packageManager) {
        for (const pkg of install) {
          const { name, version } = parseInstallSpecifier(pkg);
          await packageManager.install(name, { version: version || 'latest' });
        }
      }

      await nodeEnv.vfs.writeText(filename, code);

      try {
        const result = await req('./' + filename.replace(/^\.\//, ''));
        return {
          success: true,
          output: output.join('\n'),
          result: result !== undefined ? result : null,
        };
      } catch (err) {
        return {
          success: false,
          output: output.join('\n'),
          error: err instanceof Error ? err.message : String(err),
        };
      }
    } finally {
      _activeOutput = null;
    }
  }

  handler.dispose = async () => {
    if (_iframeBridge) {
      _iframeBridge.dispose();
      _iframeBridge = null;
    }
    if (_env) {
      await _env.dispose();
      _env = null;
      _require = null;
    }
  };

  return {
    definition: SANDBOX_TOOL_DEFINITION,
    handler,
    description: SANDBOX_TOOL_DEFINITION.description,
    parameters: SANDBOX_TOOL_DEFINITION.parameters,
  };
}
