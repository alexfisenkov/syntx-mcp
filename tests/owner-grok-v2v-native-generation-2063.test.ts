import assert from "node:assert/strict";
import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import {
  OwnerGrokV2vNativeError,
  readOwnerGrokV2vNativeDispatchStatus,
  type OwnerGrokV2vNativeOperationInput
} from "../src/adapter/syntx/owner-grok-v2v-native-context.js";
import { OwnerGrokV2vOriginalReferenceService } from "../src/application/owner-grok-v2v-original-reference-service.js";
import {
  createOwnerGrokV2vOwnedOneShotPermit,
  type OwnerGrokV2vOwnedOneShotPermit
} from "../src/application/owner-grok-v2v-owned-one-shot-policy.js";
import {
  createOwnerGrokV2vOwnedRequestPreparer,
  type OwnerGrokV2vOwnedPreparedCandidate,
  type OwnerGrokV2vOwnedRequestPreparer
} from "../src/application/owner-grok-v2v-owned-request-preparer.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { OBSERVED_AUTHORIZATION_PROFILE, type AuthBinding, type AuthLinkProvider } from "../src/auth/types.js";

const ATTEMPT = "link_grok_v2v_native_2063_0123456789";
const BINDING: AuthBinding = Object.freeze({ tenant_id: "grok-v2v-native-2063", subject: "synthetic-owner" });
const PROMPT = "Use the uploaded shot as temporal motion context.";
const SOURCE_URL = "https://r2.syntx.ai/grok-v2v/hidden/original.mp4";
const OUTPUT_URL = "https://r2.syntx.ai/grok-v2v/results/output.mp4";
const PROBE_JSON = JSON.stringify({ streams: [
  { index: 0, codec_type: "video", codec_name: "h264", width: 672, height: 610,
    duration: "3.14159", disposition: { attached_pic: 0 } },
  { index: 1, codec_type: "audio", codec_name: "aac", duration: "3.10" }
], format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "3.14159" } });

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function mediaBytes(): Uint8Array {
  const bytes = new Uint8Array(28), view = new DataView(bytes.buffer);
  view.setUint32(0, 20); bytes.set(new TextEncoder().encode("ftypisom"), 4);
  view.setUint32(12, 0); bytes.set(new TextEncoder().encode("mp41"), 16);
  view.setUint32(20, 8); bytes.set(new TextEncoder().encode("mdat"), 24);
  return bytes;
}

async function ffprobeFixture(): Promise<{ directory: string; binary: string }> {
  const directory = await mkdtemp(join(tmpdir(), "syntx-grok-v2v-native-2063-"));
  const binary = join(directory, "ffprobe-fixture");
  const script = `#!/bin/sh\nfor arg do last=$arg; done\n[ -f "$last" ] || exit 41\nprintf '%s' '${PROBE_JSON}'\n`;
  await writeFile(binary, script, { mode: 0o700, flag: "wx" });
  await chmod(binary, 0o700);
  return { directory, binary: await realpath(binary) };
}

function ownerPrincipal(connectionId = ATTEMPT) {
  return { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: connectionId } as const;
}

interface NativeFlow {
  readonly client: SyntxChatHttpClient;
  readonly links: PerUserLinkService;
  readonly referenceService: OwnerGrokV2vOriginalReferenceService;
  readonly preparer: OwnerGrokV2vOwnedRequestPreparer;
  readonly candidate: OwnerGrokV2vOwnedPreparedCandidate;
  readonly permit: OwnerGrokV2vOwnedOneShotPermit;
  readonly operation: Readonly<OwnerGrokV2vNativeOperationInput>;
  readonly counts: { upload: number; chat: number; generate: number; history: number; result: number; credentials: number };
  cleanup(): Promise<void>;
}

