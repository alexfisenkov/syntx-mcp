import assert from "node:assert/strict";
import { chmod, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { resolveOwnerReferencePrincipal } from "../src/auth/owner-reference-principal.js";
import { OwnerWan27VideoEditReferenceService } from "../src/application/owner-wan27-videoedit-reference-service.js";
import { createOwnerWan27VideoEditRequestPreparer } from "../src/application/owner-wan27-videoedit-request-preparer.js";
import {
  createOwnerWan27VideoEditOneShotPermit
} from "../src/application/owner-wan27-videoedit-one-shot-policy.js";
import * as importedNative from "../src/adapter/syntx/owner-wan27-videoedit-native-context.js";
import { minimalWan27Mp4Header, wan27VideoEditProbeFixture } from "./helpers/wan27-videoedit-fixtures-2163.js";

const BINDING_BASE = Object.freeze({ tenant_id: "wan27-videoedit-native-2170", subject: "synthetic-owner" });
const CHAT_UUID = "88170";
const OWNER_ACK = "wan27-videoedit-owner-ack-2170";
const RESULT_MESSAGE = "wan27-videoedit-result-message-2170";
const RESULT_OBJECT = "wan27-videoedit-result-object-2170";
const OUTPUT_URL = "https://r2.syntx.ai/wan27-videoedit-output/result.mp4";
let flowSequence = 0;

type Row = Readonly<Record<string, unknown>>;
type NativeName = "createOwnerWan27VideoEditChat" | "startOwnerWan27VideoEditWithOwnedCandidate" |
  "listOwnedWan27VideoEditCandidates" | "getOwnedWan27VideoEditResult";
type NativeExportName = "createOwnerWan27VideoEditNativeChat" | "startOwnerWan27VideoEditWithOwnedCandidate" |
  "listOwnerWan27VideoEditNativeCandidates" | "getOwnerWan27VideoEditNativeResult";
interface NativeApi {
  readonly OwnerWan27VideoEditNativeError: new (code: string) => Error & { readonly code: string };
  readOwnerWan27VideoEditNativeDispatchStatus(client: unknown, chat: unknown): Row | null;
}
interface NativeFlow {
  readonly api: NativeApi;
  readonly client: SyntxChatHttpClient;
  readonly links: PerUserLinkService;
  readonly service: OwnerWan27VideoEditReferenceService;
  readonly preparer: ReturnType<typeof createOwnerWan27VideoEditRequestPreparer>;
  readonly candidate: Row;
  readonly operation: Row;
  readonly principal: Readonly<{ tenant_id: string; subject_id: string; connection_id: string }>;
  readonly attemptId: string;
  readonly counts: { upload: number; chat: number; generate: number; history: number; result: number };
  readonly expectedPrompt: string;
  readonly expectedFiles: readonly Readonly<{ type: "image" | "video"; url: string }> [];
  advance(milliseconds: number): void;
  setHistoryMode(mode: "full" | "partial"): void;
  close(): Promise<void>;
}

function requireNativeApi(): NativeApi {
  const api = importedNative as unknown as NativeApi & Record<NativeExportName, unknown>;
  for (const name of ["createOwnerWan27VideoEditNativeChat", "startOwnerWan27VideoEditWithOwnedCandidate",
    "listOwnerWan27VideoEditNativeCandidates", "getOwnerWan27VideoEditNativeResult"] as const) {
    assert.equal(typeof api[name], "function", `native context exports ${name}`);
  }
  return api;
}

function invoke(client: SyntxChatHttpClient, name: NativeName, input: unknown): Promise<Row> {
  const method = Reflect.get(client, name);
  assert.equal(typeof method, "function", `SyntxChatHttpClient exposes ${name}`);
  return Reflect.apply(method as unknown as (...args: unknown[]) => Promise<Row>, client, [input]) as Promise<Row>;
}

function png(width = 240, height = 240): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const name = Buffer.from(type, "ascii"), body = Buffer.concat([name, data]);
    let crc = 0xffff_ffff;
    for (const byte of body) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); }
    const size = Buffer.alloc(4), checksum = Buffer.alloc(4);
    size.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffff_ffff) >>> 0);
    return Buffer.concat([size, body, checksum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header),
    chunk("IDAT", Buffer.from([120, 156, 99, 0, 0, 0, 2, 0, 1])), chunk("IEND", Buffer.alloc(0))]);
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

