import { beforeEach, describe, expect, it, vi } from 'vitest';

const execCommandMock = vi.hoisted(() => vi.fn());
const getPlatformMock = vi.hoisted(() => vi.fn());
const sandboxBackendMock = vi.hoisted(() => ({
  PERMISSION_ONLY: 'permission-only',
}));

vi.mock('../../../../../../js/agents/core/sandbox/system/detect.js', () => ({
  execCommand: execCommandMock,
  getPlatform: getPlatformMock,
}));

vi.mock('../../../../../../js/agents/core/sandbox/system/constants.js', () => ({
  SandboxBackend: sandboxBackendMock,
}));

async function loadPermissionModule() {
  return await import('../../../../../../js/agents/core/sandbox/system/permission.js');
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.resetModules();
  execCommandMock.mockReset();
  getPlatformMock.mockReset();
  getPlatformMock.mockReturnValue('linux');
});

describe('executeWithPermission', () => {
  it.each([undefined, null])('throws when options is %s', async (options) => {
    const { executeWithPermission } = await loadPermissionModule();
    await expect(executeWithPermission('ls', [], options)).rejects.toThrow();
  });

  it.each([
    ['empty object', {}],
    ['empty string workDir', { workDir: '' }],
    ['null workDir', { workDir: null }],
    ['undefined workDir', { workDir: undefined }],
    ['zero workDir', { workDir: 0 }],
  ])('throws when workDir is missing (%s)', async (_label, options) => {
    const { executeWithPermission } = await loadPermissionModule();
    await expect(executeWithPermission('ls', [], options)).rejects.toThrow(
      'workDir is required for permission-only executor'
    );
  });

  it('denies by default when permission handler is not provided', async () => {
    const { executeWithPermission } = await loadPermissionModule();

    const result = await executeWithPermission('ls', [], { workDir: '/tmp' });

    expect(result).toEqual({
      code: 1,
      stdout: '',
      stderr: 'Permission denied by user',
      killed: false,
      backend: sandboxBackendMock.PERMISSION_ONLY,
    });
    expect(execCommandMock).not.toHaveBeenCalled();
  });

  it('calls permission handler and executes when allowed once', async () => {
    execCommandMock.mockResolvedValue({ code: 0, stdout: 'ok', stderr: '' });

    const permissionHandler = vi.fn(async (request) => {
      expect(request).toMatchObject({
        type: 'shell',
        command: 'echo',
        args: [],
        workDir: '/tmp',
      });
      return 'allow-once';
    });

    const { executeWithPermission } = await loadPermissionModule();
    const result = await executeWithPermission('echo', [], {
      workDir: '/tmp',
      permissionHandler,
    });

    expect(permissionHandler).toHaveBeenCalledTimes(1);
    expect(execCommandMock).toHaveBeenCalledWith('echo', [], { timeout: 60000 });
    expect(result).toMatchObject({
      code: 0,
      stdout: 'ok',
      stderr: '',
      killed: false,
      backend: sandboxBackendMock.PERMISSION_ONLY,
    });
  });

  it('skips permission checks when skipPermission is true', async () => {
    execCommandMock.mockResolvedValue({ code: 0, stdout: '', stderr: '' });

    const permissionHandler = vi.fn(async () => 'deny');
    const { executeWithPermission } = await loadPermissionModule();

    const result = await executeWithPermission('echo', null, {
      workDir: '/tmp',
      permissionHandler,
      skipPermission: true,
    });

    expect(permissionHandler).not.toHaveBeenCalled();
    expect(execCommandMock).toHaveBeenCalledWith('echo', null, { timeout: 60000 });
    expect(result.backend).toBe(sandboxBackendMock.PERMISSION_ONLY);
  });

  it('caches allow-always decisions when sharing allowedPatterns set', async () => {
    execCommandMock.mockResolvedValue({ code: 0, stdout: '', stderr: '' });

    const permissionHandler = vi.fn().mockResolvedValueOnce('allow-always');
    const allowedPatterns = new Set();

    const { executeWithPermission } = await loadPermissionModule();

    await executeWithPermission('echo', ['hi'], {
      workDir: '/tmp',
      permissionHandler,
      allowedPatterns,
    });
    await executeWithPermission('echo', ['hi'], {
      workDir: '/tmp',
      permissionHandler,
      allowedPatterns,
    });

    expect(permissionHandler).toHaveBeenCalledTimes(1);
    expect(execCommandMock).toHaveBeenCalledTimes(2);
  });

  it('does not cache allow-always without allowedPatterns set', async () => {
    execCommandMock.mockResolvedValue({ code: 0, stdout: '', stderr: '' });

    const permissionHandler = vi.fn().mockResolvedValue('allow-always');

    const { executeWithPermission } = await loadPermissionModule();

    await executeWithPermission('echo', ['hi'], { workDir: '/tmp', permissionHandler });
    await executeWithPermission('echo', ['hi'], { workDir: '/tmp', permissionHandler });

    expect(permissionHandler).toHaveBeenCalledTimes(2);
    expect(execCommandMock).toHaveBeenCalledTimes(2);
  });

  it('does not cache allow-once decisions', async () => {
    execCommandMock.mockResolvedValue({ code: 0, stdout: '', stderr: '' });

    const permissionHandler = vi.fn().mockResolvedValue('allow-once');

    const { executeWithPermission } = await loadPermissionModule();

    await executeWithPermission('echo', ['hi'], { workDir: '/tmp', permissionHandler });
    await executeWithPermission('echo', ['hi'], { workDir: '/tmp', permissionHandler });

    expect(permissionHandler).toHaveBeenCalledTimes(2);
    expect(execCommandMock).toHaveBeenCalledTimes(2);
  });

  it('handles concurrent calls independently', async () => {
    execCommandMock.mockResolvedValue({ code: 0, stdout: '', stderr: '' });

    const permissionHandler = vi.fn().mockResolvedValue('allow-once');
    const { executeWithPermission } = await loadPermissionModule();

    const [first, second] = await Promise.all([
      executeWithPermission('echo', ['a'], { workDir: '/tmp', permissionHandler }),
      executeWithPermission('echo', ['b'], { workDir: '/tmp', permissionHandler }),
    ]);

    expect(permissionHandler).toHaveBeenCalledTimes(2);
    expect(execCommandMock).toHaveBeenCalledTimes(2);
    expect(first.code).toBe(0);
    expect(second.code).toBe(0);
  });

  it.each([
    [124, true],
    [137, true],
    [0, false],
  ])('sets killed flag for exit code %s', async (code, killed) => {
    execCommandMock.mockResolvedValue({ code, stdout: '', stderr: '' });

    const { executeWithPermission } = await loadPermissionModule();
    const result = await executeWithPermission('echo', [], {
      workDir: '/tmp',
      skipPermission: true,
    });

    expect(result.killed).toBe(killed);
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['max', Number.MAX_SAFE_INTEGER],
    ['string', '500'],
  ])('passes through timeoutMs boundary (%s)', async (_label, timeoutMs) => {
    execCommandMock.mockResolvedValue({ code: 0, stdout: '', stderr: '' });

    const { executeWithPermission } = await loadPermissionModule();
    await executeWithPermission('echo', [], {
      workDir: '/tmp',
      skipPermission: true,
      timeoutMs,
    });

    expect(execCommandMock).toHaveBeenCalledWith('echo', [], { timeout: timeoutMs });
  });

  it('accepts object args and whitespace workDir (type + whitespace boundaries)', async () => {
    execCommandMock.mockResolvedValue({ code: 0, stdout: '', stderr: '' });

    const args = { 0: 'x', length: 1 };
    const permissionHandler = vi.fn().mockResolvedValue('allow-once');

    const { executeWithPermission } = await loadPermissionModule();
    await executeWithPermission('echo', args, {
      workDir: '   ',
      permissionHandler,
    });

    expect(permissionHandler).toHaveBeenCalledWith(
      expect.objectContaining({ args, workDir: '   ' })
    );
    expect(execCommandMock).toHaveBeenCalledWith('echo', args, { timeout: 60000 });
  });

  it('handles long strings and deep nested args (resource boundaries)', async () => {
    execCommandMock.mockResolvedValue({ code: 0, stdout: '', stderr: '' });

    const longCommand = 'x'.repeat(10000);
    const largePath = `/tmp/${'f'.repeat(5000)}`;
    const deepArgs = [[[{ path: largePath, nested: { level: [1, { deeper: ['a'] }] } }]]];
    const permissionHandler = vi.fn().mockResolvedValue('allow-once');

    const { executeWithPermission } = await loadPermissionModule();
    await executeWithPermission(longCommand, deepArgs, {
      workDir: '/tmp',
      permissionHandler,
    });

    expect(execCommandMock).toHaveBeenCalledWith(longCommand, deepArgs, { timeout: 60000 });
  });

  it('returns a denied result when permission handler rejects a request', async () => {
    const permissionHandler = vi.fn().mockResolvedValue('deny');

    const { executeWithPermission } = await loadPermissionModule();
    const result = await executeWithPermission('echo', [], {
      workDir: '/tmp',
      permissionHandler,
    });

    expect(result).toMatchObject({
      code: 1,
      stderr: 'Permission denied by user',
      backend: sandboxBackendMock.PERMISSION_ONLY,
    });
    expect(execCommandMock).not.toHaveBeenCalled();
  });
});

