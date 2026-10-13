import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import {
  createOwnerStandardImageOwnedReferenceBindingIssuer,
  prepareOwnerStandardImageRequest,
  OWNER_STANDARD_IMAGE_VARIANTS,
  type OwnerStandardImageOwnedReferenceResolverContext
} from "../src/application/owner-standard-image-request-preparer.js";
import { createOwnerStandardImageOneShotPermit } from "../src/application/owner-standard-image-one-shot-policy.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";

const VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const catalog = loadSelectedDiscoveryCatalog(VERSION).discoveryCatalog;
const PRINCIPAL = Object.freeze({ tenant_id: "tenant_start", subject_id: "owner_start", connection_id: "link_standard_start_0123456789abcdef" });
const NOW = Date.now();
const HANDLES = Array.from({ length: 3 }, (_, index) => `standard_image_00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
const PARAMETERS = Object.freeze({
  banana: { aspect_ratio: "1:1", image_size: null, thinking_level: null },
  "banana-2.1": { aspect_ratio: "16:9", image_size: "2K", thinking_level: "medium" },
  banana2: { aspect_ratio: "4:3", image_size: "1K", thinking_level: null },
  banana3: { aspect_ratio: "3:2", image_size: "0.5K", thinking_level: null },
  banana3_light: { aspect_ratio: "2:3", image_size: "1K", thinking_level: null },
  "gpt-image-1": { aspect_ratio: "1:1", quality: null, details_quality: null },
  "gpt-image-1.5": { aspect_ratio: "3:2", quality: null, details_quality: null },
  "gpt-image-2": { aspect_ratio: "16:9", quality: "2K", details_quality: "high" },
  "gpt-image-2.5-flare": { aspect_ratio: "21:9", quality: "4K", details_quality: "max" },
  "gpt-image-2.5-sunburst": { aspect_ratio: "4:5", quality: "1K", details_quality: "xhigh" }
} as const);
const ACTIVE_KEYS: Readonly<Record<typeof OWNER_STANDARD_IMAGE_VARIANTS[number], readonly string[]>> = Object.freeze({
  banana: ["n", "model_type", "aspect_ratio", "image_size", "file_urls"],
  "banana-2.1": ["n", "model_type", "aspect_ratio", "image_size", "thinking_level", "file_urls"],
  banana2: ["n", "model_type", "aspect_ratio", "image_size", "file_urls"],
  banana3: ["n", "model_type", "aspect_ratio", "image_size", "file_urls"],
  banana3_light: ["n", "model_type", "aspect_ratio", "image_size", "file_urls"],
  "gpt-image-1": ["n", "model_type", "aspect_ratio", "file_urls"],
  "gpt-image-1.5": ["n", "model_type", "aspect_ratio", "file_urls"],
  "gpt-image-2": ["n", "model_type", "aspect_ratio", "quality", "details_quality", "file_urls"],
  "gpt-image-2.5-flare": ["n", "model_type", "aspect_ratio", "quality", "details_quality", "file_urls"],
  "gpt-image-2.5-sunburst": ["n", "model_type", "aspect_ratio", "quality", "details_quality", "file_urls"]
});

async function candidateFor(
  variant: typeof OWNER_STANDARD_IMAGE_VARIANTS[number],
  kinds: readonly ("image" | "video" | "file")[] = [],
  permitClock: () => number = () => NOW
) {
  const issuer = createOwnerStandardImageOwnedReferenceBindingIssuer(async (context: Readonly<OwnerStandardImageOwnedReferenceResolverContext>) => {
    const index = HANDLES.indexOf(context.reference_handle);
    const kind = kinds[index]!;
    const mime = kind === "video" ? "video/mp4" : kind === "file" ? "application/pdf" : "image/png";
    const ext = kind === "video" ? "mp4" : kind === "file" ? "pdf" : "png";
    return { ...context, file_url: `https://r2.syntx.ai/private/standard/start-${index + 1}.${ext}`,
      mime_type: mime, kind, width: kind === "image" ? 1 : null, height: kind === "image" ? 1 : null,
      duration: kind === "video" ? 1 : null, size: 1, sha256: `sha256:${String(index + 1).repeat(64)}`,
      expires_at: NOW + 600_000 - index * 30_000, metadata_confidence: "CONTAINER_METADATA_ONLY" as const };
  }, { catalog, catalog_version: VERSION, now: () => NOW });
  const reference_set = await issuer.issue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant,
    reference_handles: HANDLES.slice(0, kinds.length) });
  const candidate = prepareOwnerStandardImageRequest({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id,
    variant, parameters: PARAMETERS[variant], reference_set, prompt: "  exact standard prompt 🙂  " },
  { catalog, catalog_version: VERSION, now: () => NOW });
  const permit = createOwnerStandardImageOneShotPermit({ candidate, principal: PRINCIPAL,
    attemptId: PRINCIPAL.connection_id, catalog, catalog_version: VERSION, now: permitClock });
  return { candidate, permit, issuer };
}

