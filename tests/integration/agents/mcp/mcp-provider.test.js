import { describe, expect, it } from "vitest";

import { McpProvider } from '../../../../js/agents/mcp/mcp-client.js';

describe("McpProvider (base)", () => {
  it("defaults id/name/endpoint when missing", () => {
    const p = new McpProvider();
    expect(p.id).toBe("provider_unknown");
    expect(p.name).toBe("provider_unknown");
    expect(p.endpoint).toBe("local");
  });

  it("throws for unimplemented methods", async () => {
    const p = new McpProvider({ id: "p1", name: "P1", endpoint: "mock" });
    await expect(p.listTools()).rejects.toThrow(/not implemented/i);
    await expect(p.callTool("x", {})).rejects.toThrow(/not implemented/i);
  });
});

