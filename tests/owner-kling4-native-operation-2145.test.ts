import assert from "node:assert/strict";
import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import test from "node:test";
import { tmpdir } from "node:os";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { OBSERVED_AUTHORIZATION_PROFILE, type AuthBinding, type AuthLinkProvider } from "../src/auth/types.js";

const ATTEMPT = "link_kling4_native_2145_0123456789abcdef";
const BINDING: AuthBinding = Object.freeze({ tenant_id: "kling4-native-2145", subject: "synthetic-owner" });
const KEYFRAMES = "kling_4_keyframes" as const;
const OMNI = "kling_4_omni" as const;
const IMAGE_URL_1 = "https://r2.syntx.ai/kling4-native-2145/private/image-1.png";
const IMAGE_URL_2 = "https://r2.syntx.ai/kling4-native-2145/private/image-2.png";
const VIDEO_URL = "https://r2.syntx.ai/kling4-native-2145/private/video.mp4";
const OUTPUT_URL = "https://r2.syntx.ai/kling4-native-2145/output/result.mp4";
const VIDEO_PROBE = JSON.stringify({
  streams: [
    { codec_type: "video", codec_name: "h264", width: 700, height: 700, start_time: "0.000000", duration: "4.000000" },
    { codec_type: "audio", codec_name: "aac", start_time: "0.500000", duration: "5.000000" }
  ],
  format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "5.000000" }
});
let flowSequence = 0;

type ModelId = typeof KEYFRAMES | typeof OMNI;
type Context = Record<string, any>;
interface NativeApi {
  readonly OwnerKling4NativeError: new (code: string) => Error & { readonly code: string };
  createOwnerKling4NativeChat(input: unknown, packet: unknown, signal?: AbortSignal): Promise<Context>;
  readOwnerKling4NativeDispatchStatus(client: unknown, chat: unknown): Context | null;
}
interface FlowApi {
  readonly OwnerKling4ReferenceService: new (options: unknown) => Context;
  createOwnerKling4RequestPreparer(options: unknown): Context;
  createOwnerKling4OneShotPermit(input: unknown): Promise<object>;
}
interface NativeClient {
  createOwnerKling4Chat(input: unknown, signal?: AbortSignal): Promise<Context>;
  startOwnerKling4WithOwnedCandidate(input: unknown, signal?: AbortSignal): Promise<Context>;
  listOwnedKling4Candidates(input: unknown, signal?: AbortSignal): Promise<Context>;
  getOwnedKling4Result(input: unknown, signal?: AbortSignal): Promise<Context>;
}
type HistoryMode = "matched" | "two-pages" | "wrong-input-model" | "wrong-result-model" |
  "incomplete-result" | "partial-input-echo" | "absent-input-echo" | "changed-page" | "extra-owner";

async function modules(): Promise<FlowApi & NativeApi> {
  const [store, preparer, permit, native] = await Promise.all([
    import(new URL("../src/application/owner-kling4-reference-service.js", import.meta.url).href),
    import(new URL("../src/application/owner-kling4-request-preparer.js", import.meta.url).href),
    import(new URL("../src/application/owner-kling4-one-shot-policy.js", import.meta.url).href),
    import(new URL("../src/adapter/syntx/owner-kling4-native-context.js", import.meta.url).href)
  ]);
  return { ...store, ...preparer, ...permit, ...native } as unknown as FlowApi & NativeApi;
}

function png(width = 300, height = 300): Buffer {
  function chunk(type: string, data: Buffer) {
    const output = Buffer.alloc(12 + data.length);
    output.writeUInt32BE(data.length); output.write(type, 4); data.copy(output, 8);
    output.writeUInt32BE(crc32(output.subarray(4, -4)), output.length - 4);
    return output;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.alloc((width * 4 + 1) * height))), chunk("IEND", Buffer.alloc(0))]);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function mp4Bytes(): Uint8Array {
  const bytes = new Uint8Array(28), view = new DataView(bytes.buffer);
  view.setUint32(0, 20); bytes.set(new TextEncoder().encode("ftypisom"), 4); view.setUint32(12, 0);
  bytes.set(new TextEncoder().encode("mp41"), 16); view.setUint32(20, 8); bytes.set(new TextEncoder().encode("mdat"), 24);
  return bytes;
}

