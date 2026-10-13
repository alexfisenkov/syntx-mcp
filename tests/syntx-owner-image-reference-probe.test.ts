import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { OwnerContractMediaError } from "../src/application/owner-contract-media.js";
import {
  registerSyntxOwnerImageReferenceProbeTool,
  SYNTX_OWNER_IMAGE_REFERENCE_PROBE_TOOL_NAME
} from "../src/mcp/syntx-owner-image-reference-probe.js";

const ATTEMPT = "link_reference_probe_test_attempt_000000000000";
const RECOVERY = "recovery_00000000-0000-4000-8000-000000000001";
const ARTIFACT = { url: "https://r2.syntx.ai/generated/opaque.jpg", mime_type: "image/jpeg", byte_size: 12, width: 2, height: 2 };

async function openProbe(service: { generateImageReferenceCandidate(input: unknown): Promise<unknown> }) {
  const server = new McpServer({ name: "reference-probe-test", version: "1.0.0" });
  let calls = 0;
  registerSyntxOwnerImageReferenceProbeTool(server, {
    attemptId: ATTEMPT,
    service: service as never,
    input: { candidate: { status: "blocked", dispatch_allowed: false } } as never
  });
  const client = new Client({ name: "reference-probe-test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server, calls: () => calls, count: () => { calls += 1; } };
}

test("isolated probe tool accepts only the exact owner attempt and returns candidate-scoped success", async () => {
  const harness = await openProbe({ async generateImageReferenceCandidate() {
    harness.count();
    return { model_id: "banana-2.1", operation_id: "generate-image", modality: "image", artifacts: [ARTIFACT] };
  } });
  try {
    const tools = await harness.client.listTools();
    assert.deepEqual((tools.tools ?? []).map((tool) => tool.name), [SYNTX_OWNER_IMAGE_REFERENCE_PROBE_TOOL_NAME]);
    const foreign = await harness.client.callTool({ name: SYNTX_OWNER_IMAGE_REFERENCE_PROBE_TOOL_NAME,
      arguments: { link_attempt_id: "link_foreign_attempt_000000000000000000" } });
    assert.equal(foreign.isError, true);
    assert.equal(harness.calls(), 0);
    const withCallerData = await harness.client.callTool({ name: SYNTX_OWNER_IMAGE_REFERENCE_PROBE_TOOL_NAME,
      arguments: { link_attempt_id: ATTEMPT, prompt: "caller prompt", reference_url: "https://example.invalid" } });
    assert.equal(withCallerData.isError, true);
    assert.equal(harness.calls(), 0);
    const exact = await harness.client.callTool({ name: SYNTX_OWNER_IMAGE_REFERENCE_PROBE_TOOL_NAME,
      arguments: { link_attempt_id: ATTEMPT } });
    assert.equal(exact.isError, undefined);
    const output = exact.structuredContent as { candidate_status?: unknown; dispatch_allowed?: unknown; artifacts?: readonly { mime_type?: unknown }[] };
    assert.equal(output.candidate_status, "blocked");
    assert.equal(output.dispatch_allowed, false);
    assert.equal(output.artifacts?.[0]?.mime_type, "image/jpeg");
    assert.equal(harness.calls(), 1);
  } finally {
    await harness.client.close();
    await harness.server.close();
  }
});

test("probe tool exposes unknown recovery without retrying generation", async () => {
  let dispatches = 0;
  const harness = await openProbe({ async generateImageReferenceCandidate() {
    dispatches += 1;
    throw new OwnerContractMediaError("OUTCOME_UNKNOWN", RECOVERY);
  } });
  try {
    const result = await harness.client.callTool({ name: SYNTX_OWNER_IMAGE_REFERENCE_PROBE_TOOL_NAME,
      arguments: { link_attempt_id: ATTEMPT } });
    assert.equal(result.isError, true);
    const errorContent = result.content as readonly { text?: string }[];
    assert.match(errorContent?.[0]?.text ?? "", new RegExp(RECOVERY));
    assert.equal(dispatches, 1);
  } finally {
    await harness.client.close();
    await harness.server.close();
  }
});

test("post-service result validation failure is unknown and never classified as pre-dispatch", async () => {
  let calls = 0;
  const harness = await openProbe({ async generateImageReferenceCandidate() {
    calls += 1;
    return { model_id: "banana-2.1", operation_id: "generate-image", modality: "image",
      artifacts: [{ ...ARTIFACT, mime_type: "image/png" }] };
  } });
  try {
    const result = await harness.client.callTool({ name: SYNTX_OWNER_IMAGE_REFERENCE_PROBE_TOOL_NAME,
      arguments: { link_attempt_id: ATTEMPT } });
    assert.equal(result.isError, true);
    const errorText = (result.content as readonly { text?: string }[])[0]?.text ?? "";
    assert.match(errorText, /OUTCOME_UNKNOWN/u);
    assert.doesNotMatch(errorText, /PRE_DISPATCH_FAILED/u);
    assert.equal(calls, 1);
  } finally {
    await harness.client.close();
    await harness.server.close();
  }
});