async function createFlow(options: { loseGenerationAck?: boolean; foreignBinding?: boolean; prompt?: string; additionalOwnerRequest?: string } = {}): Promise<NativeFlow> {
  const fixture = await ffprobeFixture();
  const prompt = options.prompt ?? PROMPT;
  const clock = { value: 1_000_000 }, now = () => clock.value;
  const provider: AuthLinkProvider = {
    authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() { return { upstream_attempt_id: "synthetic-grok-v2v-native", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: "synthetic-grok-v2v-native-token" });
      return { state: "LINKED" };
    }
  };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(now), {
    now, defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => ATTEMPT
  });
  const created = await links.createAttempt(BINDING);
  await links.issueHandoff(BINDING, created.attempt_id);
  await links.checkAttempt(BINDING, created.attempt_id);
  const counts = { upload: 0, chat: 0, generate: 0, history: 0, result: 0, credentials: 0 };
  const chatUuid = "grok-v2v-native-chat-2063";
  const ackId = "grok-v2v-native-owner-ack-2063";
  const resultMessageId = "grok-v2v-native-result-2063";
  const ownerRow = Object.freeze({ id: ackId, chat_id: 88103, author_id: 17, message_object: [
    { id: "grok-v2v-native-text-2063", message_id: ackId, object_type: "text", object_text: prompt },
    { id: "grok-v2v-native-input-2063", message_id: ackId, object_type: "video", object_url: SOURCE_URL, model_type: "grok_v2v" }
  ] });
  const additionalOwnerRow = options.additionalOwnerRequest === undefined ? undefined : Object.freeze({
    id: "grok-v2v-native-extra-owner-request-2068", chat_id: 88103, author_id: 17, message_object: [
      { id: "grok-v2v-native-extra-owner-text-2068", message_id: "grok-v2v-native-extra-owner-request-2068",
        object_type: "text", object_text: options.additionalOwnerRequest },
      { id: "grok-v2v-native-extra-owner-input-2068", message_id: "grok-v2v-native-extra-owner-request-2068",
        object_type: "video", object_url: SOURCE_URL, model_type: "grok_v2v" }
    ]
  });
  const resultRow = Object.freeze({ id: resultMessageId, chat_id: 88103, author_id: -1, message_object: [
    { id: "grok-v2v-native-output-2063", message_id: resultMessageId, object_type: "video",
      object_url: OUTPUT_URL, completed: true, model_type: "grok_v2v" }
  ] });
  const historyRows = Object.freeze([ownerRow, ...(additionalOwnerRow ? [additionalOwnerRow] : []), resultRow]);
  const source = mediaBytes();
  const client = new SyntxChatHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      counts.credentials += 1;
      return links.useCredential(BINDING, ATTEMPT, (credential) => operation(credential.value));
    } },
    fetchImpl: async (request, init = {}) => {
      const url = new URL(request instanceof Request ? request.url : String(request));
      const method = init.method ?? "GET";
      if (url.pathname === "/api/v1/chats/upload-files" && method === "POST") {
        counts.upload += 1;
        const form = init.body as FormData;
        assert.deepEqual(Array.from(form.keys()), ["files", "destination", "check_duplicates", "model_type"]);
        assert.equal(form.get("destination"), "hidden");
        assert.equal(form.get("check_duplicates"), "true");
        assert.equal(form.get("model_type"), "grok_v2v");
        const file = form.get("files");
        assert.ok(file instanceof File);
        assert.equal(file.name, "original.mp4");
        assert.equal(file.type, "video/mp4");
        assert.deepEqual(new Uint8Array(await file.arrayBuffer()), source);
        return response({ files: [{ url: SOURCE_URL, filename: "original.mp4", status: "success",
          size: source.byteLength, content_type: "video/mp4" }] });
      }
      if (url.pathname === "/api/v1/chats" && method === "POST") {
        counts.chat += 1;
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        assert.deepEqual(Object.keys(body).sort(), ["scope", "title"]);
        assert.equal(body.scope, "video");
        assert.equal(typeof body.title, "string");
        assert.match(body.title as string, /^owner-grok-v2v-/u);
        return response({ uuid: chatUuid });
      }
      if (url.pathname === "/api/v1/video/generate" && method === "POST") {
        counts.generate += 1;
        assert.equal(url.search, "?ai_name=grok_video");
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        assert.deepEqual(Object.keys(body).sort(), ["chat_id", "prompt", "settings"]);
        assert.equal(body.chat_id, chatUuid);
        assert.equal(body.prompt, prompt);
        const settings = body.settings as Record<string, unknown>;
        assert.deepEqual(Object.keys(settings).sort(), ["aspect_ratio", "file_urls", "model_type", "resolution", "video_duration"]);
        assert.equal(settings.model_type, "grok_v2v");
        assert.equal(settings.aspect_ratio, null);
        assert.equal(settings.video_duration, 3.14);
        assert.equal(settings.resolution, "720p");
        assert.deepEqual(settings.file_urls, [{ type: "video", url: SOURCE_URL }]);
        assert.equal("duration_seconds" in settings, false);
        assert.equal("width" in settings, false);
        assert.equal("height" in settings, false);
        if (options.loseGenerationAck) throw new Error("synthetic lost generation acknowledgment");
        return response({ id: ackId });
      }
      if (url.pathname === `/api/v1/chats/${chatUuid}/messages` && method === "GET") {
        counts.history += 1;
        assert.equal(url.searchParams.get("page"), "1");
        assert.equal(url.searchParams.get("page_size"), "10");
        return response({ messages: historyRows, pagination: { page: 1, page_size: 10,
          total_count: historyRows.length, total_pages: 1, has_next: false, has_previous: false } });
      }
      if (url.pathname === `/api/v1/chats/${chatUuid}/${resultMessageId}` && method === "GET") {
        counts.result += 1;
        return response(resultRow);
      }
      throw new Error(`unexpected synthetic route ${method} ${url.pathname}`);
    }
  });
  const referenceService = new OwnerGrokV2vOriginalReferenceService({ ffprobePath: fixture.binary, destination: "hidden",
    binding: BINDING, linkService: links, resolveClient: () => client, now });
  const preparer = createOwnerGrokV2vOwnedRequestPreparer({ referenceService, now });
  try {
    const upload = await referenceService.uploadReference({ attemptId: ATTEMPT, model_id: "grok_v2v",
      filename: "original.mp4", mime_type: "video/mp4", bytes: source });
    const candidate = await preparer.prepare({ attemptId: ATTEMPT,
      request: { model_id: "grok_v2v", prompt, grok_reference_handle: upload.grok_reference_handle } });
    const principal = ownerPrincipal();
    const permit = await createOwnerGrokV2vOwnedOneShotPermit({ preparer, candidate, principal, attemptId: ATTEMPT });
    const operation: Readonly<OwnerGrokV2vNativeOperationInput> = Object.freeze({ preparer, candidate, permit,
      referenceService, principal, attemptId: ATTEMPT, linkService: links,
      binding: options.foreignBinding ? { tenant_id: "foreign-tenant", subject: BINDING.subject } : BINDING });
    return { client, links, referenceService, preparer, candidate, permit, operation, counts,
      async cleanup() { source.fill(0); await preparer.close(); await referenceService.close(); await rm(fixture.directory, { recursive: true, force: true }); } };
  } catch (error) {
    source.fill(0);
    await preparer.close();
    await referenceService.close();
    await rm(fixture.directory, { recursive: true, force: true });
    throw error;
  }
}