async function ffprobeFixture(): Promise<{ readonly directory: string; readonly binary: string }> {
  const directory = await mkdtemp(`${tmpdir()}/syntx-k4-native-2145-`);
  const binary = `${directory}/ffprobe-fixture`;
  const script = `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(VIDEO_PROBE)});\n`;
  await writeFile(binary, script, { encoding: "utf8", mode: 0o700, flag: "wx" });
  await chmod(binary, 0o700);
  return { directory, binary: await realpath(binary) };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function ownerPrincipal() {
  return { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT } as const;
}

function generationInput(modelId: ModelId, handles: readonly string[], prompt: string) {
  return {
    attemptId: ATTEMPT, model_id: modelId, prompt, version: "4.0", mode: "hd", aspect_ratio: "21:9",
    video_duration: 8, native_audio: modelId === KEYFRAMES, reference_handles: [...handles]
  } as const;
}

interface NativeFlow {
  readonly api: FlowApi & NativeApi;
  readonly client: NativeClient;
  readonly links: PerUserLinkService;
  readonly service: Context;
  readonly preparer: Context;
  readonly candidate: Context;
  readonly permit: object;
  readonly operation: Context;
  readonly counts: { upload: number; chat: number; generate: number; history: number; result: number };
  readonly expectedPrompt: string;
  readonly expectedFileUrls: readonly { readonly type: "image" | "video"; readonly url: string }[];
  setHistoryMode(mode: HistoryMode): void;
  advance(milliseconds: number): void;
  close(): Promise<void>;
}

async function createFlow(modelId: ModelId, options: {
  readonly loseGenerationAck?: boolean;
  readonly loseChatAck?: boolean;
  readonly revokeDuringGeneration?: boolean;
  readonly missingResultModel?: boolean;
  readonly extraResultText?: boolean;
} = {}): Promise<NativeFlow> {
  const api = await modules(), probe = await ffprobeFixture();
  let clock = 1_000_000, historyMode: HistoryMode = "matched";
  const now = () => clock;
  const prompt = modelId === KEYFRAMES
    ? `Use [[ref:2]] then [[ref:1]]; run ${++flowSequence}.`
    : `Use [[ref:2]] for motion and [[ref:1]] as anchor; run ${++flowSequence}.`;
  const privatePrompt = expandPrompt(modelId, prompt);
  const counts = { upload: 0, chat: 0, generate: 0, history: 0, result: 0 };
  const provider: AuthLinkProvider = {
    authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() { return { upstream_attempt_id: "synthetic-kling4-native-2145", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: "synthetic-kling4-native-2145-token" });
      return { state: "LINKED" };
    }
  };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(now), { now, defaultTtlMs: 30 * 60_000,
    attemptIdGenerator: () => ATTEMPT });
  await links.createAttempt(BINDING); await links.issueHandoff(BINDING, ATTEMPT); await links.checkAttempt(BINDING, ATTEMPT);
  const client = new SyntxChatHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      return links.useCredential(BINDING, ATTEMPT, (credential) => operation(credential.value));
    } },
    fetchImpl: async (request, init = {}) => {
      const url = new URL(request instanceof Request ? request.url : String(request));
      const method = init.method ?? "GET";
      if (url.pathname === "/api/v1/chats/upload-files" && method === "POST") {
        counts.upload += 1;
        const form = init.body as FormData;
        assert.deepEqual([...form.keys()], ["files", "destination", "check_duplicates", "model_type"]);
        assert.equal(form.get("destination"), "uploaded"); assert.equal(form.get("check_duplicates"), "true");
        assert.equal(form.get("model_type"), modelId);
        const file = form.get("files"); assert.ok(file instanceof File);
        const isVideo = file.type === "video/mp4";
        return jsonResponse({ files: [{ id: `k4-native-upload-${counts.upload}`, url: isVideo ? VIDEO_URL : counts.upload === 1 ? IMAGE_URL_1 : IMAGE_URL_2,
          mime_type: file.type, size: file.size, status: "uploaded" }] });
      }
      if (url.pathname === "/api/v1/chats" && method === "POST") {
        counts.chat += 1;
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        assert.deepEqual(Object.keys(body).sort(), ["scope", "title"]); assert.equal(body.scope, "video");
        assert.match(String(body.title), /^owner-kling4-native-/u);
        if (options.loseChatAck) throw new Error("synthetic lost K4 chat acknowledgment");
        return jsonResponse({ uuid: "88145" });
      }
      if (url.pathname === "/api/v1/video/generate" && method === "POST") {
        counts.generate += 1; assert.equal(url.search, "?ai_name=kling");
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        assert.deepEqual(Object.keys(body).sort(), ["chat_id", "prompt", "settings"]);
        assert.equal(body.chat_id, "88145"); assert.equal(body.prompt, privatePrompt);
        const settings = body.settings as Record<string, unknown>;
        assert.deepEqual(Object.keys(settings).sort(), ["aspect_ratio", "file_urls", "mode", "model_type", "native_audio", "version", "video_duration"]);
        assert.equal(settings.model_type, modelId); assert.equal(settings.version, "4.0");
        assert.equal(settings.mode, "hd"); assert.equal(settings.aspect_ratio, "21:9");
        assert.equal(settings.video_duration, 8); assert.equal(settings.native_audio, modelId === KEYFRAMES);
        assert.deepEqual(settings.file_urls, expectedFiles(modelId));
        assert.equal("duration" in settings, false); assert.equal("role" in settings, false);
        if (options.revokeDuringGeneration) await links.revoke(BINDING, ATTEMPT);
        if (options.loseGenerationAck) throw new Error("synthetic lost K4 GEN acknowledgment");
        return jsonResponse({ id: "k4-native-owner-ack-2145" });
      }
      if (url.pathname === "/api/v1/chats/88145/messages" && method === "GET") {
        counts.history += 1;
        assert.equal(url.searchParams.get("page"), String(counts.history)); assert.equal(url.searchParams.get("page_size"), "10");
        const page = Number(url.searchParams.get("page"));
        const rows = historyRows(historyMode, modelId, privatePrompt);
        const totalPages = Math.ceil(rows.length / 10);
        const pageRows = rows.slice((page - 1) * 10, page * 10);
        const pagination = historyMode === "changed-page"
          ? { page: page + 1, page_size: 10, total_count: rows.length, total_pages: totalPages,
            has_next: page < totalPages, has_previous: page > 1 }
          : { page, page_size: 10, total_count: rows.length, total_pages: totalPages,
            has_next: page < totalPages, has_previous: page > 1 };
        return jsonResponse({ messages: pageRows, pagination });
      }
      if (url.pathname === "/api/v1/chats/88145/k4-native-result-2145" && method === "GET") {
        counts.result += 1; return jsonResponse(resultRow(modelId, true, !options.missingResultModel, options.extraResultText));
      }
      throw new Error(`unexpected synthetic route ${method} ${url.pathname}`);
    }
  }) as unknown as NativeClient;

  const service = new api.OwnerKling4ReferenceService({ binding: BINDING, linkService: links, resolveClient: () => client,
    ffprobePath: probe.binary, now });
  const preparer = api.createOwnerKling4RequestPreparer({ referenceService: service, now });
  try {
    const image1 = await service.uploadReference({ attemptId: ATTEMPT, model_id: modelId,
      filename: "anchor-1.png", mime_type: "image/png", bytes: png() });
    const references = [image1];
    if (modelId === KEYFRAMES) {
      references.push(await service.uploadReference({ attemptId: ATTEMPT, model_id: modelId,
        filename: "anchor-2.png", mime_type: "image/png", bytes: png(301, 301) }));
    } else {
      references.push(await service.uploadReference({ attemptId: ATTEMPT, model_id: modelId,
        filename: "motion.mp4", mime_type: "video/mp4", bytes: mp4Bytes() }));
    }
    const candidate = await preparer.prepare(generationInput(modelId, references.map((ref: Context) => ref.reference_handle), prompt));
    const wire = preparer.getPrivateRequest(candidate);
    if (modelId === OMNI) {
      assert.deepEqual(wire.cost_parameters, { duration: "5.50", mode: "hd", version: "4.0", video_duration: 8 });
    } else {
      assert.deepEqual(wire.cost_parameters, { mode: "hd", version: "4.0", video_duration: 8 });
    }
    const principal = ownerPrincipal();
    const permit = await api.createOwnerKling4OneShotPermit({ preparer, candidate, principal, attemptId: ATTEMPT });
    const operation = Object.freeze({ preparer, candidate, permit, referenceService: service, principal,
      attemptId: ATTEMPT, linkService: links, binding: BINDING });
    return { api, client, links, service, preparer, candidate, permit, operation, counts,
      expectedPrompt: privatePrompt, expectedFileUrls: expectedFiles(modelId),
      setHistoryMode(mode) { historyMode = mode; }, advance(milliseconds) { clock += milliseconds; },
      async close() { await preparer.close(); await service.close(); await rm(probe.directory, { recursive: true, force: true }); } };
  } catch (error) {
    await preparer.close(); await service.close(); await rm(probe.directory, { recursive: true, force: true }); throw error;
  }
}

