import { describe, it, expect } from 'vitest';
import dns, {
  lookup,
  resolve,
  resolve4,
  resolve6,
  reverse,
  setServers,
  getServers,
  setDefaultResultOrder,
  getDefaultResultOrder,
  promises,
  ADDRCONFIG,
  V4MAPPED,
  ALL,
} from '../../../../../../js/agents/core/node-compat/shims/dns.js';

describe('dns shim', () => {
  it('lookup resolves localhost and unknown host via callbacks', async () => {
    await new Promise((done) => {
      lookup('localhost', (err, address, family) => {
        expect(err).toBeNull();
        expect(address).toBe('127.0.0.1');
        expect(family).toBe(4);
        done();
      });
    });

    await new Promise((done) => {
      lookup('example.com', (err, address, family) => {
        expect(err).toBeNull();
        expect(address).toBe('0.0.0.0');
        expect(family).toBe(4);
        done();
      });
    });
  });

  it('lookup supports all=true option', async () => {
    await new Promise((done) => {
      lookup('localhost', { all: true }, (err, addresses) => {
        expect(err).toBeNull();
        expect(addresses).toEqual([{ address: '127.0.0.1', family: 4 }]);
        done();
      });
    });
  });

  it('resolve APIs return browser-safe defaults', async () => {
    expect(() => resolve('example.com')).not.toThrow();

    await new Promise((done) => {
      resolve('example.com', (err, addresses) => {
        expect(err).toBeNull();
        expect(addresses).toEqual(['0.0.0.0']);
        done();
      });
    });

    await new Promise((done) => {
      resolve4('example.com', (err, addresses) => {
        expect(err).toBeNull();
        expect(addresses).toEqual(['0.0.0.0']);
        done();
      });
    });

    await new Promise((done) => {
      resolve6('example.com', (err, addresses) => {
        expect(err).toBeNull();
        expect(addresses).toEqual(['::1']);
        done();
      });
    });

    await new Promise((done) => {
      reverse('127.0.0.1', (err, hostnames) => {
        expect(err).toBeNull();
        expect(hostnames).toEqual(['localhost']);
        done();
      });
    });
  });

  it('server/order configuration methods are no-op defaults', () => {
    expect(() => setServers(['8.8.8.8'])).not.toThrow();
    expect(getServers()).toEqual([]);
    expect(() => setDefaultResultOrder('ipv4first')).not.toThrow();
    expect(getDefaultResultOrder()).toBe('verbatim');
  });

  it('promises API resolves callback equivalents', async () => {
    await expect(promises.lookup('localhost')).resolves.toEqual({
      address: '127.0.0.1',
      family: 4,
    });
    await expect(promises.lookup('localhost', { all: true })).resolves.toEqual([
      { address: '127.0.0.1', family: 4 },
    ]);
    await expect(promises.resolve('example.com')).resolves.toEqual(['0.0.0.0']);
    await expect(promises.resolve4('example.com')).resolves.toEqual(['0.0.0.0']);
    await expect(promises.resolve6('example.com')).resolves.toEqual(['::1']);
    await expect(promises.reverse('127.0.0.1')).resolves.toEqual(['localhost']);
    expect(promises.getServers()).toEqual([]);
    expect(() => promises.setServers(['1.1.1.1'])).not.toThrow();
  });

  it('exports compatibility constants', () => {
    expect(ADDRCONFIG).toBe(0);
    expect(V4MAPPED).toBe(0);
    expect(ALL).toBe(0);
  });

  it('default export mirrors named exports', () => {
    expect(dns.lookup).toBe(lookup);
    expect(dns.resolve).toBe(resolve);
    expect(dns.resolve4).toBe(resolve4);
    expect(dns.resolve6).toBe(resolve6);
    expect(dns.reverse).toBe(reverse);
    expect(dns.setServers).toBe(setServers);
    expect(dns.getServers).toBe(getServers);
    expect(dns.setDefaultResultOrder).toBe(setDefaultResultOrder);
    expect(dns.getDefaultResultOrder).toBe(getDefaultResultOrder);
    expect(dns.promises).toBe(promises);
    expect(dns.ADDRCONFIG).toBe(ADDRCONFIG);
    expect(dns.V4MAPPED).toBe(V4MAPPED);
    expect(dns.ALL).toBe(ALL);
  });
});
