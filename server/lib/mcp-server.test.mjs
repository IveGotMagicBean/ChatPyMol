import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createChatPymolMcpServer } from "./mcp-server.mjs";

test("MCP 0.2.0 schema requires at least one explicit apply_pml target", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createChatPymolMcpServer({});
  const client = new Client({ name: "chatpymol-schema-test", version: "1.0.0" });

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    assert.equal(client.getServerVersion()?.version, "0.2.0");
    const listing = await client.listTools();
    const apply = listing.tools.find((tool) => tool.name === "apply_pml");
    assert.ok(apply);
    assert.ok(apply.inputSchema.required?.includes("targetObjectIds"));
    assert.equal(apply.inputSchema.properties?.targetObjectIds?.minItems, 1);
    assert.equal(
      Object.hasOwn(apply.inputSchema.properties?.targetObjectIds || {}, "default"),
      false
    );
  } finally {
    await client.close();
    await server.close();
  }
});
