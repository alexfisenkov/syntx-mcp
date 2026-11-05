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
import { getOwnerSeedanceCurrentFamilyDefinition, type OwnerSeedanceCurrentNormalized, type OwnerSeedanceCurrentIntent } from "../src/application/owner-seedance-current-intent.js";
import { registerOwnerSeedanceCurrentTools, OWNER_SEEDANCE_CURRENT_TOOL_NAMES } from "../src/mcp/owner-seedance-current-tools.js";
import { registerOwnerCurrentVideoReferenceTools } from "../src/mcp/owner-current-video-reference-tools.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { OwnerCurrentVideoReferenceRole } from "../src/application/owner-current-video-reference-types.js";
const ATTEMPT = "link_seedance_current_sdk_0123456789";
const ffmpeg = process.env.SYNTX_MEDIA_FFMPEG_PATH ?? ["/opt/homebrew/Cellar/ffmpeg/9.0.2_1/bin/ffmpeg", "/usr/bin/ffmpeg"].find(existsSync);
const ffprobe = process.env.SYNTX_MEDIA_FFPROBE_PATH ?? ["/opt/homebrew/Cellar/ffmpeg/9.0.2_1/bin/ffprobe", "/usr/bin/ffprobe"].find(existsSync);
type Media = { image: Buffer; video: Buffer; audio: Buffer };
async function media() {
  const directory = await mkdtemp(join(tmpdir(), "syntx Seedance референсы 🎞 "));
  const image = join(directory, "кадр.png"), video = join(directory, "клип.mp4"), audio = join(directory, "звук.wav");
  const run = (args: string[]) => execFileSync(ffmpeg!, ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", ...args], { timeout: 30000, stdio: "pipe" });
  try {
    run(["-f", "lavfi", "-i", "testsrc2=size=640x640:rate=1", "-frames:v", "1", image]);
    run(["-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=24", "-t", "4.25", "-c:v", "libx264", "-pix_fmt", "yuv420p", video]);
    run(["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=16000", "-t", "2.5", "-c:a", "pcm_s16le", audio]);
    return { directory, bytes: { image: await readFile(image), video: await readFile(video), audio: await readFile(audio) } };
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
}
let fixtureSerial = 0;
async function fixture() {
  let now = Date.parse("2026-11-06T00:00:00.000Z"), lostAck = false, dropEcho = false;
  const binding = { tenant_id: "seedance-current-native-sdk", subject: `synthetic-owner-${++fixtureSerial}` };
  const auth = new InMemoryAuthLinkStore(() => now), links = new PerUserLinkService({ authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "seedance-current", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-current-seedance" }); return { state: "LINKED" }; }
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
      return Response.json({ files: [{ url: `https://r2.syntx.ai/seedance-current/owned-${counts.uploads}`, mime_type: file.type, size: file.size, filename: file.name, status: "success" }] }); }
    if (url.pathname === "/api/v1/chats") { counts.chats++; return Response.json({ uuid: `seedance-current-chat-${counts.chats}` }); }
    if (url.pathname.endsWith("video/generate")) { counts.posts++; assert.equal(url.searchParams.get("ai_name"), "seedance");
      const body = JSON.parse(String(init.body)) as { chat_id: string; prompt: string; settings: Record<string, unknown> };
      operations.set(body.chat_id, { prompt: body.prompt, settings: body.settings, ack: `owner-${counts.posts}` });
      if (lostAck) throw new Error("synthetic lost acknowledgement"); return Response.json({ id: `owner-${counts.posts}` }); }
    const match = /^\/api\/v1\/chats\/(seedance-current-chat-\d+)\/(messages|bot-\d+)$/u.exec(url.pathname);
    if (match) {
      const op = operations.get(match[1]!)!; assert.ok(op); const suffix = match[1]!.split("-").pop()!, botId = `bot-${suffix}`;
      const refs = op.settings.file_urls as Array<{ type: string; url: string }>;
      const media = refs.slice(0, dropEcho ? -1 : undefined).map((ref, i) => ({ id: `input-${suffix}-${i}`, message_id: op.ack,
        object_type: ["first_frame", "last_frame"].includes(ref.type) ? "image" : ref.type, object_url: ref.url, model_type: op.settings.model_type }));
      const bot = { id: botId, chat_id: `provider-${suffix}`, author_id: -1, message_object: [{ id: `output-${suffix}`, message_id: botId,
        object_type: "video", model_type: op.settings.model_type, completed: true, object_url: `https://r2.syntx.ai/seedance-current/output-${suffix}.mp4` }] };
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
  const service = new OwnerCurrentVideoGenerationService<OwnerSeedanceCurrentNormalized, OwnerSeedanceCurrentIntent>({ binding, linkService: links, references: store,
    native, family: getOwnerSeedanceCurrentFamilyDefinition(), createReadClient: () => new SyntxHttpClient({ credentialBroker: broker, fetchImpl }), now: () => now,
    catalogDirectory: join(process.cwd(), "catalog") });
  const server = new McpServer({ name: "seedance-current-native", version: "1" });
  registerOwnerCurrentVideoReferenceTools(server, store); registerOwnerSeedanceCurrentTools(server, { service });
  const client = new Client({ name: "seedance-current-native", version: "1" }), [caller, host] = InMemoryTransport.createLinkedPair();
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
const frame20 = { model_id: "seedance-2.0", mode: "frames", prompt: "Same image first and last", version: "pro", resolution: "4K", video_duration: 14.375, generate_audio: true };
const omni20 = { model_id: "seedance-2.0", mode: "omni-references", prompt: "@image1 then @video1 with @audio1", version: "mini", resolution: "720p", aspect_ratio: "16:9", video_duration: 5.375, generate_audio: false };

test("Seedance actual SDK current frames omni edit extend and older image branches bind every reference quote native body and GET", async t => {
  if (!ffmpeg || !ffprobe) { t.skip("trusted real codecs unavailable"); return; }
  const files = await media();
  try {
    for (const input of [frame20, omni20,
      { model_id: "seedance-2.5", mode: "frames", prompt: "Frame source @image1 stays literal", resolution: "1080p", video_duration: 29.375, generate_audio: true },
      { model_id: "seedance-2.5", mode: "omni-references", prompt: "@image1 @video1 @audio1", resolution: "480p", aspect_ratio: "adaptive", video_duration: 0, generate_audio: false },
      { model_id: "seedance-2.5", mode: "extend", prompt: "@video1 continue", resolution: "720p", video_duration: 0, generate_audio: true },
      { model_id: "seedance-2.5", mode: "edit", prompt: "@video1 edit", resolution: "1080p", generate_audio: true },
      ...["seedance_pro", "seedance_pro-fast", "seedance-1.5-pro"].map(model_id => ({ model_id, prompt: "A source image scene", resolution: model_id === "seedance-1.5-pro" ? "720p" : "1080p",
        aspect_ratio: "16:9", video_duration: model_id === "seedance_pro" ? 5 : 5.375, ...(model_id === "seedance-1.5-pro" ? { generate_audio: false, camera_fixed: true } : {}) }))] as Array<Record<string, unknown>>) {
      const f = await fixture();
      try {
        const model = input.model_id as string, frames = "mode" in input && input.mode === "frames", modern = ["seedance-2.0", "seedance-2.5"].includes(model);
        const image = await upload(f, model, "image", files.bytes);
        const references: Array<{ reference_handle: string; role: OwnerCurrentVideoReferenceRole }> = [{ reference_handle: image, role: frames ? "first_frame" : "image" }];
        if (frames) references.push({ reference_handle: image, role: "last_frame" });
        else if (modern) { references.push({ reference_handle: await upload(f, model, "video", files.bytes), role: "video" });
          if ("mode" in input && input.mode === "omni-references") references.push({ reference_handle: await upload(f, model, "audio", files.bytes), role: "audio" }); }
        const before = { ...f.counts }, args = { link_attempt_id: ATTEMPT, ...input, references };
        const wrong = await f.client.callTool({ name: OWNER_SEEDANCE_CURRENT_TOOL_NAMES[1], arguments: { ...args,
          references: [{ reference_handle: "current_video_ref_00000000-0000-4000-8000-000000000099", role: references[0]!.role }, ...references.slice(1)] } });
        assert.equal(wrong.isError, true); assert.deepEqual(f.counts, before);
        const generated = await f.client.callTool({ name: OWNER_SEEDANCE_CURRENT_TOOL_NAMES[1], arguments: args });
        assert.equal(generated.isError, undefined, JSON.stringify({ generated, input, counts: f.counts, quotes: f.quotes, operations: [...f.operations.values()], recoveries: await f.service.listRecoveries({ attemptId: ATTEMPT }) })); assert.equal((generated.structuredContent as { status: string }).status, "completed");
        assert.equal(f.counts.posts, 1); assert.equal(f.counts.quotes, 2); assert.equal(f.counts.detail, 1);
        const posted = [...f.operations.values()][0]!;
        assert.equal(posted.settings.model_type, model); assert.equal(Object.hasOwn(posted.settings, "seed"), false);
        assert.equal(posted.settings.mode, modern ? input.mode : undefined);
        assert.equal(posted.settings.version, model === "seedance-2.0" ? input.version : undefined);
        assert.equal(posted.settings.aspect_ratio, modern && input.mode !== "omni-references" ? "adaptive" : input.aspect_ratio);
        assert.equal(posted.settings.video_duration, "mode" in input && input.mode === "edit" ? 0 : input.video_duration);
        assert.equal((posted.settings.file_urls as unknown[]).length, references.length);
        if (modern && !frames) assert.ok(posted.prompt.includes("<<<https://r2.syntx.ai/")); else assert.equal(posted.prompt, input.prompt);
        assert.deepEqual(f.quotes.map(q => Object.keys(q).sort()), [0, 1].map(() => ["ai_name", "model_type", "video_duration", "resolution",
          ...(modern ? ["duration", "mode", "size"] : []), ...(model === "seedance-2.0" ? ["version"] : []), ...(model === "seedance-1.5-pro" ? ["generate_audio"] : [])].sort()));
        if (model === "seedance-2.0" && !frames) { assert.equal(posted.settings.input_video_duration, 4); assert.equal(f.quotes[0]!.duration, "4.25"); }
      } finally { await f.close(); }
    }
  } finally { await rm(files.directory, { recursive: true, force: true }); }
});

test("Seedance current lost acknowledgement and missing one owned echo recover by GET after input expiry without another POST", async t => {
  if (!ffmpeg || !ffprobe) { t.skip("trusted real codecs unavailable"); return; }
  const files = await media(), f = await fixture();
  try {
    const image = await upload(f, "seedance-2.0", "image", files.bytes), video = await upload(f, "seedance-2.0", "video", files.bytes), audio = await upload(f, "seedance-2.0", "audio", files.bytes);
    f.setLost(true);
    const generated = await f.client.callTool({ name: OWNER_SEEDANCE_CURRENT_TOOL_NAMES[1], arguments: { link_attempt_id: ATTEMPT, ...omni20,
      references: [{ reference_handle: image, role: "image" }, { reference_handle: video, role: "video" }, { reference_handle: audio, role: "audio" }] } });
    assert.equal(generated.isError, true);
    const error = JSON.parse((generated.content as Array<{ text: string }>)[0]!.text).error as { code: string; recovery_id: string };
    assert.equal(error.code, "OUTCOME_UNKNOWN"); assert.ok(error.recovery_id); const paid = { ...f.counts };
    f.advance(16 * 60000); f.setDrop(true);
    const uncertain = await f.client.callTool({ name: OWNER_SEEDANCE_CURRENT_TOOL_NAMES[2], arguments: { link_attempt_id: ATTEMPT, recovery_id: error.recovery_id } });
    assert.equal((uncertain.structuredContent as { status: string }).status, "unverified"); f.setDrop(false);
    const complete = await f.client.callTool({ name: OWNER_SEEDANCE_CURRENT_TOOL_NAMES[2], arguments: { link_attempt_id: ATTEMPT, recovery_id: error.recovery_id } });
    assert.equal((complete.structuredContent as { status: string }).status, "completed"); assert.equal(f.counts.posts, paid.posts); assert.equal(f.counts.uploads, paid.uploads); assert.equal(f.counts.quotes, paid.quotes);
  } finally { await f.close(); await rm(files.directory, { recursive: true, force: true }); }
});

test("Seedance current actual SDK zero-reference T2V covers all five models with finite manual durations and unchanged Pro dropdown", async t => {
  if (!ffmpeg || !ffprobe) { t.skip("trusted real codec configuration unavailable"); return; }
  for (const model_id of ["seedance-2.0", "seedance-2.5", "seedance_pro", "seedance_pro-fast", "seedance-1.5-pro"]) {
    const f = await fixture();
    try {
      const modern = model_id === "seedance-2.0" || model_id === "seedance-2.5";
      const input = { model_id, prompt: "<<<literal text>>> a zero reference scene", aspect_ratio: "16:9", video_duration: model_id === "seedance_pro" ? 5 : 5.375,
        resolution: model_id === "seedance-1.5-pro" ? "720p" : "1080p", ...(modern ? { mode: "omni-references", generate_audio: true } : {}),
        ...(model_id === "seedance-2.0" ? { version: "pro" } : {}), ...(model_id === "seedance-1.5-pro" ? { generate_audio: false, camera_fixed: true } : {}) };
      const generated = await f.client.callTool({ name: OWNER_SEEDANCE_CURRENT_TOOL_NAMES[1], arguments: { link_attempt_id: ATTEMPT, ...input, references: [] } });
      assert.equal(generated.isError, undefined, JSON.stringify(generated)); assert.equal((generated.structuredContent as { status: string }).status, "completed");
      assert.equal(f.counts.uploads, 0); assert.equal(f.counts.quotes, 2); assert.equal(f.counts.posts, 1); assert.equal(f.counts.detail, 1);
      const posted = [...f.operations.values()][0]!; assert.deepEqual(posted.settings.file_urls, []); assert.equal(posted.prompt, input.prompt);
      assert.equal(posted.settings.video_duration, input.video_duration); assert.equal(Object.hasOwn(posted.settings, "seed"), false);
      assert.equal(f.quotes[0]!.video_duration, String(input.video_duration));
    } finally { await f.close(); }
  }
});
