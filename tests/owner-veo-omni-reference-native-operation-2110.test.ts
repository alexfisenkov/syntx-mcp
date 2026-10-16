import assert from "node:assert/strict";
import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import {
  OwnerVeoOmniReferenceNativeError,
  readOwnerVeoOmniReferenceNativeDispatchStatus,
  type OwnerVeoOmniReferenceNativeOperationInput
} from "../src/adapter/syntx/owner-veo-omni-reference-native-context.js";
import {
  createOwnerVeoOmniReferenceOneShotPermit,
  type OwnerVeoOmniReferenceOneShotPermit
} from "../src/application/owner-veo-omni-reference-one-shot-policy.js";
import {
  createOwnerVeoOmniReferenceRequestPreparer,
  type OwnerVeoOmniReferencePreparedCandidate,
  type OwnerVeoOmniReferenceRequestPreparer
} from "../src/application/owner-veo-omni-reference-request-preparer.js";
import {
  OwnerVeoOmniReferenceService,
  OwnerVeoOmniReferenceServiceError
} from "../src/application/owner-veo-omni-reference-service.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { OBSERVED_AUTHORIZATION_PROFILE, type AuthBinding, type AuthLinkProvider } from "../src/auth/types.js";

const ATTEMPT = "link_veo_omni_native_2110_0123456789";
const BINDING: AuthBinding = Object.freeze({ tenant_id: "veo-omni-native-2110", subject: "synthetic-owner" });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const IMAGE_URL = "https://r2.syntx.ai/veo-omni-2110/private/image.png";
const VIDEO_URL = "https://r2.syntx.ai/veo-omni-2110/private/video.mp4";
const OUTPUT_URL = "https://r2.syntx.ai/veo-omni-2110/output/result.mp4";
const PROMPT = "Use [[ref:1]] as the visual anchor and [[ref:2]] for motion.";
const PRIVATE_PROMPT = `Use <<<${IMAGE_URL}>>> as the visual anchor and <<<${VIDEO_URL}>>> for motion.`;
type HistoryMode = "matched" | "changed-page" | "wrong-input-model" | "unsafe-input-url" | "reordered-input-echo" |
  "extra-owner" | "partial-input-echo" | "absent-input-echo";
const VIDEO_PROBE = JSON.stringify({
  streams: [{ codec_type: "video", codec_name: "h264", width: 640, height: 360, duration: "3.2",
    disposition: { attached_pic: 0 } }],
  format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "3.2" }
});

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function ownerPrincipal() {
  return { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT } as const;
}

function mp4Bytes(): Uint8Array {
  const bytes = new Uint8Array(28);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 20);
  bytes.set(new TextEncoder().encode("ftypisom"), 4);
  view.setUint32(12, 0);
  bytes.set(new TextEncoder().encode("mp41"), 16);
  view.setUint32(20, 8);
  bytes.set(new TextEncoder().encode("mdat"), 24);
  return bytes;
}

async function ffprobeFixture(): Promise<{ directory: string; binary: string }> {
  const directory = await mkdtemp(join(tmpdir(), "syntx-veo-omni-native-2110-"));
  const binary = join(directory, "ffprobe-fixture");
  const script = `#!${process.execPath}\nconst fs=require("node:fs");const args=process.argv.slice(2);const input=args.at(-1);if(!input||!fs.statSync(input).isFile())process.exit(41);process.stdout.write(${JSON.stringify(VIDEO_PROBE)});`;
  await writeFile(binary, script, { mode: 0o700, flag: "wx" });
  await chmod(binary, 0o700);
  return { directory, binary: await realpath(binary) };
}

interface NativeFlow {
  readonly client: SyntxChatHttpClient;
  readonly links: PerUserLinkService;
  readonly service: OwnerVeoOmniReferenceService;
  readonly preparer: OwnerVeoOmniReferenceRequestPreparer;
  readonly candidate: OwnerVeoOmniReferencePreparedCandidate;
  readonly permit: OwnerVeoOmniReferenceOneShotPermit;
  readonly operation: Readonly<OwnerVeoOmniReferenceNativeOperationInput>;
  readonly counts: { upload: number; chat: number; generate: number; history: number; result: number; credentials: number };
  setHistoryMode(mode: HistoryMode): void;
  advanceClock(milliseconds: number): void;
  cleanup(): Promise<void>;
}

