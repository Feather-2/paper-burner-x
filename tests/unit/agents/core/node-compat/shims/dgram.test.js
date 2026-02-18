import { describe, it, expect } from 'vitest';
import dgram, {
  Socket,
  createSocket,
} from '../../../../../../js/agents/core/node-compat/shims/dgram.js';

describe('dgram shim', () => {
  it('Socket exposes no-op UDP-style APIs with safe defaults', async () => {
    const socket = new Socket();

    expect(socket.bind(1234, '127.0.0.1')).toBe(socket);
    await new Promise((resolve) => socket.bind(1234, '127.0.0.1', resolve));
    await new Promise((resolve) => socket.close(resolve));
    await new Promise((resolve) => socket.send('msg', 0, 3, 1234, '127.0.0.1', (_err, bytes) => {
      expect(_err).toBeNull();
      expect(bytes).toBe(3);
      resolve();
    }));

    expect(socket.address()).toEqual({ address: '0.0.0.0', family: 'IPv4', port: 0 });
    expect(socket.setTTL(64)).toBe(64);
    expect(socket.setMulticastTTL(2)).toBe(2);
    expect(socket.setMulticastLoopback(true)).toBe(true);
    expect(socket.ref()).toBe(socket);
    expect(socket.unref()).toBe(socket);
    expect(socket.getRecvBufferSize()).toBe(0);
    expect(socket.getSendBufferSize()).toBe(0);
    expect(() => socket.setBroadcast(true)).not.toThrow();
    expect(() => socket.setMulticastInterface('224.0.0.1')).not.toThrow();
    expect(() => socket.addMembership('224.0.0.1')).not.toThrow();
    expect(() => socket.dropMembership('224.0.0.1')).not.toThrow();
    expect(() => socket.setRecvBufferSize(1024)).not.toThrow();
    expect(() => socket.setSendBufferSize(1024)).not.toThrow();
  });

  it('createSocket returns a Socket instance', () => {
    expect(createSocket('udp4')).toBeInstanceOf(Socket);
  });

  it('send short signature reports message bytes', async () => {
    const socket = new Socket();
    await new Promise((resolve) => {
      socket.send('hello', 1234, '127.0.0.1', (_err, bytes) => {
        expect(_err).toBeNull();
        expect(bytes).toBe(5);
        resolve();
      });
    });
  });

  it('default export mirrors named exports', () => {
    expect(dgram.Socket).toBe(Socket);
    expect(dgram.createSocket).toBe(createSocket);
  });
});
