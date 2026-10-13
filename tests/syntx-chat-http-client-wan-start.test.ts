import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import {
  createOwnerWanImageOneShotPermit,
  OwnerWanImageOneShotPolicyError
} from "../src/application/owner-wan-image-one-shot-policy.js";
import {
  createOwnerWanImageOwnedReferenceBindingIssuer,
  prepareOwnerWanImageRequest,
  type OwnerWanImageOwnedReferenceResolverContext,
  type OwnerWanImagePreparedCandidate
} from "../src/application/owner-wan-image-request-preparer.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import type { GenerationPrincipalRef } from "../src/domain/generation-operation.js";

const VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const catalog = loadSelectedDiscoveryCatalog(VERSION).discoveryCatalog;
const PRINCIPAL = Object.freeze({ tenant_id: "tenant_wan", subject_id: "owner_wan", connection_id: "link_wan_0123456789abcdef" });
const FOREIGN: GenerationPrincipalRef = Object.freeze({ tenant_id: "tenant_other", subject_id: "owner_other", connection_id: "link_other_0123456789abcdef" });
const VARIANTS = ["wan_25_i2i_preview", "wan_26_image", "wan_27_image", "wan_27_image_pro"] as const;
const HANDLES = Array.from({ length: 9 }, (_, index) => `wan_image_00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
const BBOX_POLICY = "LOCAL_HEADER_ORIENTATION_PROJECTION_UNVERIFIED_BROWSER" as const;

function params(variant: typeof VARIANTS[number], count: number, batchSize = 2, bbox = false, resolution?: string) {
  return {
    aspect_ratio: "1:1",
    resolution: resolution ?? (variant.startsWith("wan_25") || variant.startsWith("wan_26") ? "720P" : "1K"),
    batch_size: batchSize,
    prompt_extend: true,
    seed: null,
    color_palette: variant === "wan_27_image" || variant === "wan_27_image_pro"
      ? [{ hex: "#FF0000", ratio: "50.00%" }, { hex: "#00FF00", ratio: "30.00%" }, { hex: "#0000FF", ratio: "20.00%" }]
      : null,
    bbox_list: Array.from({ length: count }, (_, index) => bbox && index === 0 ? [[10, 20, 300, 400]] : [])
  };
}

async function makeCandidate(variant: typeof VARIANTS[number], options: { count?: number; batchSize?: number; bbox?: boolean; resolution?: string } = {}) {
  const count = options.count ?? (variant.startsWith("wan_25") || variant.startsWith("wan_26") ? 1 : 0);
  const now = Date.now();
  const issuer = createOwnerWanImageOwnedReferenceBindingIssuer(async (context: Readonly<OwnerWanImageOwnedReferenceResolverContext>) => {
    const index = HANDLES.indexOf(context.reference_handle);
    const sha256 = `sha256:${String(index + 1).repeat(64)}`;
    return {
      ...context, file_url: `https://r2.syntx.ai/private/wan-start/${index + 1}.png`, mime_type: "image/png",
      width: 1200, height: 800, size: 2_048 + index, sha256, expires_at: now + 600_000,
      metadata_confidence: "CONTAINER_METADATA_ONLY", coordinate_source_sha256: sha256,
      coordinate_metadata: { orientation: 1, projected_width: 1200, projected_height: 800,
        confidence: "HEADER_ORIENTATION_PROJECTION_NOT_BROWSER_DECODE" }
    };
  }, { catalog, catalog_version: VERSION });
  const set = await issuer.issue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant,
    reference_handles: HANDLES.slice(0, count) });
  try {
    const candidate = prepareOwnerWanImageRequest({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant,
      parameters: params(variant, count, options.batchSize, options.bbox, options.resolution), reference_set: set, prompt: "  full source prompt  ",
      bbox_coordinate_policy: options.bbox ? BBOX_POLICY : null }, { catalog, catalog_version: VERSION });
    return { candidate, issuer };
  } catch (error) { issuer.close(); throw error; }
}

