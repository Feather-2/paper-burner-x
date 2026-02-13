import { describe, it, expect, vi } from 'vitest';
import childProcessShim, {
  initChildProcess,
  exec,
  execSync,
  spawn,
  spawnSync,
  execFile,
  fork,
  ChildProcess,
} from '../../../../../../js/agents/core/node-compat/shims/child_process-browser.js';

async function captureChildError(child) {
  return new Promise(resolve => {
    child.once('error', resolve);
  });
}

describe('child_process-browser shim', () => {
  it('initChildProcess is callable', () => {
    expect(initChildProcess()).toBeUndefined();
  });

  it('ChildProcess initializes with browser-safe defaults', () => {
    const child = new ChildProcess();
    expect(child.pid).toBeGreaterThanOrEqual(1000);
    expect(child.pid).toBeLessThanOrEqual(10999);
    expect(child.connected).toBe(false);
    expect(child.killed).toBe(false);
    expect(child.exitCode).toBeNull();
    expect(child.signalCode).toBeNull();
    expect(child.spawnargs).toEqual([]);
    expect(child.spawnfile).toBe('');
    expect(child.stdin).toBeDefined();
    expect(child.stdout).toBeDefined();
    expect(child.stderr).toBeDefined();
  });

  it('ChildProcess.kill marks process killed and emits exit', () => {
    const child = new ChildProcess();
    const onExit = vi.fn();
    child.on('exit', onExit);

    expect(child.kill()).toBe(true);
    expect(child.killed).toBe(true);
    expect(onExit).toHaveBeenCalledWith(null, 'SIGTERM');

    child.kill('SIGKILL');
    expect(onExit).toHaveBeenLastCalledWith(null, 'SIGKILL');
  });

  it('ChildProcess.disconnect/send/ref/unref handle no-IPC behavior', () => {
    const child = new ChildProcess();
    child.connected = true;
    child.disconnect();
    expect(child.connected).toBe(false);

    const callback = vi.fn();
    expect(child.send({ hello: 'world' }, callback)).toBe(false);
    expect(callback).toHaveBeenCalledWith(expect.any(Error));
    expect(callback.mock.calls[0][0].message).toContain('IPC not supported');

    expect(() => child.send({})).not.toThrow();
    expect(child.ref()).toBe(child);
    expect(child.unref()).toBe(child);
  });

  it('exec emits async error and supports callback as second arg', async () => {
    const callback = vi.fn();
    const child = exec('echo hello', callback);

    const error = await captureChildError(child);
    expect(error.message).toContain('exec is not supported in browser environment: echo hello');
    expect(callback).toHaveBeenCalledWith(error, '', '');
  });

  it('exec supports callback as third arg (options + callback)', async () => {
    const callback = vi.fn();
    const child = exec('pwd', { timeout: 1 }, callback);

    const error = await captureChildError(child);
    expect(error.message).toContain('exec is not supported in browser environment: pwd');
    expect(callback).toHaveBeenCalledWith(error, '', '');
  });

  it('exec works without callback when error listener is present', async () => {
    const child = exec('whoami');
    const error = await captureChildError(child);
    expect(error.message).toContain('exec is not supported in browser environment: whoami');
  });

  it('execSync throws unsupported error', () => {
    expect(() => execSync('echo hi')).toThrow('execSync is not supported in browser environment: echo hi');
  });

  it('spawn emits async error and returns ChildProcess', async () => {
    const child = spawn('node', ['script.js'], { stdio: 'pipe' });
    expect(child).toBeInstanceOf(ChildProcess);

    const error = await captureChildError(child);
    expect(error.message).toContain('spawn is not supported in browser environment: node');
  });

  it('spawnSync throws unsupported error', () => {
    expect(() => spawnSync('node', ['script.js'])).toThrow('spawnSync is not supported in browser environment: node');
  });

  it('execFile supports callback in args position', async () => {
    const callback = vi.fn();
    const child = execFile('script.js', callback);

    const error = await captureChildError(child);
    expect(error.message).toContain('execFile is not supported in browser environment: script.js');
    expect(callback).toHaveBeenCalledWith(error, '', '');
  });

  it('execFile supports callback in options position', async () => {
    const callback = vi.fn();
    const child = execFile('script.js', ['--flag'], callback);

    const error = await captureChildError(child);
    expect(error.message).toContain('execFile is not supported in browser environment: script.js');
    expect(callback).toHaveBeenCalledWith(error, '', '');
  });

  it('execFile supports callback as fourth arg', async () => {
    const callback = vi.fn();
    const child = execFile('script.js', ['--flag'], { cwd: '/tmp' }, callback);

    const error = await captureChildError(child);
    expect(error.message).toContain('execFile is not supported in browser environment: script.js');
    expect(callback).toHaveBeenCalledWith(error, '', '');
  });

  it('execFile works without callback when error listener is present', async () => {
    const child = execFile('script.js', ['--flag'], { cwd: '/tmp' });
    const error = await captureChildError(child);
    expect(error.message).toContain('execFile is not supported in browser environment: script.js');
  });

  it('fork throws unsupported error', () => {
    expect(() => fork()).toThrow('fork is not supported in browser environment');
  });

  it('default export contains all public APIs', async () => {
    expect(childProcessShim.exec).toBe(exec);
    expect(childProcessShim.execSync).toBe(execSync);
    expect(childProcessShim.execFile).toBe(execFile);
    expect(childProcessShim.spawn).toBe(spawn);
    expect(childProcessShim.spawnSync).toBe(spawnSync);
    expect(childProcessShim.fork).toBe(fork);
    expect(childProcessShim.ChildProcess).toBe(ChildProcess);
    expect(childProcessShim.initChildProcess).toBe(initChildProcess);

    const child = childProcessShim.exec('echo via default');
    const error = await captureChildError(child);
    expect(error.message).toContain('exec is not supported in browser environment: echo via default');
  });
});
