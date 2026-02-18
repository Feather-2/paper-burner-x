import { describe, expect, it, vi } from 'vitest';
import {
  ObservabilityStream,
  withObservability,
} from '../../../../../js/agents/core/node-compat/observability.js';

describe('node-compat/observability', () => {
  it('replays buffered events asynchronously in batches', async () => {
    vi.useFakeTimers();
    const stream = new ObservabilityStream();
    for (let i = 0; i < 250; i += 1) {
      stream.emit('fs:writeFile', { index: i });
    }

    const listener = vi.fn();
    stream.subscribe(listener);
    expect(listener).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();
    expect(listener).toHaveBeenCalledTimes(250);
    vi.useRealTimers();
  });

  it('captures copy/move/rename operations via withObservability', async () => {
    const stream = new ObservabilityStream();
    const events = [];
    stream.subscribe((event) => events.push(event));

    const quota = {
      trackFileWrite: vi.fn(),
      trackFileRead: vi.fn(),
    };
    const vfs = {
      copy: vi.fn().mockResolvedValue(undefined),
      move: vi.fn().mockResolvedValue(undefined),
      rename: vi.fn().mockResolvedValue(undefined),
      readText: vi.fn().mockResolvedValue('hello'),
    };
    const wrapped = withObservability(vfs, stream, quota);

    await wrapped.copy('/a', '/b');
    await wrapped.move('/b', '/c');
    await wrapped.rename('/c', '/d');
    await wrapped.readText('/d');

    expect(quota.trackFileWrite).toHaveBeenCalledTimes(3);
    expect(quota.trackFileRead).toHaveBeenCalledTimes(1);
    expect(events.map((event) => event.type)).toContain('fs:copy');
    expect(events.map((event) => event.type)).toContain('fs:move');
    expect(events.map((event) => event.type)).toContain('fs:rename');
    expect(events.map((event) => event.type)).toContain('fs:readText');
  });
});
