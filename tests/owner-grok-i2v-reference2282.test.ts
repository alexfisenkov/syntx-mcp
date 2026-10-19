import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { OwnerGrokI2vReferenceService, OwnerGrokI2vReferenceServiceError } from "../src/application/owner-grok-i2v-reference-service.js";

const ATTEMPT = "link_grok_i2v_reference_owner_0123456789abcdef";
const OTHER_ATTEMPT = "link_grok_i2v_reference_other_0123456789abcdef";
const BINDING = Object.freeze({ tenant_id: "grok-i2v-reference-test", subject: "owner" });
const URL = "https://r2.syntx.ai/grok-i2v/private/frame.png";
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); }
  return (crc ^ 0xffff_ffff) >>> 0;
}
function png(width = 1600, height = 900, altered = false): Buffer {
  const bytes = Buffer.from(PNG_BASE64, "base64");
  bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20); bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29);
  if (altered) {
    let offset = 8;
    while (offset < bytes.length) {
      const length = bytes.readUInt32BE(offset), type = bytes.toString("ascii", offset + 4, offset + 8);
      if (type === "IDAT") { bytes[offset + 8] = bytes[offset + 8]! ^ 1; bytes.writeUInt32BE(crc32(bytes.subarray(offset + 4, offset + 8 + length)), offset + 8 + length); break; }
      offset += 12 + length;
    }
  }
  return bytes;
}
function upload(attemptId = ATTEMPT, model_id: "grok_i2v" | "grok_15_i2v" = "grok_i2v", bytes = png()) {
  return { attemptId, model_id, filename: "frame.png", mime_type: "image/png", bytes };
}
function resolve(reference_handle: string, attemptId = ATTEMPT, model_id: "grok_i2v" | "grok_15_i2v" = "grok_i2v") {
  return { attemptId, model_id, reference_handles: [reference_handle] };
}
function knownError(code: string) {
  return (error: unknown) => error instanceof OwnerGrokI2vReferenceServiceError && error.code === code;
}
async function env(fetchHandler?: (input: RequestInfo | URL, init: RequestInit) => Response | Promise<Response>) {
  let now = 1_000, next = 0, posts = 0, seen: { destination: string; model_type: string; bytes: Buffer } | undefined;
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: `grok-i2v-${next}`, approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-grok-i2v-token" }); return { state: "LINKED" }; }
  };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(() => now), { now: () => now,
    defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => [ATTEMPT, OTHER_ATTEMPT][next++]! });
  for (const id of [ATTEMPT, OTHER_ATTEMPT]) { await links.createAttempt(BINDING); await links.issueHandoff(BINDING, id); await links.checkAttempt(BINDING, id); }
  const makeClient = () => new SyntxChatHttpClient({ credentialBroker: {
    async useCredential<T>(operation: (token: string) => Promise<T>) { return operation("synthetic-grok-i2v-client-token"); }
  }, fetchImpl: async (input, init) => {
    posts++;
    const form = init?.body as FormData, file = form.get("files");
    if (!(file instanceof File)) throw new Error("synthetic expected image upload");
    seen = { destination: String(form.get("destination")), model_type: String(form.get("model_type")), bytes: Buffer.from(await file.arrayBuffer()) };
    if (fetchHandler) return fetchHandler(input, init ?? {});
    return Response.json({ files: [{ id: `grok-i2v-file-${posts}`, url: URL, filename: file.name, mime_type: file.type,
      size: file.size, status: "success" }] });
  } });
  let client = makeClient();
  const service = new OwnerGrokI2vReferenceService({ binding: BINDING, linkService: links, resolveClient: () => client,
    uploadDestination: "hidden", now: () => now });
  return { service, client: () => client, rotate: () => { client = makeClient(); }, posts: () => posts, seen: () => seen,
    links, advance: (amount: number) => { now += amount; }, cleanup: () => service.close() };
}

test("2282 requires operator-selected upload destination at vault construction", async () => {
  const e = await env();
  try {
    assert.throws(() => new OwnerGrokI2vReferenceService({ binding: BINDING, linkService: e.links, resolveClient: e.client }),
      knownError("INVALID_REQUEST"));
    assert.throws(() => new OwnerGrokI2vReferenceService({ binding: BINDING, linkService: e.links,
      resolveClient: e.client, uploadDestination: "public" }), knownError("INVALID_REQUEST"));
  } finally { await e.cleanup(); }
});

test("2282 reference vault reuses one owner image across Grok I2V models without binding aspect ratio", async () => {
  const e = await env(), source = png(), before = Buffer.from(source);
  try {
    const receipt = await e.service.uploadReference(upload(ATTEMPT, "grok_i2v", source));
    assert.equal(e.seen()?.destination, "hidden"); assert.equal(e.seen()?.model_type, "grok_i2v");
    assert.deepEqual(e.seen()?.bytes, source); assert.deepEqual(source, before, "vault does not wipe the caller's original buffer");
    assert.equal(receipt.model_id, "grok_i2v"); assert.equal(receipt.media_type, "image");
    assert.equal(receipt.generation_permit, false); assert.equal(JSON.stringify(receipt).includes("r2.syntx.ai"), false);

    const owned = await e.service.resolveReferences(resolve(receipt.reference_handle, ATTEMPT, "grok_15_i2v"));
    assert.equal(owned.model_id, "grok_15_i2v"); assert.equal("aspect_ratio" in owned, false);
    assert.equal(e.service.isOwnedReferences(owned), true); assert.equal(e.service.isOwnedReferences({ ...owned }), false);
    e.service.withCapturedReferences(owned, { model_id: "grok_15_i2v" }, (client, refs) => {
      assert.equal(client, e.client()); assert.equal(refs.length, 1); assert.equal(refs[0]?.type, "image"); assert.equal(refs[0]?.url, URL);
    });
    await assert.rejects(e.service.resolveReferences(resolve(receipt.reference_handle, OTHER_ATTEMPT, "grok_15_i2v")), knownError("REFERENCE_UNAVAILABLE"));
    await assert.rejects(e.service.resolveReferences({ ...resolve(receipt.reference_handle), aspect_ratio: "16:9" }), knownError("INVALID_REQUEST"));
    assert.equal(e.posts(), 1);
  } finally { await e.cleanup(); }
});

test("2282 same provider URL with conflicting image bytes makes both reference lineages unavailable", async () => {
  const e = await env(), first = await e.service.uploadReference(upload()), second = upload(ATTEMPT, "grok_i2v", png(1600, 900, true));
  try {
    await assert.rejects(e.service.uploadReference(second), knownError("UPLOAD_OUTCOME_UNKNOWN"));
    await assert.rejects(e.service.resolveReferences(resolve(first.reference_handle)), knownError("REFERENCE_UNAVAILABLE"));
    assert.equal(e.posts(), 2);
  } finally { await e.cleanup(); }
});

test("2282 unknown native upload is sticky across model selection and does not replay", async () => {
  const e = await env(async () => { throw new Error("synthetic lost upload acknowledgement"); });
  const source = upload();
  try {
    await assert.rejects(e.service.uploadReference(source), knownError("UPLOAD_OUTCOME_UNKNOWN"));
    await assert.rejects(e.service.uploadReference(upload(ATTEMPT, "grok_15_i2v", png())), knownError("UPLOAD_OUTCOME_UNKNOWN"));
    assert.equal(e.posts(), 1); assert.deepEqual(source.bytes, png());
  } finally { await e.cleanup(); }
});