async function makeProbe(): Promise<{ readonly directory: string; readonly path: string }> {
  const directory = await mkdtemp(join(tmpdir(), "wan27-videoedit-native-2170-"));
  const interpreter = join(directory, "node"), path = join(directory, "ffprobe-fixture");
  await symlink(process.execPath, interpreter);
  await writeFile(path, `#!${interpreter}\nprocess.stdout.write(${JSON.stringify(wan27VideoEditProbeFixture())});\n`,
    { encoding: "utf8", mode: 0o700, flag: "wx" });
  await chmod(path, 0o700);
  return { directory, path: await realpath(path) };
}

async function createFlow(options: { readonly loseGenerationAck?: boolean } = {}): Promise<NativeFlow> {
  const api = requireNativeApi();
  const id = ++flowSequence;
  const attemptId = `link_wan27_videoedit_native_2170_${id.toString().padStart(4, "0")}`;
  const binding = Object.freeze({ tenant_id: `${BINDING_BASE.tenant_id}-${id}`, subject: BINDING_BASE.subject });
  let clock = 1_000_000;
  let historyMode: "full" | "partial" = "full";
  const now = () => clock;
  const counts = { upload: 0, chat: 0, generate: 0, history: 0, result: 0 };
  const imageUrl = `https://r2.syntx.ai/wan27videoedit-${id}/anchor.png`;
  const videoUrl = `https://r2.syntx.ai/wan27videoedit-${id}/source.mp4`;
  const expectedPrompt = `Preserve this exact prompt literal for local native flow ${id}.`;
  const expectedFiles = Object.freeze([{ type: "image" as const, url: imageUrl }, { type: "video" as const, url: videoUrl }]);
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: `wan27-videoedit-native-${id}`, approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_challengeId, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: `synthetic-wan27-videoedit-${id}` });
      return { state: "LINKED" };
    }
  };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(now), { now,
    defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => attemptId });
  await links.createAttempt(binding); await links.issueHandoff(binding, attemptId); await links.checkAttempt(binding, attemptId);

  const probe = await makeProbe();
  const client = new SyntxChatHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      return links.useCredential(binding, attemptId, (credential) => operation(credential.value));
    } },
    fetchImpl: async (request, init = {}) => {
      const url = new URL(request instanceof Request ? request.url : String(request));
      const method = init.method ?? "GET";
      if (method === "POST" && url.pathname === "/api/v1/chats/upload-files") {
        counts.upload += 1;
        const form = init.body as FormData;
        assert.deepEqual([...form.keys()], ["files", "destination", "check_duplicates", "model_type"]);
        assert.equal(form.get("destination"), "uploaded"); assert.equal(form.get("check_duplicates"), "true");
        assert.equal(form.get("model_type"), "wan_27_videoedit");
        const file = form.get("files"); assert.ok(file instanceof File);
        assert.equal(file.type === "image/png" || file.type === "video/mp4", true);
        return jsonResponse({ files: [{ id: `wan27-videoedit-upload-${id}-${counts.upload}`,
          url: file.type === "image/png" ? imageUrl : videoUrl, filename: file.name,
          mime_type: file.type, size: file.size, status: "uploaded" }] });
      }
      if (method === "POST" && url.pathname === "/api/v1/chats") {
        counts.chat += 1;
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        assert.deepEqual(Object.keys(body).sort(), ["scope", "title"]);
        assert.equal(body.scope, "video");
        assert.match(String(body.title), /^owner-wan27-videoedit-/u);
        return jsonResponse({ uuid: CHAT_UUID });
      }
      if (method === "POST" && url.pathname === "/api/v1/video/generate") {
        counts.generate += 1;
        assert.equal(url.search, "?ai_name=wan_video");
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        assert.deepEqual(Object.keys(body).sort(), ["chat_id", "prompt", "settings"]);
        assert.equal(body.chat_id, CHAT_UUID); assert.equal(body.prompt, expectedPrompt);
        assert.deepEqual(body.settings, {
          model_type: "wan_27_videoedit", resolution: "1080P", aspect_ratio: "9:16",
          video_duration: 3, audio_setting: "origin", prompt_extend: true, seed: 0,
          native_audio: false, shot_type: "single", duration: 4.25, rendering_speed: "basic",
          file_urls: expectedFiles
        });
        if (options.loseGenerationAck) return jsonResponse({});
        return jsonResponse({ id: OWNER_ACK });
      }
      if (method === "GET" && url.pathname === `/api/v1/chats/${CHAT_UUID}/messages`) {
        counts.history += 1;
        const page = Number(url.searchParams.get("page")), pageSize = Number(url.searchParams.get("page_size"));
        assert.equal(page, counts.history); assert.equal(pageSize, 10);
        const echoObjects = [
          { id: `owner-text-${id}`, message_id: OWNER_ACK, object_type: "text", object_text: expectedPrompt },
          { id: `owner-image-${id}`, message_id: OWNER_ACK, object_type: "image", object_url: imageUrl,
            model_type: "wan_27_videoedit" },
          { id: `owner-video-${id}`, message_id: OWNER_ACK, object_type: "video", object_url: videoUrl,
            ...(historyMode === "full" ? { model_type: "wan_27_videoedit" } : {}) }
        ];
        const rows = [
          { id: OWNER_ACK, chat_id: 88170, author_id: 17, message_object: echoObjects },
          { id: RESULT_MESSAGE, chat_id: 88170, author_id: -1, message_object: [
            { id: RESULT_OBJECT, message_id: RESULT_MESSAGE, object_type: "video", model_type: "wan_27_videoedit",
              completed: true, object_url: OUTPUT_URL }
          ] }
        ];
        return jsonResponse({ messages: rows, pagination: { page, page_size: pageSize, total_count: rows.length,
          total_pages: 1, has_next: false, has_previous: false } });
      }
      if (method === "GET" && url.pathname === `/api/v1/chats/${CHAT_UUID}/${RESULT_MESSAGE}`) {
        counts.result += 1;
        return jsonResponse({ id: RESULT_MESSAGE, chat_id: 88170, author_id: -1, message_object: [
          { id: RESULT_OBJECT, message_id: RESULT_MESSAGE, object_type: "video", model_type: "wan_27_videoedit",
            completed: true, object_url: OUTPUT_URL }
        ] });
      }
      throw new Error(`unexpected synthetic request ${method} ${url.pathname}`);
    },
    requestTimeoutMs: 1_000
  });

  const service = new OwnerWan27VideoEditReferenceService({ binding, linkService: links,
    resolveClient: () => client, ffprobePath: probe.path, now });
  const preparer = createOwnerWan27VideoEditRequestPreparer({ referenceService: service, now });
  try {
    const imageReceipt = await service.uploadReference({ attemptId, model_id: "wan_27_videoedit", filename: "anchor.png",
      mime_type: "image/png", bytes: png() });
    const videoReceipt = await service.uploadReference({ attemptId, model_id: "wan_27_videoedit", filename: "source.mp4",
      mime_type: "video/mp4", bytes: minimalWan27Mp4Header() });
    const generationInput = {
      attemptId, model_id: "wan_27_videoedit", prompt: expectedPrompt,
      resolution: "1080P", aspect_ratio: "9:16", audio_setting: "origin", prompt_extend: true, seed: 0,
      duration_mode: "custom", custom_video_duration: 3,
      reference_handles: [imageReceipt.reference_handle, videoReceipt.reference_handle]
    } as const;
    const candidate = await preparer.prepare(generationInput);
    const principal = await resolveOwnerReferencePrincipal({ binding, attemptId, linkService: links });
    const permit = await createOwnerWan27VideoEditOneShotPermit({ preparer, candidate, principal, attemptId });
    const operation = Object.freeze({ preparer, candidate, permit, referenceService: service,
      principal, attemptId, linkService: links, binding });
    return {
      api, client, links, service, preparer, candidate: candidate as unknown as Row, operation,
      principal, attemptId, counts, expectedPrompt, expectedFiles,
      advance(milliseconds) { clock += milliseconds; },
      setHistoryMode(mode) { historyMode = mode; },
      async close() {
        await preparer.close(); await service.close();
        try { await links.revoke(binding, attemptId); } catch { /* already invalidated */ }
        await rm(probe.directory, { recursive: true, force: true });
      }
    };
  } catch (error) {
    await preparer.close(); await service.close(); await rm(probe.directory, { recursive: true, force: true });
    throw error;
  }
}

