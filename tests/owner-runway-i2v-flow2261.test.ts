import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server.js";
import { createDefaultApplication } from "../src/application/factory.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient } from "../src/adapter/syntx/http-client.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { loadOwnerRunwayI2vRuntimeCatalog } from "../src/application/owner-runway-i2v-cost.js";

const ATTEMPT = "link_runway_flow2261_0123456789abcdef";
const INPUT = "https://r2.syntx.ai/runway2261/frame.png";
const OUTPUT = "https://r2.syntx.ai/runway2261/result.mp4";
let serial = 0;

function png384(): Buffer {
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
  bytes.writeUInt32BE(384,16); bytes.writeUInt32BE(384,20);
  let crc=0xffff_ffff; for(const b of bytes.subarray(12,29)){crc ^= b; for(let bit=0;bit<8;bit++)crc=(crc>>>1)^(crc&1?0xedb8_8320:0);}
  bytes.writeUInt32BE((crc^0xffff_ffff)>>>0,29);return bytes;
}

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
type ApiService = { generate(input: unknown): Promise<any>; reconcile(input: unknown): Promise<any>; listRecoveries(input: unknown): Promise<readonly unknown[]>; close(): Promise<void>; invalidateAttempt(id: string): Promise<void> };
async function fixture(options: { free?: boolean; secondDenied?: boolean; loseAck?: boolean; pending?: boolean;
  wrongModel?: boolean; wrongOwner?: boolean; swapResult?: boolean; generationHttpStatus?: number; seed?: number | null; model?: "gen4.5i2v";
  ratio?: "16:9" | "4:3" | "1:1" | "3:4" | "9:16"; bytes?: Buffer } = {}, uploadInitially = true) {
  const [{ OwnerRunwayI2vReferenceService }, module] = await Promise.all([
    import(new URL("../src/application/owner-runway-i2v-reference-service.js", import.meta.url).href),
    import(new URL("../src/application/owner-runway-i2v-generation-service.js", import.meta.url).href)
  ]);
  assert.equal(typeof module.OwnerRunwayI2vGenerationService, "function");
  const model = options.model ?? "turbo4genfirstframeimage", ratio = options.ratio ?? "1:1";
  const code = { "16:9": "169", "4:3": "43", "1:1": "11", "3:4": "34", "9:16": "916" }[ratio];
  const binding = { tenant_id: "runway2261", subject: `owner-${++serial}` };
  const now = () => Date.parse("2026-10-18T00:00:00.000Z");
  const links = new PerUserLinkService({ authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "runway2261", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-runway2261-credential" }); return { state: "LINKED" }; }
  }, new InMemoryAuthLinkStore(now), { now, attemptIdGenerator: () => ATTEMPT });
  await links.createAttempt(binding); await links.issueHandoff(binding, ATTEMPT); await links.checkAttempt(binding, ATTEMPT);
  const stats = { uploads: 0, chats: 0, posts: 0, quotes: 0, histories: 0, results: 0, balances: 0, subscriptions: 0 };
  let last: any, ready = !options.pending;
  const owner = () => ({ id: "owner2261", chat_id: "provider2261", author_id: options.wrongOwner ? -1 : 17,
    message_object: [
      { id: "text2261", message_id: "owner2261", object_type: "text", object_text: last?.prompt },
      { id: "input2261", message_id: "owner2261", object_type: "image", object_url: INPUT, model_type: model }
    ] });
  const bot = () => ({ id: "bot2261", chat_id: "provider2261", author_id: -1, message_object: [
    { id: "output2261", message_id: "bot2261", object_type: "video", object_url: OUTPUT,
      model_type: options.wrongModel ? "other-model" : model, completed: true }
  ] });
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.syntx.ai");
    if (url.pathname.endsWith("user/balance")) { stats.balances++; return json({ balance: "10.25" }); }
    if (url.pathname.endsWith("user/subscription")) { stats.subscriptions++; return json({ active: true, type: options.free ? "FREE" : "PRO", end_date: "2099-01-01" }); }
    if (url.pathname.endsWith("get_model_info")) {
      stats.quotes++;
      assert.equal(url.searchParams.get("model_type"), model);
      assert.equal(url.searchParams.get("ai_name"), "runway");
      assert.equal(url.searchParams.get("video_duration"), "5.0");
      assert.deepEqual([...url.searchParams.keys()].sort(), ["ai_name", "model_type", "video_duration"]);
      return json({ access: !(options.secondDenied && stats.quotes === 2), cost: 0.2, discount_cost: null,
        free_remaining_generations: 0, limit: null, show_warning: false });
    }
    if (url.pathname.endsWith("chats/upload-files")) { stats.uploads++; const file = (init.body as FormData).get("files"); assert.ok(file instanceof File);
      return json({ files: [{ url: INPUT, status: "success", mime_type: file.type, media_type: "image", type: "image", filename: file.name, size: file.size }] }); }
    if (url.pathname === "/api/v1/chats") {
      stats.chats++; assert.equal(JSON.parse(String(init.body)).scope, "video");
      return json({ uuid: "runwaychat2261" });
    }
    if (url.pathname.endsWith("video/generate")) {
      stats.posts++; last = JSON.parse(String(init.body));
      assert.equal(url.searchParams.get("ai_name"), "runway");
      assert.equal(last.chat_id, "runwaychat2261"); assert.equal(last.chat_uuid, undefined);
      assert.deepEqual(last.settings, { model_type: model, aspect_ratio: code,
        video_duration: "5.0", seed: options.seed ?? null, file_urls: [{ type: "image", url: INPUT }] });
      if (options.generationHttpStatus) return json({ detail: "PRIVATE_RESPONSE_BODY_MUST_NOT_ESCAPE" }, options.generationHttpStatus);
      if (options.loseAck) throw new Error("synthetic lost ACK");
      return json({ id: "owner2261" });
    }
    if (url.pathname.endsWith("runwaychat2261/messages")) {
      stats.histories++; const messages = [owner(), ...(ready ? [bot()] : [])];
      return json({ messages, pagination: { page: 1, page_size: 10, total_count: messages.length,
        total_pages: 1, has_next: false, has_previous: false } });
    }
    if (url.pathname.endsWith("runwaychat2261/bot2261")) {
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
  const references = new OwnerRunwayI2vReferenceService({ binding, linkService: links, resolveClient: () => client,
    now });
  const { catalog } = loadOwnerRunwayI2vRuntimeCatalog();
  const service: ApiService = new module.OwnerRunwayI2vGenerationService({ binding, linkService: links, referenceService: references,
    catalog, resolveChatClient: () => client, createReadClient, now });
  try {
    const bytes = options.bytes ?? png384();
    const upload = uploadInitially ? await references.uploadReference({ attemptId: ATTEMPT, model_id: model, filename: "frame.png", aspect_ratio: ratio, mime_type: "image/png", bytes }) : { reference_handle: "" };
    const request = { attemptId: ATTEMPT, model_id: model, prompt: "Synthetic Runway test", aspect_ratio: ratio, video_duration: 5, seed: options.seed ?? null, reference_handle: upload.reference_handle };
    return { service, references, bytes, client, request, stats, ready() { ready = true; }, async close() { await service.close(); await references.close(); } };
  } catch (error) { await service.close(); await references.close(); throw error; }
}

test("2261 Runway exact upload→fresh quotes→one GEN→owned history→result", async () => {
  const env = await fixture();
  try {
    const result = await env.service.generate(env.request);
    assert.equal(result.status, "completed"); assert.equal(result.artifacts[0].object_url, OUTPUT);
    assert.equal(result.provider_terminal_status, "UNPROVEN"); assert.equal(result.cost_cap_enforced, false);
    assert.deepEqual(env.stats, { uploads: 1, chats: 1, posts: 1, quotes: 2, histories: 1, results: 1, balances: 2, subscriptions: 2 });
    await assert.rejects(env.service.generate(env.request), { code: "INTENT_ALREADY_CLAIMED" });
    assert.equal(env.stats.posts, 1);
  } finally { await env.close(); }
});
test("2261 fresh FREE or second denied quote blocks paid GEN", async () => {
  for (const options of [{ free: true }, { secondDenied: true }]) {
    const env = await fixture(options);
    try { await assert.rejects(env.service.generate(env.request)); assert.equal(env.stats.posts, 0); }
    finally { await env.close(); }
  }
});
test("2261 lost ACK and pending result recover with GET only", async () => {
  for (const options of [{ loseAck: true }, { pending: true }]) {
    const env = await fixture(options);
    try {
      const first = await env.service.generate(env.request);
      assert.equal(first.status, "outcome_unknown"); env.ready();
      const recovered = await env.service.reconcile({ attemptId: ATTEMPT, recovery_id: first.recovery_id });
      assert.equal(recovered.status, "completed"); assert.equal(env.stats.posts, 1);
    } finally { await env.close(); }
  }
});
test("2261 wrong owner/model or changed GET artifact never returns completed", async () => {
  for (const options of [{ wrongOwner: true }, { wrongModel: true }, { swapResult: true }]) {
    const env = await fixture(options);
    try { const result = await env.service.generate(env.request); assert.equal(result.status, "outcome_unknown"); assert.equal(result.artifacts.length, 0); }
    finally { await env.close(); }
  }
});
test("2261 revoked lineage and forged dispatch contexts cause no GEN or result access", async () => {
  const env = await fixture({ pending: true });
  try {
    const result = await env.service.generate(env.request);
    await env.service.invalidateAttempt(ATTEMPT);
    await assert.rejects(env.service.reconcile({ attemptId: ATTEMPT, recovery_id: result.recovery_id }));
    const native = env.client as unknown as Record<string, (input: unknown) => Promise<unknown>>;
    await assert.rejects(native.startOwnerRunwayI2vOperation!.call(env.client, Object.freeze({ attemptId: ATTEMPT })));
    assert.equal(env.stats.posts, 1);
  } finally { await env.close(); }
});

test("2261 real MCP SDK tools drive the genuine Runway services from bytes to result", async () => {
  const env = await fixture({ seed: 123 }, false);
  const server = createMcpServer(createDefaultApplication(), { ownerRunwayI2v: { referenceService: env.references, generationService: env.service } });
  const client = new Client({ name: "runway2261-full-sdk", version: "1.0.0" });
  const [caller, host] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(host); await client.connect(caller);
    const uploaded = await client.callTool({ name: "syntx_owner_upload_runway_i2v_image", arguments: {
      link_attempt_id: ATTEMPT, model_id: "turbo4genfirstframeimage", filename: "frame.png", aspect_ratio: "1:1", mime_type: "image/png", content_base64: env.bytes.toString("base64")
    } });
    assert.equal(uploaded.isError, undefined, JSON.stringify(uploaded));
    assert.equal(JSON.stringify(uploaded).includes(INPUT), false);
    const handle = (uploaded.structuredContent as { reference_handle: string }).reference_handle;
    const generated = await client.callTool({ name: "syntx_owner_generate_runway_i2v_video", arguments: {
      link_attempt_id: ATTEMPT, model_id: "turbo4genfirstframeimage", prompt: "Synthetic MCP SDK Runway test", aspect_ratio: "1:1", video_duration: 5, seed: 123, reference_handle: handle
    } });
    assert.equal(generated.isError, undefined, JSON.stringify(generated));
    assert.equal((generated.structuredContent as { status: string }).status, "completed");
    assert.equal((generated.structuredContent as { artifacts: { object_url: string }[] }).artifacts[0]!.object_url, OUTPUT);
    assert.equal(env.stats.uploads, 1); assert.equal(env.stats.posts, 1); assert.equal(env.stats.results, 1);
  } finally { await client.close(); await server.close(); await env.close(); }
});