function broker(calls: () => void): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
    calls();
    return operation("synthetic-standard-start-credential");
  } };
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

test("fixed standard image POST sends the exact prepared body for all ten variants and returns ACK only", async () => {
  for (const variant of OWNER_STANDARD_IMAGE_VARIANTS) {
    const { candidate, permit, issuer } = await candidateFor(variant);
    let credentialCalls = 0;
    let fetchCalls = 0;
    const client = new SyntxChatHttpClient({ credentialBroker: broker(() => { credentialCalls += 1; }), fetchImpl: async (input, init) => {
      fetchCalls += 1;
      const family = variant.startsWith("banana") ? "banana" : "sora-images";
      assert.equal(String(input), `https://api.syntx.ai/api/v1/design/generate?ai_name=${family}`);
      assert.equal(init?.method, "POST");
      assert.equal(init?.redirect, "error");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.deepEqual(Object.keys(body), ["chat_uuid", "prompt", "settings"]);
      assert.equal(body.chat_uuid, "standard-start-chat");
      assert.equal(body.prompt, candidate.prompt);
      const settings = body.settings as Record<string, unknown>;
      assert.deepEqual(Object.keys(settings), ACTIVE_KEYS[variant]);
      assert.equal(settings.n, 1);
      assert.equal(settings.model_type, variant);
      assert.deepEqual(settings.file_urls, []);
      return json({ id: `ack-${variant}`, role: "assistant", result_url: "https://untrusted.example/result.png" });
    } });
    try {
      const receipt = await client.startStandardImageWithOwnedCandidate({ candidate, permit, principal: PRINCIPAL,
        attemptId: PRINCIPAL.connection_id, chat_uuid: "standard-start-chat" });
      assert.deepEqual(receipt, { chat_uuid: "standard-start-chat", message_id: `ack-${variant}` });
      assert.equal(fetchCalls, 1);
      assert.equal(credentialCalls, 1);
    } finally { issuer.close(); }
  }
});

test("forwards ordered owned image, video and file references as the exact private wire protocol", async () => {
  const { candidate, permit, issuer } = await candidateFor("banana-2.1", ["image", "video", "file"]);
  let fetchCalls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(() => {}), fetchImpl: async (_input, init) => {
    fetchCalls += 1;
    const body = JSON.parse(String(init?.body)) as { settings: { file_urls: readonly { type: string; url: string }[] } };
    assert.deepEqual(body.settings.file_urls.map((item) => item.type), ["image", "video", "file"]);
    assert.deepEqual(body.settings.file_urls, candidate.request.settings.file_urls);
    assert.ok(body.settings.file_urls.every((item) => new URL(item.url).hostname === "r2.syntx.ai"));
    return json({ id: "mixed-ack" });
  } });
  try {
    assert.deepEqual(await client.startStandardImageWithOwnedCandidate({ candidate, permit, principal: PRINCIPAL,
      attemptId: PRINCIPAL.connection_id, chat_uuid: "standard-start-chat" }),
    { chat_uuid: "standard-start-chat", message_id: "mixed-ack" });
    assert.equal(fetchCalls, 1);
  } finally { issuer.close(); }
});

test("rejects forged, mismatched, revoked and extra-field requests before credentials or POST", async () => {
  const first = await candidateFor("banana-2.1");
  const second = await candidateFor("banana-2.1");
  let credentialCalls = 0;
  let fetchCalls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(() => { credentialCalls += 1; }), fetchImpl: async () => {
    fetchCalls += 1;
    return json({ id: "unexpected" });
  } });
  try {
    const valid = { candidate: first.candidate, permit: first.permit, principal: PRINCIPAL,
      attemptId: PRINCIPAL.connection_id, chat_uuid: "standard-start-chat" };
    const invalidInputs = [
      { ...valid, candidate: { ...first.candidate } },
      { ...valid, candidate: second.candidate },
      { ...valid, permit: { ...first.permit } },
      { ...valid, principal: { ...PRINCIPAL, subject_id: "foreign" } },
      { ...valid, extra: true }
    ];
    for (const invalid of invalidInputs) await assert.rejects(() => client.startStandardImageWithOwnedCandidate(invalid));
    first.issuer.invalidateAttempt(PRINCIPAL.connection_id);
    await assert.rejects(() => client.startStandardImageWithOwnedCandidate(valid));
    assert.equal(credentialCalls, 0);
    assert.equal(fetchCalls, 0);
  } finally { first.issuer.close(); second.issuer.close(); }
});

