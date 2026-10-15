import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { OwnerWan27R2vGenerationService, OwnerWan27R2vGenerationServiceError, OWNER_WAN27_R2V_GENERATION_CATALOG_VERSION } from "../src/application/owner-wan27-r2v-generation-service.js";
import { createOwnerWan27R2vRequestPreparer } from "../src/application/owner-wan27-r2v-request-preparer.js";
import { OwnerWan27R2vReferenceService } from "../src/application/owner-wan27-r2v-reference-service.js";
import { createOwnerWan27R2vOriginalProbe, releaseTrustedOwnerWan27R2vOriginalProbeResult } from "../src/application/owner-wan27-r2v-original-probe.js";
import { createOwnerWan27R2vVideoCropProcessor, releaseTrustedOwnerWan27R2vVideoCropReceipt } from "../src/application/owner-wan27-r2v-video-crop.js";
import { validateOwnerWan27R2vVideoSelection } from "../src/application/owner-wan27-r2v-video-selection.js";
import { releaseValidatedOwnerWan27R2vImage, validateOwnerWan27R2vImage } from "../src/application/owner-wan27-r2v-image-policy.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { OBSERVED_AUTHORIZATION_PROFILE, type AuthBinding, type AuthLinkProvider } from "../src/auth/types.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";

const run = promisify(execFile), ATTEMPT = "link_wan_r2v_1561_0123456789";
const BINDING: AuthBinding = Object.freeze({ tenant_id: "wan-service-tenant", subject: "wan-service-owner" });
const CATALOG = new DiscoveryCatalogRepository(loadPublicCatalogVersion(OWNER_WAN27_R2V_GENERATION_CATALOG_VERSION, `${process.cwd()}/catalog`));
const MEDIA_TOOLS = [{ ffmpeg: "/opt/homebrew/bin/ffmpeg", ffprobe: "/opt/homebrew/bin/ffprobe" }, { ffmpeg: "/usr/bin/ffmpeg", ffprobe: "/usr/bin/ffprobe" }].find((x) => existsSync(x.ffmpeg) && existsSync(x.ffprobe));
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const OUTPUT = "https://r2.syntx.ai/generated/wan27-r2v.mp4";
function crc32(bytes: Uint8Array): number { let crc = 0xffff_ffff; for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); } return (crc ^ 0xffff_ffff) >>> 0; }
function imageBytes(): Buffer { const b = Buffer.from(PNG); b.writeUInt32BE(240, 16); b.writeUInt32BE(240, 20); b.writeUInt32BE(crc32(b.subarray(12, 29)), 29); return b; }
function broker(): SyntxCredentialBroker { return { async useCredential<T>(fn: (token: string) => Promise<T>) { return fn("synthetic-r2v-fixture-token"); } }; }
function response(value: unknown): Response { return Response.json(value); }

