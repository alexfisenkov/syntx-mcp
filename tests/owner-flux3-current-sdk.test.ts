import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient } from "../src/adapter/syntx/http-client.js";
import { OwnerCurrentVideoNativeService } from "../src/adapter/syntx/owner-current-video-reference-native.js";
import { OwnerCurrentVideoReferenceStore } from "../src/application/owner-current-video-reference-store.js";
import { OwnerCurrentVideoGenerationService } from "../src/application/owner-current-video-generation-service.js";
import { getOwnerFlux3CurrentFamilyDefinition, normalizeOwnerFlux3CurrentInput, type OwnerFlux3CurrentNormalizedInput, type OwnerFlux3CurrentIntent } from "../src/application/owner-flux3-current-intent.js";
import { registerOwnerFlux3CurrentTools, OWNER_FLUX3_CURRENT_TOOL_NAMES } from "../src/mcp/owner-flux3-current-tools.js";
import { registerOwnerCurrentVideoReferenceTools } from "../src/mcp/owner-current-video-reference-tools.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { OwnerCurrentVideoReferenceRole } from "../src/application/owner-current-video-reference-types.js";
const ATTEMPT = "link_flux3_current_sdk_0123456789";
const ffmpeg = process.env.SYNTX_MEDIA_FFMPEG_PATH ?? ["/opt/homebrew/Cellar/ffmpeg/9.0.2_1/bin/ffmpeg", "/usr/bin/ffmpeg"].find(existsSync);
const ffprobe = process.env.SYNTX_MEDIA_FFPROBE_PATH ?? ["/opt/homebrew/Cellar/ffmpeg/9.0.2_1/bin/ffprobe", "/usr/bin/ffprobe"].find(existsSync);
type Media = { image: Buffer; video: Buffer; audio: Buffer };
async function media() {
  const directory = await mkdtemp(join(tmpdir(), "syntx Flux3 референсы 🎞 "));
  const image = join(directory, "кадр-%02d.png"), video = join(directory, "клип.mp4"), audio = join(directory, "звук.wav");
  const run = (args: string[]) => execFileSync(ffmpeg!, ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", ...args], { timeout: 30000, stdio: "pipe" });
  try {
    run(["-f", "lavfi", "-i", "testsrc2=size=640x640:rate=1", "-frames:v", "10", image]);
    run(["-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=24", "-t", "4.25", "-c:v", "libx264", "-pix_fmt", "yuv420p", video]);
    run(["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=16000", "-t", "2.5", "-c:a", "pcm_s16le", audio]);
    return { directory, images: await Promise.all(Array.from({ length: 10 }, (_, i) => readFile(join(directory, `кадр-${String(i + 1).padStart(2, "0")}.png`)))), bytes: { image: await readFile(join(directory, "кадр-01.png")), video: await readFile(video), audio: await readFile(audio) } };
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
}
let fixtureSerial = 0;
async function fixture() {
  let now = Date.parse("2026-11-06T00:00:00.000Z"), lostAck = false, dropEcho = false;
  const binding = { tenant_id: "flux3-current-native-sdk", subject: `synthetic-owner-${++fixtureSerial}` };
  const auth = new InMemoryAuthLinkStore(() => now), links = new PerUserLinkService({ authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "flux3-current", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-current-flux3" }); return { state: "LINKED" }; }
  }, auth, { now: () => now, defaultTtlMs: 30 * 60000, attemptIdGenerator: () => ATTEMPT });
  await links.createAttempt(binding); await links.issueHandoff(binding, ATTEMPT); await links.checkAttempt(binding, ATTEMPT);
  const counts = { uploads: 0, quotes: 0, chats: 0, posts: 0, history: 0, detail: 0 }, quotes: Array<Record<string, string>> = [];
  const operations = new Map<string, { prompt: string; settings: Record<string, unknown>; ack: string }>();
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input)); assert.equal(url.origin, "https://api.syntx.ai");
    if (url.pathname.endsWith("user/balance")) return Response.json({ balance: "1000" });
    if (url.pathname.endsWith("user/subscription")) return Response.json({ active: true, type: "PRO", end_date: "2099-12-31" });
    if (url.pathname.endsWith("get_model_info")) { counts.quotes++; quotes.push(Object.fromEntries(url.searchParams));
      return Response.json({ access: true, cost: 1, discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false }); }
    if (url.pathname.endsWith("chats/upload-files")) { counts.uploads++; const file = (init.body as FormData).get("files"); assert.ok(file instanceof File);
      return Response.json({ files: [{ url: `https://r2.syntx.ai/flux3-current/owned-${counts.uploads}`, mime_type: file.type, size: file.size, filename: file.name, status: "success" }] }); }
    if (url.pathname === "/api/v1/chats") { counts.chats++; return Response.json({ uuid: `flux3-current-chat-${counts.chats}` }); }
    if (url.pathname.endsWith("video/generate")) { counts.posts++; assert.equal(url.searchParams.get("ai_name"), "flux3_video");
      const body = JSON.parse(String(init.body)) as { chat_id: string; prompt: string; settings: Record<string, unknown> };
      operations.set(body.chat_id, { prompt: body.prompt, settings: body.settings, ack: `owner-${counts.posts}` });
      if (lostAck) throw new Error("synthetic lost acknowledgement"); return Response.json({ id: `owner-${counts.posts}` }); }
    const match = /^\/api\/v1\/chats\/(flux3-current-chat-\d+)\/(messages|bot-\d+)$/u.exec(url.pathname);
    if (match) {
      const op = operations.get(match[1]!)!; assert.ok(op); const suffix = match[1]!.split("-").pop()!, botId = `bot-${suffix}`;
      const refs = op.settings.file_urls as Array<{ type: string; url: string }>;
      const media = refs.slice(0, dropEcho ? -1 : undefined).map((ref, i) => ({ id: `input-${suffix}-${i}`, message_id: op.ack,
        object_type: ["first_frame", "last_frame"].includes(ref.type) ? "image" : ref.type, object_url: ref.url, model_type: op.settings.model_type }));
      const bot = { id: botId, chat_id: `provider-${suffix}`, author_id: -1, message_object: [{ id: `output-${suffix}`, message_id: botId,
        object_type: "video", model_type: op.settings.model_type, completed: true, object_url: `https://r2.syntx.ai/flux3-current/output-${suffix}.mp4` }] };
      if (match[2] === "messages") { counts.history++; return Response.json({ messages: [{ id: op.ack, chat_id: `provider-${suffix}`, author_id: 17,
        message_object: [{ id: `text-${suffix}`, message_id: op.ack, object_type: "text", object_text: op.prompt, model_type: op.settings.model_type }, ...media] }, bot],
        pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_previous: false, has_next: false } }); }
      counts.detail++; return Response.json(bot);
    }
    throw new Error("Unexpected synthetic route");
  };
  const broker = { async useCredential<T>(run: (token: string) => Promise<T>) { return links.useCredential(binding, ATTEMPT, token => run(token.value)); } };
  const nativeClient = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl });
  const store = new OwnerCurrentVideoReferenceStore({ binding, linkService: links, resolveClient: () => nativeClient, ffprobePath: ffprobe!, ffmpegPath: ffmpeg!, now: () => now });
  const native = new OwnerCurrentVideoNativeService({ binding, linkService: links, references: store, resolveClient: () => nativeClient });
  const service = new OwnerCurrentVideoGenerationService<OwnerFlux3CurrentNormalizedInput, OwnerFlux3CurrentIntent>({ binding, linkService: links, references: store,
    native, family: getOwnerFlux3CurrentFamilyDefinition(), createReadClient: () => new SyntxHttpClient({ credentialBroker: broker, fetchImpl }), now: () => now,
    catalogDirectory: join(process.cwd(), "catalog") });
  const server = new McpServer({ name: "flux3-current-native", version: "1" });
  registerOwnerCurrentVideoReferenceTools(server, store); registerOwnerFlux3CurrentTools(server, { service });
  const client = new Client({ name: "flux3-current-native", version: "1" }), [caller, host] = InMemoryTransport.createLinkedPair();
  await server.connect(host); await client.connect(caller);
  return { client, service, counts, quotes, operations, setLost(value: boolean) { lostAck = value; }, setDrop(value: boolean) { dropEcho = value; },
    advance(ms: number) { now += ms; }, async close() { await client.close(); await server.close(); await service.close(); await native.close(); await store.close(); auth.close(); } };
}
async function upload(f: Awaited<ReturnType<typeof fixture>>, model: string, kind: keyof Media, data: Media): Promise<string> {
  const value = await f.client.callTool({ name: "syntx_owner_upload_current_video_reference", arguments: { link_attempt_id: ATTEMPT, model_id: model,
    filename: kind === "image" ? "frame.png" : kind === "video" ? "clip.mp4" : "audio.wav", mime_type: kind === "image" ? "image/png" : kind === "video" ? "video/mp4" : "audio/wav",
    content_base64: data[kind].toString("base64") } });
  assert.equal(value.isError, undefined, JSON.stringify(value)); assert.equal(JSON.stringify(value).includes("r2.syntx.ai"), false);
  return (value.structuredContent as { reference_handle: string }).reference_handle;
}
test("Flux3 current finite controls preserve manual fractions, closed model modes and source media cardinalities", () => {
  for (const model_id of ["flux3_t2v", "flux3_i2v", "flux3_v2v"]) {
    const fields = { model_id, prompt: "<<<literal>>> @image1", resolution: "hd", video_duration: 5.375, generate_audio: true,
      ...(model_id === "flux3_t2v" ? { aspect_ratio: "2:1" } : {}) };
    assert.equal(normalizeOwnerFlux3CurrentInput(fields, model_id === "flux3_t2v" ? 0 : 1).video_duration, 5.375);
    for (const video_duration of [4.999, model_id === "flux3_v2v" ? 15.001 : 20.001, Infinity, NaN])
      assert.throws(() => normalizeOwnerFlux3CurrentInput({ ...fields, video_duration }, model_id === "flux3_t2v" ? 0 : 1));
    assert.throws(() => normalizeOwnerFlux3CurrentInput({ ...fields, seed: 0 }, model_id === "flux3_t2v" ? 0 : 1));
    assert.throws(() => normalizeOwnerFlux3CurrentInput({ ...fields, prompt: "<<<https://r2.syntx.ai/foreign>>>" }, model_id === "flux3_t2v" ? 0 : 1));
  }
});