describe('createPermissionExecutor', () => {
  it('exposes permission-only backend', async () => {
    const { createPermissionExecutor } = await loadPermissionModule();
    const executor = createPermissionExecutor({ workDir: '/tmp', skipPermission: true });

    expect(executor.backend).toBe(sandboxBackendMock.PERMISSION_ONLY);
  });

  it('merges default options and overrides for execute', async () => {
    execCommandMock.mockResolvedValue({ code: 0, stdout: '', stderr: '' });

    const permissionHandler = vi.fn().mockResolvedValue('allow-once');
    const { createPermissionExecutor } = await loadPermissionModule();

    const executor = createPermissionExecutor({
      workDir: '/default',
      timeoutMs: 111,
      permissionHandler,
    });

    await executor.execute('echo', undefined, { workDir: '/override', timeoutMs: 222 });

    expect(permissionHandler).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'echo', workDir: '/override' })
    );
    expect(execCommandMock).toHaveBeenCalledWith('echo', [], { timeout: 222 });
  });

  it('uses /bin/sh -c for shell on non-windows platforms', async () => {
    execCommandMock.mockResolvedValue({ code: 0, stdout: '', stderr: '' });
    getPlatformMock.mockReturnValue('linux');

    const { createPermissionExecutor } = await loadPermissionModule();
    const executor = createPermissionExecutor({ workDir: '/tmp', skipPermission: true });

    await executor.shell('echo hi');

    expect(execCommandMock).toHaveBeenCalledWith('/bin/sh', ['-c', 'echo hi'], {
      timeout: 60000,
    });
  });

  it('uses cmd.exe /c for shell on windows platforms', async () => {
    execCommandMock.mockResolvedValue({ code: 0, stdout: '', stderr: '' });
    getPlatformMock.mockReturnValue('win32');

    const { createPermissionExecutor } = await loadPermissionModule();
    const executor = createPermissionExecutor({ workDir: '/tmp', skipPermission: true });

    await executor.shell('dir');

    expect(execCommandMock).toHaveBeenCalledWith('cmd.exe', ['/c', 'dir'], {
      timeout: 60000,
    });
  });

  it('allowPattern bypasses permissions and clearPermissions restores checks', async () => {
    execCommandMock.mockResolvedValue({ code: 0, stdout: '', stderr: '' });

    const permissionHandler = vi.fn().mockResolvedValueOnce('deny');
    const { createPermissionExecutor } = await loadPermissionModule();

    const executor = createPermissionExecutor({ workDir: '/tmp', permissionHandler });

    executor.allowPattern('shell:*');
    await executor.execute('echo', ['hi']);

    expect(permissionHandler).not.toHaveBeenCalled();
    expect(execCommandMock).toHaveBeenCalledTimes(1);

    executor.clearPermissions();
    const denied = await executor.execute('echo', ['hi']);

    expect(permissionHandler).toHaveBeenCalledTimes(1);
    expect(denied.code).toBe(1);
    expect(execCommandMock).toHaveBeenCalledTimes(1);
  });

  it('keeps permission cache isolated between executor instances', async () => {
    execCommandMock.mockResolvedValue({ code: 0, stdout: '', stderr: '' });

    const permissionHandlerA = vi.fn().mockResolvedValue('deny');
    const permissionHandlerB = vi.fn().mockResolvedValue('deny');
    const { createPermissionExecutor } = await loadPermissionModule();

    const executorA = createPermissionExecutor({ workDir: '/tmp', permissionHandler: permissionHandlerA });
    const executorB = createPermissionExecutor({ workDir: '/tmp', permissionHandler: permissionHandlerB });

    executorA.allowPattern('shell:*');
    await executorA.execute('echo', ['hi']);
    const deniedOnB = await executorB.execute('echo', ['hi']);

    expect(permissionHandlerA).not.toHaveBeenCalled();
    expect(permissionHandlerB).toHaveBeenCalledTimes(1);
    expect(deniedOnB.code).toBe(1);
    expect(execCommandMock).toHaveBeenCalledTimes(1);
  });
});