function makeClient(fetchImpl: typeof fetch) {
  let credentialCalls = 0;
  const credentialBroker: SyntxCredentialBroker = {
    async useCredential(operation) { credentialCalls += 1; return operation("synthetic-wan-start-credential"); }
  };
  return { client: new SyntxChatHttpClient({ credentialBroker, fetchImpl }), credentialCalls: () => credentialCalls };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function permit(candidate: OwnerWanImagePreparedCandidate) {
  return createOwnerWanImageOneShotPermit({ candidate, principal: PRINCIPAL, attemptId: PRINCIPAL.connection_id,
    catalog, catalog_version: VERSION });
}

test("fixed native WAN POST preserves all four full source request shapes and accepts only message ACK", async () => {
  for (const variant of VARIANTS) {
    const { candidate, issuer } = await makeCandidate(variant);
    try {
      const oneShot = permit(candidate);
      let fetchCalls = 0;
      const harness = makeClient(async (input, init) => {
        fetchCalls += 1;
        assert.equal(new URL(String(input)).href, "https://api.syntx.ai/api/v1/design/generate?ai_name=wan_image");
        assert.equal(init?.method, "POST");
        assert.equal(init?.headers && (init.headers as Record<string, string>).authorization, "Bearer synthetic-wan-start-credential");
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        assert.deepEqual(Object.keys(body), ["chat_uuid", "prompt", "settings"]);
        assert.equal(body.prompt, "  full source prompt  ");
        const settings = body.settings as Record<string, unknown>;
        assert.deepEqual(Object.keys(settings), ["n", "model_type", "aspect_ratio", "resolution", "batch_size",
          "prompt_extend", "seed", "color_palette", "bbox_list", "file_urls"]);
        assert.equal(settings.model_type, variant);
        assert.equal(settings.n, 1);
        assert.equal(settings.batch_size, 2);
        assert.equal("size" in settings || "workflow_type" in settings || "civitai_loras" in settings, false);
        assert.deepEqual(settings.file_urls, candidate.request.settings.file_urls);
        return json({ id: 73, ignored_extra: "not an ACK field" });
      });
      assert.deepEqual(await harness.client.startWanImageWithOwnedCandidate({ candidate, permit: oneShot,
        principal: PRINCIPAL, attemptId: PRINCIPAL.connection_id, chat_uuid: "wan-test-chat" }),
      { chat_uuid: "wan-test-chat", message_id: "73" });
      assert.equal(fetchCalls, 1);
      assert.equal(harness.credentialCalls(), 1);
    } finally { issuer.close(); }
  }
});

test("full WAN27 batch 1-4, nine references, ordered boxes and palette are sent literally", async () => {
  for (const batchSize of [1, 2, 3, 4]) {
    const { candidate, issuer } = await makeCandidate("wan_27_image", { count: 9, batchSize, bbox: true });
    try {
      const oneShot = permit(candidate);
      const harness = makeClient(async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { settings: Record<string, unknown> };
        assert.equal(body.settings.batch_size, batchSize);
        assert.equal(body.settings.bbox_list && (body.settings.bbox_list as unknown[]).length, 9);
        assert.deepEqual((body.settings.bbox_list as unknown[][])[0], [[10, 20, 300, 400]]);
        assert.deepEqual(body.settings.color_palette, [
          { hex: "#FF0000", ratio: "50.00%" }, { hex: "#00FF00", ratio: "30.00%" }, { hex: "#0000FF", ratio: "20.00%" }
        ]);
        assert.equal((body.settings.file_urls as unknown[]).length, 9);
        return json({ id: "batch-ack" });
      });
      const receipt = await harness.client.startWanImageWithOwnedCandidate({ candidate, permit: oneShot,
        principal: PRINCIPAL, attemptId: PRINCIPAL.connection_id, chat_uuid: "wan-test-chat" });
      assert.deepEqual(receipt, { chat_uuid: "wan-test-chat", message_id: "batch-ack" });
    } finally { issuer.close(); }
  }
});

