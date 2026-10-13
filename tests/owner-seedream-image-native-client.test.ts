import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { decodeSeedreamImageResult, snapshotSeedreamImageResultReadContext } from "../src/adapter/syntx/seedream-image-result.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { createOwnerSeedreamImageOwnedReferenceBindingIssuer, prepareOwnerSeedreamImageRequest } from "../src/application/owner-seedream-image-request-preparer.js";
import { createOwnerSeedreamImageOneShotPermit, consumeOwnerSeedreamImageOneShotPermit } from "../src/application/owner-seedream-image-one-shot-policy.js";
import type { OwnerSeedreamImageParameters } from "../src/application/owner-seedream-image-parameters.js";
import { createOwnerSeedreamSourceAlphaWitness } from "../src/application/owner-seedream-source-alpha-witness.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";

const CREDENTIAL = "synthetic-seedream-image-credential";
const CHAT = "chat_seedream_001";
const PRINCIPAL = Object.freeze({ tenant_id: "tenant_seedream_test", subject_id: "owner_seedream_test", connection_id: "link_seedream_test_0123456789" });
const HANDLES = Array.from({ length: 14 }, (_, index) => `seedream_image_00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
const catalog = loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION).discoveryCatalog;
const VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const RESOLUTIONS = {
  "seedream-4": ["1K", "2K", "4K"], "seedream-4.5": ["2K", "4K"], "seedream-5": ["2K", "3K", "4K"],
  "seedream-5.0-flash": ["1K", "1.5K", "2K"], "seedream-5.0-pro": ["1K", "2K"]
} as const;
const RATIOS = ["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"] as const;
const VARIANTS = Object.keys(RESOLUTIONS) as (keyof typeof RESOLUTIONS)[];

function broker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> { return operation(CREDENTIAL); } };
}

function crc32(bytes: Buffer): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb8_8320 : 0); }
  return (crc ^ 0xffff_ffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const header = Buffer.alloc(4); header.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([header, body, checksum]);
}
function png15(alpha = 255): Buffer {
  const width = 15, height = 15, ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const rows = Array.from({ length: height }, () => Buffer.from([0, ...Array.from({ length: width }, () => [20, 40, 60, alpha]).flat()]));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(Buffer.concat(rows))), pngChunk("IEND", Buffer.alloc(0))]);
}

async function prepared(variant: typeof VARIANTS[number], referenceCount = 0,
  parameters: OwnerSeedreamImageParameters = { aspect_ratio: "1:1", resolution: RESOLUTIONS[variant][0],
    output_format: variant === "seedream-5.0-flash" ? "png" : null, background: variant === "seedream-5.0-flash" ? "opaque" : null }) {
  const issuer = createOwnerSeedreamImageOwnedReferenceBindingIssuer(async (context) => {
    const index = HANDLES.indexOf(context.reference_handle);
    return { ...context, file_url: `https://r2.syntx.ai/private/seedream/${index}.png`, source_mime_type: "image/png",
      mime_type: "image/png", width: 1200, height: 800, size: 2048,
      sha256: `sha256:${String(index + 1).padStart(64, "0")}`, expires_at: Date.now() + 600_000,
      metadata_confidence: "CONTAINER_METADATA_ONLY" as const, source_alpha_witness: null };
  }, { catalog, catalog_version: VERSION, now: Date.now });
  const referenceSet = await issuer.issue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant,
    reference_handles: HANDLES.slice(0, referenceCount) });
  const candidate = prepareOwnerSeedreamImageRequest({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant,
    parameters, reference_set: referenceSet, prompt: "exact Seedream source wording" }, { catalog, catalog_version: VERSION, now: Date.now });
  const permit = createOwnerSeedreamImageOneShotPermit({ candidate, principal: PRINCIPAL, attemptId: PRINCIPAL.connection_id,
    catalog, catalog_version: VERSION, now: Date.now });
  return { issuer, candidate, permit };
}

