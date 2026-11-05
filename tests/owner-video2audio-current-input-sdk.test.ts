import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { AuthLinkStore } from "../src/auth/auth-link-store.js";
import { OBSERVED_AUTHORIZATION_PROFILE } from "../src/auth/types.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { createMcpServer } from "../src/mcp/server.js";
import { createOwnerVideo2AudioSourceProfile } from "../src/application/owner-video2audio-source-profile.js";
import { createOwnerVideo2AudioRequestPreparer } from "../src/application/owner-video2audio-request-preparer.js";
import { validateOwnerVideo2AudioTrustedUploadDuration } from "../src/application/owner-video2audio-input-parameters.js";

const ffmpeg = process.env.SYNTX_VIDEO2AUDIO_TEST_FFMPEG ?? (existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "/usr/bin/ffmpeg");
const ffprobe = process.env.SYNTX_VIDEO2AUDIO_TEST_FFPROBE ?? (existsSync("/opt/homebrew/bin/ffprobe") ? "/opt/homebrew/bin/ffprobe" : "/usr/bin/ffprobe");
const digest = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const binding = { tenant_id: "video2audio-current-sdk", subject: "owner" }, attempt = "link_video2audio_current_owner_012345678901";
test("Video2Audio current SDK real31second MP4 WebM MOV and12MiB bytes preserve measured duration and GET-only unknown recovery", { timeout: 60000 }, async (t) => {
  if (!existsSync(ffmpeg) || !existsSync(ffprobe)) { t.skip("Trusted local ffmpeg/ffprobe pair required"); return; }
  const directory = await mkdtemp(join(tmpdir(), "syntx-video2audio-current-sdk-"));
  const video = async (filename: string, webm = false) => {
    const path = join(directory, filename); execFileSync(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x240:r=8:d=31.25", "-an",
      ...(webm ? ["-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-b:v", "200k"] : ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"]), "-y", path]); return await readFile(path);
  };
  const smallMp4 = await video("source.mp4"), webm = await video("source.webm", true), mov = await video("source.mov");
  // A valid bounded free atom exercises the real >10MiB wire without changing the original measured media timeline.
  const free = Buffer.alloc(12 * 1024 * 1024); free.writeUInt32BE(free.length, 0); free.write("free", 4, "ascii");
  const mp4 = Buffer.concat([smallMp4, free]); free.fill(0); smallMp4.fill(0);
  const hashes = [mp4, webm, mov].map(digest), duration = 31.25;
  let uploads = 0, posts = 0, chats = 0, quotes = 0, loseAck = false; const bodies = new Map<string, any>();
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input)); assert.equal(url.origin, "https://api.syntx.ai");
    if (url.pathname.endsWith("chats/upload-files")) {
      const form = init.body as FormData, file = form.get("files"); assert.ok(file instanceof File); uploads++;
      const copied = Buffer.from(await file.arrayBuffer()); try { assert.ok(hashes.includes(digest(copied))); } finally { copied.fill(0); }
      assert.equal(form.get("model_type"), "video2audio"); assert.ok(["video/mp4", "video/webm", "video/quicktime"].includes(file.type));
      return Response.json({ total: 1, successful: 1, failed: 0, duplicates: 0, files: [{ filename: file.name, content_type: file.type,
        size: file.size, status: "success", duration: 31, url: `https://r2.syntx.ai/current-video2audio/input${uploads}` }] });
    }
    if (url.pathname.endsWith("user/balance")) return Response.json({ balance: "1000" });
    if (url.pathname.endsWith("user/subscription")) return Response.json({ active: true, type: "PRO", end_date: "2099-01-01" });
    if (url.pathname.endsWith("get_model_info")) { quotes++; assert.deepEqual([...url.searchParams.keys()].sort(), ["ai_name", "model_type"]); return Response.json({ access: true, cost: 1, discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false }); }
    if (url.pathname === "/api/v1/chats") { chats++; return Response.json({ uuid: `current-video2audio-${chats}` }); }
    if (url.pathname.endsWith("audio/generate")) { posts++; const body = JSON.parse(String(init.body)); bodies.set(body.chat_uuid, body); assert.equal(body.settings.duration, duration);
      if (loseAck) { loseAck = false; throw new Error("synthetic unknown POST"); } return Response.json({ id: `owner-${body.chat_uuid}` }); }
    const route = url.pathname.match(/^\/api\/v1\/chats\/(current-video2audio-\d+)\/(messages|bot)$/u);
    if (route) {
      const chat = route[1]!, body = bodies.get(chat), owner = `owner-${chat}`;
      const objects = [{ id: "audio", message_id: "bot", object_type: "audio", model_type: "video2audio", completed: true, object_url: "https://r2.syntx.ai/current-video2audio/output.mp3" }];
      const bot = { id: "bot", chat_id: 41356, author_id: -1, message_object: objects };
      return route[2] === "bot" ? Response.json(bot) : Response.json({ messages: [{ id: owner, chat_id: 41356, author_id: 42, message_object: [
        { id: "prompt", message_id: owner, object_type: "text", model_type: "video2audio", object_text: body.prompt }] }, bot],
      pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    }
    throw new Error("Unexpected synthetic current Video2Audio route");
  };
  const authStore = { async getSnapshot() { return { attempt_id: attempt, authorization_profile: OBSERVED_AUTHORIZATION_PROFILE, status: "LINKED" as const, expires_at: null, linked: true }; },
    async useCredential<T>(_binding: unknown, _attempt: unknown, use: (value: { scheme: "Bearer"; value: string }) => T | Promise<T>) { return await use({ scheme: "Bearer", value: "synthetic-video2audio-only" }); }
  } as unknown as AuthLinkStore;
  const runtime = createObservedOwnerRuntime({ ownerVideo2AudioEnabled: true, ownerVideo2AudioFfprobePath: ffprobe, authStore, authBinding: binding, fetchImpl,
    now: () => Date.parse("2026-11-06T00:00:00Z") });
  const server = createMcpServer(runtime.application, runtime.serverOptions), client = new Client({ name: "current-video2audio", version: "1" }); const [caller, host] = InMemoryTransport.createLinkedPair();
  await server.connect(host); await client.connect(caller);
  const upload = async (filename: string, mime_type: string, bytes: Buffer) => await client.callTool({ name: "syntx_upload_video2audio_original", arguments: { link_attempt_id: attempt, filename, mime_type, content_base64: bytes.toString("base64") } });
  try {
    const source = await client.callTool({ name: "syntx_owner_get_video2audio_source", arguments: {} }); assert.notEqual(source.isError, true, JSON.stringify(source)); assert.match(JSON.stringify(source.structuredContent), /CURRENT_A829_4DA7/u);
    const handles: string[] = [];
    for (const [name, mime, bytes] of [["original.mp4", "video/mp4", mp4], ["original.webm", "video/webm", webm], ["original.mov", "video/quicktime", mov], ["alias.mov", "video/mov", mov]] as const) {
      const result = await upload(name, mime, bytes); assert.notEqual(result.isError, true, JSON.stringify(result)); const receipt = result.structuredContent as any;
      assert.equal(receipt.duration_seconds, duration, "local fractional duration survives integer provider metadata"); assert.equal(receipt.sha256, digest(bytes)); assert.equal(receipt.size, bytes.length);
      assert.equal(receipt.mime_type, mime === "video/mov" ? "video/quicktime" : mime); handles.push(receipt.video_original_handle);
    }
    assert.equal(uploads, 4); assert.ok(mp4.length > 10 * 1024 * 1024);
    const wrongHeader = await upload("wrong.webm", "video/webm", mp4); assert.equal(wrongHeader.isError, true); assert.equal(uploads, 4);
    const composition = runtime.serverOptions.ownerVideo2Audio!;
    const preparer = createOwnerVideo2AudioRequestPreparer({ profile: composition.profile, originalReferenceService: composition.originalReferenceService,
      now: () => Date.parse("2026-11-06T00:00:00Z") });
    try {
      const base = { attemptId: attempt, prompt: "Same prompt fingerprint check", video_original_handle: handles[0]! };
      const zero = await preparer.prepare(base), explicitZero = await preparer.prepare({ ...base, seed: 0 }), random = await preparer.prepare({ ...base, seed: null }),
        chosen = await preparer.prepare({ ...base, seed: 123, negative_prompt: "avoid noise" }), changed = await preparer.prepare({ ...base, seed: 123, negative_prompt: "avoid speech" });
      assert.equal(zero.intent_fingerprint, explicitZero.intent_fingerprint); assert.notEqual(zero.intent_fingerprint, random.intent_fingerprint);
      assert.notEqual(chosen.intent_fingerprint, changed.intent_fingerprint); assert.notEqual(chosen.request_fingerprint, changed.request_fingerprint);
      assert.equal(preparer.inspectCandidate(random)!.seed, null); assert.equal(preparer.inspectCandidate(chosen)!.negative_prompt, "avoid noise");
    } finally { await preparer.close(); }
    const args = { link_attempt_id: attempt, video_original_handle: handles[0], seed: 123, negative_prompt: "avoid noise" };
    const generated = await client.callTool({ name: "syntx_owner_generate_video2audio", arguments: args }); assert.notEqual(generated.isError, true, JSON.stringify(generated));
    assert.equal((generated.structuredContent as any).status, "COMPLETE"); assert.match((generated.structuredContent as any).source_binding.public_catalog_version, /a82998/u); assert.equal(posts, 1);
    const sent = bodies.get("current-video2audio-1"); assert.equal(sent.prompt, ""); assert.equal(sent.settings.seed, 123); assert.equal(sent.settings.negative_prompt, "avoid noise");
    loseAck = true; const unknownArgs = { ...args, seed: null, video_original_handle: handles[1], prompt: "Separate unknown current input" };
    const unknown = await client.callTool({ name: "syntx_owner_generate_video2audio", arguments: unknownArgs }); assert.equal(unknown.isError, true);
    const error = JSON.parse((unknown.content as any)[0].text).error; assert.equal(error.code, "OUTCOME_UNKNOWN"); assert.equal(posts, 2);
    const replay = await client.callTool({ name: "syntx_owner_generate_video2audio", arguments: unknownArgs }); assert.equal(replay.isError, true); assert.equal(posts, 2);
    const recovered = await client.callTool({ name: "syntx_owner_reconcile_video2audio", arguments: { link_attempt_id: attempt, recovery_id: error.recovery_id } });
    assert.notEqual(recovered.isError, true, JSON.stringify(recovered)); assert.equal((recovered.structuredContent as any).status, "COMPLETE"); assert.equal(posts, 2); assert.equal(quotes, 4); assert.equal(bodies.get("current-video2audio-2").settings.seed, null);
    assert.deepEqual([mp4, webm, mov].map(digest), hashes);
    const legacy = createOwnerVideo2AudioSourceProfile(); assert.throws(() => validateOwnerVideo2AudioTrustedUploadDuration(31.25, legacy));
  } finally { await client.close(); await server.close(); await runtime.ownerVideo2AudioLifecycle?.close(); mp4.fill(0); webm.fill(0); mov.fill(0); await rm(directory, { recursive: true, force: true }); }
});
