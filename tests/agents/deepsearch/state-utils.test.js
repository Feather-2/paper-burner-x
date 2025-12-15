const test = require("node:test");
const assert = require("node:assert/strict");

test("stripThinkingTags: removes <think> blocks from R1 model output", async () => {
  const { stripThinkingTags } = await import("../../../js/agents/stages/deepsearch/state.js");

  // Basic case
  const input1 = '<think>This is reasoning...</think>{"result": "success"}';
  assert.equal(stripThinkingTags(input1), '{"result": "success"}');

  // Multiple think blocks
  const input2 = '<think>First thought</think>prefix<think>Second thought</think>{"data": 1}';
  assert.equal(stripThinkingTags(input2), 'prefix{"data": 1}');

  // Multiline think content
  const input3 = `<think>
Line 1
Line 2
</think>
{"json": true}`;
  assert.equal(stripThinkingTags(input3), '{"json": true}');

  // No think tags - should return as-is
  const input4 = '{"normal": "json"}';
  assert.equal(stripThinkingTags(input4), '{"normal": "json"}');

  // Case insensitive
  const input5 = '<THINK>Uppercase</THINK>{"result": 1}';
  assert.equal(stripThinkingTags(input5), '{"result": 1}');
});

test("extractJsonCandidate: extracts JSON after stripping think tags", async () => {
  const { extractJsonCandidate } = await import("../../../js/agents/stages/deepsearch/state.js");

  // R1 style output with think block followed by JSON
  const r1Output = `<think>
Let me analyze this step by step:
1. First, I need to understand the gaps
2. Then generate new questions
{"internal": "this should be ignored"}
</think>

{"gaps": [{"question": "What is X?", "priority": "high"}]}`;

  const result = extractJsonCandidate(r1Output);
  const parsed = JSON.parse(result);
  assert.ok(Array.isArray(parsed.gaps));
  assert.equal(parsed.gaps[0].question, "What is X?");
});

test("extractJsonCandidate: handles fenced code blocks after think tags", async () => {
  const { extractJsonCandidate } = await import("../../../js/agents/stages/deepsearch/state.js");

  const input = `<think>Some reasoning here</think>

\`\`\`json
{"title": "Test", "markdown": "# Hello"}
\`\`\``;

  const result = extractJsonCandidate(input);
  const parsed = JSON.parse(result);
  assert.equal(parsed.title, "Test");
});

test("extractJsonCandidate: handles empty or null input", async () => {
  const { extractJsonCandidate } = await import("../../../js/agents/stages/deepsearch/state.js");

  assert.equal(extractJsonCandidate(null), null);
  assert.equal(extractJsonCandidate(""), null);
  assert.equal(extractJsonCandidate("   "), null);
  assert.equal(extractJsonCandidate("<think>only thinking</think>"), null);
});
