import { describe, it, expect, vi, beforeEach } from 'vitest';

const { createVfsMock, createVfsGlobFnMock } = vi.hoisted(() => ({
  createVfsMock: vi.fn(),
  createVfsGlobFnMock: vi.fn(),
}));

vi.mock('../../../../../js/agents/vfs/index.js', () => ({
  createVfs: createVfsMock,
}));

vi.mock('../../../../../js/agents/vfs/glob.js', () => ({
  createVfsGlobFn: createVfsGlobFnMock,
}));

import vfsPlugin from '../../../../../js/agents/plugins/services/vfs.js';

const makeVfs = (overrides = {}) => {
  class FakeVfs {}
  const vfs = new FakeVfs();
  Object.assign(vfs, {
    readFile: vi.fn().mockResolvedValue(''),
    writeFile: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(false),
    stat: vi.fn().mockResolvedValue({
      size: 0,
      mtime: new Date(0),
      isFile: true,
      isDirectory: false,
    }),
    readdir: vi.fn().mockResolvedValue([]),
    mkdir: vi.fn().mockResolvedValue(undefined),
    rmdir: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  });
  return vfs;
};

const installWithVfs = async (vfs, config = { kind: 'memory', rootPath: '.' }) => {
  createVfsMock.mockResolvedValue(vfs);
  const events = { emit: vi.fn() };
  const log = { info: vi.fn(), warn: vi.fn() };
  let service;
  const ctx = {
    config,
    events,
    log,
    registerService: vi.fn((name, svc) => {
      service = svc;
    }),
  };
  await vfsPlugin.install(ctx);
  return { ctx, service, events, log };
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe('vfs plugin (default export)', () => {
  describe('metadata', () => {
    it('exposes plugin identity and defaults', () => {
      expect(vfsPlugin.name).toBe('service/vfs');
      expect(vfsPlugin.version).toBe('1.0.0');
      expect(vfsPlugin.description).toBe('虚拟文件系统');
      expect(vfsPlugin.defaultConfig).toEqual({ kind: 'auto', rootPath: '.' });
    });
  });

  describe('install', () => {
    it('registers service and logs install', async () => {
      const vfs = makeVfs();
      const config = { kind: 'memory', rootPath: '/tmp' };

      const { service, ctx, log } = await installWithVfs(vfs, config);

      expect(createVfsMock).toHaveBeenCalledWith(config);
      expect(ctx.registerService).toHaveBeenCalledWith('vfs', expect.any(Object));
      expect(typeof service.readFile).toBe('function');
      expect(typeof service.writeFile).toBe('function');
      expect(log.info).toHaveBeenCalledWith('VFS plugin installed (FakeVfs)');
    });
  });

  describe('service.readFile', () => {
    it('forwards empty and nullish values', async () => {
      const vfs = makeVfs({ readFile: vi.fn().mockResolvedValue('ok') });
      const { service } = await installWithVfs(vfs);

      await service.readFile('', undefined);
      await service.readFile(null, null);
      await service.readFile(undefined, { encoding: 'utf8' });

      expect(vfs.readFile).toHaveBeenNthCalledWith(1, '', undefined);
      expect(vfs.readFile).toHaveBeenNthCalledWith(2, null, null);
      expect(vfs.readFile).toHaveBeenNthCalledWith(3, undefined, { encoding: 'utf8' });
    });

    it('propagates read errors', async () => {
      const vfs = makeVfs({ readFile: vi.fn().mockRejectedValue(new Error('boom')) });
      const { service } = await installWithVfs(vfs);

      await expect(service.readFile('missing.txt')).rejects.toThrow('boom');
    });

    it('supports concurrent reads', async () => {
      const vfs = makeVfs({
        readFile: vi.fn()
          .mockResolvedValueOnce('a')
          .mockResolvedValueOnce('b'),
      });
      const { service } = await installWithVfs(vfs);

      const [first, second] = await Promise.all([
        service.readFile('a.txt'),
        service.readFile('b.txt'),
      ]);

      expect(first).toBe('a');
      expect(second).toBe('b');
      expect(vfs.readFile).toHaveBeenCalledTimes(2);
    });
  });

  describe('service.writeFile', () => {
    it('emits events for concurrent writes', async () => {
      const vfs = makeVfs();
      const { service, events } = await installWithVfs(vfs);

      await Promise.all([
        service.writeFile('a.txt', 'a'),
        service.writeFile('b.txt', 'b'),
      ]);

      expect(vfs.writeFile).toHaveBeenCalledTimes(2);
      expect(events.emit).toHaveBeenCalledWith('vfs:write', { path: 'a.txt' });
      expect(events.emit).toHaveBeenCalledWith('vfs:write', { path: 'b.txt' });
    });

    it('handles large data, long strings, and deep nested options', async () => {
      const vfs = makeVfs();
      const { service } = await installWithVfs(vfs);

      const largeBuffer = new Uint8Array(1024 * 1024);
      const longText = 'x'.repeat(100000);
      const deepOptions = {
        recursive: true,
        meta: { level1: { level2: { level3: { level4: { level5: 'x' } } } } },
      };

      await service.writeFile('big.bin', largeBuffer, deepOptions);
      await service.writeFile('long.txt', longText, deepOptions);

      expect(vfs.writeFile).toHaveBeenCalledWith('big.bin', largeBuffer, deepOptions);
      expect(vfs.writeFile).toHaveBeenCalledWith('long.txt', longText, deepOptions);
    });

    it('propagates write errors without emitting', async () => {
      const vfs = makeVfs({ writeFile: vi.fn().mockRejectedValue(new Error('fail')) });
      const { service, events } = await installWithVfs(vfs);

      await expect(service.writeFile('a.txt', 'a')).rejects.toThrow('fail');
      expect(events.emit).not.toHaveBeenCalled();
    });
  });

  describe('service.deleteFile', () => {
    it('uses deleteFile when available', async () => {
      const vfs = makeVfs({ deleteFile: vi.fn().mockResolvedValue('done') });
      const { service, events } = await installWithVfs(vfs);

      await service.deleteFile('a.txt');

      expect(vfs.deleteFile).toHaveBeenCalledWith('a.txt');
      expect(events.emit).toHaveBeenCalledWith('vfs:delete', { path: 'a.txt' });
    });

    it('falls back to unlink when deleteFile is missing', async () => {
      const vfs = makeVfs({ deleteFile: undefined, unlink: vi.fn().mockResolvedValue('ok') });
      const { service } = await installWithVfs(vfs);

      await service.deleteFile('b.txt');

      expect(vfs.unlink).toHaveBeenCalledWith('b.txt');
    });

    it('falls back to rm when deleteFile and unlink are missing', async () => {
      const vfs = makeVfs({
        deleteFile: undefined,
        unlink: undefined,
        rm: vi.fn().mockResolvedValue('ok'),
      });
      const { service } = await installWithVfs(vfs);

      await service.deleteFile('c.txt');

      expect(vfs.rm).toHaveBeenCalledWith('c.txt', { recursive: false });
    });

    it('throws when no delete capability exists', async () => {
      const vfs = makeVfs({ deleteFile: undefined, unlink: undefined, rm: undefined });
      const { service, events } = await installWithVfs(vfs);

      await expect(service.deleteFile('d.txt')).rejects.toThrow(
        'VFS does not support deleteFile/unlink/rm',
      );
      expect(events.emit).not.toHaveBeenCalled();
    });

    it('propagates delete errors without emitting', async () => {
      const vfs = makeVfs({ deleteFile: vi.fn().mockRejectedValue(new Error('boom')) });
      const { service, events } = await installWithVfs(vfs);

      await expect(service.deleteFile('e.txt')).rejects.toThrow('boom');
      expect(events.emit).not.toHaveBeenCalled();
    });
  });

  describe('service.exists', () => {
    it('forwards boundary values and supports rapid consecutive calls', async () => {
      const vfs = makeVfs({ exists: vi.fn().mockResolvedValue(true) });
      const { service } = await installWithVfs(vfs);

      const inputs = [0, -1, Number.MAX_SAFE_INTEGER, '', '   ', '123'];
      const results = [];
      for (const input of inputs) {
        results.push(await service.exists(input));
      }

      expect(results).toEqual(new Array(inputs.length).fill(true));
      inputs.forEach((input, index) => {
        expect(vfs.exists).toHaveBeenNthCalledWith(index + 1, input);
      });
    });
  });

  describe('service.stat', () => {
    it('returns stats for numeric string paths', async () => {
      const statValue = {
        size: 1,
        mtime: new Date('2020-01-01T00:00:00.000Z'),
        isFile: true,
        isDirectory: false,
      };
      const vfs = makeVfs({ stat: vi.fn().mockResolvedValue(statValue) });
      const { service } = await installWithVfs(vfs);

      const out = await service.stat('123');

      expect(out).toBe(statValue);
      expect(vfs.stat).toHaveBeenCalledWith('123');
    });
  });

  describe('service.readdir', () => {
    it('forwards options including empty arrays', async () => {
      const vfs = makeVfs({ readdir: vi.fn().mockResolvedValue(['a']) });
      const { service } = await installWithVfs(vfs);

      const out = await service.readdir('dir', []);

      expect(out).toEqual(['a']);
      expect(vfs.readdir).toHaveBeenCalledWith('dir', []);
    });
  });

  describe('service.list', () => {
    it('returns empty list when readdir is not an array', async () => {
      const vfs = makeVfs({ readdir: vi.fn().mockResolvedValue(null) });
      const { service } = await installWithVfs(vfs);

      const out = await service.list('dir');

      expect(out).toEqual([]);
      expect(vfs.readdir).toHaveBeenCalledWith('dir', { withFileTypes: true });
    });

    it('filters invalid entries and maps kind correctly', async () => {
      const entries = [
        null,
        { name: 123 },
        { name: 'file.txt', isDirectory: () => false },
        { name: 'dir', isDirectory: () => true },
        { name: 'plain' },
      ];
      const vfs = makeVfs({ readdir: vi.fn().mockResolvedValue(entries) });
      const { service } = await installWithVfs(vfs);

      const out = await service.list('dir');

      expect(out).toEqual([
        { name: 'file.txt', kind: 'file' },
        { name: 'dir', kind: 'dir' },
        { name: 'plain', kind: 'file' },
      ]);
    });
  });

  describe('service.mkdir', () => {
    it('forwards mkdir calls', async () => {
      const vfs = makeVfs();
      const { service } = await installWithVfs(vfs);

      await service.mkdir('path', { recursive: true });

      expect(vfs.mkdir).toHaveBeenCalledWith('path', { recursive: true });
    });
  });

  describe('service.rmdir', () => {
    it('forwards rmdir calls', async () => {
      const vfs = makeVfs();
      const { service } = await installWithVfs(vfs);

      await service.rmdir('path', { recursive: false });

      expect(vfs.rmdir).toHaveBeenCalledWith('path', { recursive: false });
    });
  });

  describe('service.glob', () => {
    it('uses vfs.glob when available (including object-as-array options)', async () => {
      const vfs = makeVfs({ glob: vi.fn().mockResolvedValue(['a.md']) });
      const { service } = await installWithVfs(vfs);

      const out = await service.glob('**/*.md', { cwd: 'docs', ignore: {} });

      expect(out).toEqual(['a.md']);
      expect(vfs.glob).toHaveBeenCalledWith('**/*.md', { cwd: 'docs', ignore: {} });
      expect(createVfsGlobFnMock).not.toHaveBeenCalled();
    });

    it('falls back to glob helper with string pattern and empty object options', async () => {
      const globFn = vi.fn().mockResolvedValue(['x.js']);
      createVfsGlobFnMock.mockReturnValue(globFn);

      const vfs = makeVfs({ glob: undefined });
      const { service } = await installWithVfs(vfs);

      const out = await service.glob('**/*.js', {});

      expect(out).toEqual(['x.js']);
      expect(createVfsGlobFnMock).toHaveBeenCalledWith(vfs);
      expect(globFn).toHaveBeenCalledWith({ pattern: '**/*.js' });
    });

    it('merges pattern objects with options in fallback mode', async () => {
      const globFn = vi.fn().mockResolvedValue(['ok']);
      createVfsGlobFnMock.mockReturnValue(globFn);

      const vfs = makeVfs({ glob: undefined });
      const { service } = await installWithVfs(vfs);

      await service.glob(
        { pattern: '*.js', cwd: 'src', ignore: [] },
        { cwd: 'override', ignore: ['skip'] },
      );

      expect(globFn).toHaveBeenCalledWith({
        pattern: '*.js',
        cwd: 'override',
        ignore: ['skip'],
      });
    });

    it('returns empty list when fallback helper is unavailable', async () => {
      createVfsGlobFnMock.mockReturnValue(null);
      const vfs = makeVfs({ glob: undefined });
      const { service } = await installWithVfs(vfs);

      const out = await service.glob('**/*');

      expect(out).toEqual([]);
    });

    it('initializes fallback helper once and reuses it', async () => {
      const globFn = vi.fn().mockResolvedValue(['first']);
      createVfsGlobFnMock.mockReturnValue(globFn);
      const vfs = makeVfs({ glob: undefined });
      const { service } = await installWithVfs(vfs);

      await service.glob('**/*.js');
      await service.glob('**/*.md');

      expect(createVfsGlobFnMock).toHaveBeenCalledTimes(1);
      expect(globFn).toHaveBeenCalledTimes(2);
    });

    it('returns empty list and logs warning when fallback import setup throws', async () => {
      createVfsGlobFnMock.mockImplementation(() => {
        throw new Error('fallback-init-failed');
      });
      const vfs = makeVfs({ glob: undefined });
      const { service, log } = await installWithVfs(vfs);

      await expect(service.glob('**/*.js')).resolves.toEqual([]);
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('VFS glob fallback unavailable'));
    });
  });

  describe('service.getInstance', () => {
    it('returns the underlying vfs instance', async () => {
      const vfs = makeVfs();
      const { service } = await installWithVfs(vfs);

      expect(service.getInstance()).toBe(vfs);
    });
  });

  describe('service.getType', () => {
    it('returns the constructor name', async () => {
      const vfs = makeVfs();
      const { service } = await installWithVfs(vfs);

      expect(service.getType()).toBe('FakeVfs');
    });
  });
});
