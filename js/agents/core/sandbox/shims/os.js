/**
 * @fileoverview Node.js `os` module shim for browser sandbox.
 * Returns safe static values suitable for a sandboxed environment.
 */

export function platform() { return 'browser'; }
export function arch() { return 'wasm'; }
export function homedir() { return '/home/user'; }
export function tmpdir() { return '/tmp'; }
export function hostname() { return 'localhost'; }
export function type() { return 'Browser'; }
export function release() { return '1.0.0'; }
export function uptime() { return Math.floor(performance.now() / 1000); }
export function totalmem() { return 536870912; }
export function freemem() { return 268435456; }
export function cpus() { return [{ model: 'Virtual CPU', speed: 2000 }]; }
export function networkInterfaces() { return {}; }
export function userInfo() { return { username: 'user', homedir: '/home/user', shell: '/bin/sh', uid: 1000, gid: 1000 }; }
export function loadavg() { return [0, 0, 0]; }
export function endianness() { return 'LE'; }

export const EOL = '\n';
export const devNull = '/dev/null';
export const constants = { signals: {}, errno: {} };

export default {
  platform, arch, homedir, tmpdir, hostname, type, release, uptime,
  totalmem, freemem, cpus, networkInterfaces, userInfo, loadavg,
  endianness, EOL, devNull, constants,
};
