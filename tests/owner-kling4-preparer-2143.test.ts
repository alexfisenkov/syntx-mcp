import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";

const ATTEMPT = "link_kling4_preparer_2143_0123456789abcdef";
const BINDING = { tenant_id: "k4-2143-test", subject: "synthetic-owner" };
const MODEL = "kling_4_keyframes" as const;

async function modules() {
  return {
    ...await import(new URL("../src/application/owner-kling4-reference-service.js", import.meta.url).href),
    ...await import(new URL("../src/application/owner-kling4-request-preparer.js", import.meta.url).href)
  } as {
    OwnerKling4ReferenceService: new (options: unknown) => Store;
    createOwnerKling4RequestPreparer(options: unknown): Preparer;
    isOwnerKling4PreparedCandidate(value: unknown): boolean;
  };
}
interface Source { readonly reference_handle: string; readonly sha256: string; }
interface Candidate {
  readonly status: "blocked"; readonly model_id: string; readonly sources: readonly Source[];
  readonly request_fingerprint: string; readonly intent_fingerprint: string; readonly expires_at: number;
}
interface Policy {
  createOwnerKling4OneShotPermit(input: unknown): Promise<object>;
  revalidateOwnerKling4OneShotPermit(input: unknown): Promise<void>;
  consumeOwnerKling4OneShotPermit(input: unknown): Readonly<{ status: string }>;
}
interface Wire {
  readonly prompt: string; readonly settings: Readonly<Record<string, unknown>>;
  readonly cost_parameters: Readonly<Record<string, unknown>>;
}
interface Store {
  uploadReference(input: unknown): Promise<Source>;
  close(): Promise<void>;
}
interface Preparer {
  prepare(input: unknown, signal?: AbortSignal): Promise<Candidate>;
  inspectCandidate(value: unknown): Readonly<Record<string, unknown>> | undefined;
  getPrivateRequest(value: unknown): Wire;
  revalidateCandidate(value: unknown, signal?: AbortSignal): Promise<Readonly<Record<string, unknown>>>;
  withCapturedReferences<T>(value: unknown, use: (client: SyntxChatHttpClient, wire: Wire) => T): T;
  invalidateAttempt(attemptId: string): Promise<void>;
  close(): Promise<void>;
}
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(width = 300): Buffer {
  function chunk(type: string, data: Buffer) {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length); out.write(type, 4); data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, -4)), out.length - 4);
    return out;
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(300, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.alloc((width * 4 + 1) * 300))), chunk("IEND", Buffer.alloc(0))]);
}
async function runtime() {
  const api = await modules();
  let time = 10000, uploads = 0;
  const now = () => time;
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "synthetic2143", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic2143-token" }); return { state: "LINKED" }; }
  };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(now), { now, attemptIdGenerator: () => ATTEMPT });
  await links.createAttempt(BINDING); await links.issueHandoff(BINDING, ATTEMPT); await links.checkAttempt(BINDING, ATTEMPT);
  const makeClient = () => new SyntxChatHttpClient({ credentialBroker: { async useCredential<T>(use: (token: string) => Promise<T>) {
    return use("synthetic2143-http-token");
  } }, fetchImpl: async (input, init) => {
    assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
    assert.equal(init?.method, "POST");
    const form = init?.body as FormData, file = form.get("files") as File;
    assert.equal(form.get("model_type"), MODEL);
    uploads++;
    return new Response(JSON.stringify({ files: [{ id: `2143-${uploads}`, url: `https://r2.syntx.ai/k4-2143/${uploads}.png`,
      mime_type: file.type, size: file.size, status: "uploaded" }] }), { headers: { "content-type": "application/json" } });
  } });
  let client = makeClient();
  const service = new api.OwnerKling4ReferenceService({ binding: BINDING, linkService: links, resolveClient: () => client,
    ffprobePath: process.execPath, now });
  const preparer = api.createOwnerKling4RequestPreparer({ referenceService: service, now });
  return { api, service, preparer, get client() { return client; }, get uploads() { return uploads; },
    replaceClient() { client = makeClient(); }, advance() { time += 900001; },
    upload(bytes = png()) { return service.uploadReference({ attemptId: ATTEMPT, model_id: MODEL,
      filename: "synthetic.png", mime_type: "image/png", bytes }); },
    async close() { await preparer.close(); await service.close(); } };
}
function request(handles: readonly string[], patch: Record<string, unknown> = {}) {
  return { attemptId: ATTEMPT, model_id: MODEL, prompt: "\nFrame [[ref:1]] then [[ref:2]]  ", version: "4.0",
    mode: "standart", aspect_ratio: "16:9", video_duration: 3, native_audio: true, reference_handles: handles, ...patch };
}

