import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { join } from "node:path";
import { OwnerContractMediaError } from "../src/application/owner-contract-media.js";
import type { OwnerImageReferenceServicePort } from "../src/application/owner-image-reference-service.js";
import { OwnerImageReferenceService } from "../src/application/owner-image-reference-service.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { loadGenerationContractRegistryV2 } from "../src/catalog/generation-contract-history-v2.js";
import { loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import type { AuthBinding, PublicAuthLinkAttempt } from "../src/auth/types.js";
import {
  registerSyntxOwnerImageReferenceTools,
  SYNTX_OWNER_GENERATE_REFERENCE_IMAGE_TOOL_NAME,
  SYNTX_OWNER_LIST_REFERENCE_RECOVERY_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_REFERENCE_IMAGE_TOOL_NAME,
  SYNTX_OWNER_UPLOAD_IMAGE_REFERENCE_TOOL_NAME
} from "../src/mcp/owner-image-reference-tools.js";

const ATTEMPT = "link_reference_tools_test_attempt_000000000000";
const HANDLE = "reference_823e4567-e89b-12d3-a456-426614174000";
const RECOVERY = "recovery_00000000-0000-4000-8000-000000000001";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";
const ARTIFACT = { url: "https://r2.syntx.ai/generated/opaque.jpg", mime_type: "image/jpeg", byte_size: 756187, width: 1024, height: 1024 };
const SUCCESS = {
  model_id: "banana-2.1" as const,
  operation_id: "generate-image" as const,
  variant_id: "banana21-image-1k-minimal-square" as const,
  status: "result_observed" as const,
  confidence: {
    confidence_scope: "root126_exact_owner_reference_path" as const,
    backend_acceptance: "one_observed_png_reference_on_exact_tuple" as const,
    profile: { model_id: "banana-2.1" as const, variant_id: "banana21-image-1k-minimal-square" as const, image_size: "1K" as const, thinking_level: "minimal" as const, aspect_ratio: "1:1" as const, n: 1 as const },
    limits: [
      "Only one PNG input MIME was exercised live; JPEG and WebP are locally validated upload formats, not live-verified generation-reference formats.",
      "This does not establish visual similarity, causal reference strength, multiple-reference behavior, masks, URL retention, or restart-safe recovery."
    ] as const
  },
  artifacts: [ARTIFACT]
};

function harness(service: OwnerImageReferenceServicePort) {
  const server = new McpServer({ name: "owner-image-reference-tools-test", version: "1.0.0" });
  registerSyntxOwnerImageReferenceTools(server, { service });
  const client = new Client({ name: "owner-image-reference-tools-client", version: "1.0.0" });
  return { server, client };
}

async function connect(server: McpServer, client: Client) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
}

test("registers exactly four owner reference tools and returns only an opaque upload receipt with sniffed metadata", async () => {
  const calls: Array<{ name: string; input: unknown }> = [];
  const service: OwnerImageReferenceServicePort = {
    async upload(input) {
      calls.push({ name: "upload", input });
      return { status: "accepted", reference_handle: HANDLE, mime_type: "image/png", mime_type_source: "request_declared", size: 68, size_source: "request_bytes", image: { mime_type: "image/png", width: 1, height: 1, sha256: "a".repeat(64) }, expires_in_seconds: 900, confidence_scope: "input_bytes_sniffed_and_dimensions_checked" };
    },
    async generate(input) { calls.push({ name: "generate", input }); return SUCCESS; },
    async reconcile(input) { calls.push({ name: "reconcile", input }); return SUCCESS; },
    async listRecoveries(input) { calls.push({ name: "list", input }); return { recoveries: [], confidence_scope: "process_local_get_only_recovery", expires_in_seconds: 900 }; },
    async invalidateAttempt() {},
    async close() {}
  };
  const { server, client } = harness(service);
  await connect(server, client);
  try {
    const names = (await client.listTools()).tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [
      SYNTX_OWNER_UPLOAD_IMAGE_REFERENCE_TOOL_NAME,
      SYNTX_OWNER_GENERATE_REFERENCE_IMAGE_TOOL_NAME,
      SYNTX_OWNER_RECONCILE_REFERENCE_IMAGE_TOOL_NAME,
      SYNTX_OWNER_LIST_REFERENCE_RECOVERY_TOOL_NAME
    ].sort());

    const uploaded = await client.callTool({ name: SYNTX_OWNER_UPLOAD_IMAGE_REFERENCE_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, content_base64: PNG, filename: "reference.png", mime_type: "image/png"
    } });
    assert.equal(uploaded.isError, undefined);
    assert.equal((uploaded.structuredContent as { reference_handle?: string }).reference_handle, HANDLE);
    assert.equal(JSON.stringify(uploaded).includes(PNG), false);
    assert.deepEqual(calls[0], { name: "upload", input: { link_attempt_id: ATTEMPT, content_base64: PNG, filename: "reference.png", mime_type: "image/png" } });

    const extra = await client.callTool({ name: SYNTX_OWNER_UPLOAD_IMAGE_REFERENCE_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, content_base64: PNG, filename: "reference.png", mime_type: "image/png", path: "/tmp/reference.png"
    } });
    assert.equal(extra.isError, true);
    assert.equal(calls.length, 1);
  } finally { await client.close(); await server.close(); }
});

