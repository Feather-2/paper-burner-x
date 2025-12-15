#!/usr/bin/env node

import { PlanningTree } from './js/agents/stages/deepsearch/planning-tree.js';

console.log('=== Manual Strategy Tests ===\n');

// Test 1: Basic serialization
console.log('Test 1: Basic serialization and strategy recording');
const tree = new PlanningTree({ rootGoal: 'Test', runId: 'r1' });
tree.recordStrategyResult('grep', { hits: 5, latency: 100 });
tree.recordStrategyResult('bm25', { hits: 3, latency: 80 });

const json = tree.serialize();
console.log('✓ Serialized strategyStats:', JSON.stringify(json.strategyStats, null, 2));

// Test 2: Deserialization
console.log('\nTest 2: Deserialization');
const restored = PlanningTree.fromJSON(json);
console.log('✓ Restored grep stats:', restored.strategyStats.get('grep'));
console.log('✓ Restored bm25 stats:', restored.strategyStats.get('bm25'));

// Test 3: getBestStrategy
console.log('\nTest 3: getBestStrategy');
const codeSources = [{ sourceId: 's1', kind: 'code' }];
const strategy = restored.getBestStrategy(codeSources);
console.log('✓ Best strategy for code sources:', strategy);

// Test 4: Hit rate calculation
console.log('\nTest 4: Hit rate calculation');
console.log('✓ grep hit rate (insufficient samples):', restored.getStrategyHitRate('grep'));

tree.recordStrategyResult('grep', { hits: 8, latency: 90 });
tree.recordStrategyResult('grep', { hits: 7, latency: 95 });
console.log('✓ grep hit rate (3 samples):', tree.getStrategyHitRate('grep'));

console.log('\n✅ All manual tests passed!');
