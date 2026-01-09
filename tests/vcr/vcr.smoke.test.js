import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { VcrRecorder } from "../utils/vcr-recorder.js";
import { mockLlmResponse, resetLlmMocks } from "../utils/llm-mock.js";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address()));
    server.once("error", reject);
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

test("VCR: record + replay fetch interactions", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-vcr-"));
  const server = http.createServer((req, res) => {
    if (req.url === "/ping") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("pong");
      return;
    }

    if (req.url === "/chat/completions" && req.method === "POST") {
      let buf = "";
      req.on("data", (chunk) => (buf += chunk));
      req.on("end", () => {
        // Echo a deterministic response (OpenAI-ish).
        const payload = JSON.parse(buf || "{}");
        const prompt = Array.isArray(payload.messages) ? payload.messages.map((m) => m.content).join("\n") : "";
        const json = {
          id: "chatcmpl_server",
          object: "chat.completion",
          created: 0,
          model: "server-model",
          choices: [{ index: 0, message: { role: "assistant", content: `echo:${prompt}` }, finish_reason: "stop" }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        };
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(json));
      });
      return;
    }

    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });

  try {
    const addr = await listen(server);
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    const vcrRecord = new VcrRecorder({ fixturesDir: tmpDir, mode: "record" });
    await vcrRecord.record("smoke", async () => {
      const ping = await fetch(`${baseUrl}/ping`);
      assert.equal(await ping.text(), "pong");

      const r = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
      });
      const data = await r.json();
      assert.equal(data.choices?.[0]?.message?.content, "echo:hello");
    });

    await closeServer(server);

    const vcrReplay = new VcrRecorder({ fixturesDir: tmpDir, mode: "replay" });
    await vcrReplay.replay("smoke", async () => {
      const ping = await fetch(`${baseUrl}/ping`);
      assert.equal(await ping.text(), "pong");

      const r = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
      });
      const data = await r.json();
      assert.equal(data.choices?.[0]?.message?.content, "echo:hello");
    });
  } finally {
    try {
      server.close();
    } catch {
      // ignore
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("LLM mock: load response from VCR cassette", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-vcr-"));

  try {
    // Create a minimal cassette containing a single chat/completions interaction.
    const cassette = {
      meta: { schemaVersion: "1.0", name: "smoke" },
      interactions: [
        {
          kind: "fetch",
          request: {
            url: "http://127.0.0.1:9/chat/completions",
            method: "POST",
            headers: { "content-type": "application/json" },
            body: { type: "text", encoding: "utf8", text: "{\"messages\":[{\"role\":\"user\",\"content\":\"hello\"}]}", byteLength: 0 },
          },
          response: {
            status: 200,
            statusText: "OK",
            headers: { "content-type": "application/json" },
            body: { type: "text", encoding: "utf8", text: "{\"choices\":[{\"message\":{\"content\":\"from-cassette\"}}]}", byteLength: 0 },
          },
        },
      ],
    };
    fs.writeFileSync(path.join(tmpDir, "smoke.json"), JSON.stringify(cassette, null, 2));

    const cleanup = mockLlmResponse(/hello/, { vcr: { cassette: "smoke", fixturesDir: tmpDir } });
    try {
      const resp = await fetch("http://127.0.0.1:9/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
      });
      const data = await resp.json();
      assert.equal(data.choices?.[0]?.message?.content, "from-cassette");
    } finally {
      cleanup();
      resetLlmMocks();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
