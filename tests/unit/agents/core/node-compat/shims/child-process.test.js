import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryVfs } from '../../../../../../js/agents/vfs/vfs.memory.js';
import { createChildProcessShim } from '../../../../../../js/agents/core/sandbox/shims/child-process.js';

describe('createChildProcessShim', () => {
  /** @type {MemoryVfs} */
  let vfs;
  /** @type {ReturnType<typeof createChildProcessShim>} */
  let cp;

  beforeEach(async () => {
    vfs = new MemoryVfs();
    await vfs.writeText('hello.txt', 'hello world');
    await vfs.mkdir('subdir');
    await vfs.writeText('subdir/nested.txt', 'nested content');
    cp = createChildProcessShim({ vfs, cwd: '' });
  });

  /** Helper: promisify exec */
  function run(cmd) {
    return new Promise((resolve) => {
      cp.exec(cmd, (err, stdout, stderr) => {
        resolve({ err, stdout, stderr });
      });
    });
  }

  it('echo returns stdout', async () => {
    const { err, stdout } = await run('echo foo bar');
    expect(err).toBeNull();
    expect(stdout).toBe('foo bar\n');
  });

  it('cat reads a VFS file', async () => {
    const { err, stdout } = await run('cat hello.txt');
    expect(err).toBeNull();
    expect(stdout).toBe('hello world');
  });

  it('ls lists directory contents', async () => {
    const { err, stdout } = await run('ls');
    expect(err).toBeNull();
    expect(stdout).toContain('hello.txt');
    expect(stdout).toContain('subdir');
  });

  it('mkdir creates a directory', async () => {
    const { err } = await run('mkdir -p newdir');
    expect(err).toBeNull();
    const stat = await vfs.stat('newdir');
    expect(stat.isDirectory()).toBe(true);
  });

  it('rm deletes a file', async () => {
    const { err } = await run('rm hello.txt');
    expect(err).toBeNull();
    const exists = await vfs.exists('hello.txt');
    expect(exists).toBe(false);
  });

  it('rm -r recursively deletes a directory', async () => {
    const { err } = await run('rm -r subdir');
    expect(err).toBeNull();
    const exists = await vfs.exists('subdir');
    expect(exists).toBe(false);
  });

  it('cp copies a file', async () => {
    const { err } = await run('cp hello.txt copy.txt');
    expect(err).toBeNull();
    const content = await vfs.readText('copy.txt');
    expect(content).toBe('hello world');
  });

  it('mv moves a file', async () => {
    const { err } = await run('mv hello.txt moved.txt');
    expect(err).toBeNull();
    const content = await vfs.readText('moved.txt');
    expect(content).toBe('hello world');
    const exists = await vfs.exists('hello.txt');
    expect(exists).toBe(false);
  });

  it('node executes a VFS script via evaluate', async () => {
    await vfs.writeText('script.js', 'return 42;');
    const evaluate = vi.fn().mockResolvedValue(42);
    const cpWithEval = createChildProcessShim({ vfs, evaluate, cwd: '' });
    const { err, stdout } = await new Promise((resolve) => {
      cpWithEval.exec('node script.js', (e, out, serr) => resolve({ err: e, stdout: out, stderr: serr }));
    });
    expect(err).toBeNull();
    expect(stdout).toBe('42');
    expect(evaluate).toHaveBeenCalledWith('return 42;', 'script.js');
  });

  it('unknown command returns exitCode 127', async () => {
    const { err, stderr } = await run('foobar');
    expect(err).toBeInstanceOf(Error);
    expect(stderr).toContain('command not found');
  });

  it('execSync throws an error', () => {
    expect(() => cp.execSync('echo hi')).toThrow('execSync is not available in browser sandbox');
  });

  it('cat on a missing file returns stderr', async () => {
    const { err, stderr } = await run('cat nonexistent.txt');
    expect(err).toBeInstanceOf(Error);
    expect(stderr).toBeTruthy();
  });

  it('exec callback format is correct', async () => {
    const { err, stdout, stderr } = await run('echo test');
    expect(err).toBeNull();
    expect(typeof stdout).toBe('string');
    expect(typeof stderr).toBe('string');
  });
});