function expectedFiles(modelId: ModelId): readonly { readonly type: "image" | "video"; readonly url: string }[] {
  return modelId === KEYFRAMES
    ? [{ type: "image", url: IMAGE_URL_1 }, { type: "image", url: IMAGE_URL_2 }]
    : [{ type: "image", url: IMAGE_URL_1 }, { type: "video", url: VIDEO_URL }];
}

function expandPrompt(modelId: ModelId, prompt: string): string {
  return modelId === KEYFRAMES
    ? prompt.replace("[[ref:2]]", `<<<${IMAGE_URL_2}>>>`).replace("[[ref:1]]", `<<<${IMAGE_URL_1}>>>`)
    : prompt.replace("[[ref:2]]", `<<<${VIDEO_URL}>>>`).replace("[[ref:1]]", `<<<${IMAGE_URL_1}>>>`);
}

function historyRows(mode: HistoryMode, modelId: ModelId, privatePrompt: string): readonly unknown[] {
  const inputModel = mode === "wrong-input-model" ? "kling_4_omni" : modelId;
  const fileUrls = expectedFiles(modelId);
  const ownerObjects = mode === "absent-input-echo" ? [] : mode === "partial-input-echo" ? [
    { id: "k4-native-owner-text-2145", message_id: "k4-native-owner-ack-2145", object_type: "text", object_text: privatePrompt },
    ...fileUrls.map((file, index) => ({ id: `k4-native-owner-input-${index}-2145`, message_id: "k4-native-owner-ack-2145",
      object_type: file.type, object_url: file.url }))
  ] : [
    { id: "k4-native-owner-text-2145", message_id: "k4-native-owner-ack-2145", object_type: "text", object_text: privatePrompt },
    ...fileUrls.map((file, index) => ({ id: `k4-native-owner-input-${index}-2145`, message_id: "k4-native-owner-ack-2145",
      object_type: file.type, object_url: file.url, model_type: inputModel }))
  ];
  const owner = { id: "k4-native-owner-ack-2145", chat_id: "88145", author_id: 17, message_object: ownerObjects };
  const resultModel = mode === "wrong-result-model" ? (modelId === KEYFRAMES ? OMNI : KEYFRAMES) : modelId;
  const result = resultRow(resultModel, mode !== "incomplete-result");
  if (mode === "extra-owner") {
    const extraId = "k4-native-extra-owner-2145";
    return [owner, { ...owner, id: extraId, message_object: ownerObjects.map((object, index) => ({
      ...object, id: `k4-native-extra-object-${index}-2145`, message_id: extraId
    })) }, result];
  }
  if (mode === "two-pages") return [owner, ...Array.from({ length: 9 }, (_, index) => ({
    id: `k4-native-filler-${index}-2145`, chat_id: "88145", author_id: -1, message_object: []
  })), result];
  return [owner, result];
}