function nativeWithChat(flow: NativeFlow, chat: Row): Row { return Object.freeze({ ...flow.operation, chat }); }

test("creates and dispatches one native target chat, binds ordered history and reads the same-model video", async () => {
  const api = requireNativeApi();
  const flow = await createFlow();
  try {
    const chat = await invoke(flow.client, "createOwnerWan27VideoEditChat", flow.operation);
    assert.equal(chat.status, "created"); assert.equal(chat.model_id, "wan_27_videoedit");
    assert.equal(chat.profile_sha256, flow.candidate.profile_sha256);
    assert.equal(chat.dispatch_allowed, false); assert.equal(chat.backend_acceptance, "UNPROVEN");
    assert.equal(JSON.stringify(chat).includes("r2.syntx.ai"), false);
    assert.equal(api.readOwnerWan27VideoEditNativeDispatchStatus(flow.client, chat)?.phase, "AVAILABLE");
    await assert.rejects(invoke(flow.client, "createOwnerWan27VideoEditChat", flow.operation));
    assert.equal(flow.counts.chat, 1);

    const ack = await invoke(flow.client, "startOwnerWan27VideoEditWithOwnedCandidate", nativeWithChat(flow, chat));
    assert.deepEqual(ack, { chat_uuid: CHAT_UUID, message_id: OWNER_ACK });
    assert.equal(flow.counts.generate, 1);
    assert.equal(api.readOwnerWan27VideoEditNativeDispatchStatus(flow.client, chat)?.phase, "ACKNOWLEDGED");

    const candidates = await invoke(flow.client, "listOwnedWan27VideoEditCandidates", nativeWithChat(flow, chat));
    assert.equal(candidates.status, "COMPLETE");
    assert.equal(candidates.owner_ack_status, "MATCHED");
    assert.equal(candidates.request_echo_status, "MATCHED");
    assert.equal(candidates.history_binding_status, "BOUND");
    const contexts = candidates.contexts as unknown[];
    assert.equal(contexts.length, 1);
    assert.equal(candidates.backend_acceptance, "UNPROVEN");

    const result = await invoke(flow.client, "getOwnedWan27VideoEditResult", {
      result_context: contexts[0], principal: flow.principal, attemptId: flow.attemptId,
      linkService: flow.links, binding: (flow.operation as Record<string, unknown>).binding
    });
    assert.equal(result.message_binding, "BOUND"); assert.equal(result.model_echo, "MATCHED");
    assert.equal(result.provider_terminal_status, "UNPROVEN");
    assert.deepEqual(result.artifacts, [{ object_index: 0, message_object_id: RESULT_OBJECT, object_type: "video",
      object_url: OUTPUT_URL, mime_type: "video/mp4", mime_source: "URL_EXTENSION" }]);
    assert.equal(flow.counts.result, 1);
  } finally { await flow.close(); }
});

