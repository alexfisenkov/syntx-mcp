import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { createOwnerRunwayImageOwnedReferenceBindingIssuer, prepareOwnerRunwayImageRequest } from "../src/application/owner-runway-image-request-preparer.js";
import { createOwnerRunwayImageOneShotPermit, consumeOwnerRunwayImageOneShotPermit } from "../src/application/owner-runway-image-one-shot-policy.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";

const CREDENTIAL = "synthetic-runway-image-credential";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}
function broker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> { return operation(CREDENTIAL); } };
}
const catalog = loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION).discoveryCatalog;
const VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const PRINCIPAL = Object.freeze({ tenant_id: "tenant_test", subject_id: "subject_test", connection_id: "link_test_0123456789abcdef" });
const REFERENCE_HANDLES = [
  "runway_image_00000000-0000-4000-8000-000000000001",
  "runway_image_00000000-0000-4000-8000-000000000002",
  "runway_image_00000000-0000-4000-8000-000000000003"
];

async function prepared(resolution = "1088x1920", temperature = 3.125, referenceCount = 0) {
  const issuer = createOwnerRunwayImageOwnedReferenceBindingIssuer(async (context) => ({
    ...context, file_url: `https://r2.syntx.ai/private/runway/${context.reference_handle}.png`, mime_type: "image/png",
    width: 1, height: 1, size: PNG.byteLength, sha256: `sha256:${String(REFERENCE_HANDLES.indexOf(context.reference_handle) + 1).padStart(64, "0")}`,
    expires_at: Date.now() + 600_000, metadata_confidence: "CONTAINER_METADATA_ONLY"
  }), { catalog, catalog_version: VERSION });
  const referenceSet = await issuer.issue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant: "runway_frames", reference_handles: REFERENCE_HANDLES.slice(0, referenceCount) });
  const candidate = prepareOwnerRunwayImageRequest({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant: "runway_frames",
    parameters: { resolution, temperature }, reference_set: referenceSet, prompt: "exact source wording" },
  { catalog, catalog_version: VERSION });
  const permit = createOwnerRunwayImageOneShotPermit({ candidate, principal: PRINCIPAL, attemptId: PRINCIPAL.connection_id,
    catalog, catalog_version: VERSION });
  return { issuer, candidate, permit };
}

test("Runway image upload uses the fixed singular multipart route and returns a private receipt", async () => {
  let calls = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: broker(),
    fetchImpl: async (input, init) => {
      calls += 1;
      assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
      assert.equal(init?.method, "POST");
      assert.equal(init?.redirect, "error");
      const form = init?.body as FormData;
      assert.deepEqual(Array.from(form.keys()), ["files", "destination", "check_duplicates", "model_type"]);
      assert.equal(form.get("destination"), "uploaded");
      assert.equal(form.get("check_duplicates"), "true");
      assert.equal(form.get("model_type"), "runway_frames");
      const file = form.get("files");
      assert.ok(file instanceof File);
      assert.equal(file.name, "reference.png");
      assert.equal(file.type, "image/png");
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), PNG);
      return json({ files: [{ id: "runway-file-1", url: "https://r2.syntx.ai/runway/input.png", mime_type: "image/png", size: PNG.byteLength }] });
    }
  });

  const result = await client.uploadRunwayImageReference({ variant: "runway_frames", bytes: PNG, filename: "reference.png", mime_type: "image/png" });
  assert.deepEqual(result, { file_id: "runway-file-1", url: "https://r2.syntx.ai/runway/input.png" });
  assert.equal(calls, 1);
  assert.ok(PNG.some((byte) => byte !== 0), "caller-owned bytes stay unchanged");
});

test("invalid Runway input is rejected before credentials and fetch", async () => {
  let credentialCalls = 0;
  let fetchCalls = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      credentialCalls += 1;
      return operation(CREDENTIAL);
    } },
    fetchImpl: async () => { fetchCalls += 1; return json({}); }
  });
  await assert.rejects(client.uploadRunwayImageReference({ variant: "runway_frames", bytes: new Uint8Array([1, 2]), filename: "x.png", mime_type: "image/png" }),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  assert.equal(credentialCalls, 0);
  assert.equal(fetchCalls, 0);
});

