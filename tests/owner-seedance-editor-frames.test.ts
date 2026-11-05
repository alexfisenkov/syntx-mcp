import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server.js";
import { createDefaultApplication } from "../src/application/factory.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient } from "../src/adapter/syntx/http-client.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { loadOwnerSeedanceEditorRuntimeCatalog } from "../src/application/owner-seedance-editor-cost.js";

const ATTEMPT = "link_editor_flow2230_0123456789abcdef";
const INPUT = "https://r2.syntx.ai/editor2230/source.mp4";
const FRAME = "https://r2.syntx.ai/editor2230/frame.png";
const OUTPUT = "https://r2.syntx.ai/editor2230/result.mp4";
let serial = 0;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
type ApiService = { generate(input: unknown): Promise<any>; reconcile(input: unknown): Promise<any>; listRecoveries(input: unknown): Promise<readonly unknown[]>; close(): Promise<void>; invalidateAttempt(id: string): Promise<void> };
async function fixture(options: { free?: boolean; secondDenied?: boolean; loseAck?: boolean; pending?: boolean;
  wrongModel?: boolean; wrongOwner?: boolean; swapResult?: boolean; generationHttpStatus?: number; frameUnknown?: boolean; frameResponseMismatch?: boolean } = {}, uploadInitially = true) {
  const [{ OwnerSeedanceEditorReferenceService }, module] = await Promise.all([
    import(new URL("../src/application/owner-seedance-editor-reference-service.js", import.meta.url).href),
    import(new URL("../src/application/owner-seedance-editor-generation-service.js", import.meta.url).href)
  ]);
  assert.equal(typeof module.OwnerSeedanceEditorGenerationService, "function");
  const binding = { tenant_id: "editor2230", subject: `owner-${++serial}` };
  const now = () => Date.parse("2026-10-18T00:00:00.000Z");
  const links = new PerUserLinkService({ authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "editor2230", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-editor2230-credential" }); return { state: "LINKED" }; }
  }, new InMemoryAuthLinkStore(now), { now, attemptIdGenerator: () => ATTEMPT });
  await links.createAttempt(binding); await links.issueHandoff(binding, ATTEMPT); await links.checkAttempt(binding, ATTEMPT);
  const directory = await mkdtemp(join(tmpdir(), "syntx-editor-flow2230-"));
  const interpreter = join(directory, "node");
  const nativeProbe = process.env.SYNTX_EDITOR_NATIVE_FFPROBE_PATH;
  const nativeVideo = process.env.SYNTX_EDITOR_NATIVE_VIDEO_PATH;
  assert.equal(Boolean(nativeProbe), Boolean(nativeVideo), "native acceptance requires both trusted probe and genuine video");
  const probe = nativeProbe ?? join(directory, "probe");
  if (!nativeProbe) {
    await symlink(process.execPath, interpreter);
    await writeFile(probe, `#!${interpreter}\nprocess.stdout.write(${JSON.stringify(JSON.stringify({ streams: [
    { codec_type: "video", width: 1280, height: 720, avg_frame_rate: "25/1", start_time: "0", duration: "4.25", duration_ts: 4250, time_base: "1/1000" }
    ], format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2" } }))});\n`, { mode: 0o700, flag: "wx" });
  }
  const stats = { uploads: 0, chats: 0, posts: 0, quotes: 0, histories: 0, results: 0, balances: 0, subscriptions: 0 };
  let last: any, ready = !options.pending;
  const owner = () => ({ id: "owner2230", chat_id: "provider2230", author_id: options.wrongOwner ? -1 : 17,
    message_object: [
      { id: "text2230", message_id: "owner2230", object_type: "text", object_text: last?.prompt },
      { id: "input2230", message_id: "owner2230", object_type: "video", object_url: INPUT, model_type: "seedance-2.5" },
      ...(last?.settings?.file_urls?.length > 1 ? [{ id: "frame2230", message_id: "owner2230", object_type: "image", object_url: FRAME }] : [])
    ] });
  const bot = () => ({ id: "bot2230", chat_id: "provider2230", author_id: -1, message_object: [
    { id: "output2230", message_id: "bot2230", object_type: "video", object_url: OUTPUT,
      model_type: options.wrongModel ? "other-model" : "seedance-2.5", completed: true }
  ] });
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.syntx.ai");
    if (url.pathname.endsWith("user/balance")) { stats.balances++; return json({ balance: "10.25" }); }
    if (url.pathname.endsWith("user/subscription")) { stats.subscriptions++; return json({ active: true, type: options.free ? "FREE" : "PRO", end_date: "2099-01-01" }); }
    if (url.pathname.endsWith("get_model_info")) {
      stats.quotes++;
      assert.equal(url.searchParams.get("model_type"), "seedance-2.5");
      assert.equal(url.searchParams.get("ai_name"), "seedance");
      assert.equal(url.searchParams.get("duration"), "4.25");
      assert.equal(url.searchParams.get("size"), "adaptive");
      return json({ access: !(options.secondDenied && stats.quotes === 2), cost: 0.2, discount_cost: null,
        free_remaining_generations: 0, limit: null, show_warning: false });
    }
    if (url.pathname.endsWith("chats/upload-files")) { stats.uploads++; const form = init.body as FormData; const file = form.get("files") as File; assert.equal(form.get("destination"), "uploaded"); assert.equal(form.get("model_type"), "seedance-2.5");
      if (file.type === "image/png" && options.frameUnknown) throw new Error("synthetic unknown upload");
      return json({ files: [{ url: file.type === "image/png" ? FRAME : INPUT, mime_type: file.type, size: file.size + (file.type === "image/png" && options.frameResponseMismatch ? 1 : 0) }] }); }
    if (url.pathname === "/api/v1/chats") {
      stats.chats++; assert.equal(JSON.parse(String(init.body)).scope, "tool_video_inpaint");
      return json({ uuid: "editorchat2230" });
    }
    if (url.pathname.endsWith("video/generate")) {
      stats.posts++; last = JSON.parse(String(init.body));
      assert.equal(url.searchParams.get("ai_name"), "seedance");
      assert.equal(last.chat_id, "editorchat2230"); assert.equal(last.chat_uuid, undefined);
      assert.deepEqual(last.settings, { model_type: "seedance-2.5", mode: "edit", aspect_ratio: "adaptive",
        resolution: "480p", video_duration: 0, generate_audio: true, file_urls: [{ type: "video", url: INPUT }, { type: "image", url: FRAME }] });
      assert.equal(last.prompt, `Synthetic Editor test <<<${FRAME}|00:01.235>>>`);
      if (options.generationHttpStatus) return json({ detail: "PRIVATE_RESPONSE_BODY_MUST_NOT_ESCAPE" }, options.generationHttpStatus);
      if (options.loseAck) throw new Error("synthetic lost ACK");
      return json({ id: "owner2230" });
    }
    if (url.pathname.endsWith("editorchat2230/messages")) {
      stats.histories++; const messages = [owner(), ...(ready ? [bot()] : [])];
      return json({ messages, pagination: { page: 1, page_size: 10, total_count: messages.length,
        total_pages: 1, has_next: false, has_previous: false } });
    }
    if (url.pathname.endsWith("editorchat2230/bot2230")) {
      stats.results++; const row = bot(); if (options.swapResult) row.message_object[0]!.object_url = INPUT;
      return json(row);
    }
    throw new Error("Unexpected synthetic route");
  };
  const credentialBroker = { async useCredential<T>(use: (token: string) => Promise<T>): Promise<T> {
    return links.useCredential(binding, ATTEMPT, credential => use(credential.value));
  } };
  const client = new SyntxChatHttpClient({ credentialBroker, fetchImpl, requestTimeoutMs: 1000 });
  const createReadClient = () => new SyntxHttpClient({ credentialBroker, fetchImpl, requestTimeoutMs: 1000 });
  const references = new OwnerSeedanceEditorReferenceService({ binding, linkService: links, resolveClient: () => client,
    ffprobePath: await realpath(probe), now });
  const { catalog } = loadOwnerSeedanceEditorRuntimeCatalog();
  const service: ApiService = new module.OwnerSeedanceEditorGenerationService({ binding, linkService: links, referenceService: references,
    catalog, resolveChatClient: () => client, createReadClient, now });
  try {
    const bytes = nativeVideo ? await readFile(nativeVideo) : Buffer.alloc(24);
    if (!nativeVideo) { bytes.writeUInt32BE(24); bytes.write("ftyp", 4); bytes.write("isom", 8); bytes.write("isom", 16); bytes.write("mp42", 20); }
    const upload = uploadInitially ? await references.uploadReference({ attemptId: ATTEMPT, model_id: "seedance-2.5-editor", filename: "source.mp4", mime_type: "video/mp4", bytes }) : { reference_handle: "" };
    const request = { attemptId: ATTEMPT, model_id: "seedance-2.5-editor", prompt: "Synthetic Editor test", resolution: "480p", reference_handle: upload.reference_handle };
    return { service, references, bytes, client, request, stats, ready() { ready = true; }, async close() { await service.close(); await references.close(); await rm(directory, { recursive: true, force: true }); } };
  } catch (error) { await service.close(); await references.close(); await rm(directory, { recursive: true, force: true }); throw error; }
}


