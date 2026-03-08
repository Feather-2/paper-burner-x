/**
 * @fileoverview Node.js `os` module shim for browser sandbox.
 */

const FALLBACK_TOTAL_MEM = 512 * 1024 * 1024;

function estimateTotalMem() {
  const navigatorWithMemory = /** @type {Navigator & { deviceMemory?: number }} */ (globalThis.navigator);
  const deviceMemory = Number(navigatorWithMemory?.deviceMemory);
  if (Number.isFinite(deviceMemory) && deviceMemory > 0) {
    return Math.floor(deviceMemory * 1024 * 1024 * 1024);
  }
  return FALLBACK_TOTAL_MEM;
}

function estimateCpuCount() {
  const hc = Number(globalThis.navigator?.hardwareConcurrency);
  if (Number.isFinite(hc) && hc > 0) return Math.floor(hc);
  return 1;
}

export function platform() { return 'browser'; }
export function arch() { return 'wasm'; }
export function homedir() { return '/home/user'; }
export function tmpdir() { return '/tmp'; }
export function hostname() { return 'localhost'; }
export function type() { return 'Browser'; }
export function release() { return '1.0.0'; }
export function uptime() { return Math.floor(performance.now() / 1000); }
export function totalmem() { return estimateTotalMem(); }
export function freemem() { return Math.floor(totalmem() * 0.5); }
export function cpus() {
  const count = estimateCpuCount();
  return Array.from({ length: count }, (_, index) => ({
    model: 'Virtual CPU',
    speed: 2000,
    times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
    id: index,
  }));
}
export function networkInterfaces() { return {}; }
export function userInfo() { return { username: 'user', homedir: '/home/user', shell: '/bin/sh', uid: 1000, gid: 1000 }; }
export function loadavg() { return [0, 0, 0]; }
export function endianness() { return 'LE'; }

export function getResourceModel() {
  return {
    source: 'browser-stub',
    estimated: true,
    totalmem: totalmem(),
    cpuCount: cpus().length,
  };
}

export const EOL = '\n';
export const devNull = '/dev/null';
export const constants = { signals: {}, errno: {} };

export default {
  platform, arch, homedir, tmpdir, hostname, type, release, uptime,
  totalmem, freemem, cpus, networkInterfaces, userInfo, loadavg,
  endianness, getResourceModel, EOL, devNull, constants,
};