async function createFlow(options: { readonly loseGenerationAck?: boolean; readonly revokeDuringGeneration?: boolean; readonly prompt?: string } = {}): Promise<NativeFlow> {
  const probe = await ffprobeFixture();
  const nowState = { value: 1_000_000 };
  const now = () => nowState.value;
  const prompt = options.prompt ?? PROMPT;
  const privatePrompt = prompt.replace("[[ref:1]]", `<<<${IMAGE_URL}>>>`).replace("[[ref:2]]", `<<<${VIDEO_URL}>>>`);
  const provider: AuthLinkProvider = {
    authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() { return { upstream_attempt_id: "synthetic-veo-omni-native-2110", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: "synthetic-veo-omni-native-token" });
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
  const ids = { chat: "veo-omni-native-chat-2110", owner: "veo-omni-native-owner-ack-2110", result: "veo-omni-native-result-2110" };
  let historyMode: HistoryMode = "matched";
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
        assert.deepEqual([...form.keys()], ["files", "destination", "check_duplicates", "model_type"]);
        assert.equal(form.get("destination"), "uploaded");
        assert.equal(form.get("check_duplicates"), "true");
        assert.equal(form.get("model_type"), "veo_omni");
        const file = form.get("files");
        assert.ok(file instanceof File);
        const isVideo = file.type === "video/mp4";
        assert.equal(file.type, isVideo ? "video/mp4" : "image/png");
        return jsonResponse({ files: [{ id: `veo-native-upload-${counts.upload}`, url: isVideo ? VIDEO_URL : IMAGE_URL,
          status: "uploaded", mime_type: file.type, size: isVideo ? 28 : PNG.byteLength }] });
      }
      if (url.pathname === "/api/v1/chats" && method === "POST") {
        counts.chat += 1;
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        assert.deepEqual(Object.keys(body).sort(), ["scope", "title"]);
        assert.equal(body.scope, "video");
        assert.match(String(body.title), /^owner-veo-omni-reference-/u);
        return jsonResponse({ uuid: ids.chat });
      }
      if (url.pathname === "/api/v1/video/generate" && method === "POST") {
        counts.generate += 1;
        assert.equal(url.search, "?ai_name=veo3");
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        assert.deepEqual(Object.keys(body).sort(), ["chat_id", "prompt", "settings"]);
        assert.equal(body.chat_id, ids.chat);
        assert.equal(body.prompt, privatePrompt);
        const settings = body.settings as Record<string, unknown>;
        assert.deepEqual(Object.keys(settings).sort(), ["aspect_ratio", "file_urls", "model_type", "type", "upscale", "video_duration"]);
        assert.equal(settings.model_type, "veo_omni");
        assert.equal(settings.type, "references");
        assert.equal(settings.aspect_ratio, "9:16");
        assert.equal(settings.upscale, 2);
        assert.equal(settings.video_duration, 8);
        assert.deepEqual(settings.file_urls, [{ type: "image", url: IMAGE_URL }, { type: "video", url: VIDEO_URL }]);
        assert.equal("mode" in settings, false);
        if (options.loseGenerationAck) throw new Error("synthetic lost generation acknowledgment");
        if (options.revokeDuringGeneration) await links.revoke(BINDING, ATTEMPT);
        return jsonResponse({ id: ids.owner });
      }
      if (url.pathname === `/api/v1/chats/${ids.chat}/messages` && method === "GET") {
        counts.history += 1;
        assert.equal(url.searchParams.get("page"), "1");
        assert.equal(url.searchParams.get("page_size"), "10");
        const rows = historyRows(historyMode, ids, privatePrompt);
        const pagination = historyMode === "changed-page"
          ? { page: 2, page_size: 10, total_count: rows.length, total_pages: 1, has_next: false, has_previous: false }
          : { page: 1, page_size: 10, total_count: rows.length, total_pages: 1, has_next: false, has_previous: false };
        return jsonResponse({ messages: rows, pagination });
      }
      if (url.pathname === `/api/v1/chats/${ids.chat}/${ids.result}` && method === "GET") {
        counts.result += 1;
        return jsonResponse(resultRow(ids, "veo_omni"));
      }
      throw new Error(`unexpected synthetic route ${method} ${url.pathname}`);
    }
  });
  const service = new OwnerVeoOmniReferenceService({ binding: BINDING, linkService: links,
    resolveClient: () => client, ffprobePath: probe.binary, now });
  const preparer = createOwnerVeoOmniReferenceRequestPreparer({ referenceService: service, now });
  try {
    const image = await service.uploadReference({ attemptId: ATTEMPT, filename: "anchor.png", mime_type: "image/png", bytes: PNG });
    const video = await service.uploadReference({ attemptId: ATTEMPT, filename: "motion.mp4", mime_type: "video/mp4", bytes: mp4Bytes() });
    const candidate = await preparer.prepare({ attemptId: ATTEMPT, prompt, input_type: "references", upscale: 2,
      aspect_ratio: "9:16", video_duration: 8, reference_handles: [image.reference_handle, video.reference_handle] });
    const principal = ownerPrincipal();
    const permit = await createOwnerVeoOmniReferenceOneShotPermit({ preparer, candidate, principal, attemptId: ATTEMPT });
    const operation: Readonly<OwnerVeoOmniReferenceNativeOperationInput> = Object.freeze({ preparer, candidate, permit,
      referenceService: service, principal, attemptId: ATTEMPT, linkService: links, binding: BINDING });
    return { client, links, service, preparer, candidate, permit, operation, counts,
      setHistoryMode(mode) { historyMode = mode; },
      advanceClock(milliseconds) { nowState.value += milliseconds; },
      async cleanup() { await preparer.close(); await service.close(); await rm(probe.directory, { recursive: true, force: true }); } };
  } catch (error) {
    await preparer.close();
    await service.close();
    await rm(probe.directory, { recursive: true, force: true });
    throw error;
  }
}

