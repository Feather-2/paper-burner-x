import { describe, it, expect, vi } from 'vitest';
import workerThreads, {
  isMainThread,
  parentPort,
  workerData,
  threadId,
  capabilities,
  isFeatureSupported,
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
    expect(capabilities.workers).toBe(false);
    expect(isFeatureSupported('workers')).toBe(false);
  });

  it('Worker fails fast on unsupported operations', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const worker = new Worker('worker.js', {});

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(worker.threadId).toBe(0);
    expect(worker.resourceLimits).toEqual({});
    expect(worker.isSupported).toBe(false);
    expect(() => worker.postMessage({ hello: 'world' }, [])).toThrow(/not supported/i);
    await expect(worker.terminate()).resolves.toBe(0);
    expect(worker.ref()).toBe(worker);
    expect(worker.unref()).toBe(worker);
    await expect(worker.getHeapSnapshot()).rejects.toMatchObject({ code: 'ERR_WORKER_THREADS_UNSUPPORTED' });
    warnSpy.mockRestore();
  });

  it('MessageChannel and MessagePort provide in-memory message passing', async () => {
    const channel = new MessageChannel();
    expect(channel.port1).toBeInstanceOf(MessagePort);
    expect(channel.port2).toBeInstanceOf(MessagePort);

    const received = [];
    channel.port2.on('message', (payload) => received.push(payload.data));
    channel.port2.start();
    channel.port1.postMessage('hi', []);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(received).toEqual(['hi']);

    expect(channel.port1.start()).toBe(channel.port1);
    channel.port1.close();
    expect(channel.port1.ref()).toBe(channel.port1);
    expect(channel.port1.unref()).toBe(channel.port1);
  });

  it('BroadcastChannel delivers cross-instance messages by name', async () => {
    const sender = new BroadcastChannel('updates');
    const receiver = new BroadcastChannel('updates');
    const fn = vi.fn();
    receiver.on('message', fn);
    sender.postMessage({ event: 'x' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(fn).toHaveBeenCalledWith({ data: { event: 'x' } });
    sender.close();
    receiver.close();
  });

  it('context/environment helpers expose deterministic behavior', () => {
    const port = new MessagePort();
    expect(moveMessagePortToContext(port, {})).toBe(port);
    expect(receiveMessageOnPort(port)).toBeUndefined();
    expect(() => markAsUntransferable({})).not.toThrow();
    setEnvironmentData('key', 'value');
    expect(getEnvironmentData('key')).toBe('value');
  });

  it('default export mirrors named exports', () => {
    expect(workerThreads.isMainThread).toBe(isMainThread);
    expect(workerThreads.parentPort).toBe(parentPort);
    expect(workerThreads.workerData).toBe(workerData);
    expect(workerThreads.threadId).toBe(threadId);
    expect(workerThreads.capabilities).toBe(capabilities);
    expect(workerThreads.isFeatureSupported).toBe(isFeatureSupported);
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