test("does not create a chat from forged candidates or a foreign principal", async () => {
  const api = requireNativeApi();
  const flow = await createFlow();
  try {
    const forgedCandidate = Object.freeze({ ...flow.candidate });
    await assert.rejects(invoke(flow.client, "createOwnerWan27VideoEditChat", {
      ...(flow.operation as Record<string, unknown>), candidate: forgedCandidate
    }));
    const foreignPrincipal = Object.freeze({ ...flow.principal, connection_id: "link_wan27_videoedit_foreign_2170" });
    await assert.rejects(invoke(flow.client, "createOwnerWan27VideoEditChat", {
      ...(flow.operation as Record<string, unknown>), principal: foreignPrincipal
    }));
    assert.equal(flow.counts.chat, 0);
    assert.equal(api.readOwnerWan27VideoEditNativeDispatchStatus(flow.client, forgedCandidate), null);
  } finally { await flow.close(); }
});

test("keeps a lost generation acknowledgment sticky and never starts a second POST", async () => {
  const api = requireNativeApi();
  const flow = await createFlow({ loseGenerationAck: true });
  try {
    const chat = await invoke(flow.client, "createOwnerWan27VideoEditChat", flow.operation);
    await assert.rejects(invoke(flow.client, "startOwnerWan27VideoEditWithOwnedCandidate", nativeWithChat(flow, chat)),
      (error: unknown) => error instanceof api.OwnerWan27VideoEditNativeError && error.code === "OUTCOME_UNKNOWN");
    assert.equal(api.readOwnerWan27VideoEditNativeDispatchStatus(flow.client, chat)?.phase, "OUTCOME_UNKNOWN");
    const history = await invoke(flow.client, "listOwnedWan27VideoEditCandidates", nativeWithChat(flow, chat));
    assert.equal((history.gaps as string[]).includes("POST_ACK_UNAVAILABLE"), true);
    assert.equal(flow.counts.history, 0, "unknown POST without an owner ACK never gets a history-based recovery");
    await assert.rejects(invoke(flow.client, "startOwnerWan27VideoEditWithOwnedCandidate", nativeWithChat(flow, chat)));
    assert.equal(flow.counts.generate, 1);
  } finally { await flow.close(); }
});