function historyRows(mode: HistoryMode,
  ids: { readonly chat: string; readonly owner: string; readonly result: string }, prompt: string): readonly unknown[] {
  const inputModel = mode === "wrong-input-model" ? "wrong_model" : "veo_omni";
  const imageUrl = mode === "unsafe-input-url" ? "https://attacker.invalid/image.png" : IMAGE_URL;
  const ownerObjects = mode === "absent-input-echo" ? [] : mode === "partial-input-echo" ? [
    { id: "veo-native-owner-text-2110", message_id: ids.owner, object_type: "text", object_text: prompt }
  ] : mode === "reordered-input-echo" ? [
    { id: "veo-native-owner-text-2110", message_id: ids.owner, object_type: "text", object_text: prompt },
    { id: "veo-native-owner-video-2110", message_id: ids.owner, object_type: "video", object_url: VIDEO_URL, model_type: inputModel },
    { id: "veo-native-owner-image-2110", message_id: ids.owner, object_type: "image", object_url: imageUrl, model_type: inputModel }
  ] : [
    { id: "veo-native-owner-text-2110", message_id: ids.owner, object_type: "text", object_text: prompt },
    { id: "veo-native-owner-image-2110", message_id: ids.owner, object_type: "image", object_url: imageUrl, model_type: inputModel },
    { id: "veo-native-owner-video-2110", message_id: ids.owner, object_type: "video", object_url: VIDEO_URL, model_type: inputModel }
  ];
  const ownerRow = Object.freeze({ id: ids.owner, chat_id: "88110", author_id: 17, message_object: ownerObjects });
  const botRow = resultRow(ids, "veo_omni");
  const extraOwner = Object.freeze({ id: "veo-native-extra-owner-2110", chat_id: "88110", author_id: 17, message_object: [
    { id: "veo-native-extra-owner-text-2110", message_id: "veo-native-extra-owner-2110", object_type: "text", object_text: "another request" }
  ] });
  return Object.freeze([ownerRow, ...(mode === "extra-owner" ? [extraOwner] : []), botRow]);
}

function resultRow(ids: { readonly chat: string; readonly owner: string; readonly result: string }, modelType: string) {
  return Object.freeze({ id: ids.result, chat_id: "88110", author_id: -1, message_object: [
    { id: "veo-native-result-object-2110", message_id: ids.result, object_type: "video", object_url: OUTPUT_URL,
      completed: true, model_type: modelType }
  ] });
}

