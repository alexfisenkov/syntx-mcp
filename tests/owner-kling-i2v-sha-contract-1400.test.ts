import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthBinding, AuthLinkProvider } from "../src/auth/types.js";
import {
  SYNTX_OWNER_UPLOAD_KLING_I2V_IMAGE_TOOL_NAME,
  registerSyntxOwnerKlingI2vTools
} from "../src/mcp/owner-kling-i2v-tools.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";

const ATTEMPT = "link_kling_i2v_sha_contract_1400";
const BINDING: AuthBinding = Object.freeze({ tenant_id: "synthetic-tenant", subject: "synthetic-owner" });
const NOW = Date.parse("2026-10-15T00:00:00.000Z");
const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0x2c, 0x01, 0x2c, 0x01, 0x01, 0x11, 0,
  0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0, 0, 0xff, 0xd9
]);
const UPLOAD_URL = "https://r2.syntx.ai/uploaded/kling-frame.jpg";

async function seedLinkedAttempt(store: InMemoryAuthLinkStore): Promise<void> {
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() {
      return { upstream_attempt_id: "synthetic-auth-attempt", approval_url: "https://example.invalid/approve" };
    },
    async pollChallenge(_id, receive) {
      await receive({ scheme: "Bearer", value: "synthetic-linked-token" });
      return { state: "LINKED" };
    }
  };
  const links = new PerUserLinkService(provider, store, {
    now: () => NOW,
    defaultTtlMs: 30 * 60_000,
    attemptIdGenerator: () => ATTEMPT
  });
  await links.createAttempt(BINDING);
  await links.issueHandoff(BINDING, ATTEMPT);
  await links.checkAttempt(BINDING, ATTEMPT);
}

async function setup() {
  const authStore = new InMemoryAuthLinkStore(() => NOW);
  await seedLinkedAttempt(authStore);
  let uploadCalls = 0;
  const fetchImpl: typeof fetch = async (_request, init) => {
    uploadCalls += 1;
    assert.equal(init?.method, "POST");
    assert.ok(init?.body instanceof FormData);
    assert.equal(init.body.get("model_type"), "kling_image2video");
    assert.equal(init.body.get("check_duplicates"), "true");
    return Response.json({ files: [{ id: "synthetic-file-id", url: UPLOAD_URL }] });
  };
  const runtime = createObservedOwnerRuntime({ ownerKlingI2vEnabled: true, authStore, authBinding: BINDING, fetchImpl,
    catalogDirectory: resolve(process.cwd(), "catalog"), now: () => NOW });
  const composition = runtime.serverOptions.ownerKlingI2v;
  assert.ok(composition);
  const server = new McpServer({ name: "kling-i2v-sha-contract-1400", version: "1.0.0" });
  registerSyntxOwnerKlingI2vTools(server, composition);
  const client = new Client({ name: "kling-i2v-sha-contract-1400-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    get uploadCalls() { return uploadCalls; },
    close: async () => {
      await client.close();
      await server.close();
      await runtime.ownerKlingI2vLifecycle?.close();
      runtime.authStore.close?.();
    }
  };
}

async function upload(client: Client) {
  return client.callTool({ name: SYNTX_OWNER_UPLOAD_KLING_I2V_IMAGE_TOOL_NAME, arguments: {
    link_attempt_id: ATTEMPT,
    content_base64: JPEG.toString("base64"),
    filename: "kling-frame.jpg",
    mime_type: "image/jpeg"
  } });
}

test("Kling I2V runtime upload crosses the native service and SDK with the declared bare SHA-256 contract", async () => {
  const state = await setup();
  try {
    const result = await upload(state.client);
    assert.equal(result.isError, undefined, JSON.stringify(result));
    const output = result.structuredContent as { sha256: string; image_handle: string; [key: string]: unknown };
    assert.equal(output.sha256, createHash("sha256").update(JPEG).digest("hex"));
    assert.match(output.sha256, /^[a-f0-9]{64}$/u);
    assert.match(output.image_handle, /^kling_i2v_image_[0-9a-f-]{36}$/u);
    assert.equal(state.uploadCalls, 1);
    assert.doesNotMatch(JSON.stringify(result), /https?:\/\/|upload_context|provider_id/iu);
  } finally {
    await state.close();
  }
});

test("Kling I2V repeated identical SDK upload reuses its cached receipt without another native POST", async () => {
  const state = await setup();
  try {
    const first = await upload(state.client);
    const second = await upload(state.client);
    assert.equal(first.isError, undefined, JSON.stringify(first));
    assert.equal(second.isError, undefined, JSON.stringify(second));
    assert.deepEqual(second.structuredContent, first.structuredContent);
    assert.equal(state.uploadCalls, 1);
    assert.doesNotMatch(JSON.stringify(second), /https?:\/\/|upload_context|provider_id/iu);
  } finally {
    await state.close();
  }
});
