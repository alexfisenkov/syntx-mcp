import assert from "node:assert/strict";
import test from "node:test";
import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { OwnerSeedanceEditorReferenceService } from "../src/application/owner-seedance-editor-reference-service.js";

const A = "link_seedance_editor_owner_0123456789abcdef";
const B = "link_seedance_editor_owner_fedcba9876543210";
const BINDING = Object.freeze({ tenant_id: "seedance-editor-local", subject: "owner" });
const URL = "https://r2.syntx.ai/seedance-editor/hidden/clip.mp4";
const PROBE = JSON.stringify({ streams: [{ codec_type: "video", width: 320, height: 240, start_time: "0", duration: "4.25",
  time_base: "1/1000", duration_ts: 4250, start_pts: 0, disposition: { attached_pic: 0 } }] });

function mp4(): Buffer {
  const bytes = Buffer.alloc(24); bytes.writeUInt32BE(24, 0); bytes.write("ftyp", 4, "ascii"); bytes.write("isom", 8, "ascii");
  bytes.writeUInt32BE(0, 12); bytes.write("isom", 16, "ascii"); bytes.write("mp41", 20, "ascii"); return bytes;
}
async function ffprobeFixture(): Promise<{ directory: string; path: string }> {
  const directory = await mkdtemp(join(tmpdir(), "syntx-seedance-editor-reference-2228-"));
  const path = join(directory, "ffprobe-fixture");
  await writeFile(path, "#!" + process.execPath + "\nprocess.stdout.write(" + JSON.stringify(PROBE) + ");\n", { mode: 0o700, flag: "wx" });
  await chmod(path, 0o700); return { directory, path: await realpath(path) };
}
async function env(fetchHandler: (signal: AbortSignal | null, init: RequestInit) => Response | Promise<Response>) {
  let time = 1_000, next = 0, calls = 0;
  const now = () => time;
  const provider: AuthLinkProvider = { authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "seedance-" + next, approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-seedance-owner-token" }); return { state: "LINKED" }; } };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(now), { now, defaultTtlMs: 30 * 60_000,
    attemptIdGenerator: () => [A, B][next++]! });
  for (const id of [A, B]) { await links.createAttempt(BINDING); await links.issueHandoff(BINDING, id); await links.checkAttempt(BINDING, id); }
  const makeClient = () => new SyntxChatHttpClient({ credentialBroker: {
    async useCredential<T>(operation: (credential: string) => Promise<T>) { return operation("synthetic-seedance-editor-credential"); }
  }, fetchImpl: async (_url, init) => { calls++; return fetchHandler(init?.signal ?? null, init ?? {}); } });
  const fixture = await ffprobeFixture(); let client = makeClient();
  const service = new OwnerSeedanceEditorReferenceService({ binding: BINDING, linkService: links,
    resolveClient: () => client, ffprobePath: fixture.path, now });
  return { service, links, client: () => client, rotate: () => { client = makeClient(); }, count: () => calls,
    advance: () => { time += 15 * 60_000; }, cleanup: async () => { await service.close(); await rm(fixture.directory, { recursive: true, force: true }); } };
}
const response = () => new Response(JSON.stringify({ files: [{ url: URL, id: "seedance-editor-file-1" }] }), { headers: { "content-type": "application/json" } });
const upload = (attemptId = A, bytes = mp4()) => ({ attemptId, model_id: "seedance-2.5-editor", filename: "source.mp4", mime_type: "video/mp4", bytes });
const resolve = (handle: string, attemptId = A) => ({ attemptId, model_id: "seedance-2.5-editor", reference_handles: [handle] });

