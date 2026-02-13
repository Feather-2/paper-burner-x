import { describe, it, expect, vi } from 'vitest';
import readline, {
  Interface,
  createInterface,
  clearLine,
  clearScreenDown,
  cursorTo,
  moveCursor,
  emitKeypressEvents,
  promises,
} from '../../../../../../js/agents/core/node-compat/shims/readline.js';

describe('readline shim', () => {
  it('Interface tracks prompt state and emits close', () => {
    const rl = new Interface({ prompt: '> ' });
    expect(rl.getPrompt()).toBe('> ');
    expect(rl.line).toBe('');
    expect(rl.cursor).toBe(0);

    rl.setPrompt('>>> ');
    expect(rl.getPrompt()).toBe('>>> ');

    const onClose = vi.fn();
    rl.on('close', onClose);
    rl.close();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Interface.question resolves asynchronously with empty answer', async () => {
    const rl = new Interface();
    await new Promise((done) => {
      rl.question('name?', (answer) => {
        expect(answer).toBe('');
        done();
      });
    });
  });

  it('Interface no-op helpers are safe and chainable where expected', () => {
    const rl = new Interface();
    expect(rl.pause()).toBe(rl);
    expect(rl.resume()).toBe(rl);
    expect(() => rl.prompt(true)).not.toThrow();
    expect(() => rl.write('abc', { name: 'x' })).not.toThrow();
    expect(rl.getCursorPos()).toEqual({ rows: 0, cols: 0 });
  });

  it('createInterface returns an Interface instance', () => {
    const rl = createInterface({ prompt: '? ' });
    expect(rl).toBeInstanceOf(Interface);
    expect(rl.getPrompt()).toBe('? ');
  });

  it('cursor/screen helpers invoke callback and return true', () => {
    const callback = vi.fn();
    expect(clearLine({}, 0, callback)).toBe(true);
    expect(clearScreenDown({}, callback)).toBe(true);
    expect(cursorTo({}, 1, 2, callback)).toBe(true);
    expect(moveCursor({}, 1, -1, callback)).toBe(true);
    expect(callback).toHaveBeenCalledTimes(4);
  });

  it('emitKeypressEvents is a no-op', () => {
    expect(() => emitKeypressEvents({}, {})).not.toThrow();
  });

  it('promises.createInterface exposes promise-based question and async iterator', async () => {
    const rl = promises.createInterface({ prompt: '$ ' });
    await expect(rl.question('cmd>')).resolves.toBe('');
    const iter = rl[Symbol.asyncIterator]();
    await expect(iter.next()).resolves.toEqual({ value: undefined, done: true });
    expect(() => rl.close()).not.toThrow();
  });

  it('default export mirrors named exports', () => {
    expect(readline.Interface).toBe(Interface);
    expect(readline.createInterface).toBe(createInterface);
    expect(readline.clearLine).toBe(clearLine);
    expect(readline.clearScreenDown).toBe(clearScreenDown);
    expect(readline.cursorTo).toBe(cursorTo);
    expect(readline.moveCursor).toBe(moveCursor);
    expect(readline.emitKeypressEvents).toBe(emitKeypressEvents);
    expect(readline.promises).toBe(promises);
  });
});