test("Veo Omni native path creates one private chat, dispatches exact typed settings, binds owner ACK, and recovers after input TTL", {
  skip: process.platform === "win32" ? "POSIX fake ffprobe fixture; Windows native probe path NOT_RUN" : false
}, async () => {
  const flow = await createFlow();
  try {
    assert.equal(flow.counts.upload, 2);
    const chat = await flow.client.createOwnerVeoOmniReferenceChat(flow.operation);
    assert.equal(chat.model_id, "veo_omni");
    assert.equal(chat.profile_sha256, "sha256:671a2384926992ad5fc2c04ee10620da36b9184aa5707fc222abb36c5be0bfc3");
    assert.equal(chat.dispatch_allowed, false);
    assert.equal(chat.backend_acceptance, "UNPROVEN");
    assert.equal(JSON.stringify(chat).includes(IMAGE_URL), false);
    assert.equal(JSON.stringify(chat).includes(VIDEO_URL), false);
    assert.equal(JSON.stringify(chat).includes(PROMPT), false);
    assert.equal(readOwnerVeoOmniReferenceNativeDispatchStatus(flow.client, chat)?.phase, "AVAILABLE");

    const ack = await flow.client.startOwnerVeoOmniReferenceWithOwnedCandidate({ ...flow.operation, chat });
    assert.deepEqual(ack, { chat_uuid: chat.chat_uuid, message_id: "veo-omni-native-owner-ack-2110" });
    assert.equal(readOwnerVeoOmniReferenceNativeDispatchStatus(flow.client, chat)?.phase, "ACKNOWLEDGED");
    assert.equal(flow.counts.chat, 1);
    assert.equal(flow.counts.generate, 1);

    await assert.rejects(flow.client.createOwnerVeoOmniReferenceChat(flow.operation), OwnerVeoOmniReferenceNativeError);
    await assert.rejects(flow.client.startOwnerVeoOmniReferenceWithOwnedCandidate({ ...flow.operation, chat }), OwnerVeoOmniReferenceNativeError);
    assert.equal(flow.counts.chat, 1);
    assert.equal(flow.counts.generate, 1);

    flow.setHistoryMode("matched");
    const history = await flow.client.listOwnedVeoOmniReferenceCandidates({ ...flow.operation, chat });
    assert.equal(history.owner_ack_status, "MATCHED");
    assert.equal(history.request_echo_status, "MATCHED");
    assert.equal(history.history_binding_status, "BOUND");
    assert.equal(history.history_page_status, "COMPLETE");
    assert.equal(history.contexts.length, 1);
    assert.equal(JSON.stringify(history).includes(IMAGE_URL), false);
    assert.equal(JSON.stringify(history).includes(VIDEO_URL), false);
    assert.equal(JSON.stringify(history.contexts[0]).includes(PRIVATE_PROMPT), false);

    flow.advanceClock(16 * 60_000);
    await assert.rejects(flow.service.resolveReferences({ attemptId: ATTEMPT,
      reference_handles: flow.candidate.sources.map((source) => source.reference_handle) }), OwnerVeoOmniReferenceServiceError);
    const result = await flow.client.getOwnedVeoOmniReferenceResult({ result_context: history.contexts[0]!,
      principal: ownerPrincipal(), attemptId: ATTEMPT, linkService: flow.links, binding: BINDING });
    assert.equal(result.message_binding, "BOUND");
    assert.equal(result.model_echo, "MATCHED");
    assert.equal(result.provider_terminal_status, "UNPROVEN");
    assert.equal(result.artifacts.length, 1);
    assert.deepEqual(result.artifacts[0], { object_index: 0, message_object_id: "veo-native-result-object-2110",
      object_type: "video", object_url: OUTPUT_URL, mime_type: "video/mp4", mime_source: "URL_EXTENSION" });
    assert.equal(flow.counts.history, 1);
    assert.equal(flow.counts.result, 1);
    assert.equal(flow.counts.generate, 1);
  } finally { await flow.cleanup(); }
});

test("Veo Omni unknown POST outcome stays sticky and never retries generation", {
  skip: process.platform === "win32" ? "POSIX fake ffprobe fixture; Windows native probe path NOT_RUN" : false
}, async () => {
  const flow = await createFlow({ loseGenerationAck: true, prompt: "Do not replay [[ref:1]] after an unknown owner POST." });
  try {
    const chat = await flow.client.createOwnerVeoOmniReferenceChat(flow.operation);
    await assert.rejects(flow.client.startOwnerVeoOmniReferenceWithOwnedCandidate({ ...flow.operation, chat }), OwnerVeoOmniReferenceNativeError);
    assert.equal(flow.counts.generate, 1);
    assert.equal(readOwnerVeoOmniReferenceNativeDispatchStatus(flow.client, chat)?.phase, "OUTCOME_UNKNOWN");
    await assert.rejects(flow.client.startOwnerVeoOmniReferenceWithOwnedCandidate({ ...flow.operation, chat }), OwnerVeoOmniReferenceNativeError);
    assert.equal(flow.counts.generate, 1);
    const history = await flow.client.listOwnedVeoOmniReferenceCandidates({ ...flow.operation, chat });
    assert.equal(history.status, "UNVERIFIED");
    assert.deepEqual(history.gaps, ["POST_ACK_UNAVAILABLE"]);
    assert.equal(flow.counts.history, 0);
    assert.equal(flow.counts.result, 0);
  } finally { await flow.cleanup(); }
});