test("a pre-aborted signal leaves the one-shot permit available for one later attempt", async () => {
  const { candidate, permit, issuer } = await candidateFor("gpt-image-2");
  let credentialCalls = 0;
  let fetchCalls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(() => { credentialCalls += 1; }), fetchImpl: async () => {
    fetchCalls += 1;
    return json({ id: "after-abort" });
  } });
  const input = { candidate, permit, principal: PRINCIPAL, attemptId: PRINCIPAL.connection_id, chat_uuid: "standard-start-chat" };
  const controller = new AbortController();
  controller.abort();
  try {
    await assert.rejects(() => client.startStandardImageWithOwnedCandidate(input, controller.signal));
    assert.equal(credentialCalls, 0);
    assert.equal(fetchCalls, 0);
    assert.deepEqual(await client.startStandardImageWithOwnedCandidate(input), {
      chat_uuid: "standard-start-chat", message_id: "after-abort"
    });
    assert.equal(credentialCalls, 1);
    assert.equal(fetchCalls, 1);
  } finally { issuer.close(); }
});

test("an expired candidate is rejected before auth and network", async () => {
  let clock = NOW;
  const { candidate, permit, issuer } = await candidateFor("banana2", [], () => clock);
  clock = candidate.expires_at;
  let credentialCalls = 0;
  let fetchCalls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(() => { credentialCalls += 1; }), fetchImpl: async () => {
    fetchCalls += 1;
    return json({ id: "unexpected" });
  } });
  try {
    await assert.rejects(() => client.startStandardImageWithOwnedCandidate({ candidate, permit, principal: PRINCIPAL,
      attemptId: PRINCIPAL.connection_id, chat_uuid: "standard-start-chat" }));
    assert.equal(credentialCalls, 0);
    assert.equal(fetchCalls, 0);
  } finally { issuer.close(); }
});

test("an abort after POST dispatch leaves its outcome unknown and blocks another send", async () => {
  const { candidate, permit, issuer } = await candidateFor("gpt-image-2.5-flare");
  let credentialCalls = 0;
  let fetchCalls = 0;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const client = new SyntxChatHttpClient({ credentialBroker: broker(() => { credentialCalls += 1; }), fetchImpl: async (_input, init) => {
    fetchCalls += 1;
    markStarted();
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("synthetic abort after dispatch")), { once: true });
    });
  } });
  const input = { candidate, permit, principal: PRINCIPAL, attemptId: PRINCIPAL.connection_id, chat_uuid: "standard-start-chat" };
  const controller = new AbortController();
  try {
    const pending = client.startStandardImageWithOwnedCandidate(input, controller.signal);
    await started;
    controller.abort();
    await assert.rejects(() => pending);
    await assert.rejects(() => client.startStandardImageWithOwnedCandidate(input));
    assert.equal(credentialCalls, 1);
    assert.equal(fetchCalls, 1);
  } finally { issuer.close(); }
});

test("unknown POST outcome is not replayed with the same one-shot permit", async () => {
  const { candidate, permit, issuer } = await candidateFor("gpt-image-1.5");
  let credentialCalls = 0;
  let fetchCalls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(() => { credentialCalls += 1; }), fetchImpl: async () => {
    fetchCalls += 1;
    throw new Error("synthetic response loss after dispatch");
  } });
  const input = { candidate, permit, principal: PRINCIPAL, attemptId: PRINCIPAL.connection_id, chat_uuid: "standard-start-chat" };
  try {
    await assert.rejects(() => client.startStandardImageWithOwnedCandidate(input));
    await assert.rejects(() => client.startStandardImageWithOwnedCandidate(input));
    assert.equal(credentialCalls, 1);
    assert.equal(fetchCalls, 1);
  } finally { issuer.close(); }
});
