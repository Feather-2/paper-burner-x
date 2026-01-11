const test = require('node:test');
const assert = require('node:assert/strict');

// Import FlowBuilder class
const { FlowBuilder } = require('../../js/ppt/dashboard/deepsearch-flow-visualizer.js');

test('FlowBuilder initializes with empty state', () => {
  const builder = new FlowBuilder();
  assert.equal(builder.nodes.length, 0);
  assert.equal(builder.edges.length, 0);
  assert.equal(builder.nodeMap.size, 0);
  assert.equal(builder.idCounter, 0);
  assert.equal(builder.lastUpdatedNodeId, null);
  assert.equal(builder._refineStepNodeId, null);
});

// Test 1: design.phase.transition creates phase nodes
test('design.phase.transition creates phase node with status', () => {
  const builder = new FlowBuilder();
  builder.processEvent({ name: 'design.started', payload: { runId: 'run_1' } });

  builder.processEvent({
    name: 'design.phase.transition',
    payload: { from: 'style_confirming', to: 'generating' }
  });

  const node = builder.nodes.find(n => n.data.label === 'Generate Slides');
  assert.ok(node, 'phase node should be created');
  assert.equal(node.data.status, 'running');
  assert.equal(node.data.metrics.from, 'style_confirming');
  assert.equal(node.data.metrics.to, 'generating');
});

// Test 2: design.image.generate.started creates image generation node
test('design.image.generate.started creates image generation node', () => {
  const builder = new FlowBuilder();

  // Setup parent
  builder.processEvent({ name: 'design.started', payload: { runId: 'run_1' } });

  builder.processEvent({
    name: 'design.image.generate.started',
    payload: {
      imageId: 'img_001',
      slideIndex: 2,
      provider: 'flux-1.1-pro'
    }
  });

  const nodeId = builder.designImageNodes.get('img_001');
  assert.ok(nodeId, 'image node should be tracked');

  const node = builder.nodeMap.get(nodeId);
  assert.ok(node, 'image node should exist');
  assert.equal(node.data.label, 'Image S3');
  assert.equal(node.data.status, 'running');
  assert.equal(node.data.metrics.provider, 'flux-1.1-pro');
});

test('design.image.generate.started handles missing slideIndex', () => {
  const builder = new FlowBuilder();
  builder.processEvent({ name: 'design.started', payload: {} });

  builder.processEvent({
    name: 'design.image.generate.started',
    payload: { imageId: 'img_002', provider: 'dall-e-3' }
  });

  const nodeId = builder.designImageNodes.get('img_002');
  const node = builder.nodeMap.get(nodeId);
  assert.ok(node);
  assert.equal(node.data.label, 'Image img_002');
});

// Test 3: design.image.generate.succeeded updates image node status
test('design.image.generate.succeeded updates image node to completed', () => {
  const builder = new FlowBuilder();
  builder.processEvent({ name: 'design.started', payload: {} });

  // Start generation
  builder.processEvent({
    name: 'design.image.generate.started',
    payload: { imageId: 'img_003', slideIndex: 1 }
  });

  const nodeId = builder.designImageNodes.get('img_003');
  let node = builder.nodeMap.get(nodeId);
  assert.equal(node.data.status, 'running');

  // Complete generation
  builder.processEvent({
    name: 'design.image.generate.succeeded',
    payload: { imageId: 'img_003', durationMs: 2500 }
  });

  node = builder.nodeMap.get(nodeId);
  assert.equal(node.data.status, 'completed');
  assert.equal(node.data.metrics.duration, 2500);
});

test('design.image.generate.succeeded handles unknown imageId', () => {
  const builder = new FlowBuilder();

  // Try to complete non-existent image
  builder.processEvent({
    name: 'design.image.generate.succeeded',
    payload: { imageId: 'img_unknown', duration: 1000 }
  });

  // Should not crash
  assert.equal(builder.nodes.length, 0);
});

// Test 4: design.generate.ended creates checkpoint node
test('design.generate.ended creates checkpoint node', () => {
  const builder = new FlowBuilder();
  builder.processEvent({ name: 'design.started', payload: {} });

  builder.processEvent({
    name: 'design.generate.ended',
    payload: { slideCount: 8, batchCount: 2 }
  });

  const checkpointNode = builder.nodes.find(n => n.data.label === 'Generation Done');
  assert.ok(checkpointNode, 'checkpoint node should be created');
  assert.equal(checkpointNode.data.nodeType, 'checkpoint');
  assert.equal(checkpointNode.data.status, 'completed');
  assert.equal(checkpointNode.data.metrics.slides, 8);
  assert.equal(checkpointNode.data.metrics.batches, 2);
});

