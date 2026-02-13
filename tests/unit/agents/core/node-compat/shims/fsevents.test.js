import { describe, it, expect } from 'vitest';
import fsevents, {
  constants,
  watch,
  getInfo,
} from '../../../../../../js/agents/core/node-compat/shims/fsevents.js';

describe('fsevents shim', () => {
  it('exports macOS flag constants for compatibility checks', () => {
    expect(constants.kFSEventStreamEventFlagNone).toBe(0x00000000);
    expect(constants.kFSEventStreamEventFlagRootChanged).toBe(0x00000020);
    expect(constants.kFSEventStreamEventFlagItemCreated).toBe(0x00000100);
    expect(constants.kFSEventStreamEventFlagItemIsSymlink).toBe(0x00040000);
  });

  it('watch returns async cleanup function', async () => {
    const disposer = watch('/tmp', () => {});
    expect(typeof disposer).toBe('function');
    await expect(disposer()).resolves.toBeUndefined();
  });

  it('getInfo returns stable fallback event metadata', () => {
    const flags = constants.kFSEventStreamEventFlagItemModified;
    expect(getInfo('/workspace/file.txt', flags)).toEqual({
      event: 'unknown',
      path: '/workspace/file.txt',
      type: 'file',
      changes: { inode: false, finder: false, access: false, xattrs: false },
      flags,
    });
  });

  it('default export mirrors named exports', () => {
    expect(fsevents.watch).toBe(watch);
    expect(fsevents.getInfo).toBe(getInfo);
    expect(fsevents.constants).toBe(constants);
  });
});