function crc32(bytes: Uint8Array): number { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
function framePng(): Buffer { const b = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64"); b.writeUInt32BE(640, 16); b.writeUInt32BE(640, 20); b.writeUInt32BE(crc32(b.subarray(12, 29)), 29); return b; }

test("Editor frame upload, owner binding, timecode, wire and result in one synthetic flow", async () => {
  const env = await fixture();
  try {
    const frame = await env.references.uploadFrame({ attemptId: ATTEMPT, model_id: "seedance-2.5-editor", reference_handle: env.request.reference_handle,
      filename: "frame.png", mime_type: "image/png", bytes: framePng(), time_seconds: 1.2346 });
    assert.equal(JSON.stringify(frame).includes(FRAME), false);
    const result = await env.service.generate({ ...env.request, frame_handles: [frame.frame_handle] });
    assert.equal(result.status, "completed"); assert.equal(env.stats.uploads, 2); assert.equal(env.stats.posts, 1);
    await assert.rejects(env.service.generate({ ...env.request, frame_handles: [frame.frame_handle] }), {code: "INTENT_ALREADY_CLAIMED"});
  } finally { await env.close(); }
});

test("Editor frame rejects invalid time, forged handles and revoked video before upload or dispatch", async () => {
  const env = await fixture();
  try {
    const input = {attemptId: ATTEMPT, model_id: "seedance-2.5-editor", reference_handle: env.request.reference_handle,
      filename: "frame.png", mime_type: "image/png", bytes: framePng(), time_seconds: 5};
    await assert.rejects(env.references.uploadFrame(input)); assert.equal(env.stats.uploads, 1);
    await assert.rejects(env.references.uploadFrame({...input, time_seconds: 1, bytes: Buffer.from("not an image")}));
    await assert.rejects(env.references.uploadFrame({...input, time_seconds: 1, filename: "frame.jpg"}));
    assert.equal(env.stats.uploads, 1);
    const frame = await env.references.uploadFrame({...input, time_seconds: 0});
    const other = await env.references.uploadReference({ attemptId: ATTEMPT, model_id: "seedance-2.5-editor", filename: "other.mp4", mime_type: "video/mp4", bytes: env.bytes });
    await assert.rejects(env.service.generate({...env.request, reference_handle: other.reference_handle, frame_handles: [frame.frame_handle]}));
    await assert.rejects(env.service.generate({...env.request, frame_handles: [frame.frame_handle, frame.frame_handle]}));
    await assert.rejects(env.service.generate({...env.request, frame_handles: ["seedance_editor_frame_00000000-0000-4000-8000-000000000001"]}));
    assert.equal(env.stats.posts, 0);
    await env.references.invalidateAttempt(ATTEMPT);
    await assert.rejects(env.service.generate({...env.request, frame_handles: [frame.frame_handle]}));
    assert.equal(env.stats.posts, 0);
  } finally { await env.close(); }
});

test("Editor frame tools use the genuine MCP schema and opaque handle", async () => {
  const env = await fixture();
  const server = createMcpServer(createDefaultApplication(), { ownerSeedanceEditor: { referenceService: env.references, generationService: env.service } });
  const client = new Client({ name: "editor-frame-test", version: "1.0.0" });
  const [caller, host] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(host); await client.connect(caller);
    const source = await client.callTool({ name: "syntx_get_seedance_editor_source", arguments: {} });
    const frameSource = (source.structuredContent as {frame_source:{source_build_id:string; backend_acceptance:string}}).frame_source;
    assert.equal(frameSource.source_build_id, "1793890358"); assert.equal(frameSource.backend_acceptance, "UNPROVEN");
    const uploaded = await client.callTool({ name: "syntx_owner_upload_seedance_editor_frame", arguments: {
      link_attempt_id: ATTEMPT, model_id: "seedance-2.5-editor", reference_handle: env.request.reference_handle,
      filename: "frame.png", mime_type: "image/png", content_base64: framePng().toString("base64"), time_seconds: 1.2346
    }});
    assert.equal(uploaded.isError, undefined, JSON.stringify(uploaded));
    assert.equal(JSON.stringify(uploaded).includes(FRAME), false);
    const result = await client.callTool({ name: "syntx_owner_generate_seedance_editor_video", arguments: {
      link_attempt_id: ATTEMPT, model_id: "seedance-2.5-editor", prompt: env.request.prompt, resolution: "480p",
      reference_handle: env.request.reference_handle, frame_handles: [(uploaded.structuredContent as {frame_handle:string}).frame_handle]
    }});
    assert.equal(result.isError, undefined, JSON.stringify(result));
    assert.equal((result.structuredContent as {status:string}).status, "completed");
    assert.equal(env.stats.posts, 1);
  } finally { await client.close(); await server.close(); await env.close(); }
});

test("uncertain or mismatched frame upload is sticky and never repeated", async () => {
  for (const options of [{frameUnknown: true}, {frameResponseMismatch: true}]) {
    const env = await fixture(options);
    try {
      const frame = { attemptId: ATTEMPT, model_id: "seedance-2.5-editor", reference_handle: env.request.reference_handle,
        filename: "frame.png", mime_type: "image/png", bytes: framePng(), time_seconds: 1 };
      await assert.rejects(env.references.uploadFrame(frame), {code: "UPLOAD_OUTCOME_UNKNOWN"});
      await assert.rejects(env.references.uploadFrame(frame), {code: "UPLOAD_OUTCOME_UNKNOWN"});
      assert.equal(env.stats.uploads, 2); assert.equal(env.stats.posts, 0);
    } finally { await env.close(); }
  }
});

test("frame-handle accessors are rejected without evaluation", async () => {
  const env = await fixture();
  try {
    let read = false; const handles: string[] = []; Object.defineProperty(handles, "0", {get() {read = true; return "x";}, enumerable: true});
    await assert.rejects(env.service.generate({...env.request, frame_handles: handles}));
    assert.equal(read, false); assert.equal(env.stats.posts, 0);
  } finally { await env.close(); }
});
