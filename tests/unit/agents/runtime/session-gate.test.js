import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionGate, ErrConcurrentExecution } from '../../../../js/agents/runtime/session-gate.js';

describe('SessionGate', () => {
  /** @type {SessionGate} */
  let gate;

  beforeEach(() => {
    gate = new SessionGate();
  });

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------
  describe('constructor', () => {
    it('defaults to queue mode', () => {
      expect(gate._mode).toBe('queue');
    });

    it('accepts custom mode reject', () => {
      const g = new SessionGate({ mode: 'reject' });
      expect(g._mode).toBe('reject');
    });

    it('defaults timeout to 0', () => {
      expect(gate._defaultTimeout).toBe(0);
    });

    it('accepts custom timeout', () => {
      const g = new SessionGate({ timeout: 200 });
      expect(g._defaultTimeout).toBe(200);
    });

    it('starts with no gates', () => {
      expect(gate.activeCount).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // acquire – queue mode
  // -----------------------------------------------------------------------
  describe('acquire() - queue mode', () => {
    it('returns a release function', async () => {
      const release = await gate.acquire('s1');
      expect(typeof release).toBe('function');
      release();
    });

    it('serializes concurrent access to the same session (FIFO)', async () => {
      const order = [];

      const r1 = await gate.acquire('s1');
      order.push('a1');

      const p2 = gate.acquire('s1').then((release) => {
        order.push('a2');
        release();
      });

      const p3 = gate.acquire('s1').then((release) => {
        order.push('a3');
        release();
      });

      // Let microtasks settle — only first should have acquired
      await new Promise((r) => setTimeout(r, 10));
      expect(order).toEqual(['a1']);

      r1(); // release first holder
      await p2;
      await p3;
      expect(order).toEqual(['a1', 'a2', 'a3']);
    });

    it('allows parallel access to different sessions', async () => {
      const r1 = await gate.acquire('s1');
      const r2 = await gate.acquire('s2');
      expect(gate.activeCount).toBe(2);
      expect(gate.isLocked('s1')).toBe(true);
      expect(gate.isLocked('s2')).toBe(true);
      r1();
      r2();
      expect(gate.activeCount).toBe(0);
    });

    it('release is idempotent (calling twice is safe)', async () => {
      const release = await gate.acquire('s1');
      release();
      release(); // second call should not throw or double-decrement
      expect(gate.isLocked('s1')).toBe(false);
      expect(gate.activeCount).toBe(0);
    });

    it('second acquire resolves only after first releases', async () => {
      const r1 = await gate.acquire('s1');
      let secondAcquired = false;

      const p2 = gate.acquire('s1').then((release) => {
        secondAcquired = true;
        return release;
      });

      await new Promise((r) => setTimeout(r, 10));
      expect(secondAcquired).toBe(false);

      r1();
      const r2 = await p2;
      expect(secondAcquired).toBe(true);
      r2();
    });
  });

  // -----------------------------------------------------------------------
  // acquire – reject mode
  // -----------------------------------------------------------------------
  describe('acquire() - reject mode', () => {
    /** @type {SessionGate} */
    let rejectGate;

    beforeEach(() => {
      rejectGate = new SessionGate({ mode: 'reject' });
    });

    it('throws ErrConcurrentExecution when session already locked', async () => {
      const release = await rejectGate.acquire('s1');

      await expect(rejectGate.acquire('s1')).rejects.toThrow(ErrConcurrentExecution);
      await expect(rejectGate.acquire('s1')).rejects.toThrow('Concurrent execution rejected');

      release();
    });

    it('ErrConcurrentExecution has correct code and sessionId', async () => {
      const release = await rejectGate.acquire('sess-abc');

      try {
        await rejectGate.acquire('sess-abc');
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ErrConcurrentExecution);
        expect(err.name).toBe('ErrConcurrentExecution');
        expect(err.code).toBe('ERR_CONCURRENT_EXECUTION');
        expect(err.sessionId).toBe('sess-abc');
        expect(err.message).toContain('sess-abc');
      }

      release();
    });

    it('allows acquisition after release', async () => {
      const r1 = await rejectGate.acquire('s1');
      r1();

      const r2 = await rejectGate.acquire('s1');
      expect(rejectGate.isLocked('s1')).toBe(true);
      r2();
    });
  });

  // -----------------------------------------------------------------------
  // acquire – AbortSignal
  // -----------------------------------------------------------------------
  describe('acquire() - AbortSignal', () => {
    it('rejects immediately when signal already aborted (fast path, no contention)', async () => {
      const ac = new AbortController();
      ac.abort(new Error('pre-aborted'));

      await expect(
        gate.acquire('s1', { signal: ac.signal })
      ).rejects.toThrow('pre-aborted');

      expect(gate.isLocked('s1')).toBe(false);
    });

    it('rejects immediately when signal already aborted (slow path, with contention)', async () => {
      const r1 = await gate.acquire('s1');
      const ac = new AbortController();
      ac.abort();

      await expect(
        gate.acquire('s1', { signal: ac.signal })
      ).rejects.toThrow();

      r1();
    });

    it('rejects when signal aborts while waiting in queue', async () => {
      const r1 = await gate.acquire('s1');
      const ac = new AbortController();

      const p = gate.acquire('s1', { signal: ac.signal });
      setTimeout(() => ac.abort(new Error('cancelled')), 20);

      await expect(p).rejects.toThrow('cancelled');
      r1();
      expect(gate.isLocked('s1')).toBe(false);
    });

    it('uses DOMException fallback when no abort reason given', async () => {
      const r1 = await gate.acquire('s1');
      const ac = new AbortController();

      const p = gate.acquire('s1', { signal: ac.signal });
      setTimeout(() => ac.abort(), 20);

      await expect(p).rejects.toThrow();
      r1();
    });
  });

  // -----------------------------------------------------------------------
  // acquire – timeout
  // -----------------------------------------------------------------------
  describe('acquire() - timeout', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('rejects if lock not released within timeout', async () => {
      const r1 = await gate.acquire('s1');

      const p = gate.acquire('s1', { timeout: 50 });
      vi.advanceTimersByTime(50);

      await expect(p).rejects.toThrow('SessionGate timeout after 50ms');
      r1();
    });

    it('instance-level default timeout works', async () => {
      const timeoutGate = new SessionGate({ timeout: 30 });
      const r1 = await timeoutGate.acquire('s1');

      const p = timeoutGate.acquire('s1');
      vi.advanceTimersByTime(30);

      await expect(p).rejects.toThrow('SessionGate timeout after 30ms');
      r1();
    });

    it('per-call timeout overrides instance default', async () => {
      const timeoutGate = new SessionGate({ timeout: 500 });
      const r1 = await timeoutGate.acquire('s1');

      const p = timeoutGate.acquire('s1', { timeout: 20 });
      vi.advanceTimersByTime(20);

      await expect(p).rejects.toThrow('SessionGate timeout after 20ms');
      r1();
    });

    it('does not reject if released before timeout', async () => {
      const r1 = await gate.acquire('s1');

      const p = gate.acquire('s1', { timeout: 100 });

      vi.advanceTimersByTime(10);
      r1();

      const r2 = await p;
      expect(gate.isLocked('s1')).toBe(true);
      r2();
    });

    it('timeout message includes session ID', async () => {
      const r1 = await gate.acquire('my-sess');

      const p = gate.acquire('my-sess', { timeout: 50 });
      vi.advanceTimersByTime(50);

      await expect(p).rejects.toThrow('my-sess');
      r1();
    });
  });

  // -----------------------------------------------------------------------
  // withSession()
  // -----------------------------------------------------------------------
  describe('withSession()', () => {
    it('runs fn and auto-releases', async () => {
      const result = await gate.withSession('s1', () => 42);
      expect(result).toBe(42);
      expect(gate.isLocked('s1')).toBe(false);
    });

    it('returns async fn return value', async () => {
      const result = await gate.withSession('s1', async () => 'async-value');
      expect(result).toBe('async-value');
      expect(gate.isLocked('s1')).toBe(false);
    });

    it('auto-releases on fn throw', async () => {
      await expect(
        gate.withSession('s1', () => { throw new Error('boom'); })
      ).rejects.toThrow('boom');
      expect(gate.isLocked('s1')).toBe(false);
      expect(gate.activeCount).toBe(0);
    });

    it('auto-releases on async fn rejection', async () => {
      await expect(
        gate.withSession('s1', async () => { throw new Error('async-boom'); })
      ).rejects.toThrow('async-boom');
      expect(gate.isLocked('s1')).toBe(false);
    });

    it('serializes withSession calls on same session', async () => {
      const order = [];
      const p1 = gate.withSession('s1', async () => {
        order.push(1);
        await new Promise((r) => setTimeout(r, 30));
        order.push(2);
      });
      const p2 = gate.withSession('s1', async () => {
        order.push(3);
      });
      await Promise.all([p1, p2]);
      expect(order).toEqual([1, 2, 3]);
    });
  });

  // -----------------------------------------------------------------------
  // isLocked()
  // -----------------------------------------------------------------------
  describe('isLocked()', () => {
    it('returns false for unknown session', () => {
      expect(gate.isLocked('nonexistent')).toBe(false);
    });

    it('returns true when session is locked', async () => {
      const release = await gate.acquire('s1');
      expect(gate.isLocked('s1')).toBe(true);
      release();
    });

    it('returns false after session is released', async () => {
      const release = await gate.acquire('s1');
      release();
      expect(gate.isLocked('s1')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // activeCount
  // -----------------------------------------------------------------------
  describe('activeCount', () => {
    it('starts at 0', () => {
      expect(gate.activeCount).toBe(0);
    });

    it('increments per locked session', async () => {
      const r1 = await gate.acquire('s1');
      expect(gate.activeCount).toBe(1);

      const r2 = await gate.acquire('s2');
      expect(gate.activeCount).toBe(2);

      r1();
      expect(gate.activeCount).toBe(1);

      r2();
      expect(gate.activeCount).toBe(0);
    });

    it('counts queued waiters within same session as one entry', async () => {
      const r1 = await gate.acquire('s1');
      const p2 = gate.acquire('s1');
      // still one Map entry for 's1' despite two holders/waiters
      expect(gate.activeCount).toBe(1);

      r1();
      const r2 = await p2;
      r2();
    });
  });

  // -----------------------------------------------------------------------
  // dispose()
  // -----------------------------------------------------------------------
  describe('dispose()', () => {
    it('prevents further acquisition', async () => {
      gate.dispose();
      await expect(gate.acquire('s1')).rejects.toThrow('SessionGate disposed');
    });

    it('clears all gates', async () => {
      await gate.acquire('s1');
      await gate.acquire('s2');
      expect(gate.activeCount).toBe(2);

      gate.dispose();
      expect(gate.activeCount).toBe(0);
    });

    it('is safe to call multiple times', () => {
      gate.dispose();
      gate.dispose(); // should not throw
    });
  });

  // -----------------------------------------------------------------------
  // Error cases
  // -----------------------------------------------------------------------
  describe('error cases', () => {
    it('throws on empty string sessionId', async () => {
      await expect(gate.acquire('')).rejects.toThrow('sessionId is required');
    });

    it('ErrConcurrentExecution is instanceof Error', () => {
      const err = new ErrConcurrentExecution('x');
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(ErrConcurrentExecution);
    });
  });
});