test("pre-send principal, candidate, chat and revoked-reference checks block credentials and network", async () => {
  const { candidate, issuer } = await makeCandidate("wan_27_image");
  const oneShot = permit(candidate);
  let fetchCalls = 0;
  const harness = makeClient(async () => { fetchCalls += 1; return json({ id: 1 }); });
  try {
    const invalidCalls = [
      { candidate, permit: oneShot, principal: FOREIGN, attemptId: FOREIGN.connection_id, chat_uuid: "wan-test-chat" },
      { candidate: new Proxy(candidate, {}), permit: oneShot, principal: PRINCIPAL, attemptId: PRINCIPAL.connection_id, chat_uuid: "wan-test-chat" },
      { candidate, permit: oneShot, principal: PRINCIPAL, attemptId: PRINCIPAL.connection_id, chat_uuid: "bad/chat" }
    ];
    for (const invalid of invalidCalls) await assert.rejects(() => harness.client.startWanImageWithOwnedCandidate(invalid),
      (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
    issuer.invalidateAttempt(PRINCIPAL.connection_id);
    await assert.rejects(() => harness.client.startWanImageWithOwnedCandidate({ candidate, permit: oneShot, principal: PRINCIPAL,
      attemptId: PRINCIPAL.connection_id, chat_uuid: "wan-test-chat" }),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
    assert.equal(fetchCalls, 0);
    assert.equal(harness.credentialCalls(), 0);
  } finally { issuer.close(); }
});

test("WAN Pro rejects 4K with any owned reference instead of coercing to 2K", async () => {
  await assert.rejects(() => makeCandidate("wan_27_image_pro", { count: 1, resolution: "4K" }));
});

test("unknown or aborted POST outcome is spent and cannot automatically replay", async () => {
  const { candidate, issuer } = await makeCandidate("wan_27_image_pro");
  const oneShot = permit(candidate);
  let fetchCalls = 0;
  const harness = makeClient(async () => { fetchCalls += 1; return json({ error: "upstream outcome unknown" }, 504); });
  try {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(() => harness.client.startWanImageWithOwnedCandidate({ candidate, permit: oneShot, principal: PRINCIPAL,
      attemptId: PRINCIPAL.connection_id, chat_uuid: "wan-test-chat" }, controller.signal),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_REQUEST_ABORTED");
    assert.equal(fetchCalls, 0);
    assert.equal(harness.credentialCalls(), 0);
    await assert.rejects(() => harness.client.startWanImageWithOwnedCandidate({ candidate, permit: oneShot, principal: PRINCIPAL,
      attemptId: PRINCIPAL.connection_id, chat_uuid: "wan-test-chat" }));
    assert.equal(fetchCalls, 1);
    await assert.rejects(() => harness.client.startWanImageWithOwnedCandidate({ candidate, permit: oneShot, principal: PRINCIPAL,
      attemptId: PRINCIPAL.connection_id, chat_uuid: "wan-test-chat" }),
    (error: unknown) => error instanceof OwnerWanImageOneShotPolicyError && error.code === "PERMIT_ALREADY_CONSUMED");
    assert.equal(fetchCalls, 1);
  } finally { issuer.close(); }
});

test("wrong, accessor, or extra-body candidates cannot select another WAN route or wire fields", async () => {
  const { candidate, issuer } = await makeCandidate("wan_27_image");
  const oneShot = permit(candidate);
  let fetchCalls = 0;
  const harness = makeClient(async () => { fetchCalls += 1; return json({ id: 1 }); });
  try {
    const accessor = Object.defineProperty({}, "candidate", { enumerable: true, get() { throw new Error("must not execute"); } });
    await assert.rejects(() => harness.client.startWanImageWithOwnedCandidate(accessor),
      (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
    await assert.rejects(() => harness.client.startWanImageWithOwnedCandidate({ candidate, permit: oneShot, principal: PRINCIPAL,
      attemptId: PRINCIPAL.connection_id, chat_uuid: "wan-test-chat", settings: { workflow_type: "fake" } }),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
    await assert.rejects(() => harness.client.startWanImageWithOwnedCandidate({ candidate, permit: oneShot, principal: PRINCIPAL,
      attemptId: PRINCIPAL.connection_id, chat_uuid: "wan-test-chat", now: () => 0 }),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
    assert.equal(fetchCalls, 0);
  } finally { issuer.close(); }
});