test("prepares genuine ordered K4 uploads into a URL-free candidate and exact private wire", async () => {
  const r = await runtime();
  try {
    const a = await r.upload(), b = await r.upload(png(301));
    const value = await r.preparer.prepare(request([b.reference_handle, a.reference_handle]));
    assert.equal(r.api.isOwnerKling4PreparedCandidate(value), true);
    assert.deepEqual(value.sources.map(x => x.sha256), [b.sha256, a.sha256]);
    assert.equal(JSON.stringify(value).includes("r2.syntx.ai"), false);
    const wire = r.preparer.getPrivateRequest(value);
    assert.equal(wire.prompt, "\nFrame <<<https://r2.syntx.ai/k4-2143/2.png>>> then <<<https://r2.syntx.ai/k4-2143/1.png>>>  ");
    assert.deepEqual(Object.keys(wire.settings).sort(), ["aspect_ratio", "file_urls", "mode", "model_type", "native_audio", "version", "video_duration"]);
    assert.equal(wire.settings.model_type, MODEL); assert.equal(wire.settings.native_audio, true);
    assert.deepEqual(wire.cost_parameters, { mode: "standart", version: "4.0", video_duration: 3 });
    assert.equal(r.preparer.withCapturedReferences(value, (client, actual) => client === r.client && actual === wire), true);
    assert.deepEqual(await r.preparer.revalidateCandidate(value), r.preparer.inspectCandidate(value));
    assert.throws(() => r.preparer.getPrivateRequest(Object.freeze({ ...value })));
    assert.equal(r.uploads, 2);
  } finally { await r.close(); }
});

test("semantic intent ignores new handles and URLs but binds text, controls and ordered content", async () => {
  const r = await runtime();
  try {
    const a = await r.upload(), b = await r.upload(png(301)), a2 = await r.upload(), b2 = await r.upload(png(301));
    const one = await r.preparer.prepare(request([a.reference_handle, b.reference_handle]));
    const same = await r.preparer.prepare(request([a2.reference_handle, b2.reference_handle]));
    assert.equal(one.intent_fingerprint, same.intent_fingerprint);
    assert.notEqual(one.request_fingerprint, same.request_fingerprint);
    const reversed = await r.preparer.prepare(request([b.reference_handle, a.reference_handle]));
    assert.notEqual(one.intent_fingerprint, reversed.intent_fingerprint);
    const different = await r.preparer.prepare(request([a.reference_handle, b.reference_handle], { mode: "hd" }));
    assert.notEqual(one.intent_fingerprint, different.intent_fingerprint);
  } finally { await r.close(); }
});

test("zero-reference preparation is linked and source-shaped, never provider acceptance", async () => {
  const r = await runtime();
  try {
    const value = await r.preparer.prepare(request([], { prompt: "A calm synthetic moving scene." }));
    assert.deepEqual(value.sources, []);
    assert.deepEqual(r.preparer.getPrivateRequest(value).settings.file_urls, []);
    assert.equal(r.uploads, 0);
    r.replaceClient();
    assert.equal(r.preparer.inspectCandidate(value), undefined);
    await assert.rejects(r.preparer.revalidateCandidate(value));
  } finally { await r.close(); }
});

test("revokes prepared captures on invalidation, expiry and close; pre-abort grants no candidate", async () => {
  const r = await runtime();
  try {
    const a = await r.upload();
    const input = request([a.reference_handle], { prompt: "Use [[ref:1]] alone." });
    await assert.rejects(r.preparer.prepare(input, AbortSignal.abort()));
    const value = await r.preparer.prepare(input);
    await r.preparer.invalidateAttempt(ATTEMPT);
    assert.equal(r.preparer.inspectCandidate(value), undefined);
    assert.throws(() => r.preparer.withCapturedReferences(value, () => true));
    const zero = await r.preparer.prepare(request([], { prompt: "New independent scene." }));
    r.advance();
    assert.equal(r.preparer.inspectCandidate(zero), undefined);
    await r.preparer.close();
    await assert.rejects(r.preparer.prepare(input));
  } finally { await r.close(); }
});

test("one-shot binds genuine K4 candidate/principal and consumes one semantic intent", async () => {
  const policy = await import(new URL("../src/application/owner-kling4-one-shot-policy.js", import.meta.url).href) as Policy;
  const r = await runtime();
  try {
    const a = await r.upload();
    const input = request([a.reference_handle], { prompt: "Unique policy2143 [[ref:1]] scene." });
    const candidate = await r.preparer.prepare(input);
    const principal = { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT };
    const context = { preparer: r.preparer, candidate, principal, attemptId: ATTEMPT };
    await assert.rejects(policy.createOwnerKling4OneShotPermit({ ...context, candidate: Object.freeze({ ...candidate }) }));
    await assert.rejects(policy.createOwnerKling4OneShotPermit({ ...context, principal: { ...principal, subject_id: "another-owner" } }));
    const permit = await policy.createOwnerKling4OneShotPermit(context), consume = { ...context, permit };
    assert.throws(() => policy.consumeOwnerKling4OneShotPermit(consume));
    await policy.revalidateOwnerKling4OneShotPermit(consume);
    assert.equal(policy.consumeOwnerKling4OneShotPermit(consume).status, "consumed");
    assert.throws(() => policy.consumeOwnerKling4OneShotPermit(consume));
    const newHandle = await r.upload();
    const sameIntent = await r.preparer.prepare(request([newHandle.reference_handle], { prompt: input.prompt }));
    assert.equal(candidate.intent_fingerprint, sameIntent.intent_fingerprint);
    await assert.rejects(policy.createOwnerKling4OneShotPermit({ ...context, candidate: sameIntent }));
    const other = await r.preparer.prepare(request([], { prompt: "Revoked policy2143 scene." }));
    const otherContext = { ...context, candidate: other };
    const otherPermit = await policy.createOwnerKling4OneShotPermit(otherContext);
    await r.preparer.invalidateAttempt(ATTEMPT);
    await assert.rejects(policy.revalidateOwnerKling4OneShotPermit({ ...otherContext, permit: otherPermit }));
  } finally { await r.close(); }
});