function resultRow(modelId: ModelId, completed = true, includeModel = true, includeText = false) {
  return { id: "k4-native-result-2145", chat_id: "88145", author_id: -1, message_object: [
    ...(includeText ? [{ id: "k4-native-result-text-2145", message_id: "k4-native-result-2145", object_type: "text", object_text: "completed" }] : []),
    { id: "k4-native-result-object-2145", message_id: "k4-native-result-2145", object_type: "video",
      object_url: OUTPUT_URL, completed, ...(includeModel ? { model_type: modelId } : {}) }
  ] };
}

test("native K4 chat/dispatch/history/result binds exact model wire and survives reference TTL", {
  skip: process.platform === "win32" ? "POSIX synthetic ffprobe fixture; Windows probe path NOT_RUN" : false
}, async () => {
  for (const modelId of [KEYFRAMES, OMNI] as const) {
    const flow = await createFlow(modelId);
    try {
      const chat = await flow.client.createOwnerKling4Chat(flow.operation);
      assert.equal(chat.model_id, modelId); assert.equal(chat.dispatch_allowed, false); assert.equal(chat.backend_acceptance, "UNPROVEN");
      assert.equal(JSON.stringify(chat).includes("r2.syntx.ai"), false);
      assert.equal(flow.api.readOwnerKling4NativeDispatchStatus(flow.client, chat)?.phase, "AVAILABLE");
      await assert.rejects(flow.client.createOwnerKling4Chat(flow.operation));
      assert.equal(flow.counts.chat, 1);

      const ack = await flow.client.startOwnerKling4WithOwnedCandidate({ ...flow.operation, chat });
      assert.deepEqual(ack, { chat_uuid: chat.chat_uuid, message_id: "k4-native-owner-ack-2145" });
      assert.equal(flow.api.readOwnerKling4NativeDispatchStatus(flow.client, chat)?.phase, "ACKNOWLEDGED");
      assert.equal(flow.counts.chat, 1); assert.equal(flow.counts.generate, 1);
      await assert.rejects(flow.client.startOwnerKling4WithOwnedCandidate({ ...flow.operation, chat }));
      assert.equal(flow.counts.generate, 1);

      flow.setHistoryMode("two-pages");
      const history = await flow.client.listOwnedKling4Candidates({ ...flow.operation, chat });
      assert.equal(history.owner_ack_status, "MATCHED", JSON.stringify(history)); assert.equal(history.history_page_status, "COMPLETE");
      assert.equal(history.request_echo_status, "MATCHED"); assert.equal(history.history_binding_status, "BOUND");
      assert.equal(history.contexts.length, 1);
      assert.equal(history.history_get_calls, 2);
      assert.equal(JSON.stringify(history).includes("r2.syntx.ai"), false);

      flow.advance(16 * 60_000);
      assert.equal(flow.preparer.inspectCandidate(flow.candidate), undefined);
      const result = await flow.client.getOwnedKling4Result({ result_context: history.contexts[0],
        principal: ownerPrincipal(), attemptId: ATTEMPT, linkService: flow.links, binding: BINDING });
      assert.equal(result.message_binding, "BOUND"); assert.equal(result.model_echo, "MATCHED");
      assert.equal(result.provider_terminal_status, "UNPROVEN");
      assert.equal(result.artifacts[0]?.object_url, OUTPUT_URL);
      assert.equal(flow.counts.result, 1); assert.equal(flow.counts.generate, 1);
    } finally { await flow.close(); }
  }
});

