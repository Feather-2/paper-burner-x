import { normalizeVfsPath } from '../../../vfs/path.js';

/**
 * @typedef {object} ChildProcessConfig
 * @property {object} vfs - VFS instance
 * @property {(code: string, filename: string) => Promise<*>} [evaluate] - JS executor
 * @property {Record<string, string>} [env={}] - Environment variables
 * @property {string} [cwd=''] - Working directory
 */

/**
 * @typedef {object} ExecResult
 * @property {string} stdout
 * @property {string} stderr
 * @property {number} exitCode
 */

/**
 * Create a browser-side child_process shim.
 * @param {ChildProcessConfig} config
 * @returns {{
 *   exec: Function,
 *   execSync: Function,
 *   _commands: object,
 *   _parseCommand: Function,
 *   _resolveCommandPath: (commandName: string) => Promise<string>,
 *   _getCommandSearchPaths: () => string[]
 * }}
 */
export function createChildProcessShim(config) {
  const { vfs, evaluate, env = {}, cwd = '' } = config;

  function resolvePath(p) {
    if (!p) return cwd;
    if (p.startsWith('/')) return normalizeVfsPath(p);
    return normalizeVfsPath(cwd ? cwd + '/' + p : p);
  }

  function parseCommand(cmd) {
    const parts = cmd.trim().split(/\s+/);
    return { name: parts[0], args: parts.slice(1) };
  }

  /**
   * @param {string} source
   * @returns {string}
   */
  function stripShebang(source) {
    if (typeof source !== 'string') return '';
    return source.replace(/^#![^\n]*(\n|$)/, '');
  }

  /**
   * @param {string|undefined} value
   * @returns {string[]}
   */
  function splitPathEntries(value) {
    if (typeof value !== 'string' || value.trim().length === 0) return [];
    return value
      .split(/[;:]/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  /**
   * @returns {string[]}
   */
  function getCommandSearchPaths() {
    /** @type {string[]} */
    const paths = [];
    const seen = new Set();

    /**
     * @param {string} value
     * @returns {void}
     */
    const addPath = (value) => {
      if (typeof value !== 'string' || value.trim().length === 0) return;
      let normalized = '';
      try {
        normalized = resolvePath(value);
      } catch {
        return;
      }
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      paths.push(normalized);
    };

    addPath('node_modules/.bin');
    addPath('/node_modules/.bin');

    for (const entry of splitPathEntries(env.PATH)) {
      addPath(entry);
    }

    return paths;
  }

  /**
   * @param {string} path
   * @returns {Promise<boolean>}
   */
  async function isFile(path) {
    if (typeof vfs.stat === 'function') {
      try {
        const stat = await vfs.stat(path);
        if (stat && typeof stat.isFile === 'function') {
          return stat.isFile();
        }
        if (stat && typeof stat.isDirectory === 'function') {
          return !stat.isDirectory();
        }
        return !!stat;
      } catch {
        return false;
      }
    }

    if (typeof vfs.exists === 'function') {
      try {
        return !!(await vfs.exists(path));
      } catch {
        return false;
      }
    }

    if (typeof vfs.readText === 'function') {
      try {
        await vfs.readText(path);
        return true;
      } catch {
        return false;
      }
    }

    return false;
  }

  /**
   * @param {string} commandName
   * @returns {Promise<string>}
   */
  async function resolveCommandPath(commandName) {
    const normalizedCommand = String(commandName || '').trim();
    if (!normalizedCommand) return '';

    if (normalizedCommand.includes('/')) {
      let directPath = '';
      try {
        directPath = resolvePath(normalizedCommand);
      } catch {
        return '';
      }
      return (await isFile(directPath)) ? directPath : '';
    }

    for (const basePath of getCommandSearchPaths()) {
      let candidatePath = '';
      try {
        candidatePath = normalizeVfsPath(`${basePath}/${normalizedCommand}`);
      } catch {
        continue;
      }
      if (await isFile(candidatePath)) return candidatePath;
    }

    return '';
  }

  /** @type {Record<string, (args: string[]) => Promise<ExecResult>>} */
  const commands = {
    echo: async (args) => ({ stdout: args.join(' ') + '\n', stderr: '', exitCode: 0 }),

    cat: async (args) => {
      try {
        const path = resolvePath(args[0]);
        const content = await vfs.readText(path);
        return { stdout: content, stderr: '', exitCode: 0 };
      } catch (e) { return { stdout: '', stderr: e.message, exitCode: 1 }; }
    },

    ls: async (args) => {
      try {
        const dir = args[0] ? resolvePath(args[0]) : cwd;
        const entries = await vfs.readdir(dir);
        return { stdout: entries.join('\n') + '\n', stderr: '', exitCode: 0 };
      } catch (e) { return { stdout: '', stderr: e.message, exitCode: 1 }; }
    },

    mkdir: async (args) => {
      try {
        const recursive = args.includes('-p');
        const dir = resolvePath(args.filter(a => a !== '-p')[0]);
        await vfs.mkdir(dir, { recursive });
        return { stdout: '', stderr: '', exitCode: 0 };
      } catch (e) { return { stdout: '', stderr: e.message, exitCode: 1 }; }
    },

    rm: async (args) => {
      try {
        const recursive = args.includes('-r') || args.includes('-rf');
        const path = resolvePath(args.filter(a => !a.startsWith('-'))[0]);
        if (recursive) await vfs.rmdir(path, { recursive: true });
        else await vfs.unlink(path);
        return { stdout: '', stderr: '', exitCode: 0 };
      } catch (e) { return { stdout: '', stderr: e.message, exitCode: 1 }; }
    },

    cp: async (args) => {
      try {
        const src = resolvePath(args[args.length - 2]);
        const dest = resolvePath(args[args.length - 1]);
        await vfs.copy(src, dest);
        return { stdout: '', stderr: '', exitCode: 0 };
      } catch (e) { return { stdout: '', stderr: e.message, exitCode: 1 }; }
    },

    mv: async (args) => {
      try {
        const src = resolvePath(args[0]);
        const dest = resolvePath(args[1]);
        await vfs.move(src, dest);
        return { stdout: '', stderr: '', exitCode: 0 };
      } catch (e) { return { stdout: '', stderr: e.message, exitCode: 1 }; }
    },

    node: async (args) => {
      if (!evaluate) return { stdout: '', stderr: 'node: evaluate function not configured', exitCode: 1 };
      try {
        const script = resolvePath(args[0]);
        const code = await vfs.readText(script);
        const result = await evaluate(stripShebang(code), script);
        return { stdout: result !== undefined ? String(result) : '', stderr: '', exitCode: 0 };
      } catch (e) { return { stdout: '', stderr: e.message, exitCode: 1 }; }
    },
  };

  /**
   * @param {string} cmd
   * @param {object|Function} [options]
   * @param {Function} [callback]
   */
  function exec(cmd, options, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    const { name, args } = parseCommand(cmd);
    Promise.resolve()
      .then(async () => {
        const handler = commands[name];
        if (handler) return handler(args);

        const commandPath = await resolveCommandPath(name);
        if (!commandPath) {
          return { stdout: '', stderr: `command not found: ${name}`, exitCode: 127 };
        }

        return commands.node([commandPath, ...args]);
      })
      .then(r => callback?.(r.exitCode === 0 ? null : new Error(r.stderr), r.stdout, r.stderr))
      .catch(e => callback?.(e, '', e.message));
  }

  function execSync() {
    throw new Error('execSync is not available in browser sandbox. Use exec() instead.');
  }

  return {
    exec,
    execSync,
    _commands: commands,
    _parseCommand: parseCommand,
    _resolveCommandPath: resolveCommandPath,
    _getCommandSearchPaths: getCommandSearchPaths,
  };
}