// Test 5: design.degraded creates error node
test('design.degraded creates error node with slideIndex', () => {
  const builder = new FlowBuilder();
  builder.processEvent({ name: 'design.started', payload: {} });

  builder.processEvent({
    name: 'design.degraded',
    payload: {
      slideIndex: 4,
      reason: 'Failed to apply theme colors'
    }
  });

  const errorNode = builder.nodes.find(n => n.data.nodeType === 'error');
  assert.ok(errorNode, 'error node should be created');
  assert.equal(errorNode.data.label, 'S5 Degraded');
  assert.equal(errorNode.data.status, 'failed');
  assert.equal(errorNode.data.details[0].text, 'Failed to apply theme colors');
});

test('design.degraded creates error node without slideIndex', () => {
  const builder = new FlowBuilder();
  builder.processEvent({ name: 'design.started', payload: {} });

  builder.processEvent({
    name: 'design.degraded',
    payload: { reason: 'General failure' }
  });

  const errorNode = builder.nodes.find(n => n.data.nodeType === 'error');
  assert.ok(errorNode);
  assert.equal(errorNode.data.label, 'Degraded');
});

test('design.degraded uses default reason if missing', () => {
  const builder = new FlowBuilder();
  builder.processEvent({ name: 'design.started', payload: {} });

  builder.processEvent({
    name: 'design.degraded',
    payload: { slideIndex: 2 }
  });

  const errorNode = builder.nodes.find(n => n.data.nodeType === 'error');
  assert.equal(errorNode.data.details[0].text, 'Quality degradation detected');
});

// Test 6: design.refine.step creates iteration node
test('design.refine.step creates iteration node', () => {
  const builder = new FlowBuilder();
  builder.processEvent({ name: 'design.started', payload: {} });

  builder.processEvent({
    name: 'design.refine.step',
    payload: {
      step: 'color-harmony',
      iteration: 1,
      target: 'slide_2'
    }
  });

  const refineNode = builder.nodes.find(n => n.data.label?.startsWith('Refine'));
  assert.ok(refineNode, 'refine step node should be created');
  assert.equal(refineNode.data.nodeType, 'iteration');
  assert.equal(refineNode.data.status, 'running');
  assert.equal(refineNode.data.label, 'Refine color-harmony');
  assert.equal(refineNode.data.metrics.iteration, 1);
  assert.equal(refineNode.data.metrics.target, 'slide_2');
  assert.ok(builder._refineStepNodeId, 'should track refine step node id');
});

test('design.refine.step handles missing step name', () => {
  const builder = new FlowBuilder();
  builder.processEvent({ name: 'design.started', payload: {} });

  builder.processEvent({
    name: 'design.refine.step',
    payload: { iteration: 0 }
  });

  const refineNode = builder.nodes.find(n => n.data.label?.startsWith('Refine'));
  assert.ok(refineNode);
  assert.equal(refineNode.data.label, 'Refine Step');
});

// Test 7: design.refine.ended updates or creates node
test('design.refine.ended updates existing refine step node', () => {
  const builder = new FlowBuilder();
  builder.processEvent({ name: 'design.started', payload: {} });

  // Start refine step
  builder.processEvent({
    name: 'design.refine.step',
    payload: { step: 'layout-fix', iteration: 1 }
  });

  const refineId = builder._refineStepNodeId;
  assert.ok(refineId);

  // End refine
  builder.processEvent({
    name: 'design.refine.ended',
    payload: { improvements: 3 }
  });

  const node = builder.nodeMap.get(refineId);
  assert.equal(node.data.status, 'completed');
  assert.equal(node.data.metrics.improvements, 3);
  assert.equal(builder._refineStepNodeId, null, 'should clear refine step node id');
});

test('design.refine.ended creates checkpoint if no active refine step', () => {
  const builder = new FlowBuilder();
  builder.processEvent({ name: 'design.started', payload: {} });

  // End refine without starting
  builder.processEvent({
    name: 'design.refine.ended',
    payload: { improvements: 2 }
  });

  const checkpointNode = builder.nodes.find(n => n.data.label === 'Refine Done');
  assert.ok(checkpointNode, 'checkpoint node should be created');
  assert.equal(checkpointNode.data.nodeType, 'checkpoint');
  assert.equal(checkpointNode.data.status, 'completed');
  assert.equal(checkpointNode.data.metrics.improvements, 2);
});

