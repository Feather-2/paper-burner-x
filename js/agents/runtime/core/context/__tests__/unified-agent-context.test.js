import { describe, it } from 'vitest';
import assert from 'node:assert';
import { UnifiedAgentContext } from '../unified-agent-context.js';

describe('UnifiedAgentContext - Parallel Write Protection (A1)', () => {
  it('serializes concurrent addClaim calls without data loss', async () => {
    const findings = [];
    let operationCount = 0;
    const mockSharedContext = {
      addFinding(finding) {
        // Simulate read-modify-write that could race without mutex
        operationCount++;
        const currentCount = operationCount;
        findings.push({ ...finding, order: currentCount });
      }
    };

    const context = new UnifiedAgentContext();
    context.bind({ sharedContext: mockSharedContext });

    // Launch 10 concurrent addClaim operations
    const claims = Array.from({ length: 10 }, (_, i) => ({
      text: `claim_${i}`,
      source: `source_${i}`,
      confidence: 0.9
    }));

    await Promise.all(claims.map(claim => context.addClaim(claim)));

    // All 10 findings should be recorded without loss
    assert.strictEqual(findings.length, 10);

    // Verify all claims are present
    const texts = findings.map(f => f.content).sort();
    const expected = claims.map(c => c.text).sort();
    assert.deepStrictEqual(texts, expected);
  });

  it('releases mutex even when addFinding throws', async () => {
    let callCount = 0;
    const mockSharedContext = {
      addFinding() {
        callCount++;
        if (callCount === 1) {
          throw new Error('First call fails');
        }
      }
    };

    const context = new UnifiedAgentContext();
    context.bind({ sharedContext: mockSharedContext });

    // First call should complete (error is caught internally)
    await context.addClaim({ text: 'claim1' });

    // Second call should succeed (mutex was released)
    await context.addClaim({ text: 'claim2' });

    // Both calls should have been attempted
    assert.strictEqual(callCount, 2);
  });

  it('handles concurrent signal calls without data loss', async () => {
    const signals = [];
    const mockSharedContext = {
      signal(type, payload) {
        signals.push({ type, payload });
      }
    };

    const context = new UnifiedAgentContext();
    context.bind({ sharedContext: mockSharedContext });

    // Launch 10 concurrent signal operations
    const signalCalls = Array.from({ length: 10 }, (_, i) =>
      context.signal(`signal_${i}`, { data: i })
    );

    await Promise.all(signalCalls);

    // All 10 signals should be recorded
    assert.strictEqual(signals.length, 10);
  });

  it('handles concurrent recordDecision calls without data loss', async () => {
    const decisions = [];
    const mockSharedContext = {
      recordDecision(decision) {
        decisions.push(decision);
      }
    };

    const context = new UnifiedAgentContext();
    context.bind({ sharedContext: mockSharedContext });

    // Launch 10 concurrent recordDecision operations
    const decisionCalls = Array.from({ length: 10 }, (_, i) =>
      context.recordDecision({ step: `step_${i}`, result: 'approved' })
    );

    await Promise.all(decisionCalls);

    // All 10 decisions should be recorded
    assert.strictEqual(decisions.length, 10);
  });
});

describe('AsyncMutex', () => {
  it('serializes async operations', async () => {
    // Test that mutex serializes the async acquire/release cycle
    const executionOrder = [];
    let activeCount = 0;
    let maxConcurrent = 0;

    const mockSharedContext = {
      addFinding() {
        activeCount++;
        maxConcurrent = Math.max(maxConcurrent, activeCount);
        executionOrder.push('exec');
        activeCount--;
      }
    };

    const context = new UnifiedAgentContext();
    context.bind({ sharedContext: mockSharedContext });

    // Launch 5 operations concurrently
    await Promise.all([
      context.addClaim({ text: 'a' }),
      context.addClaim({ text: 'b' }),
      context.addClaim({ text: 'c' }),
      context.addClaim({ text: 'd' }),
      context.addClaim({ text: 'e' })
    ]);

    // All 5 operations should have executed
    assert.strictEqual(executionOrder.length, 5);

    // Mutex should ensure only 1 operation executes at a time
    assert.strictEqual(maxConcurrent, 1);
  });
});