test("unknown K4 GEN POST outcome remains sticky and never dispatches twice", {
  skip: process.platform === "win32" ? "POSIX synthetic ffprobe fixture; Windows probe path NOT_RUN" : false
}, async () => {
  const flow = await createFlow(OMNI, { loseGenerationAck: true });
  try {
    const chat = await flow.client.createOwnerKling4Chat(flow.operation);
    await assert.rejects(flow.client.startOwnerKling4WithOwnedCandidate({ ...flow.operation, chat }));
    assert.equal(flow.api.readOwnerKling4NativeDispatchStatus(flow.client, chat)?.phase, "OUTCOME_UNKNOWN");
    await assert.rejects(flow.client.startOwnerKling4WithOwnedCandidate({ ...flow.operation, chat }));
    assert.equal(flow.counts.generate, 1);
  } finally { await flow.close(); }
});

test("unknown K4 chat creation outcome stays sticky for its one-shot permit", {
  skip: process.platform === "win32" ? "POSIX synthetic ffprobe fixture; Windows probe path NOT_RUN" : false
}, async () => {
  const flow = await createFlow(KEYFRAMES, { loseChatAck: true });
  try {
    await assert.rejects(flow.client.createOwnerKling4Chat(flow.operation));
    assert.equal(flow.counts.chat, 1);
    await assert.rejects(flow.client.createOwnerKling4Chat(flow.operation));
    assert.equal(flow.counts.chat, 1);
  } finally { await flow.close(); }
});

