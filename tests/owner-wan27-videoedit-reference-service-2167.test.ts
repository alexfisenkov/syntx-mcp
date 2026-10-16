import assert from "node:assert/strict";
import test from "node:test";
import { realpathSync } from "node:fs";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { resolveOwnerReferencePrincipal } from "../src/auth/owner-reference-principal.js";
import { OwnerWan27VideoEditReferenceService } from "../src/application/owner-wan27-videoedit-reference-service.js";
import { createOwnerWan27VideoEditRequestPreparer } from "../src/application/owner-wan27-videoedit-request-preparer.js";
import { createOwnerWan27VideoEditOneShotPermit, revalidateOwnerWan27VideoEditOneShotPermit,
  consumeOwnerWan27VideoEditOneShotPermit } from "../src/application/owner-wan27-videoedit-one-shot-policy.js";
import { minimalWan27Mp4Header, wan27VideoEditProbeFixture } from "./helpers/wan27-videoedit-fixtures-2163.js";

const ATTEMPT = "link_wan27_edit_owner_0123456789abcdef";
const OTHER = "link_wan27_edit_owner_fedcba9876543210";
const BINDING = Object.freeze({ tenant_id: "wan27-edit-local", subject: "owner" });
function png(width = 240): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const name = Buffer.from(type), body = Buffer.concat([name, data]);
    let crc = 0xffffffff;
    for (const byte of body) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    const size = Buffer.alloc(4), checksum = Buffer.alloc(4);
    size.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, body, checksum]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(240, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", ihdr),
    chunk("IDAT", Buffer.from([120,156,99,0,0,0,2,0,1])), chunk("IEND", Buffer.alloc(0))]);
}
async function setup(handler: (form: FormData, count: number) => Response | Promise<Response>, ffprobePath = "/unused-only-images") {
  let count = 0, sequence = 0, time = 1000;
  const now = () => time;
  const provider: AuthLinkProvider = { authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: `edit-${sequence}`, approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-wan-edit-local" }); return { state: "LINKED" }; } };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(now), { now, attemptIdGenerator: () => [ATTEMPT, OTHER][sequence++]! });
  for (const id of [ATTEMPT, OTHER]) { await links.createAttempt(BINDING); await links.issueHandoff(BINDING, id); await links.checkAttempt(BINDING, id); }
  const makeClient = () => new SyntxChatHttpClient({ credentialBroker: {
    async useCredential<T>(use: (credential: string) => Promise<T>) { return use("synthetic-wan-edit-http"); }
  }, fetchImpl: async (_url, init) => { count++; return handler(init?.body as FormData, count); } });
  let client = makeClient();
  const service = new OwnerWan27VideoEditReferenceService({ binding: BINDING, linkService: links,
    resolveClient: () => client, ffprobePath, now });
  return { service, links, now, count: () => count, advance: () => { time += 15 * 60000; }, rotate: () => { client = makeClient(); } };
}
const response = (url: string) => new Response(JSON.stringify({ files: [{ url }] }), { headers: { "content-type": "application/json" } });
const upload = (bytes = png()) => ({ attemptId: ATTEMPT, model_id: "wan_27_videoedit", filename: "owned.png", mime_type: "image/png", bytes });
const resolve = (handle: string, attemptId = ATTEMPT) => ({ attemptId, model_id: "wan_27_videoedit", reference_handles: [handle] });

test("2167 nominal owned image references retain order, hide URL, reject foreign/copy handles and drain", async () => {
  const env = await setup((form, n) => {
    assert.equal(form.get("model_type"), "wan_27_videoedit");
    return response(`https://r2.syntx.ai/owned-edit-${n}.png`);
  });
  try {
    const a = await env.service.uploadReference(upload()), b = await env.service.uploadReference(upload(png(241)));
    assert.match(a.reference_handle, /^wan27_videoedit_reference_/u);
    assert.equal(JSON.stringify(a).includes("r2.syntx.ai"), false);
    const owned = await env.service.resolveReferences({ ...resolve(b.reference_handle), reference_handles: [b.reference_handle, a.reference_handle] });
    assert.equal(env.service.isOwnedReferences(owned), true);
    assert.equal(env.service.isOwnedReferences({ ...owned }), false);
    env.service.withCapturedReferences(owned, (_client, rows) => {
      assert.deepEqual(rows.map(row => row.reference_handle), [b.reference_handle, a.reference_handle]);
      assert.equal(rows[0]?.kind, "image"); assert.equal(rows[0]?.duration_seconds, null);
    });
    await assert.rejects(env.service.resolveReferences(resolve(a.reference_handle, OTHER)), { code: "REFERENCE_UNAVAILABLE" });
    await assert.rejects(env.service.resolveReferences({ ...resolve(a.reference_handle), reference_handles: [a.reference_handle, a.reference_handle] }), { code: "INVALID_REQUEST" });
    await env.service.invalidateAttempt(ATTEMPT);
    assert.equal(env.service.isOwnedReferences(owned), false);
  } finally { await env.service.close(); }
});

test("2167 unknown upload remains sticky across invalidation without a second POST", async () => {
  const env = await setup(() => { throw new Error("synthetic network ACK lost"); });
  try {
    await assert.rejects(env.service.uploadReference(upload()), { code: "UPLOAD_OUTCOME_UNKNOWN" });
    await env.service.invalidateAttempt(ATTEMPT);
    await assert.rejects(env.service.uploadReference(upload()), { code: "UPLOAD_OUTCOME_UNKNOWN" });
    assert.equal(env.count(), 1);
  } finally { await env.service.close(); }
});

test("2167 same URL different source bytes quarantines previous handles and preserves unknown", async () => {
  const env = await setup(() => response("https://r2.syntx.ai/collision.png"));
  try {
    const a = await env.service.uploadReference(upload());
    const owned = await env.service.resolveReferences(resolve(a.reference_handle));
    await assert.rejects(env.service.uploadReference(upload(png(241))), { code: "UPLOAD_OUTCOME_UNKNOWN" });
    assert.equal(env.service.isOwnedReferences(owned), false);
    await assert.rejects(env.service.uploadReference(upload()), { code: "UPLOAD_OUTCOME_UNKNOWN" });
    assert.equal(env.count(), 2);
  } finally { await env.service.close(); }
});

test("2167 TTL and same-client binding revoke references without any extra POST", async () => {
  const env = await setup(() => response("https://r2.syntx.ai/ttl.png"));
  try {
    const a = await env.service.uploadReference(upload());
    const owned = await env.service.resolveReferences(resolve(a.reference_handle));
    env.rotate(); assert.equal(env.service.isOwnedReferences(owned), false);
    env.advance(); await assert.rejects(env.service.resolveReferences(resolve(a.reference_handle)), { code: "REFERENCE_UNAVAILABLE" });
    assert.equal(env.count(), 1);
  } finally { await env.service.close(); }
});

test("2167 genuine mixed uploads bind source duration to a nominal one-shot candidate", async () => {
  const directory = await mkdtemp(join(tmpdir(), "syntx-wan27-edit-preparer-test-"));
  const interpreter = join(directory, "node"), probe = join(directory, "ffprobe-fixture");
  await symlink(process.execPath, interpreter);
  await writeFile(probe, `#!${interpreter}\nprocess.stdout.write(${JSON.stringify(wan27VideoEditProbeFixture())});\n`, { mode: 0o700, flag: "wx" });
  await chmod(probe, 0o700);
  const env = await setup((_form, n) => response(`https://r2.syntx.ai/edit-input-${n}.mp4`), realpathSync(probe));
  const preparer = createOwnerWan27VideoEditRequestPreparer({ referenceService: env.service, now: env.now });
  try {
    const image = await env.service.uploadReference(upload());
    const video = await env.service.uploadReference({ ...upload(), filename: "source.mp4", mime_type: "video/mp4", bytes: minimalWan27Mp4Header() });
    const input = { attemptId: ATTEMPT, model_id: "wan_27_videoedit", prompt: "2167 nominal pipeline unique intent",
      resolution: "720P", aspect_ratio: "16:9", audio_setting: "origin", prompt_extend: true, seed: 0,
      duration_mode: "custom", custom_video_duration: 3, reference_handles: [image.reference_handle, video.reference_handle] };
    await assert.rejects(preparer.prepare({ ...input, source_input_duration_seconds: 10 }), { code: "INVALID_REQUEST" });
    await assert.rejects(preparer.prepare({ ...input, reference_handles: [image.reference_handle] }));
    const candidate = await preparer.prepare(input);
    assert.equal(preparer.inspectCandidate({ ...candidate }), undefined);
    const wire = preparer.getPrivateRequest(candidate);
    assert.deepEqual(wire.cost_parameters, { resolution: "720P", video_duration: 3, duration: 4.25 });
    assert.equal(wire.wire.settings.seed, 0);
    assert.deepEqual(wire.wire.settings.file_urls.map(row => row.type), ["image", "video"]);
    const principal = await resolveOwnerReferencePrincipal({ binding: BINDING, attemptId: ATTEMPT, linkService: env.links });
    const context = { preparer, candidate, principal, attemptId: ATTEMPT };
    const permit = await createOwnerWan27VideoEditOneShotPermit(context);
    assert.throws(() => consumeOwnerWan27VideoEditOneShotPermit({ ...context, permit: { ...permit } }), { code: "PERMIT_INVALID" });
    assert.throws(() => consumeOwnerWan27VideoEditOneShotPermit({ ...context, permit }), { code: "PERMIT_NOT_REVALIDATED" });
    await revalidateOwnerWan27VideoEditOneShotPermit({ ...context, permit });
    assert.equal(consumeOwnerWan27VideoEditOneShotPermit({ ...context, permit }).status, "consumed");
    assert.throws(() => consumeOwnerWan27VideoEditOneShotPermit({ ...context, permit }), { code: "PERMIT_ALREADY_CONSUMED" });
    env.advance();
    assert.equal(preparer.inspectCandidate(candidate), undefined);
    assert.equal(env.count(), 2);
  } finally { await preparer.close(); await env.service.close(); await rm(directory, { recursive: true, force: true }); }
});