test("Flux3 actual SDK current fractional T2V ten image I2V and genuine MP4 V2V bind all refs through quotes native POST and owned GET", async t => {
  if (!ffmpeg || !ffprobe) { t.skip("trusted real codecs unavailable"); return; }
  const files = await media();
  try { for (const model of ["flux3_t2v", "flux3_i2v", "flux3_v2v"]) {
    const f = await fixture();
    try {
      const references: Array<{ reference_handle: string; role: OwnerCurrentVideoReferenceRole }> = [];
      if (model === "flux3_i2v") for (const image of files.images) references.push({ reference_handle: await upload(f, model, "image", { ...files.bytes, image }), role: "image" });
      if (model === "flux3_v2v") references.push({ reference_handle: await upload(f, model, "video", files.bytes), role: "video" });
      const input = { model_id: model, prompt: "<<<literal>>> @image1 preserved", resolution: "fhd", video_duration: 5.375, generate_audio: true,
        ...(model === "flux3_t2v" ? { aspect_ratio: "2:1" } : {}) };
      const generated = await f.client.callTool({ name: OWNER_FLUX3_CURRENT_TOOL_NAMES[1], arguments: { link_attempt_id: ATTEMPT, ...input, references } });
      assert.equal(generated.isError, undefined, JSON.stringify(generated)); assert.equal((generated.structuredContent as { status: string }).status, "completed");
      assert.equal(f.counts.quotes, 2); assert.equal(f.counts.posts, 1); assert.equal(f.counts.detail, 1);
      const posted = [...f.operations.values()][0]!;
      assert.equal(posted.prompt, input.prompt); assert.deepEqual(posted.settings, { model_type: model, video_duration: 5.375,
        resolution: "fhd", aspect_ratio: model === "flux3_t2v" ? "2:1" : "auto", generate_audio: true,
        file_urls: (posted.settings.file_urls as unknown[]) });
      assert.equal((posted.settings.file_urls as unknown[]).length, references.length);
      assert.deepEqual(f.quotes.map(q => Object.keys(q).sort()), [0, 1].map(() => ["ai_name", "model_type", "resolution", "video_duration"]));
      assert.equal(f.quotes[0]!.video_duration, "5.375");
    } finally { await f.close(); }
  }} finally { await rm(files.directory, { recursive: true, force: true }); }
});