test("owner revocation during generation await leaves the one POST outcome unknown", {
  skip: process.platform === "win32" ? "POSIX synthetic ffprobe fixture; Windows probe path NOT_RUN" : false
}, async () => {
  const flow = await createFlow(OMNI, { revokeDuringGeneration: true });
  try {
    const chat = await flow.client.createOwnerKling4Chat(flow.operation);
    await assert.rejects(flow.client.startOwnerKling4WithOwnedCandidate({ ...flow.operation, chat }));
    assert.equal(flow.api.readOwnerKling4NativeDispatchStatus(flow.client, chat)?.phase, "OUTCOME_UNKNOWN");
    assert.equal(flow.counts.generate, 1);
  } finally { await flow.close(); }
});

test("partial owner media model echo is reported unproven while exact bot K4 result remains bound", {
  skip: process.platform === "win32" ? "POSIX synthetic ffprobe fixture; Windows probe path NOT_RUN" : false
}, async () => {
  const flow = await createFlow(KEYFRAMES);
  try {
    const chat = await flow.client.createOwnerKling4Chat(flow.operation);
    await flow.client.startOwnerKling4WithOwnedCandidate({ ...flow.operation, chat });
    flow.setHistoryMode("partial-input-echo");
    const history = await flow.client.listOwnedKling4Candidates({ ...flow.operation, chat });
    assert.equal(history.status, "COMPLETE");
    assert.equal(history.owner_ack_status, "MATCHED");
    assert.equal(history.request_echo_status, "PARTIAL_UNPROVEN");
    assert.equal(history.history_binding_status, "BOUND");
    assert.equal(history.contexts.length, 1);
    assert.equal(history.backend_acceptance, "UNPROVEN");
  } finally { await flow.close(); }
});

test("result GET with a missing video model echo yields no artifact and no matched model claim", {
  skip: process.platform === "win32" ? "POSIX synthetic ffprobe fixture; Windows probe path NOT_RUN" : false
}, async () => {
  const flow = await createFlow(OMNI, { missingResultModel: true });
  try {
    const chat = await flow.client.createOwnerKling4Chat(flow.operation);
    await flow.client.startOwnerKling4WithOwnedCandidate({ ...flow.operation, chat });
    const history = await flow.client.listOwnedKling4Candidates({ ...flow.operation, chat });
    assert.equal(history.contexts.length, 1);
    const result = await flow.client.getOwnedKling4Result({ result_context: history.contexts[0], principal: ownerPrincipal(),
      attemptId: ATTEMPT, linkService: flow.links, binding: BINDING });
    assert.equal(result.model_echo, "UNKNOWN");
    assert.equal(result.message_binding, "UNVERIFIED");
    assert.deepEqual(result.artifacts, []);
    assert.deepEqual(result.gaps, ["MODEL_ECHO_MISSING"]);
    assert.equal(result.provider_terminal_status, "UNPROVEN");
  } finally { await flow.close(); }
});