describe('createInteractivePermissionHandler', () => {
  it('formats the request and allows once for yes responses', async () => {
    const prompt = vi.fn().mockResolvedValue(' YES ');

    const { createInteractivePermissionHandler } = await loadPermissionModule();
    const handler = createInteractivePermissionHandler({ prompt });

    const result = await handler({
      type: 'shell',
      command: 'echo',
      args: ['-n', 'hi'],
      workDir: '/tmp',
    });

    expect(result).toBe('allow-once');
    expect(prompt).toHaveBeenCalledTimes(1);

    const message = prompt.mock.calls[0][0];
    expect(message).toContain('[Permission Required]');
    expect(message).toContain('Type: shell');
    expect(message).toContain('Command: echo');
    expect(message).toContain('Args: -n hi');
    expect(message).toContain('WorkDir: /tmp');
    expect(message).toContain('Allow? (y/n/a[lways]): ');
  });

  it.each([
    ['a', 'allow-always'],
    [' ALWAYS ', 'allow-always'],
    ['   ', 'deny'],
    ['no', 'deny'],
  ])('maps "%s" to "%s"', async (answer, expected) => {
    const prompt = vi.fn().mockResolvedValue(answer);

    const { createInteractivePermissionHandler } = await loadPermissionModule();
    const handler = createInteractivePermissionHandler({ prompt });

    const result = await handler({
      type: 'shell',
      command: '',
      args: [],
      workDir: '/tmp',
    });

    expect(result).toBe(expected);
  });
});