async function preparedTransparentFlash() {
  const bytes = png15(128);
  const sha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const witness = createOwnerSeedreamSourceAlphaWitness(bytes);
  const issuer = createOwnerSeedreamImageOwnedReferenceBindingIssuer(async (context) => ({ ...context,
    file_url: "https://r2.syntx.ai/private/seedream/transparent.png", source_mime_type: "image/png", mime_type: "image/png",
    width: 15, height: 15, size: bytes.byteLength, sha256, expires_at: Date.now() + 600_000,
    metadata_confidence: "CONTAINER_METADATA_ONLY" as const, source_alpha_witness: witness
  }), { catalog, catalog_version: VERSION, now: Date.now });
  const referenceSet = await issuer.issue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id,
    variant: "seedream-5.0-flash", reference_handles: [HANDLES[0]!] });
  const candidate = prepareOwnerSeedreamImageRequest({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id,
    variant: "seedream-5.0-flash", parameters: { aspect_ratio: "1:1", resolution: "1K", output_format: "png", background: "transparent" },
    reference_set: referenceSet, prompt: "transparent Seedream source wording" }, { catalog, catalog_version: VERSION, now: Date.now });
  const permit = createOwnerSeedreamImageOneShotPermit({ candidate, principal: PRINCIPAL, attemptId: PRINCIPAL.connection_id,
    catalog, catalog_version: VERSION, now: Date.now });
  return { issuer, candidate, permit };
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}
function resultContext(variant: typeof VARIANTS[number] = "seedream-5") {
  return { chat_uuid: "seedream-chat", message_id: "bot-result", variant, provider_chat_id: "987654321", message_object_ids: ["image-object"] };
}
function rawResult(variant = "seedream-5", url = "https://r2.syntx.ai/seedream/result.png") {
  return { id: "bot-result", chat_id: 987654321, author_id: -1, message_object: [{ id: "image-object", message_id: "bot-result",
    object_type: "image", model_type: variant, completed: true, object_url: url }] };
}

test("Seedream native client exposes the fixed owned upload, one-shot start, and exact result read seams", () => {
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => new Response("{}") });
  const seams = client as unknown as Record<string, unknown>;
  assert.equal(typeof seams.uploadSeedreamImageReference, "function");
  assert.equal(typeof seams.startSeedreamImageWithOwnedCandidate, "function");
  assert.equal(typeof seams.getSeedreamImageResult, "function");
});

test("Seedream upload uses one fixed multipart post per exact variant and returns only the safe receipt", async () => {
  const source = png15();
  const calls: Array<{ url: string; modelType: FormDataEntryValue | null; form: FormData }> = [];
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (input, init) => {
    const form = init?.body as FormData;
    calls.push({ url: String(input), modelType: form.get("model_type"), form });
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    assert.deepEqual(Array.from(form.keys()), ["files", "destination", "check_duplicates", "model_type"]);
    assert.equal(form.get("destination"), "uploaded");
    assert.equal(form.get("check_duplicates"), "true");
    const file = form.get("files");
    assert.ok(file instanceof File);
    assert.equal(file.name, "reference.png");
    assert.equal(file.type, "image/png");
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), source);
    return json({ files: [{ id: "seedream-upload-1", url: "https://r2.syntx.ai/seedream/input.png", mime_type: "image/png", size: source.byteLength }] });
  } });

  for (const variant of VARIANTS) {
    const receipt = await client.uploadSeedreamImageReference({ variant, bytes: source, filename: "reference.png", mime_type: "image/png" });
    assert.deepEqual(receipt, { file_id: "seedream-upload-1", url: "https://r2.syntx.ai/seedream/input.png" });
  }
  assert.equal(calls.length, VARIANTS.length);
  assert.deepEqual(calls.map((call) => call.modelType), VARIANTS);
  assert.ok(calls.every((call) => call.url === "https://api.syntx.ai/api/v1/chats/upload-files"));
  assert.ok(calls.every((call) => call.form.get("files") === null), "the request drops its multipart file reference on completion");
  assert.ok(source.some((byte) => byte !== 0), "caller bytes remain unchanged");
});

