import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { OwnerKlingKeyframesReferenceService } from "../src/application/owner-kling-keyframes-reference-service.js";
import { createOwnerKlingKeyframesRequestPreparer, isOwnerKlingKeyframesPreparedCandidate,
  readOwnerKlingKeyframesNativeBindingForClient } from "../src/application/owner-kling-keyframes-request-preparer.js";

const ATTEMPT = "link_keyframes_preparer_owner_123456";
const BINDING = Object.freeze({ tenant_id: "keyframes-preparer-tenant", subject: "keyframes-preparer-owner" });
const NOW = Date.parse("2026-10-14T00:00:00.000Z");
const PNG = png300();

function png300(): Buffer {
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
  bytes.writeUInt32BE(300, 16); bytes.writeUInt32BE(300, 20); bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29); return bytes;
}
function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); }
  return (crc ^ 0xffff_ffff) >>> 0;
}

async function setup(urls = ["https://r2.syntx.ai/hidden/first.png", "https://r2.syntx.ai/hidden/second.png"]) {
  let now = NOW;
  const provider = { authorizationProfile: "OBSERVED_OWNER_AUTHORIZED" as const,
    async createChallenge() { return { upstream_attempt_id: "synthetic", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id: string, receive: (token: { scheme: "Bearer"; value: string }) => Promise<void>) {
      await receive({ scheme: "Bearer", value: "synthetic-link-token" }); return { state: "LINKED" as const };
    } };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(() => now), { now: () => now,
    defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => ATTEMPT });
  await links.createAttempt(BINDING); await links.issueHandoff(BINDING, ATTEMPT); await links.checkAttempt(BINDING, ATTEMPT);
  let uploads = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: { async useCredential<T>(operation: (value: string) => Promise<T>) {
    return operation("synthetic-preparer-token"); } }, fetchImpl: async (_request, init) => {
      const file = (init?.body as FormData).get("files"); assert.ok(file instanceof File); uploads += 1;
      return Response.json({ files: [{ id: `private-${uploads}`, url: urls[uploads - 1]!, filename: file.name,
        mime_type: "image/png", size: PNG.byteLength }] });
    } });
  const references = new OwnerKlingKeyframesReferenceService({ binding: BINDING, linkService: links, resolveClient: () => client, now: () => now });
  const upload = (filename: string) => references.upload({ attemptId: ATTEMPT, content_base64: PNG.toString("base64"), filename, mime_type: "image/png" });
  const first = await upload("first.png"), second = await upload("second.png");
  return { references, links, client, handles: [String(first.image_handle), String(second.image_handle)] as const, uploads,
    advance(milliseconds: number) { now += milliseconds; } };
}

const parameter = (version: string) => ({ model_id: "kling_keyframes", version, mode: "hd", video_duration: version === "3.0" ? 3 : 5,
  native_audio: false, aspect_ratio: null });
const controls = (version: string) => version === "3.0" ? { temperature: 0.6, multi_shots: false } : { temperature: 0.6 };

