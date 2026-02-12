/**
 * Browser-compatible child_process shim
 * This version throws errors for commands since shell execution isn't supported in browser
 */

import { EventEmitter } from './events.js';
import { Readable, Writable } from './stream.js';

export function initChildProcess() {}

export function exec(command, optionsOrCallback, callback) {
  let cb;
  if (typeof optionsOrCallback === 'function') {
    cb = optionsOrCallback;
  } else {
    cb = callback;
  }

  const child = new ChildProcess();
  setTimeout(() => {
    const error = new Error(`exec is not supported in browser environment: ${command}`);
    child.emit('error', error);
    if (cb) cb(error, '', '');
  }, 0);

  return child;
}

export function execSync(command, _options) {
  throw new Error(`execSync is not supported in browser environment: ${command}`);
}

export function spawn(command, args, options) {
  const child = new ChildProcess();
  setTimeout(() => {
    const error = new Error(`spawn is not supported in browser environment: ${command}`);
    child.emit('error', error);
  }, 0);

  return child;
}

export function spawnSync(command, _args, _options) {
  throw new Error(`spawnSync is not supported in browser environment: ${command}`);
}

export function execFile(file, args, options, callback) {
  let cb;
  if (typeof args === 'function') {
    cb = args;
  } else if (typeof options === 'function') {
    cb = options;
  } else {
    cb = callback;
  }

  const child = new ChildProcess();
  setTimeout(() => {
    const error = new Error(`execFile is not supported in browser environment: ${file}`);
    child.emit('error', error);
    if (cb) cb(error, '', '');
  }, 0);

  return child;
}

export function fork() {
  throw new Error('fork is not supported in browser environment');
}

export class ChildProcess extends EventEmitter {
  constructor() {
    super();
    this.pid = Math.floor(Math.random() * 10000) + 1000;
    this.connected = false;
    this.killed = false;
    this.exitCode = null;
    this.signalCode = null;
    this.spawnargs = [];
    this.spawnfile = '';
    this.stdin = new Writable();
    this.stdout = new Readable();
    this.stderr = new Readable();
  }

  kill(signal) {
    this.killed = true;
    this.emit('exit', null, signal || 'SIGTERM');
    return true;
  }

  disconnect() {
    this.connected = false;
  }

  send(_message, callback) {
    if (callback) callback(new Error('IPC not supported'));
    return false;
  }

  ref() { return this; }
  unref() { return this; }
}

export default {
  exec,
  execSync,
  execFile,
  spawn,
  spawnSync,
  fork,
  ChildProcess,
  initChildProcess,
};