test("Seedream start sends the exact frozen candidate once without promoting Pro cost batch_size to the wire", async () => {
  const value = await prepared("seedream-5.0-pro");
  let calls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (input, init) => {
    calls += 1;
    assert.equal(String(input), "https://api.syntx.ai/api/v1/design/generate?ai_name=seedream");
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    assert.deepEqual(JSON.parse(String(init?.body)), {
      chat_uuid: CHAT,
      prompt: "exact Seedream source wording",
      settings: { n: 1, stream: false, model_type: "seedream-5.0-pro", aspect_ratio: "1:1", resolution: "1K", file_urls: [] }
    });
    return json({ id: "seedream-message-1" });
  } });
  const receipt = await client.startSeedreamImageWithOwnedCandidate({ candidate: value.candidate, permit: value.permit,
    principal: PRINCIPAL, attemptId: PRINCIPAL.connection_id, chat_uuid: CHAT });
  assert.deepEqual(receipt, { chat_uuid: CHAT, message_id: "seedream-message-1" });
  assert.equal(calls, 1);
  assert.equal(value.candidate.cost_inputs.batch_size, 0);
  assert.equal(Object.hasOwn(value.candidate.request.settings, "batch_size"), false);
  assert.throws(() => consumeOwnerSeedreamImageOneShotPermit({ permit: value.permit, candidate: value.candidate,
    principal: PRINCIPAL, attemptId: PRINCIPAL.connection_id }), { code: "PERMIT_ALREADY_CONSUMED" });
  value.issuer.close();
});

test("Seedream POST preserves all 104 source aspect-ratio/resolution combinations and inactive-field omissions", async () => {
  let calls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (_input, init) => {
    calls += 1;
    assert.equal(String(_input), "https://api.syntx.ai/api/v1/design/generate?ai_name=seedream");
    assert.equal(init?.method, "POST");
    const body = JSON.parse(String(init?.body)) as { settings: Record<string, unknown> };
    const settings = body.settings;
    assert.equal(settings.n, 1);
    assert.equal(settings.stream, false);
    assert.ok(VARIANTS.includes(settings.model_type as typeof VARIANTS[number]));
    assert.ok(RATIOS.includes(settings.aspect_ratio as typeof RATIOS[number]));
    assert.ok(typeof settings.resolution === "string");
    assert.deepEqual(settings.file_urls, []);
    if (settings.model_type === "seedream-5.0-flash") {
      assert.equal(settings.output_format, "png");
      assert.equal(settings.background, "opaque");
    } else {
      assert.equal(Object.hasOwn(settings, "output_format"), false);
      assert.equal(Object.hasOwn(settings, "background"), false);
    }
    assert.equal(Object.hasOwn(settings, "batch_size"), false);
    return json({ id: `seedream-combination-${calls}` });
  } });
  let combinations = 0;
  for (const variant of VARIANTS) for (const aspect_ratio of RATIOS) for (const resolution of RESOLUTIONS[variant]) {
    const flash = variant === "seedream-5.0-flash";
    const value = await prepared(variant, 0, { aspect_ratio, resolution,
      output_format: flash ? "png" : null, background: flash ? "opaque" : null });
    await client.startSeedreamImageWithOwnedCandidate({ candidate: value.candidate, permit: value.permit,
      principal: PRINCIPAL, attemptId: PRINCIPAL.connection_id, chat_uuid: CHAT });
    value.issuer.close();
    combinations += 1;
  }
  assert.equal(combinations, 104);
  assert.equal(calls, 104);
});

test("Seedream POST retains the full fourteen-reference source ceiling and reference-order file URLs", async () => {
  const value = await prepared("seedream-5", 14);
  let calls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (_input, init) => {
    calls += 1;
    const body = JSON.parse(String(init?.body)) as { settings: { file_urls: Array<{ type: string; url: string }> } };
    assert.deepEqual(body.settings.file_urls, HANDLES.map((_, index) => ({ type: "image", url: `https://r2.syntx.ai/private/seedream/${index}.png` })));
    return json({ id: "seedream-fourteen-ref-result" });
  } });
  const receipt = await client.startSeedreamImageWithOwnedCandidate({ candidate: value.candidate, permit: value.permit,
    principal: PRINCIPAL, attemptId: PRINCIPAL.connection_id, chat_uuid: CHAT });
  assert.equal(receipt.message_id, "seedream-fourteen-ref-result");
  assert.equal(value.candidate.reference_count, 14);
  assert.equal(calls, 1);
  value.issuer.close();
});