test("Veo Omni native history rejects pagination drift, conflicting input echo, unsafe refs, and another owner request", {
  skip: process.platform === "win32" ? "POSIX fake ffprobe fixture; Windows native probe path NOT_RUN" : false
}, async () => {
  const flow = await createFlow({ prompt: "Do not accept conflicting history for [[ref:1]] and [[ref:2]]." });
  try {
    const chat = await flow.client.createOwnerVeoOmniReferenceChat(flow.operation);
    await flow.client.startOwnerVeoOmniReferenceWithOwnedCandidate({ ...flow.operation, chat });
    for (const [mode, gap] of [
      ["changed-page", "HISTORY_PAGE_INVALID"],
      ["wrong-input-model", "OWNER_REQUEST_ECHO_CONTRADICTORY"],
      ["unsafe-input-url", "OWNER_REQUEST_ECHO_CONTRADICTORY"],
      ["reordered-input-echo", "OWNER_REQUEST_ECHO_CONTRADICTORY"],
      ["extra-owner", "HISTORY_ADDITIONAL_OWNER_REQUEST"]
    ] as const) {
      flow.setHistoryMode(mode);
      const history = await flow.client.listOwnedVeoOmniReferenceCandidates({ ...flow.operation, chat });
      assert.notEqual(history.history_binding_status, "BOUND");
      assert.equal(history.contexts.length, 0);
      assert.ok(history.gaps.includes(gap));
    }
    for (const [mode, expectedEcho] of [["partial-input-echo", "PARTIAL_UNPROVEN"], ["absent-input-echo", "ABSENT"]] as const) {
      flow.setHistoryMode(mode);
      const history = await flow.client.listOwnedVeoOmniReferenceCandidates({ ...flow.operation, chat });
      assert.equal(history.request_echo_status, expectedEcho);
      assert.equal(history.history_binding_status, "BOUND");
      assert.equal(history.owner_ack_status, "MATCHED");
      assert.equal(history.contexts.length, 1);
      assert.equal(history.backend_acceptance, "UNPROVEN");
    }
    assert.equal(flow.counts.generate, 1);
    assert.equal(flow.counts.history, 7);
    assert.equal(flow.counts.result, 0);
  } finally { await flow.cleanup(); }
});

