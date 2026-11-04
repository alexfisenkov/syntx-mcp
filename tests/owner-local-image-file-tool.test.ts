import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDefaultApplication } from "../src/application/factory.js";
import { createMcpServer } from "../src/mcp/server.js";
import { registerSyntxOwnerLocalImageFileTool, SYNTX_UPLOAD_STANDARD_IMAGE_REFERENCE_FILE_TOOL_NAME } from "../src/mcp/owner-local-image-file-tool.js";
import { getStandardImageReferencePreparationPolicy } from "../src/application/standard-image-reference-preparation.js";
import type { OwnerLocalImageFileService } from "../src/application/owner-local-image-file-service.js";

test("local file tool accepts a small path argument and returns only the opaque receipt and preparation metadata", async () => {
  let received: unknown;
  const service = { async upload(input: { readonly variant: "banana-2.1" | "gpt-image-1" }) {
    received = input;
    return { receipt: { status: "uploaded", reference_handle: "standard_image_12345678-1234-1234-1234-123456789012",
      variant: input.variant, kind: "image", original_mime_type: "image/jpeg", mime_type: "image/jpeg", width: 2400,
      height: 3200, duration: null, size: 1234, sha256: `sha256:${"b".repeat(64)}`, expires_in_seconds: 900,
      metadata_confidence: "CONTAINER_METADATA_ONLY", validation_confidence: "source metadata" },
      preparation: { applied: false, original_bytes: 1234, prepared_bytes: 1234, original_width: 2400,
        original_height: 3200, original_mime_type: "image/jpeg", prepared_mime_type: "image/jpeg" }, filename: "photo.jpg" };
  } };
  const server = createMcpServer(createDefaultApplication());
  registerSyntxOwnerLocalImageFileTool(server, service as unknown as OwnerLocalImageFileService);
  const client = new Client({ name: "local-image-file-tool-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const listed = (await client.listTools()).tools;
    const tool = listed.find(({ name }) => name === SYNTX_UPLOAD_STANDARD_IMAGE_REFERENCE_FILE_TOOL_NAME)!;
    assert.ok(tool);
    assert.equal(JSON.stringify(tool.inputSchema).includes("content_base64"), false);
    const result = await client.callTool({ name: SYNTX_UPLOAD_STANDARD_IMAGE_REFERENCE_FILE_TOOL_NAME, arguments: {
      link_attempt_id: "link_local_file_tool_test_0123456789", variant: "banana-2.1", absolute_path: "/approved/photos/photo.jpg"
    } });
    assert.equal(result.isError, undefined);
    assert.equal(JSON.stringify(received).includes("content_base64"), false);
    assert.equal(JSON.stringify(result).includes("/approved/photos"), false);
    assert.equal((result.structuredContent as Record<string, unknown>).receipt instanceof Object, true);
    const bananaPolicy = (result.structuredContent as Record<string, unknown>).preparation_policy as Record<string, unknown>;
    assert.deepEqual(bananaPolicy, getStandardImageReferencePreparationPolicy("banana-2.1"));
    assert.equal(bananaPolicy.source_limit_bytes, 20 * 1024 * 1024);
    assert.equal(bananaPolicy.prepared_target_bytes, 5 * 1024 * 1024);
    assert.equal(bananaPolicy.legacy_validator_limit_bytes, 7 * 1024 * 1024);
    const gptResult = await client.callTool({ name: SYNTX_UPLOAD_STANDARD_IMAGE_REFERENCE_FILE_TOOL_NAME, arguments: {
      link_attempt_id: "link_local_file_tool_test_0123456789", variant: "gpt-image-1", absolute_path: "/approved/photos/photo.jpg"
    } });
    assert.equal(gptResult.isError, undefined);
    const gptPolicy = (gptResult.structuredContent as Record<string, unknown>).preparation_policy as Record<string, unknown>;
    assert.deepEqual(gptPolicy, getStandardImageReferencePreparationPolicy("gpt-image-1"));
    assert.equal(gptPolicy.source_limit_bytes, 32 * 1024 * 1024);
    assert.equal(gptPolicy.prepared_target_bytes, 26.25 * 1024 * 1024);
    assert.equal(gptPolicy.legacy_validator_limit_bytes, 32 * 1024 * 1024);
    const omitted = createMcpServer(createDefaultApplication());
    const emptyClient = new Client({ name: "local-image-default-absent-test", version: "1.0.0" });
    const [emptyClientTransport, emptyServerTransport] = InMemoryTransport.createLinkedPair();
    await omitted.connect(emptyServerTransport);
    await emptyClient.connect(emptyClientTransport);
    try {
      assert.equal((await emptyClient.listTools()).tools.some(({ name }) => name === SYNTX_UPLOAD_STANDARD_IMAGE_REFERENCE_FILE_TOOL_NAME), false);
    } finally { await emptyClient.close(); await omitted.close(); }
  } finally { await client.close(); await server.close(); }
});
