// Vitest coverage for Node VFS entrypoint selection with mocked backends and boundary/error/concurrency cases.
// Focuses on createVfs routing and NodeFsVfs re-export in index.node.js without touching real fs.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { MemoryVfsMock, NodeFsVfsMock } = vi.hoisted(() => ({
  MemoryVfsMock: vi.fn(),
  NodeFsVfsMock: vi.fn(),
}));

vi.mock('../../../../js/agents/vfs/vfs.memory.js', () => ({
  default: MemoryVfsMock,
}));
vi.mock('../../../../js/agents/vfs/vfs.node.js', () => ({
  NodeFsVfs: NodeFsVfsMock,
}));
vi.mock('../../../../js/agents/vfs/index.browser.js', () => ({
  browserOnly: true,
}));

import { createVfs, NodeFsVfs } from '../../../../js/agents/vfs/index.node.js';

let memInstanceId = 0;
let nodeInstanceId = 0;

beforeEach(() => {
  memInstanceId = 0;
  nodeInstanceId = 0;
  MemoryVfsMock.mockReset();
  NodeFsVfsMock.mockReset();
  MemoryVfsMock.mockImplementation(function MemoryVfsMock() {
    this.kind = 'memory';
    this.instanceId = ++memInstanceId;
  });
  NodeFsVfsMock.mockImplementation(function NodeFsVfsMock(options) {
    this.kind = 'nodefs';
    this.options = options;
    this.instanceId = ++nodeInstanceId;
  });
});

describe('createVfs', () => {
  it('returns MemoryVfs when options are omitted or undefined', async () => {
    const v1 = await createVfs();
    const v2 = await createVfs(undefined);

    expect(v1).toBeInstanceOf(MemoryVfsMock);
    expect(v2).toBeInstanceOf(MemoryVfsMock);
    expect(v1.instanceId).not.toBe(v2.instanceId);
    expect(MemoryVfsMock).toHaveBeenCalledTimes(2);
    expect(NodeFsVfsMock).not.toHaveBeenCalled();
  });

  it('returns MemoryVfs for kind=memory/mem with trimming and case-insensitivity', async () => {
    const v1 = await createVfs({ kind: 'memory' });
    const v2 = await createVfs({ kind: '  MeM  ' });

    expect(v1).toBeInstanceOf(MemoryVfsMock);
    expect(v2).toBeInstanceOf(MemoryVfsMock);
    expect(MemoryVfsMock).toHaveBeenCalledTimes(2);
  });

  it('returns NodeFsVfs for kind=nodefs and defaults rootPath when missing or empty', async () => {
    const v1 = await createVfs({ kind: 'nodefs' });
    const v2 = await createVfs({ kind: '  NODEFS  ', rootPath: '' });

    expect(v1).toBeInstanceOf(NodeFsVfsMock);
    expect(v2).toBeInstanceOf(NodeFsVfsMock);
    expect(NodeFsVfsMock).toHaveBeenNthCalledWith(1, { rootPath: '.' });
    expect(NodeFsVfsMock).toHaveBeenNthCalledWith(2, { rootPath: '.' });
  });

  it('passes long rootPath through and ignores deep nesting', async () => {
    const longPath = `/root/${'a'.repeat(10000)}`;
    const vfs = await createVfs({
      kind: 'nodefs',
      rootPath: longPath,
      meta: { nested: { depth: { level: 4 } } },
    });

    expect(vfs).toBeInstanceOf(NodeFsVfsMock);
    expect(NodeFsVfsMock).toHaveBeenCalledWith({ rootPath: longPath });
    expect(vfs.options.rootPath).toBe(longPath);
  });

  it('defaults to MemoryVfs for non-string or empty kind values', async () => {
    const cases = [
      undefined,
      null,
      '',
      '   ',
      [],
      {},
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      '123',
      { 0: 'memory', length: 1 },
    ];

    for (const kind of cases) {
      const vfs = await createVfs({ kind });
      expect(vfs).toBeInstanceOf(MemoryVfsMock);
    }

    expect(MemoryVfsMock).toHaveBeenCalledTimes(cases.length);
    expect(NodeFsVfsMock).not.toHaveBeenCalled();
  });

  it('defaults to MemoryVfs when options is an empty array or object', async () => {
    const v1 = await createVfs([]);
    const v2 = await createVfs({});

    expect(v1).toBeInstanceOf(MemoryVfsMock);
    expect(v2).toBeInstanceOf(MemoryVfsMock);
    expect(MemoryVfsMock).toHaveBeenCalledTimes(2);
    expect(NodeFsVfsMock).not.toHaveBeenCalled();
  });

  it('handles large payloads without affecting selection', async () => {
    const largeContent = 'x'.repeat(1024 * 1024);
    const vfs = await createVfs({
      kind: 'memory',
      fileContent: largeContent,
      meta: { deep: { nest: { level: 3 } } },
    });

    expect(vfs).toBeInstanceOf(MemoryVfsMock);
    expect(MemoryVfsMock).toHaveBeenCalledTimes(1);
    expect(NodeFsVfsMock).not.toHaveBeenCalled();
  });

  it('supports concurrent calls with mixed kinds', async () => {
    const results = await Promise.all([
      createVfs({ kind: 'memory' }),
      createVfs({ kind: 'nodefs', rootPath: '/tmp/a' }),
      createVfs({ kind: 'mem' }),
      createVfs({ kind: 'nodefs' }),
    ]);

    expect(results[0]).toBeInstanceOf(MemoryVfsMock);
    expect(results[1]).toBeInstanceOf(NodeFsVfsMock);
    expect(results[2]).toBeInstanceOf(MemoryVfsMock);
    expect(results[3]).toBeInstanceOf(NodeFsVfsMock);
    expect(results[0].instanceId).not.toBe(results[2].instanceId);
    expect(results[1].instanceId).not.toBe(results[3].instanceId);
    expect(NodeFsVfsMock).toHaveBeenCalledWith({ rootPath: '/tmp/a' });
    expect(NodeFsVfsMock).toHaveBeenCalledWith({ rootPath: '.' });
  });

  it('creates new instances for rapid successive calls', async () => {
    const instances = [];
    for (let i = 0; i < 5; i += 1) {
      instances.push(await createVfs({ kind: 'memory' }));
    }

    const ids = instances.map((vfs) => vfs.instanceId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(MemoryVfsMock).toHaveBeenCalledTimes(5);
  });

  it('propagates errors from MemoryVfs constructor', async () => {
    MemoryVfsMock.mockImplementationOnce(function MemoryVfsMock() {
      throw new Error('memory fail');
    });

    await expect(createVfs({ kind: 'memory' })).rejects.toThrow('memory fail');
  });

  it('propagates errors from NodeFsVfs constructor', async () => {
    NodeFsVfsMock.mockImplementationOnce(function NodeFsVfsMock() {
      throw new Error('nodefs fail');
    });

    await expect(createVfs({ kind: 'nodefs' })).rejects.toThrow('nodefs fail');
  });

  it('throws when options is null', async () => {
    await expect(createVfs(null)).rejects.toThrow(TypeError);
  });
});

describe('NodeFsVfs', () => {
  it('re-exports NodeFsVfs from vfs.node.js', () => {
    expect(NodeFsVfs).toBe(NodeFsVfsMock);
  });

  it('constructs instances with provided options', () => {
    const instance = new NodeFsVfs({ rootPath: '/data' });

    expect(instance).toBeInstanceOf(NodeFsVfsMock);
    expect(NodeFsVfsMock).toHaveBeenCalledWith({ rootPath: '/data' });
  });
});
