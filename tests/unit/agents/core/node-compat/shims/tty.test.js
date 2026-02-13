import { describe, it, expect, vi } from 'vitest';
import tty, { ReadStream, WriteStream, isatty } from '../../../../../../js/agents/core/node-compat/shims/tty.js';

describe('tty shim', () => {
  it('ReadStream exposes default terminal flags', () => {
    const stream = new ReadStream();
    expect(stream.isTTY).toBe(false);
    expect(stream.isRaw).toBe(false);
  });

  it('ReadStream.setRawMode updates state and is chainable', () => {
    const stream = new ReadStream();
    expect(stream.setRawMode(true)).toBe(stream);
    expect(stream.isRaw).toBe(true);
    stream.setRawMode(false);
    expect(stream.isRaw).toBe(false);
  });

  it('WriteStream control methods return true and invoke callbacks', () => {
    const stream = new WriteStream();
    const callback = vi.fn();

    expect(stream.clearLine(0, callback)).toBe(true);
    expect(stream.clearScreenDown(callback)).toBe(true);
    expect(stream.cursorTo(1, 2, callback)).toBe(true);
    expect(stream.moveCursor(1, -1, callback)).toBe(true);
    expect(callback).toHaveBeenCalledTimes(4);
  });

  it('WriteStream exposes color/window helpers', () => {
    const stream = new WriteStream();
    expect(stream.isTTY).toBe(false);
    expect(stream.columns).toBe(80);
    expect(stream.rows).toBe(24);
    expect(stream.getColorDepth({})).toBe(1);
    expect(stream.hasColors(256, {})).toBe(false);
    expect(stream.getWindowSize()).toEqual([80, 24]);

    stream.columns = 120;
    stream.rows = 30;
    expect(stream.getWindowSize()).toEqual([120, 30]);
  });

  it('isatty always returns false', () => {
    expect(isatty(0)).toBe(false);
    expect(isatty(1)).toBe(false);
    expect(isatty(-1)).toBe(false);
  });

  it('default export mirrors named exports', () => {
    expect(tty.ReadStream).toBe(ReadStream);
    expect(tty.WriteStream).toBe(WriteStream);
    expect(tty.isatty).toBe(isatty);
  });
});