test("R2V service claims owner intent, double-preflights exact derived cost, and reconciles only with GET after candidate TTL", async (t) => {
  if (!MEDIA_TOOLS) { t.skip("local ffmpeg/ffprobe are unavailable"); return; }
  let now = Date.parse("2026-10-14T00:00:00.000Z"), chatCount = 0, modelReads = 0, postCount = 0, failNextHistory = false, invalidCost = false, abortAfterAck = false, abortController: AbortController | undefined, blockNextAccess = false, accessStarted: (() => void) | undefined;
  const clock = () => { if (abortAfterAck) { abortAfterAck = false; abortController?.abort(); } return now; };
  const jobs = new Map<string, { ack: string; output: string; model: string }>(), events: Array<{ method: string; url: URL; body: any }> = [];
  const provider: AuthLinkProvider = { authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() { return { upstream_attempt_id: "synthetic", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic" }); return { state: "LINKED" }; } };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(clock), { now: clock, defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => ATTEMPT });
  await links.createAttempt(BINDING); await links.issueHandoff(BINDING, ATTEMPT); await links.checkAttempt(BINDING, ATTEMPT);
  const credentialBroker = broker();
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input)), method = init.method ?? (input instanceof Request ? input.method : "GET"); const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined; events.push({ method, url, body });
    if (url.pathname === "/api/v1/user/balance") return response({ balance: "1000" });
    if (url.pathname === "/api/v1/user/subscription") return response({ active: true, type: "PRO", end_date: "2026-10-15T12:00:00.000Z" });
    if (url.pathname === "/api/v2/get_model_info") { modelReads++; if (blockNextAccess) { blockNextAccess = false; accessStarted?.(); return new Promise<Response>((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("synthetic preflight aborted")), { once: true })); } return response({ access: true, cost: invalidCost ? null : 3, discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false }); }
    if (url.pathname.endsWith("/chats/upload-files")) { const form = init.body as FormData, file = form.get("files"); assert.ok(file instanceof File); return response({ files: [{ id: `upload-${postCount + 1}`, filename: file.name, url: `https://r2.syntx.ai/input/${ATTEMPT}/${postCount + 1}.mp4`, mime_type: file.type, content_type: file.type, size: file.size, ...(file.type === "video/mp4" ? { duration: 1 } : {}) }] }); }
    if (url.pathname === "/api/v1/chats" && method === "POST") { chatCount++; return response({ uuid: `wan27-service-chat-${chatCount}` }); }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") { postCount++; assert.equal(url.search, "?ai_name=wan_video"); const chat = body.chat_id as string; const ack = `wan27-service-ack-${postCount}`; const prompt = body.prompt as string; jobs.set(chat, { ack, output: prompt.includes("lost") ? "" : `wan27-service-result-${postCount}`, model: body.settings.model_type }); if (prompt.includes("abort after ack")) abortAfterAck = true; return prompt.includes("lost") ? response({}) : response({ id: ack }); }
    const history = /^\/api\/v1\/chats\/([^/]+)\/messages$/u.exec(url.pathname);
    if (history && method === "GET") { if (failNextHistory) { failNextHistory = false; throw new Error("synthetic transient history fault"); } const job = jobs.get(history[1]!); assert.ok(job); const rows = [{ id: job.ack, chat_id: 123, author_id: 17, message_object: [] }, ...(job.output ? [{ id: job.output, chat_id: 123, author_id: -1, message_object: [{ id: `obj-${job.output}`, message_id: job.output, object_type: "video", model_type: job.model }] }] : [])]; const page = Number(url.searchParams.get("page")), size = Number(url.searchParams.get("page_size")); return response({ messages: rows, pagination: { page, page_size: size, total_count: rows.length, total_pages: rows.length ? 1 : 0, has_next: false, has_previous: false } }); }
    const result = /^\/api\/v1\/chats\/([^/]+)\/([^/]+)$/u.exec(url.pathname);
    if (result && method === "GET") { const job = jobs.get(result[1]!); assert.ok(job?.output); return response({ id: job.output, chat_id: 123, author_id: -1, message_object: [{ id: `obj-${job.output}`, message_id: job.output, object_type: "video", model_type: job.model, completed: true, object_url: OUTPUT }] }); }
    throw new Error(`unexpected synthetic route ${method} ${url.pathname}`);
  };
  const client = new SyntxChatHttpClient({ credentialBroker, fetchImpl }), references = new OwnerWan27R2vReferenceService({ binding: BINDING, linkService: links, resolveClient: () => client, now: clock });
  const preparer = createOwnerWan27R2vRequestPreparer({ binding: BINDING, linkService: links, referenceService: references, now: clock });
  const service = new OwnerWan27R2vGenerationService({ binding: BINDING, linkService: links, catalog: CATALOG,
    catalog_version: OWNER_WAN27_R2V_GENERATION_CATALOG_VERSION, preparer, referenceService: references, resolveChatClient: () => client, now: clock,
    createAccountStatusService: () => new AccountStatusService(new SyntxHttpClient({ credentialBroker, fetchImpl }), clock),
    createModelAccessService: () => new ModelAccessService(CATALOG, new SyntxHttpClient({ credentialBroker, fetchImpl }), clock) });
  let media: { directory: string; original: Awaited<ReturnType<ReturnType<typeof createOwnerWan27R2vOriginalProbe>["probe"]>>; crop: Awaited<ReturnType<ReturnType<typeof createOwnerWan27R2vVideoCropProcessor>["crop"]>> } | undefined;
  const makeManifest = async (video = false) => {
    const draft = await references.createManifest({ attemptId: ATTEMPT, video_reference_count: video ? 1 : 0 }), bytes = imageBytes();
    const image = validateOwnerWan27R2vImage({ filename: "frame.png", mime_type: "image/png", bytes });
    try { await references.addImage({ manifest_handle: draft.manifest_handle, image }); } finally { releaseValidatedOwnerWan27R2vImage(image); bytes.fill(0); }
    if (video) { media ??= await makeCrop(); await references.addSelectedVideo({ manifest_handle: draft.manifest_handle, crop: media.crop }); }
    return references.finalizeManifest({ manifest_handle: draft.manifest_handle });
  };
  const parameters = Object.freeze({ resolution: "1080P" as const, aspect_ratio: "16:9" as const, video_duration: 4, prompt_extend: false, seed: null, native_audio: false as const });
  const input = (manifest_handle: string, prompt: string) => ({ attemptId: ATTEMPT, request: { model_id: "wan_27_r2v" as const, manifest_handle, prompt, parameters } });
  try {
    await assert.rejects(service.generate({ attemptId: ATTEMPT, request: { ...input("malformed", "invalid before HTTP").request, parameters: { ...parameters, native_audio: true } } }),
      (e: unknown) => e instanceof OwnerWan27R2vGenerationServiceError && e.code === "INVALID_REQUEST");
    assert.equal(chatCount, 0); assert.equal(postCount, 0); assert.equal(modelReads, 0); assert.equal(events.length, 0);
    const imageManifest = await makeManifest(); invalidCost = true;
    await assert.rejects(service.generate(input(imageManifest.manifest_handle, "unpriced quote refusal")), (e: unknown) => e instanceof OwnerWan27R2vGenerationServiceError && e.code === "PREFLIGHT_FAILED");
    assert.equal(chatCount, 0); assert.equal(postCount, 0); assert.equal(modelReads, 1);
    const noPrice = events.filter((e) => e.url.pathname === "/api/v2/get_model_info"); assert.equal(noPrice.length, 1); assert.deepEqual([noPrice[0]?.url.searchParams.get("duration"), noPrice[0]?.url.searchParams.get("video_duration"), noPrice[0]?.url.searchParams.get("resolution")], ["0", "4", "1080P"]);
    invalidCost = false; failNextHistory = true;
    let firstRecovery = "";
    await assert.rejects(service.generate(input(imageManifest.manifest_handle, "image delayed recovery")), (e: unknown) => { if (e instanceof OwnerWan27R2vGenerationServiceError && e.code === "OUTCOME_UNKNOWN") firstRecovery = e.recovery_id ?? ""; return !!firstRecovery; });
    assert.equal(chatCount, 1); assert.equal(postCount, 1); assert.equal(modelReads, 3);
    const imageCosts = events.filter((e) => e.url.pathname === "/api/v2/get_model_info"); assert.deepEqual(imageCosts.map((e) => [e.url.searchParams.get("duration"), e.url.searchParams.get("video_duration"), e.url.searchParams.get("resolution")]), [["0", "4", "1080P"], ["0", "4", "1080P"], ["0", "4", "1080P"]]);
    now += 16 * 60_000;
    const recovered = await service.reconcile({ attemptId: ATTEMPT, recovery_id: firstRecovery }); assert.equal(recovered.status, "completed"); assert.equal(recovered.artifacts.length, 1); assert.equal(recovered.artifacts[0]?.object_url, OUTPUT); assert.equal(postCount, 1);
    const duplicateManifest = await makeManifest(); await assert.rejects(service.generate(input(duplicateManifest.manifest_handle, "image delayed recovery")), (e: unknown) => e instanceof OwnerWan27R2vGenerationServiceError && e.code === "INTENT_ALREADY_CLAIMED"); assert.equal(chatCount, 1); assert.equal(postCount, 1);
    const mixedManifest = await makeManifest(true); const mixed = await service.generate(input(mixedManifest.manifest_handle, "mixed video duration cost")); assert.equal(mixed.status, "completed");
    const costs = events.filter((e) => e.url.pathname === "/api/v2/get_model_info"); assert.deepEqual(costs.slice(3, 5).map((e) => [e.url.searchParams.get("duration"), e.url.searchParams.get("video_duration")]), [["1", "4"], ["1", "4"]]); assert.equal(chatCount, 2); assert.equal(postCount, 2);
    const abortManifest = await makeManifest(), controller = new AbortController(); abortController = controller; let abortRecovery = "";
    await assert.rejects(service.generate(input(abortManifest.manifest_handle, "abort after ack still recovers"), controller.signal), (e: unknown) => { if (e instanceof OwnerWan27R2vGenerationServiceError && e.code === "OUTCOME_UNKNOWN") abortRecovery = e.recovery_id ?? ""; return !!abortRecovery; });
    const afterAbort = await service.reconcile({ attemptId: ATTEMPT, recovery_id: abortRecovery }); assert.equal(afterAbort.status, "completed"); assert.equal(afterAbort.diagnostic.ack_known, true); assert.equal(postCount, 3); abortController = undefined;
    const lostManifest = await makeManifest(); let lostRecovery = "";
    await assert.rejects(service.generate(input(lostManifest.manifest_handle, "lost acknowledgement remains unknown")), (e: unknown) => { if (e instanceof OwnerWan27R2vGenerationServiceError && e.code === "OUTCOME_UNKNOWN") lostRecovery = e.recovery_id ?? ""; return !!lostRecovery; });
    assert.equal(chatCount, 4); assert.equal(postCount, 4); await assert.rejects(service.reconcile({ attemptId: ATTEMPT, recovery_id: lostRecovery }), (e: unknown) => e instanceof OwnerWan27R2vGenerationServiceError && e.code === "OUTCOME_UNKNOWN"); assert.equal(postCount, 4);
    const beforeRevoke = { chatCount, postCount }, revokeManifest = await makeManifest(); let resolveAccess!: () => void; const preflightStarted = new Promise<void>((resolve) => { resolveAccess = resolve; }); accessStarted = resolveAccess; blockNextAccess = true; const revoking = service.generate(input(revokeManifest.manifest_handle, "cancel before free chat")).catch((e: unknown) => e); await preflightStarted; await service.invalidateAttempt(ATTEMPT); const revoked = await revoking; assert.ok(revoked instanceof OwnerWan27R2vGenerationServiceError); assert.deepEqual({ chatCount, postCount }, beforeRevoke); accessStarted = undefined;
    const afterInvalidateManifest = await makeManifest(); await assert.rejects(service.generate(input(afterInvalidateManifest.manifest_handle, "image delayed recovery")), (e: unknown) => e instanceof OwnerWan27R2vGenerationServiceError && e.code === "INTENT_ALREADY_CLAIMED"); assert.deepEqual({ chatCount, postCount }, beforeRevoke);
    await service.close(); const stillBorrowed = await references.createManifest({ attemptId: ATTEMPT, video_reference_count: 0 }); assert.equal(stillBorrowed.status, "draft");
  } finally { await service.close(); await references.close(); if (media) { releaseTrustedOwnerWan27R2vVideoCropReceipt(media.crop); releaseTrustedOwnerWan27R2vOriginalProbeResult(media.original); await rm(media.directory, { recursive: true, force: true }); } }
});

async function makeCrop(): Promise<{ directory: string; original: Awaited<ReturnType<ReturnType<typeof createOwnerWan27R2vOriginalProbe>["probe"]>>; crop: Awaited<ReturnType<ReturnType<typeof createOwnerWan27R2vVideoCropProcessor>["crop"]>> }> {
  const directory = await mkdtemp(join(tmpdir(), "syntx-wan27-service-1561-")), path = join(directory, "source.mp4");
  await run(MEDIA_TOOLS!.ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=24:duration=2", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path]);
  const bytes = new Uint8Array(await readFile(path)), original = await createOwnerWan27R2vOriginalProbe({ ffprobePath: MEDIA_TOOLS!.ffprobe }).probe({ filename: "source.mp4", mime_type: "video/mp4", bytes }); bytes.fill(0);
  const selection = validateOwnerWan27R2vVideoSelection({ original, start_seconds: 0.25, end_seconds: 1.25, video_reference_count: 1 });
  const crop = await createOwnerWan27R2vVideoCropProcessor({ ffmpegPath: MEDIA_TOOLS!.ffmpeg, ffprobePath: MEDIA_TOOLS!.ffprobe }).crop(original, selection); return { directory, original, crop };
}