test("Runway start sends exact candidate settings once and consumes its permit", async () => {
  const value = await prepared();
  let calls = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: broker(),
    fetchImpl: async (input, init) => {
      calls += 1;
      assert.equal(String(input), "https://api.syntx.ai/api/v1/design/generate?ai_name=runway-frames");
      assert.equal(init?.method, "POST");
      assert.equal(init?.redirect, "error");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        chat_uuid: "chat_runway_001", prompt: "exact source wording",
        settings: { n: 1, model_type: "runway_frames", resolution: "1088x1920", temperature: 3.125, file_urls: [] }
      });
      return json({ id: "runway-message-1" });
    }
  });
  const receipt = await client.startRunwayImageWithOwnedCandidate({
    candidate: value.candidate, permit: value.permit, principal: PRINCIPAL,
    attemptId: PRINCIPAL.connection_id, chat_uuid: "chat_runway_001"
  });
  assert.deepEqual(receipt, { chat_uuid: "chat_runway_001", message_id: "runway-message-1" });
  assert.equal(calls, 1);
  assert.throws(() => consumeOwnerRunwayImageOneShotPermit({ permit: value.permit, candidate: value.candidate,
    principal: PRINCIPAL, attemptId: PRINCIPAL.connection_id }),
  (error: unknown) => (error as { code?: string }).code === "PERMIT_ALREADY_CONSUMED");
  value.issuer.close();
});

test("Runway transport preserves every literal resolution, fractional temperatures, and zero to three references", async () => {
  const resolutions = ["2112x912", "1920x1088", "1456x1088", "1088x1088", "1088x1456", "1088x1920"];
  const temperatures = [1, 1.375, 2.25, 3.5, 4.625, 5];
  let calls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (_input, init) => {
    calls += 1;
    const body = JSON.parse(String(init?.body)) as { settings: Record<string, unknown> };
    const index = calls - 1;
    assert.deepEqual(body.settings, {
      n: 1, model_type: "runway_frames", resolution: resolutions[index], temperature: temperatures[index],
      file_urls: REFERENCE_HANDLES.slice(0, index % 4).map((handle) => ({ type: "image", url: `https://r2.syntx.ai/private/runway/${handle}.png` }))
    });
    return json({ id: `runway-message-${calls}` });
  } });
  for (let index = 0; index < resolutions.length; index += 1) {
    const value = await prepared(resolutions[index], temperatures[index], index % 4);
    await client.startRunwayImageWithOwnedCandidate({ candidate: value.candidate, permit: value.permit, principal: PRINCIPAL,
      attemptId: PRINCIPAL.connection_id, chat_uuid: "chat_runway_001" });
    value.issuer.close();
  }
  assert.equal(calls, resolutions.length);
});

test("pre-aborted Runway start makes no call and leaves its permit unspent", async () => {
  const value = await prepared();
  let calls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => { calls += 1; return json({ id: "unused" }); } });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(client.startRunwayImageWithOwnedCandidate({ candidate: value.candidate, permit: value.permit,
    principal: PRINCIPAL, attemptId: PRINCIPAL.connection_id, chat_uuid: "chat_runway_001" }, controller.signal),
  (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_REQUEST_ABORTED");
  assert.equal(calls, 0);
  assert.equal(consumeOwnerRunwayImageOneShotPermit({ permit: value.permit, candidate: value.candidate,
    principal: PRINCIPAL, attemptId: PRINCIPAL.connection_id }).status, "consumed");
  value.issuer.close();
});

test("unknown Runway POST outcome is never retried and the spent permit cannot replay", async () => {
  const value = await prepared();
  let calls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => { calls += 1; throw new Error("connection lost"); } });
  const request = { candidate: value.candidate, permit: value.permit, principal: PRINCIPAL,
    attemptId: PRINCIPAL.connection_id, chat_uuid: "chat_runway_001" };
  await assert.rejects(client.startRunwayImageWithOwnedCandidate(request));
  await assert.rejects(client.startRunwayImageWithOwnedCandidate(request));
  assert.equal(calls, 1);
  value.issuer.close();
});

