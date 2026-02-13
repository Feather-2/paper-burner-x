import { describe, it, expect, vi } from 'vitest';
import cluster, {
  isMaster,
  isPrimary,
  isWorker,
  Worker,
  worker,
  workers,
  fork,
  disconnect,
  settings,
  SCHED_NONE,
  SCHED_RR,
  schedulingPolicy,
  setupMaster,
  setupPrimary,
  on,
  once,
  emit,
  removeListener,
} from '../../../../../../js/agents/core/node-compat/shims/cluster.js';

describe('cluster shim', () => {
  it('exports compatibility constants and shared values', () => {
    expect(isMaster).toBe(true);
    expect(isPrimary).toBe(true);
    expect(isWorker).toBe(false);
    expect(worker).toBeNull();
    expect(workers).toEqual({});
    expect(settings).toEqual({});
    expect(SCHED_NONE).toBe(1);
    expect(SCHED_RR).toBe(2);
    expect(schedulingPolicy).toBe(SCHED_RR);
  });

  it('Worker exposes no-op worker lifecycle API', () => {
    const instance = new Worker();
    expect(instance.id).toBe(0);
    expect(instance.process).toBeNull();
    expect(instance.send({ hello: 'world' })).toBe(false);
    expect(instance.isDead()).toBe(false);
    expect(instance.isConnected()).toBe(false);
    expect(() => instance.kill('SIGTERM')).not.toThrow();
    expect(() => instance.disconnect()).not.toThrow();
  });

  it('factory and setup methods are safe in browser runtime', async () => {
    expect(fork()).toBeInstanceOf(Worker);
    expect(() => setupMaster({ exec: 'worker.js' })).not.toThrow();
    expect(() => setupPrimary({ exec: 'worker.js' })).not.toThrow();

    await new Promise((resolve) => disconnect(resolve));
    expect(() => disconnect()).not.toThrow();
  });

  it('event facade forwards to internal event emitter', () => {
    const eventName = `cluster:event:${Date.now()}`;
    const persistent = vi.fn();
    const oneShot = vi.fn();

    on(eventName, persistent);
    once(eventName, oneShot);
    emit(eventName, 'payload');
    emit(eventName, 'payload-2');

    expect(persistent).toHaveBeenCalledTimes(2);
    expect(persistent).toHaveBeenCalledWith('payload');
    expect(oneShot).toHaveBeenCalledTimes(1);
    expect(oneShot).toHaveBeenCalledWith('payload');

    removeListener(eventName, persistent);
    emit(eventName, 'payload-3');
    expect(persistent).toHaveBeenCalledTimes(2);
  });

  it('default export mirrors named exports', () => {
    expect(cluster.isMaster).toBe(isMaster);
    expect(cluster.isPrimary).toBe(isPrimary);
    expect(cluster.isWorker).toBe(isWorker);
    expect(cluster.Worker).toBe(Worker);
    expect(cluster.worker).toBe(worker);
    expect(cluster.workers).toBe(workers);
    expect(cluster.fork).toBe(fork);
    expect(cluster.disconnect).toBe(disconnect);
    expect(cluster.settings).toBe(settings);
    expect(cluster.SCHED_NONE).toBe(SCHED_NONE);
    expect(cluster.SCHED_RR).toBe(SCHED_RR);
    expect(cluster.schedulingPolicy).toBe(schedulingPolicy);
    expect(cluster.setupMaster).toBe(setupMaster);
    expect(cluster.setupPrimary).toBe(setupPrimary);
    expect(cluster.on).toBe(on);
    expect(cluster.once).toBe(once);
    expect(cluster.emit).toBe(emit);
    expect(cluster.removeListener).toBe(removeListener);
  });
});
