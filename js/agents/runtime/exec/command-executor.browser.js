/**
 * Command Executor - Browser Stub
 *
 * Browser environments do not support child_process.
 * All functions throw UnsupportedError when called.
 */

/**
 * @typedef {import('./command-executor.node.js').ExecResult} ExecResult
 * @typedef {import('./command-executor.node.js').ExecOptions} ExecOptions
 */

const UNSUPPORTED_MSG = "Command execution is not supported in browser environments";

/**
 * @param {string} _command
 * @param {string[]} [_args]
 * @param {ExecOptions} [_options]
 * @returns {Promise<ExecResult>}
 */
export async function exec(_command, _args = [], _options = {}) {
  return {
    success: false,
    exitCode: -1,
    signal: null,
    stdout: "",
    stderr: "",
    duration: 0,
    timedOut: false,
    truncated: false,
    error: UNSUPPORTED_MSG,
  };
}

/**
 * @param {string} _command
 * @param {ExecOptions} [_options]
 * @returns {Promise<ExecResult>}
 */
export async function execShell(_command, _options = {}) {
  return exec(_command, [], _options);
}

/**
 * @param {string} _command
 * @param {string[]} [_args]
 * @param {ExecOptions} [_options]
 * @returns {Promise<string>}
 */
export async function execSimple(_command, _args = [], _options = {}) {
  throw new Error(UNSUPPORTED_MSG);
}

/**
 * @param {string} _command
 * @returns {Promise<boolean>}
 */
export async function commandExists(_command) {
  return false;
}

export default { exec, execShell, execSimple, commandExists };
