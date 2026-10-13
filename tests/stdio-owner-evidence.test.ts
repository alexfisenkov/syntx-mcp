import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { TOOL_NAMES } from "../src/mcp/server.js";
import { SYNTX_VIDEO_EVIDENCE_TOOL_NAME } from "../src/mcp/video-evidence-tool.js";
import { resolveOwnerVideoEvidence } from "../src/transports/stdio-owner-evidence.js";

test("owner evidence resolver merges fixed v8 records and v10 graph evidence", async () => {
  const result = await resolveOwnerVideoEvidence({ form_id: "veo-3" });
  assert.equal(result.kind, "VIDEO_EVIDENCE");
  assert.equal(result.form_id, "veo-3");
  assert.equal(result.runtime_usable, false);
  assert.ok(result.evidence_records.length > 0);
  assert.ok(result.nodes.some((node) => node.relation === "PROVIDER_ROOT"));
  assert.ok(result.blockers.length > 0);
  assert.equal("source" in result, false);
});

test("owner evidence resolver accepts module selector and rejects unknown selectors safely", async () => {
  const result = await resolveOwnerVideoEvidence({ module_name: "constants.js" });
  assert.equal(result.module_name, "constants.js");
  assert.ok(result.evidence_records.every((record) => record.name.length > 0));
  assert.throws(
    () => resolveOwnerVideoEvidence({ form_id: "not-a-current-form" }),
    /Unknown video evidence selector/u
  );
});

test("owner evidence stdio advertises only read-only catalog tools plus evidence", async () => {
  const client = new Client({ name: "owner-evidence-stdio-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("dist/src/transports/stdio-owner-evidence.js")],
    cwd: process.cwd(),
    env: Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined).concat([["SYNTX_OWNER_GENERATE_IMAGE", "1"], ["SYNTX_OWNER_ACCOUNT_STATUS", "1"]])),
    stderr: "pipe"
  });
  await client.connect(transport as unknown as Transport);
  try {
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    assert.deepEqual(names, [...TOOL_NAMES, SYNTX_VIDEO_EVIDENCE_TOOL_NAME]);
    assert.equal(names.some((name) => name.includes("generate") || name.includes("account")), false);
    const result = await client.callTool({ name: SYNTX_VIDEO_EVIDENCE_TOOL_NAME, arguments: { form_id: "seedance" } });
    assert.equal(result.isError, undefined);
    assert.equal((result.structuredContent as { kind: string }).kind, "VIDEO_EVIDENCE");
  } finally {
    await client.close();
  }
});

test("package advertises the separate evidence bin and packaged archive paths", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { bin: Record<string, string> };
  assert.equal(packageJson.bin["syntx-mcp-owner-evidence"], "dist/src/transports/stdio-owner-evidence.js");
});