// Test 8: design.slide.failed handles error object and string formats
test('design.slide.failed handles error object', () => {
  const builder = new FlowBuilder();
  builder.processEvent({ name: 'design.started', payload: {} });

  // Start slide
  builder.processEvent({
    name: 'design.slide.started',
    payload: { slideIndex: 1, slideIntent: { title: 'Test' } }
  });

  // Fail with error object
  builder.processEvent({
    name: 'design.slide.failed',
    payload: {
      slideIndex: 1,
      error: { message: 'Network timeout' }
    }
  });

  const node = builder.designSlideNodes.get(1);
  const slideNode = builder.nodeMap.get(node);
  assert.equal(slideNode.data.status, 'failed');
  assert.equal(slideNode.data.details[0].text, 'Failed: Network timeout');
});

test('design.slide.failed handles error string', () => {
  const builder = new FlowBuilder();
  builder.processEvent({ name: 'design.started', payload: {} });

  builder.processEvent({
    name: 'design.slide.started',
    payload: { slideIndex: 2, slideIntent: {} }
  });

  // Fail with error string
  builder.processEvent({
    name: 'design.slide.failed',
    payload: {
      slideIndex: 2,
      error: 'LLM rate limit exceeded'
    }
  });

  const node = builder.designSlideNodes.get(2);
  const slideNode = builder.nodeMap.get(node);
  assert.equal(slideNode.data.status, 'failed');
  assert.equal(slideNode.data.details[0].text, 'Failed: LLM rate limit exceeded');
});

test('design.slide.failed handles missing error', () => {
  const builder = new FlowBuilder();
  builder.processEvent({ name: 'design.started', payload: {} });

  builder.processEvent({
    name: 'design.slide.started',
    payload: { slideIndex: 0, slideIntent: {} }
  });

  builder.processEvent({
    name: 'design.slide.failed',
    payload: { slideIndex: 0 }
  });

  const node = builder.designSlideNodes.get(0);
  const slideNode = builder.nodeMap.get(node);
  assert.equal(slideNode.data.status, 'failed');
  assert.equal(slideNode.data.details[0].text, 'Failed: unknown error');
});

// Test 9: reset() clears all design-related state
test('reset() clears all design flow state', () => {
  const builder = new FlowBuilder();

  // Populate design state
  builder.processEvent({ name: 'design.started', payload: {} });
  builder.processEvent({ name: 'design.phase.transition', payload: { from: 'style_confirming', to: 'generating' } });
  builder.processEvent({ name: 'design.batch.started', payload: { batchIndex: 0 } });
  builder.processEvent({ name: 'design.slide.started', payload: { slideIndex: 0 } });
  builder.processEvent({ name: 'design.image.generate.started', payload: { imageId: 'img1' } });
  builder.processEvent({ name: 'design.refine.step', payload: { step: 'test' } });

  assert.ok(builder.nodes.length > 0);
  assert.ok(builder._refineStepNodeId);
  assert.ok(builder.designBatchNodes.size > 0);
  assert.ok(builder.designSlideNodes.size > 0);
  assert.ok(builder.designImageNodes.size > 0);
  assert.ok(builder.designPhaseNodes.size > 0);

  // Reset
  builder.reset();

  // Verify all cleared
  assert.equal(builder.nodes.length, 0);
  assert.equal(builder.edges.length, 0);
  assert.equal(builder.nodeMap.size, 0);
  assert.equal(builder.lastUpdatedNodeId, null);
  assert.equal(builder.designBatchNodes.size, 0);
  assert.equal(builder.designSlideNodes.size, 0);
  assert.equal(builder.designImageNodes.size, 0);
  assert.equal(builder.designPhaseNodes.size, 0);
  assert.equal(builder._activeDesignPhaseId, null);
  assert.equal(builder._refineStepNodeId, null);
});

