import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { readOwnerKlingI2VUploadReferenceForClient } from "../src/adapter/syntx/kling-i2v-upload-context.js";
import { OwnerKlingI2VImageReferenceService } from "../src/application/owner-kling-i2v-reference-service.js";

const ATTEMPT = "link_kling_capture_owner_0123456789";
const FOREIGN_ATTEMPT = "link_kling_capture_other_0123456789";
const BINDING = Object.freeze({ tenant_id: "kling-capture-tenant", subject: "kling-capture-owner" });
const NOW = Date.parse("2026-10-14T00:00:00.000Z");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0x2c, 0x01, 0x2c, 0x01, 0x01, 0x11, 0,
  0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0, 0, 0xff, 0xd9]);
const PRIVATE_URL = "https://r2.syntx.ai/hidden/captured.jpg";

function broker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> { return operation("synthetic-capture-token"); } };
}

async function makeLinkService(now: () => number, attemptIds: readonly string[] = [ATTEMPT]) {
  let next = 0;
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: `synthetic-${next}`, approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-capture-link-token" }); return { state: "LINKED" }; }
  };
  const service = new PerUserLinkService(provider, new InMemoryAuthLinkStore(now), { now, defaultTtlMs: 30 * 60_000,
    attemptIdGenerator: () => attemptIds[next++]! });
  for (const attemptId of attemptIds) {
    await service.createAttempt(BINDING); await service.issueHandoff(BINDING, attemptId); await service.checkAttempt(BINDING, attemptId);
  }
  return service;
}

async function fixture(now: () => number = () => NOW) {
  let posts = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    posts += 1; return Response.json({ files: [{ id: "captured-private-id", url: PRIVATE_URL }] });
  } });
  const links = await makeLinkService(now);
  const service = new OwnerKlingI2VImageReferenceService({ binding: BINDING, linkService: links,
    resolveClient: () => client, destination: "hidden", now });
  const receipt = await service.upload({ attemptId: ATTEMPT, filename: "captured.jpg", mime_type: "image/jpeg",
    content_base64: JPEG.toString("base64") });
  const input = { attempt_id: ATTEMPT, image_handle: receipt.image_handle };
  const resolution = await service.resolve(input);
  return { client, links, service, receipt, input, resolution, get posts() { return posts; } };
}

test("capture passes only the exact recorded client and nominal upload context to its callback", async () => {
  const state = await fixture();
  const foreignClient = new SyntxChatHttpClient({ credentialBroker: broker() });
  try {
    const capture = await state.service.withCapturedNativeImage(state.resolution, state.input, (client, context, signal) => {
      assert.equal(client, state.client);
      assert.notEqual(signal, undefined);
      assert.equal(signal.aborted, false);
      assert.deepEqual(readOwnerKlingI2VUploadReferenceForClient(client, context), { url: PRIVATE_URL });
      assert.equal(readOwnerKlingI2VUploadReferenceForClient(foreignClient, context), null);
      return Object.freeze({ captured: true });
    });
    assert.deepEqual(capture, { captured: true });
    assert.equal(state.posts, 1);
    await assert.rejects(() => state.service.withCapturedNativeImage({ ...state.resolution }, state.input,
      () => assert.fail("forged resolution must not reach callback")),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "REFERENCE_UNAVAILABLE");
  } finally { await state.service.close(); }
});

test("capture rejects an expired resolution before invoking the callback", async () => {
  let time = NOW;
  const state = await fixture(() => time);
  let callbacks = 0;
  try {
    time += 15 * 60_000;
    await assert.rejects(() => state.service.withCapturedNativeImage(state.resolution, state.input, () => { callbacks += 1; }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "REFERENCE_EXPIRED");
    assert.equal(callbacks, 0);
    assert.equal(state.posts, 1);
  } finally { await state.service.close(); }
});

test("capture invalidates the nominal context when the linked attempt identity changes", async () => {
  const state = await fixture();
  let changed = false;
  const getStatus = state.links.getStatus.bind(state.links);
  state.links.getStatus = async (binding, attemptId) => {
    const status = await getStatus(binding, attemptId);
    return changed ? { ...status, attempt_id: FOREIGN_ATTEMPT } : status;
  };
  changed = true;
  let callbacks = 0;
  try {
    await assert.rejects(() => state.service.withCapturedNativeImage(state.resolution, state.input, () => { callbacks += 1; }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "PRINCIPAL_NOT_LINKED");
    assert.equal(callbacks, 0);
    assert.equal(state.posts, 1);
    assert.equal(state.service.isOwnedResolution(state.resolution, state.input), false);
  } finally { await state.service.close(); }
});