test("Seedream Flash transports transparency only from its exact nominal owned PNG candidate", async () => {
  const value = await preparedTransparentFlash();
  let calls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (_input, init) => {
    calls += 1;
    assert.deepEqual(JSON.parse(String(init?.body)), { chat_uuid: CHAT, prompt: "transparent Seedream source wording",
      settings: { n: 1, stream: false, model_type: "seedream-5.0-flash", aspect_ratio: "1:1", resolution: "1K",
        output_format: "png", background: "transparent", file_urls: [{ type: "image", url: "https://r2.syntx.ai/private/seedream/transparent.png" }] } });
    return json({ id: "seedream-transparent-result" });
  } });
  const receipt = await client.startSeedreamImageWithOwnedCandidate({ candidate: value.candidate, permit: value.permit,
    principal: PRINCIPAL, attemptId: PRINCIPAL.connection_id, chat_uuid: CHAT });
  assert.equal(receipt.message_id, "seedream-transparent-result");
  assert.equal(calls, 1);
  value.issuer.close();
});

test("Seedream exact result read performs one GET after the private history binding", async () => {
  let calls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (input, init) => {
    calls += 1;
    assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/chat_seedream_001/seedream-message-1");
    assert.equal(init?.method, "GET");
    return json({ id: "seedream-message-1", chat_id: 987654321, author_id: -1, message_object: [{
      id: "seedream-object-1", message_id: "seedream-message-1", object_type: "image", model_type: "seedream-5.0-flash",
      completed: true, object_url: "https://r2.syntx.ai/seedream/generated.png"
    }] });
  } });
  const result = await client.getSeedreamImageResult({ chat_uuid: CHAT, message_id: "seedream-message-1", variant: "seedream-5.0-flash",
    provider_chat_id: "987654321", message_object_ids: ["seedream-object-1"] });
  assert.equal(result.status, "COMPLETE");
  if (result.status !== "COMPLETE") return;
  assert.equal(result.artifact.url, "https://r2.syntx.ai/seedream/generated.png");
  assert.equal(result.artifact.mime_type, "image/png");
  assert.equal(result.artifact.geometry_verified, false);
  assert.equal(calls, 1);
  await assert.rejects(client.getSeedreamImageResult({ chat_uuid: CHAT, message_id: "seedream-message-1", variant: "seedream-5.0-flash",
    provider_chat_id: "987654321", message_object_ids: ["object-1", "object-2"] }));
  assert.equal(calls, 1, "malformed binding is rejected before another GET");
});

test("pre-aborted Seedream dispatch leaves the permit usable; an unknown POST is spent and never retried", async () => {
  const before = await prepared("seedream-4");
  let preAbortCalls = 0;
  const preAbortClient = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    preAbortCalls += 1; return json({ id: "unused" });
  } });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(preAbortClient.startSeedreamImageWithOwnedCandidate({ candidate: before.candidate, permit: before.permit,
    principal: PRINCIPAL, attemptId: PRINCIPAL.connection_id, chat_uuid: CHAT }, controller.signal),
  (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_REQUEST_ABORTED");
  assert.equal(preAbortCalls, 0);
  assert.equal(consumeOwnerSeedreamImageOneShotPermit({ permit: before.permit, candidate: before.candidate,
    principal: PRINCIPAL, attemptId: PRINCIPAL.connection_id }).status, "consumed");
  before.issuer.close();

  const after = await prepared("seedream-4.5");
  let postCalls = 0;
  const unknownClient = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    postCalls += 1; throw new Error("synthetic connection loss");
  } });
  const request = { candidate: after.candidate, permit: after.permit, principal: PRINCIPAL,
    attemptId: PRINCIPAL.connection_id, chat_uuid: CHAT };
  await assert.rejects(unknownClient.startSeedreamImageWithOwnedCandidate(request));
  await assert.rejects(unknownClient.startSeedreamImageWithOwnedCandidate(request),
    (error: unknown) => (error as { code?: string }).code === "PERMIT_ALREADY_CONSUMED");
  assert.equal(postCalls, 1);
  after.issuer.close();
});