test("2261 unknown generation preserves HTTP metadata without exposing response bodies or retrying", async () => {
  const env = await fixture({ generationHttpStatus: 422, pending: true });
  try {
    const result = await env.service.generate(env.request);
    assert.equal(result.status, "outcome_unknown");
    assert.ok(result.gaps.includes("GENERATION_HTTP_422"));
    assert.equal(JSON.stringify(result).includes("PRIVATE_RESPONSE_BODY_MUST_NOT_ESCAPE"), false);
    assert.equal(env.stats.posts, 1);
    const recovered = await env.service.reconcile({ attemptId: ATTEMPT, recovery_id: result.recovery_id });
    assert.equal(recovered.status, "outcome_unknown");
    assert.ok(recovered.gaps.includes("GENERATION_HTTP_422"), "GET-only recovery preserves original transport metadata");
    await assert.rejects(env.service.generate(env.request), { code: "INTENT_ALREADY_CLAIMED" });
    assert.equal(env.stats.posts, 1);
  } finally { await env.close(); }
});

test("Current Gen4.5 I2V SDK preserves all five genuinely cropped PNG ratios through quote native upload GEN and owned GET", async t => {
  const ffmpeg = process.env.SYNTX_MEDIA_FFMPEG_PATH ?? ["/opt/homebrew/bin/ffmpeg", "/usr/bin/ffmpeg"].find(existsSync);
  if (!ffmpeg || !existsSync(ffmpeg)) { t.skip("trusted real ffmpeg unavailable for genuine Gen4.5 cropped PNGs"); return; }
  const directory = await mkdtemp(join(tmpdir(), "syntx Gen4.5 кадры 📷 "));
  try {
    for (const [ratio, numerator, denominator, code] of [["16:9",16,9,"169"],["4:3",4,3,"43"],["1:1",1,1,"11"],["3:4",3,4,"34"],["9:16",9,16,"916"]] as const) {
      const scale = 2 * Math.ceil(320 / Math.min(numerator, denominator) / 2), file = join(directory, `кадр ${code}.png`);
      execFileSync(ffmpeg, ["-nostdin", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
        `testsrc2=size=${numerator * scale}x${denominator * scale}:rate=1`, "-frames:v", "1", "-y", file], { timeout: 20_000, stdio: "pipe" });
      const f = await fixture({ model: "gen4.5i2v", ratio, bytes: await readFile(file) }, false);
      const server = createMcpServer(createDefaultApplication(), { ownerRunwayI2v: { referenceService: f.references, generationService: f.service } });
      const client = new Client({ name: "gen45-current-five-ratios", version: "1" }), [caller, host] = InMemoryTransport.createLinkedPair();
      try {
        await server.connect(host); await client.connect(caller);
        const uploaded = await client.callTool({ name: "syntx_owner_upload_runway_i2v_image", arguments: { link_attempt_id: ATTEMPT,
          model_id: "gen4.5i2v", aspect_ratio: ratio, filename: "frame.png", mime_type: "image/png", content_base64: f.bytes.toString("base64") } });
        assert.equal(uploaded.isError, undefined, JSON.stringify(uploaded));
        const reference_handle = (uploaded.structuredContent as { reference_handle: string }).reference_handle;
        const args = { link_attempt_id: ATTEMPT, model_id: "gen4.5i2v", aspect_ratio: ratio, prompt: "Current cropped source ratio",
          video_duration: 5, seed: null, reference_handle };
        const before = { ...f.stats };
        assert.equal((await client.callTool({ name: "syntx_owner_generate_runway_i2v_video", arguments: { ...args, aspect_ratio: "21:9" } })).isError, true);
        assert.deepEqual(f.stats, before);
        const result = await client.callTool({ name: "syntx_owner_generate_runway_i2v_video", arguments: args });
        assert.equal(result.isError, undefined, JSON.stringify(result)); assert.equal((result.structuredContent as { status: string }).status, "completed");
        assert.deepEqual(f.stats, { uploads: 1, chats: 1, posts: 1, quotes: 2, histories: 1, results: 1, balances: 2, subscriptions: 2 });
      } finally { await client.close(); await server.close(); await f.close(); }
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