test("result GET ignores unrelated text objects while binding the expected completed video", {
  skip: process.platform === "win32" ? "POSIX synthetic ffprobe fixture; Windows probe path NOT_RUN" : false
}, async () => {
  const flow = await createFlow(OMNI, { extraResultText: true });
  try {
    const chat = await flow.client.createOwnerKling4Chat(flow.operation);
    await flow.client.startOwnerKling4WithOwnedCandidate({ ...flow.operation, chat });
    const history = await flow.client.listOwnedKling4Candidates({ ...flow.operation, chat });
    const result = await flow.client.getOwnedKling4Result({ result_context: history.contexts[0], principal: ownerPrincipal(),
      attemptId: ATTEMPT, linkService: flow.links, binding: BINDING });
    assert.equal(result.message_binding, "BOUND");
    assert.equal(result.model_echo, "MATCHED");
    assert.equal(result.artifacts.length, 1);
    assert.equal(result.artifacts[0]?.object_index, 1);
    assert.equal(result.artifacts[0]?.object_type, "video");
  } finally { await flow.close(); }
});

test("history join rejects contradictory model echo and incomplete pagination", {
  skip: process.platform === "win32" ? "POSIX synthetic ffprobe fixture; Windows probe path NOT_RUN" : false
}, async () => {
  for (const mode of ["wrong-input-model", "wrong-result-model", "incomplete-result", "absent-input-echo", "changed-page", "extra-owner"] as const) {
    const flow = await createFlow(KEYFRAMES);
    try {
      const chat = await flow.client.createOwnerKling4Chat(flow.operation);
      await flow.client.startOwnerKling4WithOwnedCandidate({ ...flow.operation, chat });
      flow.setHistoryMode(mode);
      const history = await flow.client.listOwnedKling4Candidates({ ...flow.operation, chat });
      assert.notEqual(history.status, "COMPLETE", `mode=${mode}`);
      assert.equal(history.backend_acceptance, "UNPROVEN");
    } finally { await flow.close(); }
  }
});

test("native exports reject forged packets, proxied contexts, and forged clients without dispatch", {
  skip: process.platform === "win32" ? "POSIX synthetic ffprobe fixture; Windows probe path NOT_RUN" : false
}, async () => {
  const flow = await createFlow(KEYFRAMES);
  try {
    await assert.rejects(flow.api.createOwnerKling4NativeChat(flow.operation, Object.freeze({})),
      (error: unknown) => error instanceof flow.api.OwnerKling4NativeError && error.code === "INVALID_REQUEST");
    assert.equal(flow.counts.chat, 0);
    let getterCalls = 0;
    const getterInput = Object.defineProperty({ ...flow.operation }, "attemptId", {
      enumerable: true, configurable: true, get() { getterCalls += 1; return ATTEMPT; }
    });
    await assert.rejects(flow.client.createOwnerKling4Chat(getterInput));
    assert.equal(getterCalls, 0);
    assert.equal(flow.api.readOwnerKling4NativeDispatchStatus({} as SyntxChatHttpClient, {}), null);
    assert.equal(flow.api.readOwnerKling4NativeDispatchStatus(flow.client, new Proxy({}, {})), null);

    const chat = await flow.client.createOwnerKling4Chat(flow.operation);
    assert.notEqual(flow.api.readOwnerKling4NativeDispatchStatus(flow.client, chat), null);
    Object.defineProperty(flow.client, "startOwnerKling4WithOwnedCandidate", { value: () => undefined, configurable: true });
    assert.equal(flow.api.readOwnerKling4NativeDispatchStatus(flow.client, chat), null);

    class SubclassClient extends SyntxChatHttpClient {}
    const subclass = new SubclassClient({ credentialBroker: { async useCredential<T>(use: (credential: string) => Promise<T>) {
      return use("unused-subclass-token");
    } }, fetchImpl: async () => jsonResponse({}) });
    await assert.rejects(subclass.createOwnerKling4Chat(flow.operation));
    assert.equal(flow.counts.chat, 1);
  } finally { await flow.close(); }
});