test("Runway result performs one exact GET and preserves unknown MIME and geometry uncertainty", async () => {
  let calls = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: broker(),
    fetchImpl: async (input, init) => {
      calls += 1;
      assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/chat_runway_001/runway-message-1");
      assert.equal(init?.method, "GET");
      return json({ id: "runway-message-1", chat_id: 987654321, author_id: -1, message_object: [{
        id: "runway-object-1", message_id: "runway-message-1", object_type: "image", model_type: "runway_frames",
        completed: true, object_url: "https://r2.syntx.ai/runway/generated"
      }] });
    }
  });
  const result = await client.getRunwayImageResult({ chat_uuid: "chat_runway_001", message_id: "runway-message-1", variant: "runway_frames",
    provider_chat_id: "987654321", message_object_ids: ["runway-object-1"] });
  assert.equal(result.status, "COMPLETE");
  if (result.status !== "COMPLETE") return;
  assert.equal(result.artifact.url, "https://r2.syntx.ai/runway/generated");
  assert.equal(result.artifact.mime_type, null);
  assert.equal(result.artifact.mime_source, "UNKNOWN");
  assert.equal(result.artifact.geometry_verified, false);
  assert.equal(calls, 1);
});

test("Runway result rejects mismatched IDs and invalid history bindings without another request", async () => {
  let calls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    calls += 1;
    return json({ id: "runway-message-1", chat_id: 987654321, author_id: -1, message_object: [{
      id: "different-object", message_id: "runway-message-1", object_type: "image", model_type: "runway_frames",
      completed: true, object_url: "https://r2.syntx.ai/runway/generated.png"
    }] });
  } });
  const result = await client.getRunwayImageResult({ chat_uuid: "chat_runway_001", message_id: "runway-message-1", variant: "runway_frames",
    provider_chat_id: "987654321", message_object_ids: ["runway-object-1"] });
  assert.deepEqual({ status: result.status, reason: result.status === "UNVERIFIED" ? result.reason : undefined },
    { status: "UNVERIFIED", reason: "OBJECT_ID_MISMATCH" });
  await assert.rejects(client.getRunwayImageResult({ chat_uuid: "chat_runway_001", message_id: "runway-message-1", variant: "runway_frames",
    provider_chat_id: "987654321", message_object_ids: ["runway-object-1", "runway-object-2"] }));
  assert.equal(calls, 1);

  const numericIdClient = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => json({
    id: 123, chat_id: 987654321, author_id: -1, message_object: []
  }) });
  const numericId = await numericIdClient.getRunwayImageResult({ chat_uuid: "chat_runway_001", message_id: "123", variant: "runway_frames",
    provider_chat_id: "987654321", message_object_ids: ["runway-object-1"] });
  assert.deepEqual({ status: numericId.status, reason: numericId.status === "UNVERIFIED" ? numericId.reason : undefined },
    { status: "UNVERIFIED", reason: "OUTER_MESSAGE_MISMATCH" });
});

test("Runway result infers only the MIME extension and never claims decoded geometry", async () => {
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => json({
    id: "runway-message-1", chat_id: 987654321, author_id: -1, message_object: [{
      id: "runway-object-1", message_id: "runway-message-1", object_type: "image", model_type: "runway_frames",
      completed: true, object_url: "https://r2.syntx.ai/runway/generated.webp"
    }]
  }) });
  const result = await client.getRunwayImageResult({ chat_uuid: "chat_runway_001", message_id: "runway-message-1", variant: "runway_frames",
    provider_chat_id: "987654321", message_object_ids: ["runway-object-1"] });
  assert.equal(result.status, "COMPLETE");
  if (result.status !== "COMPLETE") return;
  assert.equal(result.artifact.mime_type, "image/webp");
  assert.equal(result.artifact.mime_source, "URL_EXTENSION");
  assert.equal(result.artifact.width, null);
  assert.equal(result.artifact.height, null);
  assert.equal(result.artifact.geometry_verified, false);
});