test("labels partial ordered request echo as unproven and does not mint a result context", async () => {
  requireNativeApi();
  const flow = await createFlow();
  try {
    const chat = await invoke(flow.client, "createOwnerWan27VideoEditChat", flow.operation);
    await invoke(flow.client, "startOwnerWan27VideoEditWithOwnedCandidate", nativeWithChat(flow, chat));
    flow.setHistoryMode("partial");
    const candidates = await invoke(flow.client, "listOwnedWan27VideoEditCandidates", nativeWithChat(flow, chat));
    assert.equal(candidates.owner_ack_status, "MATCHED");
    assert.equal(candidates.request_echo_status, "PARTIAL_UNPROVEN");
    assert.equal(candidates.status, "UNVERIFIED");
    assert.equal((candidates.contexts as unknown[]).length, 0);
    assert.equal(flow.counts.result, 0);
  } finally { await flow.close(); }
});

test("uses GET-only history and result after the reference/preparer TTL expires", async () => {
  requireNativeApi();
  const flow = await createFlow();
  try {
    const chat = await invoke(flow.client, "createOwnerWan27VideoEditChat", flow.operation);
    await invoke(flow.client, "startOwnerWan27VideoEditWithOwnedCandidate", nativeWithChat(flow, chat));
    flow.advance(15 * 60_000 + 1);
    const candidates = await invoke(flow.client, "listOwnedWan27VideoEditCandidates", nativeWithChat(flow, chat));
    assert.equal(candidates.request_echo_status, "MATCHED");
    const contexts = candidates.contexts as unknown[];
    assert.equal(contexts.length, 1);
    const result = await invoke(flow.client, "getOwnedWan27VideoEditResult", {
      result_context: contexts[0], principal: flow.principal, attemptId: flow.attemptId,
      linkService: flow.links, binding: (flow.operation as Record<string, unknown>).binding
    });
    assert.equal(result.message_binding, "BOUND");
    assert.equal(flow.counts.upload, 2); assert.equal(flow.counts.generate, 1);
    assert.equal(flow.counts.history, 1); assert.equal(flow.counts.result, 1);
  } finally { await flow.close(); }
});
