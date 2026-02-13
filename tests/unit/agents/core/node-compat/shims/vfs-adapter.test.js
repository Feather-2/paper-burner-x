import { describe, it, expect } from 'vitest';
import VirtualFSAdapterDefault, {
  VirtualFSAdapter,
} from '../../../../../../js/agents/core/node-compat/shims/vfs-adapter.js';

describe('vfs-adapter shim', () => {
  it('stores injected vfs in constructor', () => {
    const vfs = { root: '/' };
    const adapter = new VirtualFSAdapter(vfs);
    expect(adapter.vfs).toBe(vfs);
  });

  it('all adapter methods reject with browser not-implemented errors', async () => {
    const adapter = new VirtualFSAdapter({});
    const cases = [
      ['readFile', ['/tmp/a.txt']],
      ['readFileBuffer', ['/tmp/a.txt']],
      ['writeFile', ['/tmp/a.txt', 'content']],
      ['appendFile', ['/tmp/a.txt', 'content']],
      ['mkdir', ['/tmp/dir']],
      ['readdir', ['/tmp']],
      ['stat', ['/tmp/a.txt']],
      ['unlink', ['/tmp/a.txt']],
      ['rmdir', ['/tmp/dir']],
      ['rename', ['/tmp/a.txt', '/tmp/b.txt']],
      ['copyFile', ['/tmp/a.txt', '/tmp/b.txt']],
    ];

    for (const [method, args] of cases) {
      await expect(adapter[method](...args)).rejects.toThrow(
        `VirtualFSAdapter.${method} not implemented in browser`
      );
    }
  });

  it('default export equals VirtualFSAdapter class', () => {
    expect(VirtualFSAdapterDefault).toBe(VirtualFSAdapter);
  });
});