// Test 10: Complete design flow integration
test('complete design flow creates correct node hierarchy', () => {
  const builder = new FlowBuilder();

  // Full design flow
  builder.processEvent({ name: 'design.started', payload: { runId: 'run_1', slideCount: 3 } });
  builder.processEvent({ name: 'design.tokens.ended', payload: { theme: 'corporate' } });
  builder.processEvent({ name: 'design.phase.transition', payload: { from: 'style_confirming', to: 'generating' } });
  builder.processEvent({ name: 'design.phase.transition', payload: { from: 'generating', to: 'reviewing' } });
  builder.processEvent({ name: 'design.image.planning.completed', payload: { planned: 2, estimatedCostUSD: 0.08 } });
  builder.processEvent({ name: 'design.batch.started', payload: { batchIndex: 0, slideIndexes: [0, 1, 2] } });
  builder.processEvent({ name: 'design.slide.started', payload: { slideIndex: 0, slideIntent: { title: 'Cover' } } });
  builder.processEvent({ name: 'design.slide.completed', payload: { slideIndex: 0, duration: 1200 } });
  builder.processEvent({ name: 'design.batch.completed', payload: { batchIndex: 0, duration: 5000 } });
  builder.processEvent({ name: 'design.generate.ended', payload: { slideCount: 3, batchCount: 1 } });
  builder.processEvent({ name: 'design.phase.transition', payload: { from: 'reviewing', to: 'visual_filling' } });
  builder.processEvent({ name: 'design.refine.step', payload: { step: 'final-polish', iteration: 0 } });
  builder.processEvent({ name: 'design.refine.ended', payload: { improvements: 2 } });
  builder.processEvent({ name: 'design.qa.ended', payload: { degradedCount: 0, slides: 3 } });
  builder.processEvent({ name: 'design.phase.transition', payload: { from: 'visual_filling', to: 'completed' } });
  builder.processEvent({ name: 'design.ended', payload: { slides: 3, degradedCount: 0 } });

  // Verify key nodes exist
  assert.ok(builder.nodes.find(n => n.data.label === 'Design Started'));
  assert.ok(builder.nodes.find(n => n.data.label === 'Theme'));
  assert.ok(builder.nodes.find(n => n.data.label === 'Generate Slides'));
  assert.ok(builder.nodes.find(n => n.data.label === 'Review'));
  assert.ok(builder.nodes.find(n => n.data.label === 'Image Plan'));
  assert.ok(builder.nodes.find(n => n.data.label === 'Batch #1'));
  assert.ok(builder.nodes.find(n => n.data.label === 'S1 Cover'));
  assert.ok(builder.nodes.find(n => n.data.label === 'Generation Done'));
  assert.ok(builder.nodes.find(n => n.data.label === 'Refine final-polish'));
  assert.ok(builder.nodes.find(n => n.data.label === 'QA Complete'));
  assert.ok(builder.nodes.find(n => n.data.label === 'Design Done'));

  // Verify edges connect properly
  assert.ok(builder.edges.length > 0, 'should have edges connecting nodes');

  // Verify final counts
  assert.ok(builder.nodes.length >= 10, 'should have at least 10 nodes');
});

// Test 11: lastUpdatedNodeId tracking
test('lastUpdatedNodeId tracks most recent update', () => {
  const builder = new FlowBuilder();

  builder.processEvent({ name: 'design.started', payload: {} });
  const startId = builder.lastUpdatedNodeId;
  assert.ok(startId);

  builder.processEvent({ name: 'design.phase.transition', payload: { from: 'style_confirming', to: 'generating' } });
  const phaseId = builder.lastUpdatedNodeId;
  assert.ok(phaseId);
  assert.notEqual(phaseId, startId);

  builder.processEvent({ name: 'design.phase.transition', payload: { from: 'style_confirming', to: 'generating' } });
  // Should update to same phase node id
  assert.equal(builder.lastUpdatedNodeId, phaseId);
});

// Test 12: Parent-child relationships
test('design events create correct parent-child relationships', () => {
  const builder = new FlowBuilder();

  builder.processEvent({ name: 'design.started', payload: {} });
  const designStartId = 'design_start';

  builder.processEvent({ name: 'design.batch.started', payload: { batchIndex: 0 } });
  const batchId = builder.designBatchNodes.get(0);
  const batchNode = builder.nodeMap.get(batchId);

  // Batch should be child of design_start
  const batchEdge = builder.edges.find(e => e.target === batchId);
  assert.ok(batchEdge, 'batch should have incoming edge');
  assert.equal(batchEdge.source, designStartId);

  builder.processEvent({ name: 'design.slide.started', payload: { slideIndex: 0 } });
  const slideId = builder.designSlideNodes.get(0);

  // Slide should be child of batch (since batch is on parent stack)
  const slideEdge = builder.edges.find(e => e.target === slideId);
  assert.ok(slideEdge, 'slide should have incoming edge');
  assert.equal(slideEdge.source, batchId);
});

