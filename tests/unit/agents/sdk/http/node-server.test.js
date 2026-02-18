import { afterEach, describe, expect, it, vi } from "vitest";
import { createNodeServer } from "../../../../../js/agents/sdk/http/node-server.js";

/** @type {Array<{ close: () => Promise<void> }>} */
const servers = [];

afterEach(async () => {
  while (servers.length > 0) {
    const srv = servers.pop();
    try {
      await srv.close();
    } catch {
      // ignore close errors in cleanup
    }
  }
});

function resolveBaseUrl(nodeServer) {
  const addr = nodeServer.server.address();
  if (!addr || typeof addr !== "object") throw new Error("server did not expose address");
  return `http://127.0.0.1:${addr.port}`;
}

describe("createNodeServer", () => {
  it("returns 400 for invalid stream requests before sending SSE 200", async () => {
    const server = await createNodeServer(async () => ({
      run: async () => ({ output: "ok", stop_reason: "end_turn", usage: {}, tool_calls: [] }),
      eventBus: null,
    }));
    servers.push(server);
    await server.listen(0, "127.0.0.1");

    const base = resolveBaseUrl(server);
    const res = await fetch(`${base}/v1/run/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: "x" }), // missing prompt
    });

    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("application/json");
    const payload = await res.json();
    expect(payload.error).toContain("prompt");
  });

  it("streams SSE with 200 for valid requests", async () => {
    const run = vi.fn(async () => ({
      output: "hello",
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
      tool_calls: [],
    }));
    const server = await createNodeServer(async () => ({ run, eventBus: null }));
    servers.push(server);
    await server.listen(0, "127.0.0.1");

    const base = resolveBaseUrl(server);
    const res = await fetch(`${base}/v1/run/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "hi" }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain("\"type\":\"agent_start\"");
    expect(text).toContain("\"type\":\"agent_stop\"");
    expect(run).toHaveBeenCalledTimes(1);
  });
});