test("reference generation output keeps the exact evidence scope, and unknown outcomes expose only GET recovery", async () => {
  let dispatchCalls = 0;
  const service: OwnerImageReferenceServicePort = {
    async upload() { throw new Error("unused"); },
    async generate() { dispatchCalls += 1; throw new OwnerContractMediaError("OUTCOME_UNKNOWN", RECOVERY); },
    async reconcile(input) { assert.equal(input.recovery_id, RECOVERY); return SUCCESS; },
    async listRecoveries() { return { recoveries: [], confidence_scope: "process_local_get_only_recovery", expires_in_seconds: 900 }; },
    async invalidateAttempt() {},
    async close() {}
  };
  const { server, client } = harness(service);
  await connect(server, client);
  try {
    const generated = await client.callTool({ name: SYNTX_OWNER_GENERATE_REFERENCE_IMAGE_TOOL_NAME,
      arguments: { link_attempt_id: ATTEMPT, reference_handle: HANDLE, prompt: "a red house" } });
    assert.equal(generated.isError, true);
    const errorText = (generated.content as readonly { text?: string }[])[0]?.text ?? "";
    assert.match(errorText, new RegExp(RECOVERY));
    assert.equal(errorText.includes("a red house"), false);
    assert.equal(dispatchCalls, 1);

    const recovered = await client.callTool({ name: SYNTX_OWNER_RECONCILE_REFERENCE_IMAGE_TOOL_NAME,
      arguments: { link_attempt_id: ATTEMPT, recovery_id: RECOVERY } });
    assert.equal(recovered.isError, undefined);
    const output = recovered.structuredContent as typeof SUCCESS;
    assert.equal(output.confidence.confidence_scope, "root126_exact_owner_reference_path");
    assert.equal(output.confidence.profile.n, 1);
    assert.equal((output.confidence.limits as readonly string[]).length, 2);

    const listed = await client.callTool({ name: SYNTX_OWNER_LIST_REFERENCE_RECOVERY_TOOL_NAME, arguments: { link_attempt_id: ATTEMPT } });
    assert.equal(listed.isError, undefined);
    assert.equal((listed.structuredContent as { confidence_scope: string }).confidence_scope, "process_local_get_only_recovery");
  } finally { await client.close(); await server.close(); }
});

test("actual owner service maps a foreign unlinked attempt to a safe auth error without uploading or fetching", async () => {
  let fetchCalls = 0;
  const binding: AuthBinding = Object.freeze({ tenant_id: "tenant_reference_tools", subject: "subject_reference_tools" });
  const linkService = {
    async getStatus(_binding: AuthBinding, attemptId: string): Promise<PublicAuthLinkAttempt> {
      return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED", status: "REVOKED", expires_at: null, linked: false };
    }
  };
  const chatClient = new SyntxChatHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> { return operation("fake-only"); } },
    fetchImpl: async () => { fetchCalls += 1; return new Response("{}", { status: 500 }); }
  });
  const service = new OwnerImageReferenceService({
    binding,
    registry: loadGenerationContractRegistryV2("sha256-0e5b7a6ab56a4fc5103c025690293297b49258c1c876d7a0a663ff7959099d39.json", join(process.cwd(), "catalog")),
    catalog: loadSelectedDiscoveryCatalog("sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json", join(process.cwd(), "catalog")).discoveryCatalog,
    linkService,
    createChatClient: () => chatClient,
    createReadClient: () => ({ async listInProgress() { return []; }, async getMessage() { throw new Error("unused"); } }),
    preflightFactory: () => ({ async verifyFreshSubscription() {}, async verifyModelAccess() {}, async authorizeCost() {} })
  });
  const { server, client } = harness(service);
  await connect(server, client);
  try {
    const result = await client.callTool({ name: SYNTX_OWNER_UPLOAD_IMAGE_REFERENCE_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, content_base64: PNG, filename: "reference.png", mime_type: "image/png"
    } });
    assert.equal(result.isError, true);
    const errorText = (result.content as readonly { text?: string }[])[0]?.text ?? "";
    const payload = JSON.parse(errorText) as { error: { code: string; message: string } };
    assert.equal(payload.error.code, "REFERENCE_PRINCIPAL_NOT_LINKED");
    assert.equal(payload.error.message, "The exact SYNTX account attempt is not linked.");
    assert.equal(errorText.includes(ATTEMPT), false);
    assert.equal(errorText.includes(PNG), false);
    assert.equal(fetchCalls, 0);
  } finally {
    await client.close();
    await server.close();
    await service.close();
  }
});