// Test 13: Metrics preservation across updates
test('_updateNode preserves existing metrics', () => {
  const builder = new FlowBuilder();

  builder.processEvent({ name: 'design.started', payload: {} });
  builder.processEvent({
    name: 'design.image.generate.started',
    payload: { imageId: 'img_10', provider: 'flux' }
  });

  const nodeId = builder.designImageNodes.get('img_10');
  let node = builder.nodeMap.get(nodeId);
  assert.equal(node.data.metrics.provider, 'flux');

  builder.processEvent({
    name: 'design.image.generate.succeeded',
    payload: { imageId: 'img_10', durationMs: 1200 }
  });

  node = builder.nodeMap.get(nodeId);
  assert.equal(node.data.metrics.provider, 'flux', 'should preserve original metrics');
  assert.equal(node.data.metrics.duration, 1200);
});

// Test 14: Details array handling
test('_updateNode appends details correctly', () => {
  const builder = new FlowBuilder();

  builder.processEvent({ name: 'design.started', payload: {} });
  builder.processEvent({ name: 'design.slide.started', payload: { slideIndex: 0 } });

  const slideId = builder.designSlideNodes.get(0);

  // Add first detail
  builder.processEvent({ name: 'design.slide.progress', payload: { slideIndex: 0, step: 'layout', msg: 'arranging' } });
  let node = builder.nodeMap.get(slideId);
  assert.equal(node.data.details.length, 1);

  // Add second detail
  builder.processEvent({ name: 'design.slide.progress', payload: { slideIndex: 0, step: 'render', msg: 'finalizing' } });
  node = builder.nodeMap.get(slideId);
  assert.equal(node.data.details.length, 2);
  assert.equal(node.data.details[0].text, 'layout: arranging');
  assert.equal(node.data.details[1].text, 'render: finalizing');
});

// Test 15: Edge cases and error handling
test('handles empty payload gracefully', () => {
  const builder = new FlowBuilder();

  // Should not crash with empty payloads
  builder.processEvent({ name: 'design.phase.transition', payload: {} });
  builder.processEvent({ name: 'design.image.generate.succeeded', payload: {} });
  builder.processEvent({ name: 'design.refine.ended', payload: {} });

  assert.ok(true, 'should handle empty payloads without crashing');
});

test('handles missing event name', () => {
  const builder = new FlowBuilder();

  builder.processEvent({ payload: { test: 'data' } });
  builder.processEvent(null);
  builder.processEvent(undefined);

  assert.equal(builder.nodes.length, 0, 'should ignore invalid events');
});

test('getFlowData returns immutable snapshots', () => {
  const builder = new FlowBuilder();
  builder.processEvent({ name: 'design.started', payload: {} });

  const data1 = builder.getFlowData();
  builder.processEvent({ name: 'design.phase.transition', payload: { from: 'style_confirming', to: 'generating' } });
  const data2 = builder.getFlowData();

  // Should return different snapshots
  assert.notEqual(data1.nodes.length, data2.nodes.length);
  assert.equal(data1.nodes.length, 1);
  assert.equal(data2.nodes.length, 2);
});

// === Additional event handler tests ===

test('design.visual.errors creates error node', () => {
  const builder = new FlowBuilder();
  builder.processEvent({ name: 'design.started', payload: {} });

  builder.processEvent({
    name: 'design.visual.errors',
    payload: { errors: [{ renderer: 'ai-image', error: 'timeout' }] }
  });

  const node = builder.nodes.find(n => n.data.label === 'Visual Errors');
  assert.ok(node, 'visual error node should be created');
  assert.equal(node.data.status, 'failed');
  assert.equal(node.data.details[0].text, 'ai-image: timeout');
});

test('design.image.generate.failed updates image node to failed', () => {
  const builder = new FlowBuilder();
  builder.processEvent({ name: 'design.started', payload: {} });
  builder.processEvent({ name: 'design.image.generate.started', payload: { imageId: 'img_fail', slideIndex: 0 } });

  const nodeId = builder.designImageNodes.get('img_fail');
  builder.processEvent({ name: 'design.image.generate.failed', payload: { imageId: 'img_fail', error: 'API timeout' } });

  const node = builder.nodeMap.get(nodeId);
  assert.equal(node.data.status, 'failed');
  assert.equal(node.data.details[0].text, 'Failed: API timeout');
});