test("Veo Omni rejects a cloned chat, cross-client result context, and revoked auth before another POST or GET", {
  skip: process.platform === "win32" ? "POSIX fake ffprobe fixture; Windows native probe path NOT_RUN" : false
}, async () => {
  const flow = await createFlow({ prompt: "Do not cross-bind auth for [[ref:1]] and [[ref:2]]." });
  try {
    const chat = await flow.client.createOwnerVeoOmniReferenceChat(flow.operation);
    await assert.rejects(flow.client.createOwnerVeoOmniReferenceChat({ ...flow.operation,
      candidate: Object.freeze({ ...flow.candidate }) }), OwnerVeoOmniReferenceNativeError);
    assert.equal(flow.counts.chat, 1);
    const otherClient = new SyntxChatHttpClient({
      credentialBroker: { async useCredential<T>(_operation: (credential: string) => Promise<T>): Promise<T> {
        throw new Error("cross-client native start must fail before auth");
      } },
      fetchImpl: async () => { throw new Error("cross-client native start must not use I/O"); }
    });
    await assert.rejects(otherClient.startOwnerVeoOmniReferenceWithOwnedCandidate({ ...flow.operation, chat }), OwnerVeoOmniReferenceNativeError);
    assert.equal(flow.counts.generate, 0);
    const cloned = Object.freeze({ ...chat });
    await assert.rejects(flow.client.startOwnerVeoOmniReferenceWithOwnedCandidate({ ...flow.operation, chat: cloned }), OwnerVeoOmniReferenceNativeError);
    const ack = await flow.client.startOwnerVeoOmniReferenceWithOwnedCandidate({ ...flow.operation, chat });
    assert.equal(ack.message_id, "veo-omni-native-owner-ack-2110");
    const history = await flow.client.listOwnedVeoOmniReferenceCandidates({ ...flow.operation, chat });
    const clonedResultContext = Object.freeze({ ...history.contexts[0]! });
    await assert.rejects(flow.client.getOwnedVeoOmniReferenceResult({ result_context: clonedResultContext,
      principal: ownerPrincipal(), attemptId: ATTEMPT, linkService: flow.links, binding: BINDING }), OwnerVeoOmniReferenceNativeError);
    await assert.rejects(otherClient.getOwnedVeoOmniReferenceResult({ result_context: history.contexts[0]!,
      principal: ownerPrincipal(), attemptId: ATTEMPT, linkService: flow.links, binding: BINDING }), OwnerVeoOmniReferenceNativeError);
    await flow.links.revoke(BINDING, ATTEMPT);
    await assert.rejects(flow.client.getOwnedVeoOmniReferenceResult({ result_context: history.contexts[0]!,
      principal: ownerPrincipal(), attemptId: ATTEMPT, linkService: flow.links, binding: BINDING }), OwnerVeoOmniReferenceNativeError);
    assert.equal(flow.counts.generate, 1);
    assert.equal(flow.counts.result, 0);
  } finally { await flow.cleanup(); }
});

test("Veo Omni refuses candidate expiry or revoked owner auth before generation POST", {
  skip: process.platform === "win32" ? "POSIX fake ffprobe fixture; Windows native probe path NOT_RUN" : false
}, async () => {
  const expired = await createFlow({ prompt: "Candidate expiry must block [[ref:1]] and [[ref:2]]." });
  try {
    const chat = await expired.client.createOwnerVeoOmniReferenceChat(expired.operation);
    expired.advanceClock(16 * 60_000);
    await assert.rejects(expired.client.startOwnerVeoOmniReferenceWithOwnedCandidate({ ...expired.operation, chat }), OwnerVeoOmniReferenceNativeError);
    assert.equal(expired.counts.generate, 0);
    assert.equal(readOwnerVeoOmniReferenceNativeDispatchStatus(expired.client, chat)?.phase, "AVAILABLE");
  } finally { await expired.cleanup(); }

  const revoked = await createFlow({ prompt: "Revoked auth must block [[ref:1]] and [[ref:2]]." });
  try {
    const chat = await revoked.client.createOwnerVeoOmniReferenceChat(revoked.operation);
    await revoked.links.revoke(BINDING, ATTEMPT);
    await assert.rejects(revoked.client.startOwnerVeoOmniReferenceWithOwnedCandidate({ ...revoked.operation, chat }), OwnerVeoOmniReferenceNativeError);
    assert.equal(revoked.counts.generate, 0);
    assert.equal(readOwnerVeoOmniReferenceNativeDispatchStatus(revoked.client, chat)?.phase, "AVAILABLE");
  } finally { await revoked.cleanup(); }
});

test("Veo Omni authorization revoked during the only generation POST leaves the outcome unknown", {
  skip: process.platform === "win32" ? "POSIX fake ffprobe fixture; Windows native probe path NOT_RUN" : false
}, async () => {
  const flow = await createFlow({ revokeDuringGeneration: true,
    prompt: "Do not accept an owner identity revoked while [[ref:1]] is sent." });
  try {
    const chat = await flow.client.createOwnerVeoOmniReferenceChat(flow.operation);
    await assert.rejects(flow.client.startOwnerVeoOmniReferenceWithOwnedCandidate({ ...flow.operation, chat }), OwnerVeoOmniReferenceNativeError);
    assert.equal(flow.counts.generate, 1);
    assert.equal(readOwnerVeoOmniReferenceNativeDispatchStatus(flow.client, chat)?.phase, "OUTCOME_UNKNOWN");
    await assert.rejects(flow.client.listOwnedVeoOmniReferenceCandidates({ ...flow.operation, chat }), OwnerVeoOmniReferenceNativeError);
    assert.equal(flow.counts.history, 0);
    assert.equal(flow.counts.result, 0);
  } finally { await flow.cleanup(); }
});
