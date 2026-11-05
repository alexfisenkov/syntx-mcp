import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { OWNER_KLING_MEDIA_TOOL_NAMES, registerSyntxOwnerKlingMediaTools } from "../src/mcp/owner-kling-media-tools.js";
import { createOwnerKlingMediaRuntime } from "../src/runtime/owner-kling-media-runtime.js";

const ATTEMPT = "link_kling_media2350_owner_0123456789abcdef";
const FFPROBE = process.env.SYNTX_KLING_MEDIA_TEST_FFPROBE ?? "/opt/homebrew/bin/ffprobe";
const FFMPEG = process.env.SYNTX_KLING_MEDIA_TEST_FFMPEG ?? "/opt/homebrew/bin/ffmpeg";
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
function crc32(bytes: Uint8Array): number { let crc = 0xffff_ffff; for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); } return (crc ^ 0xffff_ffff) >>> 0; }
function png640(): Buffer { const b = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
  b.writeUInt32BE(640, 16); b.writeUInt32BE(640, 20); b.writeUInt32BE(crc32(b.subarray(12, 29)), 29); return b; }
function distinctPng(index: number): Buffer {
  const original = png640(), end = original.length - 12, data = Buffer.from(`Comment\0current-reference-${index}`, "latin1"), chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0); chunk.write("tEXt", 4, "ascii"); data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return Buffer.concat([original.subarray(0, end), chunk, original.subarray(end)]);
}
function pngOver10MiB(): Buffer { const base = png640(), end = base.length - 12, data = Buffer.alloc(10 * 1024 * 1024 + 1 - base.length - 12, 0x41);
  data.write("Comment\0", 0, "latin1"); const chunk = Buffer.alloc(12 + data.length); chunk.writeUInt32BE(data.length, 0); chunk.write("tEXt", 4, "ascii");
  data.copy(chunk, 8); chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return Buffer.concat([base.subarray(0, end), chunk, base.subarray(end)]); }
function webp640(): Buffer { const chunk = Buffer.alloc(18); chunk.write("VP8 ", 0, 4, "ascii"); chunk.writeUInt32LE(10, 4); chunk[11] = 0x9d; chunk[12] = 1; chunk[13] = 0x2a;
  chunk.writeUInt16LE(640, 14); chunk.writeUInt16LE(640, 16); const out = Buffer.alloc(12 + chunk.length); out.write("RIFF", 0, 4, "ascii");
  out.writeUInt32LE(out.length - 8, 4); out.write("WEBP", 8, 4, "ascii"); chunk.copy(out, 12); return out; }
function resultCode(value: unknown): string { if (!value || typeof value !== "object") return "UNKNOWN"; const content = (value as { content?: Array<{ text?: string }> }).content ?? []; return content.map(x => x.text ?? "").join(" "); }