test("prepares all six Keyframes versions into a typed private request and a safe nominal candidate", async () => {
  const state = await setup();
  const preparer = createOwnerKlingKeyframesRequestPreparer({ referenceService: state.references, now: () => NOW });
  try {
    for (const version of ["1.5", "1.6", "2.1", "2.5", "2.6", "3.0"]) {
      const candidate = await preparer.prepare({ attemptId: ATTEMPT, prompt: "  Preserve this exact raw prompt.  ", parameters: parameter(version),
        controls: controls(version), image_handles: state.handles });
      assert.equal(candidate.model_id, "kling_keyframes");
      assert.equal(candidate.prompt_utf16_length, 35);
      assert.equal(candidate.dispatch_allowed, false);
      assert.equal(JSON.stringify(candidate).includes("https://"), false);
      assert.equal(JSON.stringify(candidate).includes("Preserve this exact"), false);
      const inspected = preparer.inspectCandidate(candidate) as unknown as { attempt_id?: string; principal?: unknown;
        image_handles?: readonly string[]; reference_epoch?: number; reference_expires_at?: number };
      assert.equal(inspected.attempt_id, ATTEMPT);
      assert.deepEqual(inspected.image_handles, state.handles);
      assert.equal(typeof inspected.reference_epoch, "number");
      assert.equal(typeof inspected.reference_expires_at, "number");
      assert.ok(inspected.principal && typeof inspected.principal === "object");
      const nativeBinding = preparer.getNativeBindingForClient(state.client, candidate);
      assert.equal(preparer.getNativeBindingForClient(state.client, candidate), nativeBinding);
      assert.equal(nativeBinding.status, "captured");
      assert.equal(readOwnerKlingKeyframesNativeBindingForClient(state.client, nativeBinding)?.length, 2);
      assert.equal(readOwnerKlingKeyframesNativeBindingForClient({}, nativeBinding), null);
      assert.throws(() => preparer.getNativeBindingForClient({}, candidate));
      const request = preparer.getPrivateRequest(candidate);
      assert.equal(request.prompt, "  Preserve this exact raw prompt.  ");
      assert.equal(request.settings.version, version);
      assert.deepEqual(request.settings.file_urls, [
        { type: "image", url: "https://r2.syntx.ai/hidden/first.png" },
        { type: "image", url: "https://r2.syntx.ai/hidden/second.png" }
      ]);
      assert.equal(Object.isFrozen(request.settings.file_urls), true);
    }
  } finally { await preparer.close(); await state.references.close(); }
});

test("rejects duplicate typed URLs before candidate issuance and preserves borrowed references on close", async () => {
  const state = await setup(["https://r2.syntx.ai/hidden/same.png", "https://r2.syntx.ai/hidden/same.png"]);
  const preparer = createOwnerKlingKeyframesRequestPreparer({ referenceService: state.references, now: () => NOW });
  try {
    await assert.rejects(() => preparer.prepare({ attemptId: ATTEMPT, prompt: "A valid nonblank prompt.", parameters: parameter("2.1"),
      controls: controls("2.1"), image_handles: state.handles }), (error: unknown) => error instanceof Error && "code" in error && error.code === "REFERENCE_UNAVAILABLE");
    await preparer.close();
    const pair = await state.references.resolvePair({ attempt_id: ATTEMPT, image_handles: state.handles });
    assert.equal(state.references.isOwnedPairResolution(pair, { attempt_id: ATTEMPT, image_handles: state.handles }), true);
    for (const prompt of ["", "   ", "bad\u0000prompt", "unpaired \ud800"]) {
      const fresh = await setup();
      const local = createOwnerKlingKeyframesRequestPreparer({ referenceService: fresh.references, now: () => NOW });
      await assert.rejects(() => local.prepare({ attemptId: ATTEMPT, prompt, parameters: parameter("2.1"), controls: controls("2.1"), image_handles: fresh.handles }),
        (error: unknown) => error instanceof Error && "code" in error && error.code === "PROMPT_INVALID");
      await local.close(); await fresh.references.close();
    }
  } finally { await preparer.close(); await state.references.close(); }
});

