export default async function compressionBench(runner) {
  const { CicadaCompressor, CompressionLayer } = await import("../../js/agents/runtime/compression/cicada-compressor.js");

  const compressor = new CicadaCompressor({
    modelRouter: null,
    archive: null,
    layers: [CompressionLayer.TOOL_OUTPUT, CompressionLayer.SESSION_HISTORY],
  });

  const makeMessage = (role, idx) => {
    const base = `Turn ${idx}: ` + "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(10);
    return { role, content: base + ` (#${idx})` };
  };

  const messages = [];
  for (let i = 0; i < 40; i++) {
    messages.push(makeMessage(i % 2 === 0 ? "user" : "assistant", i + 1));
  }

  const toolOutputs = [];
  for (let i = 0; i < 12; i++) {
    toolOutputs.push({
      tool: "search",
      name: "web.search",
      ok: true,
      meta: { idx: i, tags: ["bench", "compression"] },
      data: {
        results: Array.from({ length: 30 }, (_, j) => ({
          title: `Result ${i}-${j}`,
          url: `https://example.com/${i}/${j}`,
          snippet: "This is a snippet. ".repeat(12),
        })),
      },
    });
  }

  const context = { messages, toolOutputs };

  await runner.run(
    "agents:compression:cicada",
    async () => {
      await compressor.compress(context, {
        layers: [CompressionLayer.TOOL_OUTPUT, CompressionLayer.SESSION_HISTORY],
        keepLastTurns: 8,
        maxToolOutputChars: 800,
        maxToolOutputArrayItems: 12,
        maxToolOutputDepth: 2,
      });
    },
    { iterations: 200, warmup: 20 }
  );
}
