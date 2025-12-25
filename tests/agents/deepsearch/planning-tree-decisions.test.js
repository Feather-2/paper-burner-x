const test = require("node:test");
const assert = require("node:assert/strict");

function setupTree() {
  const { PlanningTree } = require("../../../js/agents/stages/deepsearch/planning-tree.js");

  const tree = new PlanningTree({ rootGoal: 'Test research goal', runId: 'test-run-1' });

  const gap1 = {
    gapId: 'gap_1',
    type: 'definition',
    question: 'What is the core concept?',
    priority: 'high',
    queryHints: ['definition', 'concept', 'overview']
  };

  const gap2 = {
    gapId: 'gap_2',
    type: 'data',
    question: 'What are the key statistics?',
    priority: 'medium',
    queryHints: ['data', 'statistics', 'numbers']
  };

  tree.expandFromGap(gap1);
  tree.expandFromGap(gap2);

  return { tree, gap1, gap2, PlanningTree };
}

test("PlanningTree recordDecision: should record decision to node", async () => {
  const { tree } = setupTree();

  const nodes = tree.getNodesForGap('gap_1');
  assert.ok(nodes.length > 0);

  const nodeId = nodes[0].nodeId;
  const success = tree.recordDecision(nodeId, {
    stage: 'retrieve',
    action: 'BM25 search',
    reason: 'Using BM25 for text search',
    outcome: 'success',
    metrics: { hits: 5, latency: 120 }
  });

  assert.equal(success, true);

  const decisions = tree.getDecisionHistory(nodeId);
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].stage, 'retrieve');
  assert.equal(decisions[0].action, 'BM25 search');
  assert.equal(decisions[0].outcome, 'success');
  assert.ok(decisions[0].timestamp !== undefined);
});

test("PlanningTree recordDecision: should handle invalid nodeId", async () => {
  const { tree } = setupTree();

  const success = tree.recordDecision('invalid-node-id', {
    stage: 'retrieve',
    action: 'test',
    outcome: 'success'
  });

  assert.equal(success, false);
});

test("PlanningTree recordDecision: should normalize invalid outcome", async () => {
  const { tree } = setupTree();

  const nodes = tree.getNodesForGap('gap_1');
  const nodeId = nodes[0].nodeId;

  tree.recordDecision(nodeId, {
    stage: 'retrieve',
    action: 'test',
    outcome: 'invalid-outcome'
  });

  const decisions = tree.getDecisionHistory(nodeId);
  assert.equal(decisions[0].outcome, 'unknown');
});

test("PlanningTree recordDecision: should initialize decisions array if missing", async () => {
  const { tree } = setupTree();

  const nodes = tree.getNodesForGap('gap_1');
  const node = nodes[0];

  delete node.decisions;

  const success = tree.recordDecision(node.nodeId, {
    stage: 'retrieve',
    action: 'test',
    outcome: 'success'
  });

  assert.equal(success, true);
  assert.equal(Array.isArray(node.decisions), true);
  assert.equal(node.decisions.length, 1);
});

test("PlanningTree getDecisionHistory: should return full history", async () => {
  const { tree } = setupTree();

  const nodes = tree.getNodesForGap('gap_1');
  const nodeId = nodes[0].nodeId;

  tree.recordDecision(nodeId, { stage: 'retrieve', action: 'BM25 search', outcome: 'success', metrics: { hits: 5 } });
  tree.recordDecision(nodeId, { stage: 'retrieve', action: 'grep search', outcome: 'fail', metrics: { hits: 0 } });
  tree.recordDecision(nodeId, { stage: 'retrieve', action: 'external search', outcome: 'partial', metrics: { hits: 2 } });

  const history = tree.getDecisionHistory(nodeId);
  assert.equal(history.length, 3);
  assert.equal(history[0].action, 'BM25 search');
  assert.equal(history[1].action, 'grep search');
  assert.equal(history[2].action, 'external search');
});

test("PlanningTree getDecisionHistory: should return empty array for invalid node", async () => {
  const { tree } = setupTree();

  const history = tree.getDecisionHistory('invalid-node-id');
  assert.deepEqual(history, []);
});

