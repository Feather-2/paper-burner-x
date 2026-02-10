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
 * @returns {{ exec: Function, execSync: Function, _commands: object, _parseCommand: Function }}
 */
export function createChildProcessShim(config) {
  const { vfs, evaluate, env = {}, cwd = '' } = config;
  void env;

  function resolvePath(p) {
    if (!p) return cwd;
    if (p.startsWith('/')) return normalizeVfsPath(p);
    return normalizeVfsPath(cwd ? cwd + '/' + p : p);
  }

  function parseCommand(cmd) {
    const parts = cmd.trim().split(/\s+/);
    return { name: parts[0], args: parts.slice(1) };
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
        const result = await evaluate(code, script);
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
    const handler = commands[name];
    if (!handler) {
      const err = new Error(`command not found: ${name}`);
      if (callback) callback(err, '', `command not found: ${name}`);
      return;
    }
    handler(args)
      .then(r => callback?.(r.exitCode === 0 ? null : new Error(r.stderr), r.stdout, r.stderr))
      .catch(e => callback?.(e, '', e.message));
  }

  function execSync() {
    throw new Error('execSync is not available in browser sandbox. Use exec() instead.');
  }

  return { exec, execSync, _commands: commands, _parseCommand: parseCommand };
}