test("2228 genuine owner upload resolves one opaque video handle and keeps URLs private", async (t) => {
  if (process.platform === "win32") { t.skip("POSIX ffprobe fixture executable unavailable on Windows"); return; }
  const e = await env(async (_signal, init) => {
    const form = init.body as FormData; const file = form.get("files");
    assert.ok(file instanceof File); assert.equal(file.name, "source.mp4"); assert.equal(file.type, "video/mp4");
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), mp4()); return response();
  });
  try {
    const receipt = await e.service.uploadReference(upload());
    assert.match(receipt.reference_handle, /^seedance_editor_reference_[0-9a-f-]{36}$/u);
    assert.equal(receipt.model_id, "seedance-2.5-editor"); assert.equal(receipt.kind, "video");
    assert.equal(receipt.duration_seconds, 4.25); assert.equal(receipt.expires_in_seconds, 900);
    assert.equal(receipt.input_confidence, "LOCAL_METADATA_ONLY_NO_DECODE"); assert.equal(JSON.stringify(receipt).includes("r2.syntx.ai"), false);
    const owned = await e.service.resolveReferences(resolve(receipt.reference_handle));
    assert.equal(e.service.isOwnedReferences(owned), true); assert.equal(owned.generation_permit, false);
    assert.equal(e.service.isOwnedReferences({ ...owned }), false);
    e.service.withCapturedReferences(owned, (client, rows) => {
      assert.equal(client, e.client()); assert.equal(rows.length, 1); assert.equal(rows[0]?.kind, "video");
      assert.equal(rows[0]?.url, URL); assert.equal(rows[0]?.duration_seconds, 4.25);
    });
    await assert.rejects(e.service.resolveReferences(resolve(receipt.reference_handle, B)), { code: "REFERENCE_UNAVAILABLE" });
    await assert.rejects(e.service.resolveReferences({ ...resolve(receipt.reference_handle), reference_handles: [receipt.reference_handle, receipt.reference_handle] }),
      { code: "INVALID_REQUEST" });
    e.rotate(); assert.equal(e.service.isOwnedReferences(owned), false);
    await assert.rejects(e.service.resolveReferences(resolve(receipt.reference_handle)), { code: "REFERENCE_UNAVAILABLE" });
    assert.equal(e.count(), 1);
  } finally { await e.cleanup(); }
});

test("2228 ambiguous native upload is sticky across invalidation and cannot be retried", async (t) => {
  if (process.platform === "win32") { t.skip("POSIX ffprobe fixture executable unavailable on Windows"); return; }
  const e = await env(async () => { throw new Error("synthetic upload acknowledgement lost"); });
  try {
    await assert.rejects(e.service.uploadReference(upload()), { code: "UPLOAD_OUTCOME_UNKNOWN" });
    await e.service.invalidateAttempt(A);
    await assert.rejects(e.service.uploadReference(upload()), { code: "UPLOAD_OUTCOME_UNKNOWN" });
    assert.equal(e.count(), 1);
  } finally { await e.cleanup(); }
});

test("2228 reference_handles accessor is rejected without invoking it or fetching", async (t) => {
  if (process.platform === "win32") { t.skip("POSIX ffprobe fixture executable unavailable on Windows"); return; }
  const e = await env(async () => response());
  let getterCalls = 0;
  try {
    const handles: string[] = [];
    Object.defineProperty(handles, "0", { get() { getterCalls++; throw new Error("must not run"); }, enumerable: true, configurable: true });
    await assert.rejects(e.service.resolveReferences({ attemptId: A, model_id: "seedance-2.5-editor", reference_handles: handles }),
      { code: "INVALID_REQUEST" });
    assert.equal(getterCalls, 0); assert.equal(e.count(), 0);
  } finally { await e.cleanup(); }
});

test("2228 expiry and pending invalidation revoke the handle and fence late upload acknowledgements", async (t) => {
  if (process.platform === "win32") { t.skip("POSIX ffprobe fixture executable unavailable on Windows"); return; }
  let release!: (value: Response) => void; let entered!: () => void;
  const started = new Promise<void>(resolveStarted => { entered = resolveStarted; });
  const e = await env((signal) => new Promise<Response>((resolveResponse, reject) => {
    release = resolveResponse; entered();
    signal?.addEventListener("abort", () => reject(new Error("synthetic aborted upload")), { once: true });
  }));
  try {
    const pending = e.service.uploadReference(upload());
    await started; await e.service.invalidateAttempt(A); release(response());
    await assert.rejects(pending, { code: "UPLOAD_OUTCOME_UNKNOWN" });
    await assert.rejects(e.service.uploadReference(upload()), { code: "UPLOAD_OUTCOME_UNKNOWN" });
    assert.equal(e.count(), 1);
  } finally { await e.cleanup(); }

  const expired = await env(async () => response());
  try {
    const receipt = await expired.service.uploadReference(upload());
    const owned = await expired.service.resolveReferences(resolve(receipt.reference_handle));
    expired.advance(); assert.equal(expired.service.isOwnedReferences(owned), false);
    await assert.rejects(expired.service.resolveReferences(resolve(receipt.reference_handle)), { code: "REFERENCE_UNAVAILABLE" });
    assert.equal(expired.count(), 1);
  } finally { await expired.cleanup(); }
});