test("2350 MCP SDK performs exactly one source-typed flow for each Kling media ID", async t => {
  if (!existsSync(FFMPEG) || !existsSync(FFPROBE)) { t.skip("local ffmpeg/ffprobe unavailable for the genuine O1 V2V fixture"); return; }
  const dir = await mkdtemp(join(tmpdir(), "syntx-kling-media-2350-")), videoPath = join(dir, "source.mp4");
  let videoBytes: Buffer;
  try {
    execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=640x480:r=24:d=5",
      "-vf", "setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709", "-an", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-movflags", "+faststart", "-y", videoPath]);
    videoBytes = await readFile(videoPath);
  } catch (error) { await rm(dir, { recursive: true, force: true }); throw error; }
  const now = Date.parse("2026-10-19T00:00:00.000Z"), binding = Object.freeze({ tenant_id: "kling-media2350", subject: "synthetic-owner" });
  const provider: AuthLinkProvider = { authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "kling-media2350", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-kling-media2350-credential" }); return { state: "LINKED" }; } };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(() => now), { now: () => now, attemptIdGenerator: () => ATTEMPT });
  await links.createAttempt(binding); await links.issueHandoff(binding, ATTEMPT); await links.checkAttempt(binding, ATTEMPT);
  const counts = { uploads: 0, chats: 0, posts: 0, balances: 0, subscriptions: 0, quotes: 0, histories: 0, details: 0 };
  let current = false, dropCurrentEcho = false;
  const uploadedURLs = new Map<string, { type: string; url: string }>();
  let expectedCurrentReferences: Array<{ type: string; url: string }> = [];
  const inputs = new Map<string, { chat: string; model: string; prompt: string; url: string; type: string; ack: string; refs: Array<{ type: string; url: string }> }>();
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input)); assert.equal(url.origin, "https://api.syntx.ai");
    if (url.pathname.endsWith("user/balance")) { counts.balances++; return json({ balance: "100" }); }
    if (url.pathname.endsWith("user/subscription")) { counts.subscriptions++; return json({ active: true, type: "PRO", end_date: "2099-01-01" }); }
    if (url.pathname.endsWith("get_model_info")) {
      counts.quotes++; assert.equal(url.searchParams.get("ai_name"), "kling");
      const model = url.searchParams.get("model_type")!; assert.ok(["kling_elements", "kling_o1_image2video", "kling_o1_video2video"].includes(model));
      const expectedKeys = model === "kling_elements" ? ["ai_name", "mode", "model_type", "native_audio", "version", "video_duration"] :
        ["ai_name", "mode", "model_type", "version", "video_duration"];
      assert.deepEqual([...url.searchParams.keys()].sort(), (current && model !== "kling_elements" ? expectedKeys.filter(key => key !== "version") : expectedKeys).sort());
      assert.equal(url.searchParams.get("version"), current ? model === "kling_elements" ? "3.0" : null : "1.6");
      assert.equal(url.searchParams.get("mode"), current && model === "kling_elements" ? "4K" : "hd");
      assert.equal(url.searchParams.get("video_duration"), current ? model === "kling_elements" ? "5.375" : model === "kling_o1_image2video" ? "6.375" : "5" : "5");
      if (model === "kling_elements") assert.equal(url.searchParams.get("native_audio"), current ? "true" : "false");
      return json({ access: true, cost: 0.25, discount_cost: null, free_remaining_generations: 0, limit: null, show_warning: false });
    }
    if (url.pathname.endsWith("chats/upload-files")) {
      counts.uploads++; const form = init.body as FormData, file = form.get("files"); assert.ok(file instanceof File);
      const model = String(form.get("model_type")), dest = String(form.get("destination")); assert.equal(dest, "hidden");
      const refUrl = `https://r2.syntx.ai/kling-media2350/${model}${current ? `-current-${counts.uploads}` : ""}`;
      uploadedURLs.set(`${model}:${createHash("sha256").update(Buffer.from(await file.arrayBuffer())).digest("hex")}`, { type: file.type.startsWith("image/") ? "image" : "video", url: refUrl });
      return json({ files: [{ url: refUrl, status: "success", filename: file.name, mime_type: file.type, size: file.size }] });
    }
    if (url.pathname === "/api/v1/chats") { counts.chats++; return json({ uuid: `klingchat${counts.chats}` }); }
    if (url.pathname.endsWith("/video/generate")) {
      counts.posts++; assert.equal(url.searchParams.get("ai_name"), "kling"); assert.deepEqual([...url.searchParams.keys()], ["ai_name"]);
      const body = JSON.parse(String(init.body)) as { chat_id: string; prompt: string; settings: Record<string, unknown> };
      const model = String(body.settings.model_type), expectedType = model === "kling_o1_video2video" ? "video" : "image";
      const refs = current ? expectedCurrentReferences : [{ type: expectedType, url: `https://r2.syntx.ai/kling-media2350/${model}` }];
      assert.deepEqual(body.settings.file_urls, refs);
      if (current) {
        assert.equal(Object.hasOwn(body.settings, "temperature"), false);
        assert.equal(body.settings.version, model === "kling_elements" ? "3.0" : undefined);
        assert.equal(body.settings.mode, model === "kling_elements" ? "4K" : "hd");
        assert.equal(body.settings.video_duration, model === "kling_elements" ? 5.375 : model === "kling_o1_image2video" ? 6.375 : 5);
        assert.equal(body.settings.native_audio, model === "kling_elements");
        assert.equal(body.settings.multi_shots, model === "kling_elements" ? true : undefined);
        assert.equal(body.settings.aspect_ratio, model === "kling_o1_video2video" ? undefined : "9:16");
      } else {
        assert.equal(body.settings.version, "1.6"); assert.equal(body.settings.mode, "hd"); assert.equal(body.settings.video_duration, 5);
        if (model === "kling_o1_video2video") assert.equal(Object.hasOwn(body.settings, "aspect_ratio"), false);
        else assert.equal(body.settings.aspect_ratio, "16:9");
      }
      const ack = `owner-${counts.posts}`; inputs.set(body.chat_id, { chat: body.chat_id, model, prompt: body.prompt,
        url: refs[0]!.url, type: refs[0]!.type, refs: [...refs], ack });
      if (model === "kling_o1_video2video") throw new Error("synthetic lost generation acknowledgement");
      return json({ id: ack });
    }
    const history = url.pathname.match(/^\/api\/v1\/chats\/(klingchat\d+)\/messages$/u);
    if (history) {
      counts.histories++; const op = inputs.get(history[1]!); assert.ok(op);
      const n = Number(op.ack.slice(6)); return json({ messages: [
        { id: op.ack, chat_id: `provider-${n}`, author_id: 42, message_object: [
          { id: `prompt-${n}`, message_id: op.ack, object_type: "text", object_text: op.prompt },
          ...op.refs.slice(0, current && dropCurrentEcho ? -1 : undefined).map((ref, index) => ({ id: `input-${n}-${index}`, message_id: op.ack, object_type: ref.type, object_url: ref.url }))
        ] },
        { id: `bot-${n}`, chat_id: `provider-${n}`, author_id: -1, message_object: [
          { id: `video-${n}`, message_id: `bot-${n}`, object_type: "video", object_url: `https://r2.syntx.ai/kling-media2350/result-${n}.mp4`, model_type: op.model, completed: true }
        ] }
      ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    }
    const detail = url.pathname.match(/^\/api\/v1\/chats\/(klingchat\d+)\/(bot-\d+)$/u);
    if (detail) { counts.details++; const n = Number(detail[1]!.slice(9)), op = inputs.get(detail[1]!); assert.ok(op);
      return json({ id: `bot-${n}`, chat_id: `provider-${n}`, author_id: -1, message_object: [
        { id: `video-${n}`, message_id: `bot-${n}`, object_type: "video", object_url: `https://r2.syntx.ai/kling-media2350/result-${n}.mp4`, model_type: op.model, completed: true }
      ] }); }
    throw new Error(`Unexpected Kling media test route: ${url.pathname}`);
  };
  const credentialBroker = { async useCredential<T>(use: (token: string) => Promise<T>): Promise<T> { return links.useCredential(binding, ATTEMPT, c => use(c.value)); } };
  const readClient = () => new SyntxHttpClient({ credentialBroker, fetchImpl, requestTimeoutMs: 1_000 });
  const chatClient = () => new SyntxChatHttpClient({ credentialBroker, fetchImpl, requestTimeoutMs: 1_000 });
  const runtime = createOwnerKlingMediaRuntime({ binding, linkService: links, createReadClient: readClient, createChatClient: chatClient,
    uploadDestination: "hidden", ffprobePath: FFPROBE, now: () => now, catalogDirectory: join(process.cwd(), "catalog") });
  const mcp = new McpServer({ name: "kling-media2350", version: "1" }), client = new Client({ name: "kling-media2350-client", version: "1" });
  registerSyntxOwnerKlingMediaTools(mcp, { referenceService: runtime.referenceService, generationService: runtime.generationService });
  const [caller, host] = InMemoryTransport.createLinkedPair();
  try {
    await mcp.connect(host); await client.connect(caller);
    assert.deepEqual((await client.listTools()).tools.map(tool => tool.name), OWNER_KLING_MEDIA_TOOL_NAMES);
    const advertised = (await client.listTools()).tools.find(tool => tool.name === OWNER_KLING_MEDIA_TOOL_NAMES[1])!;
    for (const key of ["model_id", "prompt", "version", "mode", "aspect_ratio", "video_duration", "native_audio", "reference_handle"])
      assert.ok(advertised.inputSchema.properties?.[key], `missing advertised Kling media field ${key}`);
    const validateAdvertised = new AjvJsonSchemaValidator().getValidator(advertised.inputSchema as Parameters<AjvJsonSchemaValidator["getValidator"]>[0]);
    for (const model of ["kling_elements", "kling_o1_image2video"] as const) {
      const rejected = await client.callTool({ name: OWNER_KLING_MEDIA_TOOL_NAMES[0], arguments: { link_attempt_id: ATTEMPT,
        model_id: model, filename: "reference.webp", mime_type: "image/webp", content_base64: webp640().toString("base64") } });
      assert.notEqual(rejected.isError, undefined); assert.equal(counts.uploads, 0);
    }
    const oversized = await client.callTool({ name: OWNER_KLING_MEDIA_TOOL_NAMES[0], arguments: { link_attempt_id: ATTEMPT,
      model_id: "kling_elements", filename: "large.png", mime_type: "image/png", content_base64: pngOver10MiB().toString("base64") } });
    assert.notEqual(oversized.isError, undefined); assert.equal(counts.uploads, 0);
    const models = ["kling_elements", "kling_o1_image2video", "kling_o1_video2video"] as const;
    for (const model of models) {
      const video = model === "kling_o1_video2video", bytes = video ? videoBytes : png640();
      const upload = await client.callTool({ name: OWNER_KLING_MEDIA_TOOL_NAMES[0], arguments: { link_attempt_id: ATTEMPT, model_id: model,
        filename: video ? "source.mp4" : "reference.png", mime_type: video ? "video/mp4" : "image/png", content_base64: bytes.toString("base64") } });
      assert.equal(upload.isError, undefined, resultCode(upload));
      assert.equal(JSON.stringify(upload).includes("https://r2.syntx.ai"), false);
      const handle = (upload.structuredContent as { reference_handle: string }).reference_handle;
      const shared = { link_attempt_id: ATTEMPT, model_id: model, prompt: `Move the geometric subject slowly: ${model}.`, version: "1.6", mode: "hd",
        video_duration: 5, native_audio: false, reference_handle: handle };
      const args = video ? shared : { ...shared, aspect_ratio: "16:9" };
      assert.equal(validateAdvertised(args).valid, true);
      const wrong = video ? { ...args, aspect_ratio: "16:9" } : { ...args, video_duration: 10 };
      assert.equal(validateAdvertised(wrong).valid, false);
      const beforeInvalid = { ...counts };
      assert.equal((await client.callTool({ name: OWNER_KLING_MEDIA_TOOL_NAMES[1], arguments: wrong })).isError, true);
      assert.deepEqual(counts, beforeInvalid, "canonical branch rejection occurs before native dispatch");
      const generated = await client.callTool({ name: OWNER_KLING_MEDIA_TOOL_NAMES[1], arguments: args });
      assert.equal(generated.isError, undefined, resultCode(generated));
      assert.equal((generated.structuredContent as { status: string }).status, video ? "outcome_unknown" : "completed");
      assert.equal((generated.structuredContent as { backend_acceptance: string }).backend_acceptance, "UNPROVEN");
      if (video) {
        const recovery_id = (generated.structuredContent as { recovery_id: string }).recovery_id;
        const recovered = await client.callTool({ name: OWNER_KLING_MEDIA_TOOL_NAMES[2], arguments: { link_attempt_id: ATTEMPT, recovery_id } });
        assert.equal(recovered.isError, undefined, resultCode(recovered)); assert.equal((recovered.structuredContent as { status: string }).status, "completed");
        assert.equal(counts.posts, 3, "reconciliation did not replay the ambiguous POST");
      }
    }
    assert.deepEqual(counts, { uploads: 3, chats: 3, posts: 3, balances: 6, subscriptions: 6, quotes: 6, histories: 3, details: 3 });
    current = true;
    for (const model of models) {
      const handles: string[] = [], references: Array<{ type: string; url: string }> = [];
      const originals = model === "kling_o1_video2video" ? [videoBytes, ...Array.from({ length: 4 }, (_, i) => distinctPng(i))] :
        Array.from({ length: model === "kling_elements" ? 7 : 4 }, (_, i) => distinctPng(i));
      for (const [index, bytes] of originals.entries()) {
        const video = model === "kling_o1_video2video" && index === 0;
        const uploaded = await client.callTool({ name: OWNER_KLING_MEDIA_TOOL_NAMES[0], arguments: { link_attempt_id: ATTEMPT, model_id: model,
          filename: video ? "source.mp4" : `current-${index}.png`, mime_type: video ? "video/mp4" : "image/png", content_base64: bytes.toString("base64") } });
        assert.equal(uploaded.isError, undefined, resultCode(uploaded));
        const receipt = uploaded.structuredContent as { reference_handle: string; sha256: string };
        handles.push(receipt.reference_handle); references.push(uploadedURLs.get(`${model}:${receipt.sha256}`)!);
      }
      expectedCurrentReferences = references;
      const args = { link_attempt_id: ATTEMPT, model_id: model, prompt: `Current source tuple ${model}`, mode: model === "kling_elements" ? "4K" : "hd",
        reference_handles: handles, ...(model === "kling_o1_video2video" ? {} : { aspect_ratio: "9:16", video_duration: model === "kling_elements" ? 5.375 : 6.375 }),
        ...(model === "kling_elements" ? { version: "3.0", native_audio: true, multi_shots: true } : {}) };
      assert.equal(validateAdvertised(args).valid, true);
      const beforeInvalid = { ...counts };
      for (const invalid of [{ ...args, reference_handles: [...handles, handles[0]] }, { ...args, reference_handle: handles[0] },
        { ...args, reference_handles: ["kling_media_reference_00000000-0000-4000-8000-000000000099", ...handles.slice(1)] },
        ...(model === "kling_o1_video2video" ? [{ ...args, video_duration: 9 }, { ...args, reference_handles: handles.slice(1) }] : [])]) {
        assert.equal((await client.callTool({ name: OWNER_KLING_MEDIA_TOOL_NAMES[1], arguments: invalid })).isError, true);
        assert.deepEqual(counts, beforeInvalid, "invalid count/dual input/measured duration cannot reach quote or POST");
      }
      let getterCalls = 0;
      const accessorHandles = [...handles]; Object.defineProperty(accessorHandles, "0", { enumerable: true, get() { getterCalls++; return handles[0]; } });
      const { link_attempt_id: _link, ...nativeArgs } = args;
      for (const reference_handles of [accessorHandles, new Proxy(handles, {})]) await assert.rejects(runtime.generationService.generate({ attemptId: ATTEMPT,
        ...nativeArgs, reference_handles }));
      assert.equal(getterCalls, 0); assert.deepEqual(counts, beforeInvalid);
      const generated = await client.callTool({ name: OWNER_KLING_MEDIA_TOOL_NAMES[1], arguments: args });
      assert.equal(generated.isError, undefined, resultCode(generated));
      if (model === "kling_o1_video2video") {
        const recovery_id = (generated.structuredContent as { recovery_id: string }).recovery_id;
        dropCurrentEcho = true;
        const missing = await client.callTool({ name: OWNER_KLING_MEDIA_TOOL_NAMES[2], arguments: { link_attempt_id: ATTEMPT, recovery_id } });
        assert.equal((missing.structuredContent as { status: string }).status, "outcome_unknown", "every captured source is required in the owned echo");
        dropCurrentEcho = false;
        const recovered = await client.callTool({ name: OWNER_KLING_MEDIA_TOOL_NAMES[2], arguments: { link_attempt_id: ATTEMPT, recovery_id } });
        assert.equal((recovered.structuredContent as { status: string }).status, "completed");
        assert.equal(counts.posts, 6);
      } else assert.equal((generated.structuredContent as { status: string }).status, "completed");
    }
    assert.equal(counts.uploads, 18, "genuine video upload is reused without a second POST; all distinct image bytes are owned");
    assert.equal(counts.posts, 6); assert.equal(counts.quotes, 12);

  } finally { await client.close(); await mcp.close(); await runtime.lifecycle.close(); await rm(dir, { recursive: true, force: true }); }
});