test("PlanningTree getDecisionHistory: should return shallow copy", async () => {
  const { tree } = setupTree();

  const nodes = tree.getNodesForGap('gap_1');
  const nodeId = nodes[0].nodeId;

  tree.recordDecision(nodeId, { stage: 'retrieve', action: 'test', outcome: 'success' });

  const history1 = tree.getDecisionHistory(nodeId);
  const history2 = tree.getDecisionHistory(nodeId);

  assert.notStrictEqual(history1, history2);
  assert.deepEqual(history1, history2);
});

test("PlanningTree analyzeGapFailure: should analyze failure reasons", async () => {
  const { tree } = setupTree();

  const nodes = tree.getNodesForGap('gap_1');

  for (const node of nodes) {
    tree.recordDecision(node.nodeId, { stage: 'retrieve', action: 'BM25 search', reason: 'no hits found', outcome: 'fail', metrics: { hits: 0 } });
    tree.recordDecision(node.nodeId, { stage: 'retrieve', action: 'grep search', reason: 'no hits found', outcome: 'fail', metrics: { hits: 0 } });
    tree.recordDecision(node.nodeId, { stage: 'retrieve', action: 'external search', reason: 'timeout error', outcome: 'partial', metrics: { hits: 1 } });
  }

  const analysis = tree.analyzeGapFailure('gap_1');

  assert.ok(analysis.failureCount > 0);
  assert.equal(analysis.totalAttempts, nodes.length * 3);
  assert.ok(parseFloat(analysis.successRate) < 1.0);
  assert.ok(analysis.commonReasons.length > 0);
  assert.ok(analysis.suggestedActions.length > 0);
  assert.deepEqual(analysis.relatedNodeIds, nodes.map(n => n.nodeId));
});

test("PlanningTree analyzeGapFailure: should count failure reasons correctly", async () => {
  const { tree } = setupTree();

  const nodes = tree.getNodesForGap('gap_1');

  for (const node of nodes) {
    tree.recordDecision(node.nodeId, { stage: 'retrieve', action: 'test1', reason: 'no hits found', outcome: 'fail' });
    tree.recordDecision(node.nodeId, { stage: 'retrieve', action: 'test2', reason: 'no hits found', outcome: 'fail' });
    tree.recordDecision(node.nodeId, { stage: 'retrieve', action: 'test3', reason: 'timeout', outcome: 'fail' });
  }

  const analysis = tree.analyzeGapFailure('gap_1');
  const noHitsReason = analysis.commonReasons.find(r => r.reason === 'no hits found');

  assert.ok(noHitsReason !== undefined);
  assert.equal(noHitsReason.count, nodes.length * 2);
});

test("PlanningTree analyzeGapFailure: should generate suggestions for retrieve failures", async () => {
  const { tree } = setupTree();

  const nodes = tree.getNodesForGap('gap_1');

  for (const node of nodes) {
    for (let i = 0; i < 3; i++) {
      tree.recordDecision(node.nodeId, { stage: 'retrieve', action: `attempt ${i + 1}`, reason: 'low quality results', outcome: 'fail' });
    }
  }

  const analysis = tree.analyzeGapFailure('gap_1');
  const retrieveSuggestion = analysis.suggestedActions.find(s => s.stage === 'retrieve');

  assert.ok(retrieveSuggestion !== undefined);
  assert.ok(retrieveSuggestion.suggestion.includes('检索阶段反复失败'));
});

test("PlanningTree analyzeGapFailure: should handle no decisions", async () => {
  const { tree } = setupTree();

  const analysis = tree.analyzeGapFailure('gap_1');

  assert.equal(analysis.failureCount, 0);
  assert.equal(analysis.totalAttempts, 0);
  assert.equal(analysis.successRate, '0.00');
  assert.deepEqual(analysis.commonReasons, []);
  assert.deepEqual(analysis.suggestedActions, []);
});

