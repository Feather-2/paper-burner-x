import { describe, it, expect } from 'vitest';
import { platform, arch, homedir, tmpdir, hostname, type, release, uptime, totalmem, freemem, cpus, networkInterfaces, userInfo, loadavg, endianness, getResourceModel, EOL, devNull, constants } from '../../../../../../js/agents/core/node-compat/shims/os.js';

describe('os shim', () => {
  it('platform returns browser', () => {
    expect(platform()).toBe('browser');
  });

  it('arch returns wasm', () => {
    expect(arch()).toBe('wasm');
  });

  it('homedir returns /home/user', () => {
    expect(homedir()).toBe('/home/user');
  });

  it('tmpdir returns /tmp', () => {
    expect(tmpdir()).toBe('/tmp');
  });

  it('hostname returns localhost', () => {
    expect(hostname()).toBe('localhost');
  });

  it('type returns Browser', () => {
    expect(type()).toBe('Browser');
  });

  it('cpus returns non-empty array', () => {
    const c = cpus();
    expect(Array.isArray(c)).toBe(true);
    expect(c.length).toBeGreaterThan(0);
    expect(c[0]).toHaveProperty('model');
  });

  it('totalmem and freemem return numbers', () => {
    expect(typeof totalmem()).toBe('number');
    expect(typeof freemem()).toBe('number');
    expect(totalmem()).toBeGreaterThan(freemem());
  });

  it('EOL is newline', () => {
    expect(EOL).toBe('\n');
  });

  it('devNull is /dev/null', () => {
    expect(devNull).toBe('/dev/null');
  });

  it('userInfo returns expected shape', () => {
    const info = userInfo();
    expect(info.username).toBe('user');
    expect(info.uid).toBe(1000);
  });

  it('loadavg returns 3-element array', () => {
    expect(loadavg()).toEqual([0, 0, 0]);
  });

  it('endianness returns LE', () => {
    expect(endianness()).toBe('LE');
  });

  it('constants has signals and errno', () => {
    expect(constants).toHaveProperty('signals');
    expect(constants).toHaveProperty('errno');
  });

  it('getResourceModel declares estimated stub source', () => {
    const model = getResourceModel();
    expect(model.source).toBe('browser-stub');
    expect(model.estimated).toBe(true);
    expect(model.totalmem).toBeGreaterThan(0);
    expect(model.cpuCount).toBeGreaterThan(0);
  });
});