test("Grok V2V uses one measured upload, exact video settings, bound owner ACK, history page, and result read", {
  skip: process.platform === "win32" ? "POSIX fake-ffprobe fixture; Windows native probe path NOT_RUN" : false
}, async () => {
  const flow = await createFlow();
  try {
    assert.equal(flow.counts.upload, 1);
    const chat = await flow.client.createOwnerGrokV2vChat(flow.operation);
    assert.equal(chat.model_id, "grok_v2v");
    assert.equal(chat.dispatch_allowed, false);
    assert.equal(chat.backend_acceptance, "UNPROVEN");
    assert.equal(JSON.stringify(chat).includes(SOURCE_URL), false);
    assert.equal(JSON.stringify(chat).includes(PROMPT), false);
    assert.equal(readOwnerGrokV2vNativeDispatchStatus(flow.client, chat)?.phase, "AVAILABLE");

    const start = await flow.client.startGrokV2vWithOwnedCandidate({ ...flow.operation, chat });
    assert.deepEqual(start, { chat_uuid: chat.chat_uuid, message_id: "grok-v2v-native-owner-ack-2063" });
    assert.equal(readOwnerGrokV2vNativeDispatchStatus(flow.client, chat)?.phase, "ACKNOWLEDGED");
    assert.equal(flow.counts.chat, 1);
    assert.equal(flow.counts.generate, 1);
    assert.equal(flow.counts.credentials, 3);

    const history = await flow.client.listOwnedGrokV2vCandidates({ ...flow.operation, chat });
    assert.equal(history.owner_ack_status, "MATCHED");
    assert.equal(history.request_echo_status, "MATCHED");
    assert.equal(history.history_page_status, "COMPLETE");
    assert.equal(history.history_get_calls, 1);
    assert.equal(history.contexts.length, 1);
    assert.equal(JSON.stringify(history).includes(SOURCE_URL), false);
    assert.equal(JSON.stringify(history.contexts[0]).includes(PROMPT), false);
    assert.equal(JSON.stringify(history.contexts[0]).includes(SOURCE_URL), false);

    const result = await flow.client.getOwnedGrokV2vResult({ result_context: history.contexts[0]!,
      principal: ownerPrincipal(), attemptId: ATTEMPT, linkService: flow.links, binding: BINDING });
    assert.equal(result.message_binding, "BOUND");
    assert.equal(result.model_echo, "MATCHED");
    assert.equal(result.provider_terminal_status, "UNPROVEN");
    assert.equal(result.artifacts.length, 1);
    assert.equal(result.artifacts[0]?.object_url, OUTPUT_URL);
    assert.equal(flow.counts.history, 1);
    assert.equal(flow.counts.result, 1);
    assert.equal(flow.counts.generate, 1);

    await assert.rejects(flow.client.getOwnedGrokV2vResult({ result_context: history.contexts[0]!,
      principal: { ...ownerPrincipal(), tenant_id: "foreign-tenant" }, attemptId: ATTEMPT,
      linkService: flow.links, binding: BINDING }), OwnerGrokV2vNativeError);
    const otherClient = new SyntxChatHttpClient({
      credentialBroker: { async useCredential<T>(_operation: (credential: string) => Promise<T>): Promise<T> {
        throw new Error("foreign client must not use credentials");
      } },
      fetchImpl: async () => { throw new Error("foreign client must not issue a GET"); }
    });
    await assert.rejects(otherClient.getOwnedGrokV2vResult({ result_context: history.contexts[0]!,
      principal: ownerPrincipal(), attemptId: ATTEMPT, linkService: flow.links, binding: BINDING }), OwnerGrokV2vNativeError);
    assert.equal(flow.counts.result, 1);
  } finally { await flow.cleanup(); }
});

