import { describe, it, expect, vi } from 'vitest';
import workerThreads, {
  isMainThread,
  parentPort,
  workerData,
  threadId,
  Worker,
  MessageChannel,
  MessagePort,
  BroadcastChannel,
  moveMessagePortToContext,
  receiveMessageOnPort,
  SHARE_ENV,
  markAsUntransferable,
  getEnvironmentData,
  setEnvironmentData,
} from '../../../../../../js/agents/core/node-compat/shims/worker_threads.js';

describe('worker_threads shim', () => {
  it('exports thread identity constants', () => {
    expect(isMainThread).toBe(true);
    expect(parentPort).toBeNull();
    expect(workerData).toBeNull();
    expect(threadId).toBe(0);
    expect(SHARE_ENV).toBe(Symbol.for('nodejs.worker_threads.SHARE_ENV'));
  });

  it('Worker exposes stubbed runtime methods', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const worker = new Worker('worker.js', {});

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(worker.threadId).toBe(0);
    expect(worker.resourceLimits).toEqual({});

    expect(() => worker.postMessage({ hello: 'world' }, [])).not.toThrow();
    await expect(worker.terminate()).resolves.toBe(0);
    expect(() => worker.ref()).not.toThrow();
    expect(() => worker.unref()).not.toThrow();
    await expect(worker.getHeapSnapshot()).resolves.toEqual({});
  });

  it('MessageChannel and MessagePort provide no-op messaging API', () => {
    const channel = new MessageChannel();
    expect(channel.port1).toBeInstanceOf(MessagePort);
    expect(channel.port2).toBeInstanceOf(MessagePort);

    expect(() => channel.port1.postMessage('hi', [])).not.toThrow();
    expect(() => channel.port1.start()).not.toThrow();
    expect(() => channel.port1.close()).not.toThrow();
    expect(() => channel.port1.ref()).not.toThrow();
    expect(() => channel.port1.unref()).not.toThrow();
  });

  it('BroadcastChannel stores name and exposes no-op methods', () => {
    const channel = new BroadcastChannel('updates');
    expect(channel.name).toBe('updates');
    expect(() => channel.postMessage({ event: 'x' })).not.toThrow();
    expect(() => channel.close()).not.toThrow();
    expect(() => channel.ref()).not.toThrow();
    expect(() => channel.unref()).not.toThrow();
  });

  it('context/environment helpers are inert by design', () => {
    const port = new MessagePort();
    expect(moveMessagePortToContext(port, {})).toBe(port);
    expect(receiveMessageOnPort(port)).toBeUndefined();
    expect(() => markAsUntransferable({})).not.toThrow();
    expect(getEnvironmentData('key')).toBeUndefined();
    expect(() => setEnvironmentData('key', 'value')).not.toThrow();
  });

  it('default export mirrors named exports', () => {
    expect(workerThreads.isMainThread).toBe(isMainThread);
    expect(workerThreads.parentPort).toBe(parentPort);
    expect(workerThreads.workerData).toBe(workerData);
    expect(workerThreads.threadId).toBe(threadId);
    expect(workerThreads.Worker).toBe(Worker);
    expect(workerThreads.MessageChannel).toBe(MessageChannel);
    expect(workerThreads.MessagePort).toBe(MessagePort);
    expect(workerThreads.BroadcastChannel).toBe(BroadcastChannel);
    expect(workerThreads.moveMessagePortToContext).toBe(moveMessagePortToContext);
    expect(workerThreads.receiveMessageOnPort).toBe(receiveMessageOnPort);
    expect(workerThreads.SHARE_ENV).toBe(SHARE_ENV);
    expect(workerThreads.markAsUntransferable).toBe(markAsUntransferable);
    expect(workerThreads.getEnvironmentData).toBe(getEnvironmentData);
    expect(workerThreads.setEnvironmentData).toBe(setEnvironmentData);
  });
});