test("Seedream upload rejects local-cap overflow before credentials and rejects an unsafe receipt without retry", async () => {
  let credentialCalls = 0;
  let fetchCalls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
    credentialCalls += 1; return operation(CREDENTIAL);
  } }, fetchImpl: async () => { fetchCalls += 1; return json({}); } });
  await assert.rejects(client.uploadSeedreamImageReference({ variant: "seedream-5", bytes: new Uint8Array(10_485_761),
    filename: "large.png", mime_type: "image/png" }),
  (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  assert.equal(credentialCalls, 0);
  assert.equal(fetchCalls, 0);

  const source = png15();
  let unsafeCalls = 0;
  let requestForm: FormData | undefined;
  const unsafeClient = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (_input, init) => {
    unsafeCalls += 1; requestForm = init?.body as FormData;
    return json({ files: [{ id: "seedream-file", url: "https://evil.invalid/seedream.png", mime_type: "image/png", size: source.byteLength }] });
  } });
  await assert.rejects(unsafeClient.uploadSeedreamImageReference({ variant: "seedream-5", bytes: source,
    filename: "reference.png", mime_type: "image/png" }));
  assert.equal(unsafeCalls, 1);
  assert.equal(requestForm?.get("files"), null);
});

test("Seedream upload accepts only one MIME/size-matched receipt and never exposes an unsafe URL in its error", async () => {
  const source = png15();
  const responses = [
    { files: [
      { id: "seedream-file-1", url: "https://r2.syntx.ai/seedream/one.png", mime_type: "image/png", size: source.byteLength },
      { id: "seedream-file-2", url: "https://r2.syntx.ai/seedream/two.png", mime_type: "image/png", size: source.byteLength }
    ] },
    { files: [{ id: "seedream-file", url: "https://r2.syntx.ai/seedream/one.png", mime_type: "image/jpeg", size: source.byteLength }] },
    { files: [{ id: "seedream-file", url: "https://evil.invalid/seedream/secret-path.png", mime_type: "image/png", size: source.byteLength }] },
    { files: [{ id: "seedream-file", url: "https://r2.syntx.ai/seedream/one.png", mime_type: "image/png", size: source.byteLength + 1 }] }
  ];
  let calls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => json(responses[calls++]!) });
  for (let index = 0; index < responses.length; index += 1) {
    await assert.rejects(client.uploadSeedreamImageReference({ variant: "seedream-5", bytes: source, filename: "reference.png", mime_type: "image/png" }), (error: unknown) => {
      assert.equal(calls, index + 1);
      assert.equal(String(error).includes("secret-path"), false);
      return true;
    });
  }
  assert.equal(calls, 4);
});

test("Seedream result decoder binds one completed output for every source variant without claiming geometry", () => {
  for (const variant of VARIANTS) {
    const result = decodeSeedreamImageResult(rawResult(variant), resultContext(variant));
    assert.equal(result.status, "COMPLETE", variant);
    if (result.status !== "COMPLETE") continue;
    assert.equal(result.model_type, variant);
    assert.equal(result.artifact.message_object_id, "image-object");
    assert.equal(result.artifact.mime_type, "image/png");
    assert.equal(result.artifact.geometry_verified, false);
    assert.equal(result.artifact.width, null);
    assert.equal(result.artifact.height, null);
  }
});

test("Seedream result decoder keeps empty or unfinished output pending and rejects mismatches", () => {
  assert.deepEqual(decodeSeedreamImageResult({ ...rawResult(), message_object: [] }, resultContext()),
    { ...resultContext(), status: "PENDING", reason: "NO_RESULT_OBJECTS" });
  const unfinished = rawResult();
  unfinished.message_object[0]!.completed = false;
  assert.equal(decodeSeedreamImageResult(unfinished, resultContext()).status, "PENDING");
  assert.equal(decodeSeedreamImageResult(rawResult("seedream-4"), resultContext()).status, "UNVERIFIED");
  assert.equal(decodeSeedreamImageResult(rawResult("seedream-5", "https://evil.example/image.png"), resultContext()).status, "UNVERIFIED");
});

