import { describe, it, expect } from 'vitest';
import domain, {
  Domain,
  create,
  active,
} from '../../../../../../js/agents/core/node-compat/shims/domain.js';

describe('domain shim', () => {
  it('Domain tracks members and supports basic lifecycle helpers', () => {
    const instance = new Domain();
    const emitterA = { id: 'a' };
    const emitterB = { id: 'b' };
    const fn = () => 'ok';

    expect(instance.members).toEqual([]);
    instance.add(emitterA);
    instance.add(emitterB);
    expect(instance.members).toEqual([emitterA, emitterB]);

    instance.remove(emitterA);
    instance.remove({ id: 'missing' });
    expect(instance.members).toEqual([emitterB]);

    expect(instance.bind(fn)).toBe(fn);
    expect(instance.intercept(fn)).toBe(fn);
    expect(instance.run(() => 42)).toBe(42);

    expect(() => instance.enter()).not.toThrow();
    expect(() => instance.exit()).not.toThrow();
    instance.dispose();
    expect(instance.members).toEqual([]);
  });

  it('create returns a Domain instance and active stays null', () => {
    expect(create()).toBeInstanceOf(Domain);
    expect(active).toBeNull();
  });

  it('default export mirrors named exports', () => {
    expect(domain.Domain).toBe(Domain);
    expect(domain.create).toBe(create);
    expect(domain.active).toBe(active);
  });
});