test("snapshots caller data before awaits, rejects cloned candidates, rechecks ownership, and drains its own close", async () => {
  const state = await setup();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const getStatus = state.links.getStatus.bind(state.links);
  state.links.getStatus = async (...args: Parameters<typeof state.links.getStatus>) => { await gate; return getStatus(...args); };
  const preparer = createOwnerKlingKeyframesRequestPreparer({ referenceService: state.references, now: () => NOW });
  try {
    const params = parameter("2.1"), settings = controls("2.1"), handles = [...state.handles];
    const input = { attemptId: ATTEMPT, prompt: "Keep this prompt exactly.", parameters: params, controls: settings, image_handles: handles };
    const pending = preparer.prepare(input);
    input.prompt = "caller mutation"; params.version = "2.5"; settings.temperature = 0.9; handles.reverse();
    release();
    const candidate = await pending;
    assert.equal(preparer.getPrivateRequest(candidate).prompt, "Keep this prompt exactly.");
    assert.equal(preparer.getPrivateRequest(candidate).settings.version, "2.1");
    assert.equal(preparer.getPrivateRequest(candidate).settings.temperature, 0.6);
    assert.deepEqual(preparer.getPrivateRequest(candidate).settings.file_urls.map((item) => item.url), [
      "https://r2.syntx.ai/hidden/first.png", "https://r2.syntx.ai/hidden/second.png"
    ]);
    assert.equal(isOwnerKlingKeyframesPreparedCandidate(candidate), true);
    assert.equal(isOwnerKlingKeyframesPreparedCandidate({ ...candidate }), false);
    const binding = preparer.inspectCandidate(candidate);
    assert.ok(binding && Object.isFrozen(binding) && Object.isFrozen(binding.principal) && Object.isFrozen(binding.image_handles));
    assert.equal((await preparer.revalidateCandidate(candidate)), binding);
    assert.throws(() => preparer.getPrivateRequest({ ...candidate }), (error: unknown) => error instanceof Error && "code" in error && error.code === "CANDIDATE_UNBOUND");
    await state.links.revoke(BINDING, ATTEMPT);
    await assert.rejects(() => preparer.revalidateCandidate(candidate));
    assert.equal(preparer.inspectCandidate(candidate), undefined);
  } finally { release(); await preparer.close(); await state.references.close(); }

  const expiring = await setup();
  const expiringPreparer = createOwnerKlingKeyframesRequestPreparer({ referenceService: expiring.references, now: () => NOW });
  try {
    const candidate = await expiringPreparer.prepare({ attemptId: ATTEMPT, prompt: "A bounded prompt.", parameters: parameter("2.1"),
      controls: controls("2.1"), image_handles: expiring.handles });
    expiring.advance(15 * 60_000 + 1);
    assert.throws(() => expiringPreparer.getPrivateRequest(candidate),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "CANDIDATE_EXPIRED");
  } finally { await expiringPreparer.close(); await expiring.references.close(); }

  const draining = await setup();
  let unblock!: () => void;
  const blocked = new Promise<void>((resolve) => { unblock = resolve; });
  const status = draining.links.getStatus.bind(draining.links);
  draining.links.getStatus = async (...args: Parameters<typeof draining.links.getStatus>) => { await blocked; return status(...args); };
  const owner = createOwnerKlingKeyframesRequestPreparer({ referenceService: draining.references, now: () => NOW });
  const operation = owner.prepare({ attemptId: ATTEMPT, prompt: "A prompt that waits.", parameters: parameter("2.1"),
    controls: controls("2.1"), image_handles: draining.handles });
  const closed = owner.close();
  await closed;
  await assert.rejects(operation);
  unblock();
  const borrowedPair = await draining.references.resolvePair({ attempt_id: ATTEMPT, image_handles: draining.handles });
  assert.equal(draining.references.isOwnedPairResolution(borrowedPair, { attempt_id: ATTEMPT, image_handles: draining.handles }), true);
  await draining.references.close();
});

test("maps cyclic unknown parameter data to a typed local parameters error", async () => {
  const state = await setup();
  const preparer = createOwnerKlingKeyframesRequestPreparer({ referenceService: state.references, now: () => NOW });
  try {
    const cyclic = parameter("2.1") as Record<string, unknown>;
    cyclic.unknown = cyclic;
    await assert.rejects(() => preparer.prepare({ attemptId: ATTEMPT, prompt: "A valid prompt.", parameters: cyclic,
      controls: controls("2.1"), image_handles: state.handles }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "PARAMETERS_INVALID");
  } finally { await preparer.close(); await state.references.close(); }
});