test("Grok V2V fails closed when a second positive-author request row shares the fresh chat history", {
  skip: process.platform === "win32" ? "POSIX fake-ffprobe fixture; Windows native probe path NOT_RUN" : false
}, async () => {
  const flow = await createFlow({ prompt: "Primary prompt for the duplicate-owner-history guard case.",
    additionalOwnerRequest: "A different owner prompt in the same fresh chat." });
  try {
    const chat = await flow.client.createOwnerGrokV2vChat(flow.operation);
    const ack = await flow.client.startGrokV2vWithOwnedCandidate({ ...flow.operation, chat });
    assert.equal(ack.message_id, "grok-v2v-native-owner-ack-2063");
    const history = await flow.client.listOwnedGrokV2vCandidates({ ...flow.operation, chat });
    assert.equal(history.status, "UNVERIFIED");
    assert.equal(history.owner_ack_status, "MATCHED");
    assert.equal(history.request_echo_status, "PARTIAL_UNPROVEN");
    assert.equal(history.history_page_status, "COMPLETE");
    assert.deepEqual(history.gaps, ["HISTORY_ADDITIONAL_OWNER_REQUEST"]);
    assert.equal(history.contexts.length, 0);
    assert.equal(flow.counts.generate, 1);
    assert.equal(flow.counts.history, 1);
    assert.equal(flow.counts.result, 0, "ambiguous request lineage must not trigger a result GET");
  } finally { await flow.cleanup(); }
});

test("Grok V2V binds the full principal before chat creation and does not POST for a foreign binding", {
  skip: process.platform === "win32" ? "POSIX fake-ffprobe fixture; Windows native probe path NOT_RUN" : false
}, async () => {
  const flow = await createFlow({ foreignBinding: true, prompt: "Do not create a chat for a foreign owner binding." });
  try {
    await assert.rejects(flow.client.createOwnerGrokV2vChat(flow.operation), OwnerGrokV2vNativeError);
    assert.equal(flow.counts.chat, 0);
    assert.equal(flow.counts.generate, 0);
  } finally { await flow.cleanup(); }
});

test("Grok V2V unknown generation outcome is fenced and never creates a second POST", {
  skip: process.platform === "win32" ? "POSIX fake-ffprobe fixture; Windows native probe path NOT_RUN" : false
}, async () => {
  const flow = await createFlow({ loseGenerationAck: true, prompt: "Do not replay an unknown generation attempt." });
  try {
    const chat = await flow.client.createOwnerGrokV2vChat(flow.operation);
    await assert.rejects(flow.client.startGrokV2vWithOwnedCandidate({ ...flow.operation, chat }), OwnerGrokV2vNativeError);
    assert.equal(flow.counts.generate, 1);
    await assert.rejects(flow.client.startGrokV2vWithOwnedCandidate({ ...flow.operation, chat }), OwnerGrokV2vNativeError);
    assert.equal(flow.counts.generate, 1);
    const status = readOwnerGrokV2vNativeDispatchStatus(flow.client, chat);
    assert.equal(status?.phase, "OUTCOME_UNKNOWN");
    const candidates = await flow.client.listOwnedGrokV2vCandidates({ ...flow.operation, chat });
    assert.notEqual(candidates.status, "COMPLETE");
    assert.equal(flow.counts.generate, 1);
    assert.equal(flow.counts.history, 0);
    assert.equal(flow.counts.result, 0);
  } finally { await flow.cleanup(); }
});