test('design.image.generate.skipped creates checkpoint node', () => {
  const builder = new FlowBuilder();
  builder.processEvent({ name: 'design.started', payload: {} });
  builder.processEvent({ name: 'design.image.generate.skipped', payload: { slotId: 'slot_1', reason: 'budget_exceeded' } });

  const node = builder.nodes.find(n => n.data.label === 'Image Skipped');
  assert.ok(node, 'skipped node should be created');
  assert.equal(node.data.nodeType, 'checkpoint');
  assert.equal(node.data.metrics.reason, 'budget_exceeded');
});

test('design.image.fill.completed creates checkpoint node', () => {
  const builder = new FlowBuilder();
  builder.processEvent({ name: 'design.started', payload: {} });
  builder.processEvent({ name: 'design.image.fill.completed', payload: { filledCount: 5, pendingCount: 2 } });

  const node = builder.nodes.find(n => n.data.label === 'Images Filled');
  assert.ok(node, 'fill completed node should be created');
  assert.equal(node.data.metrics.filled, 5);
  assert.equal(node.data.metrics.pending, 2);
});

test('design.svg.generate.completed creates checkpoint node', () => {
  const builder = new FlowBuilder();
  builder.processEvent({ name: 'design.started', payload: {} });
  builder.processEvent({ name: 'design.svg.generate.completed', payload: { slots: 3 } });

  const node = builder.nodes.find(n => n.data.label === 'SVG Generated');
  assert.ok(node, 'svg completed node should be created');
  assert.equal(node.data.metrics.slots, 3);
});

test('design.visual.render.started creates visual render node', () => {
  const builder = new FlowBuilder();
  builder.processEvent({ name: 'design.started', payload: {} });
  builder.processEvent({
    name: 'design.visual.render.started',
    payload: { planned: { total: 10, 'ai-image': 6, svg: 4 } }
  });

  assert.ok(builder._visualRenderNodeId, 'should track visual render node id');
  const node = builder.nodeMap.get(builder._visualRenderNodeId);
  assert.equal(node.data.label, 'Visual Render');
  assert.equal(node.data.status, 'running');
  assert.equal(node.data.metrics.total, 10);
  assert.equal(node.data.metrics.images, 6);
  assert.equal(node.data.metrics.svg, 4);
});

test('design.visual.render.completed updates visual render node', () => {
  const builder = new FlowBuilder();
  builder.processEvent({ name: 'design.started', payload: {} });
  builder.processEvent({ name: 'design.visual.render.started', payload: { planned: { total: 5 } } });

  const nodeId = builder._visualRenderNodeId;
  builder.processEvent({
    name: 'design.visual.render.completed',
    payload: { report: { completed: { 'ai-image': 3, svg: 2 }, durationMs: 5000 } }
  });

  const node = builder.nodeMap.get(nodeId);
  assert.equal(node.data.status, 'completed');
  assert.equal(node.data.metrics.images, 3);
  assert.equal(node.data.metrics.svg, 2);
  assert.equal(node.data.metrics.duration, 5000);
  assert.equal(builder._visualRenderNodeId, null, 'should clear node id after completion');
});

test('design.visual.render.failed updates visual render node to failed', () => {
  const builder = new FlowBuilder();
  builder.processEvent({ name: 'design.started', payload: {} });
  builder.processEvent({ name: 'design.visual.render.started', payload: { planned: { total: 5 } } });

  const nodeId = builder._visualRenderNodeId;
  builder.processEvent({
    name: 'design.visual.render.failed',
    payload: { report: { errors: [{ renderer: 'ai-image', error: 'Provider down' }] } }
  });

  const node = builder.nodeMap.get(nodeId);
  assert.equal(node.data.status, 'failed');
  assert.equal(node.data.details[0].text, 'ai-image: Provider down');
  assert.equal(builder._visualRenderNodeId, null, 'should clear node id after failure');
});

test('reset clears _visualRenderNodeId', () => {
  const builder = new FlowBuilder();
  builder.processEvent({ name: 'design.started', payload: {} });
  builder.processEvent({ name: 'design.visual.render.started', payload: { planned: { total: 5 } } });

  assert.ok(builder._visualRenderNodeId);
  builder.reset();
  assert.equal(builder._visualRenderNodeId, null);
});