test("Seedream result decoder rejects outer, provider, object ID/message/type, model, and cardinality mismatches", () => {
  const cases: Array<[unknown, string]> = [
    [{ ...rawResult(), id: "other-message" }, "OUTER_MESSAGE_MISMATCH"],
    [{ ...rawResult(), chat_id: 987654320 }, "PROVIDER_CHAT_MISMATCH"],
    [{ ...rawResult(), author_id: 77 }, "NOT_BOT_MESSAGE"],
    [{ ...rawResult(), message_object: [{ ...rawResult().message_object[0]!, id: "other-object" }] }, "OBJECT_ID_MISMATCH"],
    [{ ...rawResult(), message_object: [{ ...rawResult().message_object[0]!, message_id: "other-message" }] }, "OBJECT_MESSAGE_MISMATCH"],
    [{ ...rawResult(), message_object: [{ ...rawResult().message_object[0]!, object_type: "video" }] }, "OBJECT_TYPE_MISMATCH"],
    [rawResult("seedream-4"), "MODEL_TYPE_MISMATCH"],
    [{ ...rawResult(), message_object: [...rawResult().message_object, ...rawResult().message_object] }, "RESULT_OBJECT_CARDINALITY_INVALID"]
  ];
  for (const [payload, reason] of cases) {
    const result = decodeSeedreamImageResult(payload, resultContext());
    assert.equal(result.status, "UNVERIFIED", reason);
    if (result.status === "UNVERIFIED") assert.equal(result.reason, reason);
  }
});

test("Seedream result context snapshots exactly one safe ID and rejects widened or hostile DTOs", () => {
  const source = resultContext();
  const safe = snapshotSeedreamImageResultReadContext(source);
  source.message_object_ids[0] = "mutated-after-snapshot";
  assert.deepEqual(safe.message_object_ids, ["image-object"]);
  assert.ok(Object.isFrozen(safe) && Object.isFrozen(safe.message_object_ids));
  assert.throws(() => snapshotSeedreamImageResultReadContext({ ...resultContext(), extra: true }));
  assert.throws(() => snapshotSeedreamImageResultReadContext({ ...resultContext(), message_object_ids: ["one", "two"] }));
  assert.throws(() => snapshotSeedreamImageResultReadContext(new Proxy(resultContext(), {})));
});

test("Seedream result URL/MIME handling stays private and preserves unknown metadata without raw provider fields", () => {
  const unknownMime = decodeSeedreamImageResult(rawResult("seedream-5", "https://r2.syntx.ai/output/asset"), resultContext());
  assert.equal(unknownMime.status, "COMPLETE");
  if (unknownMime.status === "COMPLETE") {
    assert.equal(unknownMime.artifact.mime_type, null);
    assert.equal(unknownMime.artifact.mime_source, "UNKNOWN");
    assert.equal(unknownMime.artifact.geometry_verified, false);
  }
  for (const url of ["http://r2.syntx.ai/output.png", "https://user@r2.syntx.ai/output.png",
    "https://r2.syntx.ai.evil.example/output.png", "https://r2.syntx.ai:444/output.png",
    "https://r2.syntx.ai/output.png#fragment", "https://r2.syntx.ai/"]) {
    const result = decodeSeedreamImageResult(rawResult("seedream-5", url), resultContext());
    assert.equal(result.status, "UNVERIFIED", url);
    if (result.status === "UNVERIFIED") assert.equal(result.reason, "RESULT_URL_UNSAFE");
  }
  const wrongBot = decodeSeedreamImageResult({ ...rawResult(), author_id: 77, prompt: "PRIVATE_PROMPT_SENTINEL" }, resultContext());
  assert.deepEqual(wrongBot, { ...resultContext(), status: "UNVERIFIED", reason: "NOT_BOT_MESSAGE" });
  assert.equal(JSON.stringify(wrongBot).includes("PRIVATE_PROMPT_SENTINEL"), false);
});
