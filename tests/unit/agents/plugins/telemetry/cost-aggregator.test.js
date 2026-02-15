import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CostAggregator } from '../../../../../js/agents/plugins/telemetry/cost-aggregator.js';

describe('CostAggregator', () => {
  /** @type {CostAggregator} */
  let agg;

  beforeEach(() => {
    agg = new CostAggregator();
  });

  describe('recordUsage', () => {
    it('records usage and accumulates', () => {
      agg.recordUsage('agent-1', { promptTokens: 100, completionTokens: 50, latencyMs: 200, model: 'gpt-4' });
      agg.recordUsage('agent-1', { promptTokens: 200, completionTokens: 100, latencyMs: 300, model: 'gpt-4' });
      const cost = agg.getAgentCost('agent-1');
      expect(cost.calls).toBe(2);
      expect(cost.promptTokens).toBe(300);
      expect(cost.completionTokens).toBe(150);
      expect(cost.totalTokens).toBe(450);
      expect(cost.totalLatencyMs).toBe(500);
    });

    it('rejects missing agentId', () => {
      expect(agg.recordUsage('', {}).ok).toBe(false);
      expect(agg.recordUsage(null, {}).ok).toBe(false);
    });

    it('handles missing or invalid token values', () => {
      agg.recordUsage('a', { promptTokens: 'bad', completionTokens: -5 });
      const cost = agg.getAgentCost('a');
      expect(cost.promptTokens).toBe(0);
      expect(cost.completionTokens).toBe(0);
    });

    it('uses totalTokens from usage if provided', () => {
      agg.recordUsage('a', { promptTokens: 10, completionTokens: 5, totalTokens: 20 });
      expect(agg.getAgentCost('a').totalTokens).toBe(20);
    });

    it('calculates totalTokens from prompt+completion if not provided', () => {
      agg.recordUsage('a', { promptTokens: 10, completionTokens: 5 });
      expect(agg.getAgentCost('a').totalTokens).toBe(15);
    });
  });

  describe('getAgentCost', () => {
    it('returns null for unknown agent', () => {
      expect(agg.getAgentCost('nope')).toBeNull();
    });
  });

  describe('getTotalCost', () => {
    it('aggregates across agents', () => {
      agg.recordUsage('a', { promptTokens: 100, completionTokens: 50, model: 'gpt-4' });
      agg.recordUsage('b', { promptTokens: 200, completionTokens: 100, model: 'claude' });
      const total = agg.getTotalCost();
      expect(total.agents).toBe(2);
      expect(total.calls).toBe(2);
      expect(total.promptTokens).toBe(300);
      expect(total.completionTokens).toBe(150);
    });

    it('returns zeros when empty', () => {
      const total = agg.getTotalCost();
      expect(total.agents).toBe(0);
      expect(total.calls).toBe(0);
    });
  });

  describe('getBreakdown', () => {
    it('returns sorted breakdown with model details', () => {
      agg.recordUsage('low', { promptTokens: 10, completionTokens: 5, model: 'gpt-4' });
      agg.recordUsage('high', { promptTokens: 1000, completionTokens: 500, model: 'claude' });
      const breakdown = agg.getBreakdown();
      expect(breakdown).toHaveLength(2);
      expect(breakdown[0].agentId).toBe('high');
      expect(breakdown[0].models).toHaveLength(1);
      expect(breakdown[0].models[0].model).toBe('claude');
    });
  });

  describe('snapshot and restore', () => {
    it('creates and restores', () => {
      agg.recordUsage('a', { promptTokens: 100, completionTokens: 50, model: 'gpt-4' });
      agg.recordUsage('b', { promptTokens: 200, completionTokens: 100, model: 'claude' });
      const snapshot = agg.getSnapshot();
      expect(snapshot.agents).toHaveLength(2);

      const agg2 = new CostAggregator();
      const result = agg2.restore(snapshot);
      expect(result.ok).toBe(true);
      expect(result.count).toBe(2);
      expect(agg2.getTotalCost().promptTokens).toBe(300);
      agg2.dispose();
    });

    it('rejects invalid snapshot', () => {
      expect(agg.restore(null).ok).toBe(false);
      expect(agg.restore({}).ok).toBe(false);
    });
  });

  describe('EventBus integration', () => {
    it('auto-records from llm:complete events', () => {
      const handlers = new Map();
      const eventBus = {
        on: (name, handler) => { handlers.set(name, handler); return () => handlers.delete(name); },
      };
      const aggWithBus = new CostAggregator({ eventBus });
      const llmCompleteHandler = handlers.get('llm:complete');
      expect(typeof llmCompleteHandler).toBe('function');

      llmCompleteHandler({ payload: { agentId: 'agent-1', promptTokens: 100, completionTokens: 50, model: 'gpt-4' } });
      expect(aggWithBus.getAgentCost('agent-1').calls).toBe(1);
      aggWithBus.dispose();
    });

    it('uses actor as fallback agentId', () => {
      const handlers = new Map();
      const eventBus = {
        on: (name, handler) => { handlers.set(name, handler); return () => handlers.delete(name); },
      };
      const aggWithBus = new CostAggregator({ eventBus });
      const llmCompleteHandler = handlers.get('llm:complete');
      expect(typeof llmCompleteHandler).toBe('function');
      llmCompleteHandler({ payload: { actor: 'design', promptTokens: 50 } });
      expect(aggWithBus.getAgentCost('design')).not.toBeNull();
      aggWithBus.dispose();
    });
  });

  describe('dispose', () => {
    it('rejects operations after dispose', () => {
      agg.dispose();
      expect(agg.recordUsage('a', {}).ok).toBe(false);
      expect(agg.restore({ agents: [] }).ok).toBe(false);
    });

    it('clears data on dispose', () => {
      agg.recordUsage('a', { promptTokens: 100 });
      expect(agg.agentCount).toBe(1);
      agg.dispose();
      expect(agg.agentCount).toBe(0);
    });
  });
});