test("PlanningTree analyzeGapFailure: should handle non-existent gapId", async () => {
  const { tree } = setupTree();

  const analysis = tree.analyzeGapFailure('non-existent-gap');

  assert.equal(analysis.failureCount, 0);
  assert.equal(analysis.totalAttempts, 0);
  assert.deepEqual(analysis.relatedNodeIds, []);
});

test("PlanningTree serialize: should preserve decisions", async () => {
  const { tree } = setupTree();

  const nodes = tree.getNodesForGap('gap_1');
  const nodeId = nodes[0].nodeId;

  tree.recordDecision(nodeId, { stage: 'retrieve', action: 'test', outcome: 'success', metrics: { hits: 5 } });

  const serialized = tree.serialize();

  assert.ok(serialized.nodes !== undefined);
  const serializedNode = serialized.nodes[nodeId];
  assert.ok(serializedNode !== undefined);
  assert.equal(Array.isArray(serializedNode.decisions), true);
  assert.equal(serializedNode.decisions.length, 1);
  assert.equal(serializedNode.decisions[0].action, 'test');
});

test("PlanningTree fromJSON: should restore decisions", async () => {
  const { tree, PlanningTree } = setupTree();

  const nodes = tree.getNodesForGap('gap_1');
  const nodeId = nodes[0].nodeId;

  tree.recordDecision(nodeId, { stage: 'retrieve', action: 'test', outcome: 'success', metrics: { hits: 5 } });

  const serialized = tree.serialize();
  const deserialized = PlanningTree.fromJSON(serialized);

  const deserializedNode = deserialized.nodes.get(nodeId);
  assert.ok(deserializedNode !== undefined);
  assert.equal(Array.isArray(deserializedNode.decisions), true);
  assert.equal(deserializedNode.decisions.length, 1);
  assert.equal(deserializedNode.decisions[0].action, 'test');
});

test("PlanningTree fromJSON: should handle old data without decisions", async () => {
  const { tree, PlanningTree } = setupTree();

  const serialized = tree.serialize();

  for (const nodeId of Object.keys(serialized.nodes)) {
    delete serialized.nodes[nodeId].decisions;
  }

  const deserialized = PlanningTree.fromJSON(serialized);

  const nodes = deserialized.getNodesForGap('gap_1');
  assert.ok(nodes.length > 0);

  const nodeId = nodes[0].nodeId;
  const success = deserialized.recordDecision(nodeId, { stage: 'retrieve', action: 'test', outcome: 'success' });

  assert.equal(success, true);
});

test("PlanningTree integration: full gap lifecycle tracking", async () => {
  const { tree } = setupTree();

  const nodes = tree.getNodesForGap('gap_1');
  const nodeId = nodes[0].nodeId;

  tree.recordDecision(nodeId, { stage: 'retrieve', action: 'BM25 initial search', reason: 'Using default queryHints', outcome: 'fail', metrics: { hits: 0, latency: 50 } });
  tree.recordDecision(nodeId, { stage: 'retrieve', action: 'BM25 refined search', reason: 'Refined queryHints based on LLM', outcome: 'partial', metrics: { hits: 2, latency: 80 } });
  tree.recordDecision(nodeId, { stage: 'retrieve', action: 'external search', reason: 'Local results insufficient', outcome: 'success', metrics: { hits: 5, latency: 1200 } });
  tree.recordDecision(nodeId, { stage: 'understand', action: 'extract claims', reason: 'Extracted from 7 total evidence', outcome: 'success', metrics: { claimCount: 3, evidenceCount: 7 } });
  tree.recordDecision(nodeId, { stage: 'gaps', action: 'gap filled', reason: 'Sufficient evidence collected', outcome: 'success', metrics: { finalHits: 7 } });

  const history = tree.getDecisionHistory(nodeId);
  assert.equal(history.length, 5);

  const stageProgression = history.map(d => d.stage);
  assert.deepEqual(stageProgression, ['retrieve', 'retrieve', 'retrieve', 'understand', 'gaps']);

  const outcomes = history.map(d => d.outcome);
  assert.deepEqual(outcomes, ['fail', 'partial', 'success', 'success', 'success']);
});