test("Flux3 current lost acknowledgement requires all owned echoes and GET-only recovery after input expiry", async t => {
  if (!ffmpeg || !ffprobe) { t.skip("trusted real codecs unavailable"); return; }
  const files = await media(), f = await fixture();
  try {
    const references = await Promise.all(files.images.slice(0, 2).map(async image => ({ reference_handle: await upload(f, "flux3_i2v", "image", { ...files.bytes, image }), role: "image" })));
    f.setLost(true);
    const generated = await f.client.callTool({ name: OWNER_FLUX3_CURRENT_TOOL_NAMES[1], arguments: { link_attempt_id: ATTEMPT, model_id: "flux3_i2v",
      prompt: "A distinct lost acknowledgement", resolution: "hd", video_duration: 6.125, generate_audio: false, references } });
    assert.equal(generated.isError, true);
    const error = JSON.parse((generated.content as Array<{ text: string }>)[0]!.text).error as { code: string; recovery_id: string };
    assert.equal(error.code, "OUTCOME_UNKNOWN"); const paid = { ...f.counts }; f.advance(16 * 60000); f.setDrop(true);
    const uncertain = await f.client.callTool({ name: OWNER_FLUX3_CURRENT_TOOL_NAMES[2], arguments: { link_attempt_id: ATTEMPT, recovery_id: error.recovery_id } });
    assert.equal((uncertain.structuredContent as { status: string }).status, "unverified"); f.setDrop(false);
    const complete = await f.client.callTool({ name: OWNER_FLUX3_CURRENT_TOOL_NAMES[2], arguments: { link_attempt_id: ATTEMPT, recovery_id: error.recovery_id } });
    assert.equal((complete.structuredContent as { status: string }).status, "completed");
    assert.equal(f.counts.posts, paid.posts); assert.equal(f.counts.uploads, paid.uploads); assert.equal(f.counts.quotes, paid.quotes);
  } finally { await f.close(); await rm(files.directory, { recursive: true, force: true }); }
});
