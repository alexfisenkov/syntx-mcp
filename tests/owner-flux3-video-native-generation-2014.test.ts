import assert from "node:assert/strict";
import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { OwnerFlux3MediaReferenceService } from "../src/application/owner-flux3-media-reference-service.js";
import { createOwnerFlux3VideoOwnedOneShotPermit } from "../src/application/owner-flux3-video-owned-one-shot-policy.js";
import { createOwnerFlux3VideoOwnedRequestPreparer } from "../src/application/owner-flux3-video-owned-request-preparer.js";
import type { OwnerFlux3VideoParameterValues } from "../src/application/owner-flux3-video-parameters.js";
import { OwnerFlux3VideoNativeError, readOwnerFlux3VideoNativeDispatchStatus,
  type OwnerFlux3VideoNativeOperationInput } from "../src/adapter/syntx/owner-flux3-video-native-context.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { resolveOwnerReferencePrincipal } from "../src/auth/owner-reference-principal.js";
import { OBSERVED_AUTHORIZATION_PROFILE, type AuthBinding, type AuthLinkProvider } from "../src/auth/types.js";

const ATTEMPT = "link_flux3_native_2014_0123456789";
const BINDING: AuthBinding = Object.freeze({ tenant_id: "flux3-native-tenant", subject: "flux3-native-owner" });
const IMAGE_BYTES = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const VIDEO_URL = "https://r2.syntx.ai/flux3-native/results/output.mp4";
const VIDEO_PROBE = { streams: [
  { codec_type: "video", codec_name: "unlisted-local-codec", width: 7680, height: 4320, duration: "240.5", disposition: { attached_pic: 0 } },
  { codec_type: "audio", codec_name: "unlisted-local-audio" }
], format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "240.8" } };

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function videoBytes(): Uint8Array {
  const bytes = new Uint8Array(28), view = new DataView(bytes.buffer);
  view.setUint32(0, 20); bytes.set(new TextEncoder().encode("ftypisom"), 4);
  view.setUint32(12, 0); bytes.set(new TextEncoder().encode("mp41"), 16);
  view.setUint32(20, 8); bytes.set(new TextEncoder().encode("mdat"), 24);
  return bytes;
}

async function ffprobeFixture(): Promise<{ directory: string; binary: string }> {
  const directory = await mkdtemp(join(tmpdir(), "syntx-flux3-native-2014-"));
  const binary = join(directory, "ffprobe-fixture");
  const script = `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(JSON.stringify(VIDEO_PROBE))});\n`;
  await writeFile(binary, script, { mode: 0o700, flag: "wx" });
  await chmod(binary, 0o700);
  return { directory, binary: await realpath(binary) };
}

async function linkedOwner(now: () => number): Promise<PerUserLinkService> {
  const provider: AuthLinkProvider = {
    authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() { return { upstream_attempt_id: "synthetic-flux3-native-owner", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: "synthetic-flux3-native-linked-token" });
      return { state: "LINKED" };
    }
  };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(now), {
    now, defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => ATTEMPT
  });
  const attempt = await links.createAttempt(BINDING);
  await links.issueHandoff(BINDING, attempt.attempt_id);
  await links.checkAttempt(BINDING, attempt.attempt_id);
  return links;
}

interface Flux3Flow {
  readonly client: SyntxChatHttpClient;
  readonly links: PerUserLinkService;
  readonly referenceService: OwnerFlux3MediaReferenceService;
  readonly preparer: ReturnType<typeof createOwnerFlux3VideoOwnedRequestPreparer>;
  readonly operation: Readonly<OwnerFlux3VideoNativeOperationInput>;
  readonly chat: Awaited<ReturnType<SyntxChatHttpClient["createOwnerFlux3VideoChat"]>>;
  readonly ack: Awaited<ReturnType<SyntxChatHttpClient["startFlux3VideoWithOwnedCandidate"]>> | null;
  readonly clock: { value: number };
  readonly calls: { upload: number; chat: number; generate: number; history: number; result: number; credentials: number };
  readonly resultMessage: Readonly<Record<string, unknown>>;
  cleanup(): Promise<void>;
}

async function createFlow(
  model_id: "flux3_i2v" | "flux3_v2v",
  ownerEcho: readonly Readonly<Record<string, unknown>>[] = [],
  prompt = "",
  loseGenerationAck = false
): Promise<Flux3Flow> {
  const ffprobe = await ffprobeFixture();
  const clock = { value: 1_000_000 }, now = () => clock.value;
  const links = await linkedOwner(now);
  const calls = { upload: 0, chat: 0, generate: 0, history: 0, result: 0, credentials: 0 };
  const modelTag = model_id === "flux3_i2v" ? "i2v" : "v2v";
  const chatUuid = `flux3-native-chat-${modelTag}`;
  const ackId = `flux3-native-ack-${modelTag}`;
  const resultMessageId = `flux3-native-result-${modelTag}`;
  const resultObjects = [{ id: `flux3-video-${modelTag}-text`, message_id: resultMessageId,
    object_type: "text", object_text: "synthetic completed result" }, ...["one", "two"].map((suffix) => ({ id: `flux3-video-${modelTag}-${suffix}`,
    message_id: resultMessageId, object_type: "video", object_url: VIDEO_URL.replace("output.mp4", `${suffix}.mp4`),
    completed: true, model_type: model_id }))];
  const resultMessage = Object.freeze({ id: resultMessageId, chat_id: 77201, author_id: -1, message_object: resultObjects });
  const client = new SyntxChatHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      calls.credentials += 1;
      return links.useCredential(BINDING, ATTEMPT, (credential) => operation(credential.value));
    } },
    fetchImpl: async (input, init = {}) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method = init.method ?? "GET";
      if (url.pathname === "/api/v1/chats/upload-files" && method === "POST") {
        calls.upload += 1;
        const form = init.body as FormData;
        const expectedModel = model_id;
        assert.deepEqual(Array.from(form.keys()), ["files", "destination", "check_duplicates", "model_type"]);
        assert.equal(form.get("destination"), "hidden");
        assert.equal(form.get("check_duplicates"), "true");
        assert.equal(form.get("model_type"), expectedModel);
        const file = form.get("files");
        assert.ok(file instanceof File);
        if (model_id === "flux3_i2v") {
          assert.equal(file.type, "image/png");
          assert.equal(file.name, "scene.png");
          assert.deepEqual(Array.from(new Uint8Array(await file.arrayBuffer())), Array.from(IMAGE_BYTES));
          return response({ files: [{ url: "https://r2.syntx.ai/flux3-i2v/hidden/scene.png", filename: "scene.png",
            status: "success", size: IMAGE_BYTES.byteLength, content_type: "image/png" }] });
        }
        assert.equal(file.type, "video/mp4");
        assert.equal(file.name, "original.mp4");
        assert.deepEqual(new Uint8Array(await file.arrayBuffer()), videoBytes());
        return response({ files: [{ url: "https://r2.syntx.ai/flux3-v2v/hidden/original.mp4", filename: "original.mp4",
          status: "success", size: 28, content_type: "video/mp4" }] });
      }
      if (url.pathname === "/api/v1/chats" && method === "POST") {
        calls.chat += 1;
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        assert.deepEqual(Object.keys(body).sort(), ["scope", "title"]);
        assert.equal(body.scope, "video");
        assert.equal(typeof body.title, "string");
        assert.match(body.title as string, /^owner-flux3-video-/u);
        return response({ uuid: chatUuid });
      }
      if (url.pathname === "/api/v1/video/generate" && method === "POST") {
        calls.generate += 1;
        assert.equal(url.search, "?ai_name=flux3_video");
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        assert.deepEqual(Object.keys(body).sort(), ["chat_id", "prompt", "settings"]);
        assert.equal(body.chat_id, chatUuid);
        assert.equal(body.prompt, prompt);
        const settings = body.settings as Record<string, unknown>;
        assert.deepEqual(Object.keys(settings).sort(), ["aspect_ratio", "file_urls", "generate_audio", "model_type", "resolution", "video_duration"]);
        assert.equal(settings.model_type, model_id);
        assert.equal(settings.aspect_ratio, "auto");
        assert.equal(settings.generate_audio, true);
        assert.equal(settings.resolution, model_id === "flux3_i2v" ? "hd" : "fhd");
        assert.equal(settings.video_duration, model_id === "flux3_i2v" ? 20 : 15);
        const files = settings.file_urls as readonly Readonly<{ type: string; url: string }>[];
        assert.deepEqual(files, [{ type: model_id === "flux3_i2v" ? "image" : "video",
          url: model_id === "flux3_i2v" ? "https://r2.syntx.ai/flux3-i2v/hidden/scene.png" : "https://r2.syntx.ai/flux3-v2v/hidden/original.mp4" }]);
        assert.equal("n" in settings, false);
        assert.equal("draft" in settings, false);
        if (loseGenerationAck) throw new Error("synthetic lost Flux3 generation ACK");
        return response({ id: ackId });
      }
      if (url.pathname === `/api/v1/chats/${chatUuid}/messages` && method === "GET") {
        calls.history += 1;
        assert.equal(url.searchParams.get("page"), "1");
        assert.equal(url.searchParams.get("page_size"), "10");
        const ownerMessage = { id: ackId, chat_id: 77201, author_id: 17, message_object: ownerEcho };
        return response({ messages: [ownerMessage, resultMessage], pagination: {
          page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false
        } });
      }
      if (url.pathname === `/api/v1/chats/${chatUuid}/${resultMessageId}` && method === "GET") {
        calls.result += 1;
        return response(resultMessage);
      }
      throw new Error(`unexpected synthetic route ${method} ${url.pathname}`);
    }
  });
  const referenceService = new OwnerFlux3MediaReferenceService({ ffprobePath: ffprobe.binary, destination: "hidden",
    binding: BINDING, linkService: links, resolveClient: () => client, now });
  const preparer = createOwnerFlux3VideoOwnedRequestPreparer({ referenceService, now });
  const inputBytes = model_id === "flux3_i2v" ? new Uint8Array(IMAGE_BYTES) : videoBytes();
  const upload = await referenceService.uploadReference({ attemptId: ATTEMPT, model_id,
    filename: model_id === "flux3_i2v" ? "scene.png" : "original.mp4",
    mime_type: model_id === "flux3_i2v" ? "image/png" : "video/mp4", bytes: inputBytes });
  const parameters: OwnerFlux3VideoParameterValues = { resolution: model_id === "flux3_i2v" ? "hd" : "fhd",
    video_duration: model_id === "flux3_i2v" ? 20 : 15, generate_audio: true };
  const candidate = await preparer.prepare({ attemptId: ATTEMPT, request: { model_id, prompt,
    flux3_reference_handles: [upload.flux3_reference_handle], parameters } });
  const principal = await resolveOwnerReferencePrincipal({ binding: BINDING, attemptId: ATTEMPT, linkService: links });
  const permit = await createOwnerFlux3VideoOwnedOneShotPermit({ preparer, candidate, principal, attemptId: ATTEMPT });
  const operation = Object.freeze({ preparer, candidate, permit, referenceService, principal, attemptId: ATTEMPT,
    linkService: links, binding: BINDING });
  const chat = await client.createOwnerFlux3VideoChat(operation);
  let ack: Awaited<ReturnType<SyntxChatHttpClient["startFlux3VideoWithOwnedCandidate"]>> | null = null;
  try { ack = await client.startFlux3VideoWithOwnedCandidate(Object.freeze({ ...operation, chat })); }
  catch (error) { if (!loseGenerationAck) throw error; }
  return {
    client, links, referenceService, preparer, operation, chat, ack, clock, calls, resultMessage,
    async cleanup() { await preparer.close(); await referenceService.close(); await rm(ffprobe.directory, { recursive: true, force: true }); }
  };
}

function invoke(client: SyntxChatHttpClient, methodName: string, input: unknown): Promise<unknown> {
  const method = Reflect.get(client, methodName);
  assert.equal(typeof method, "function", `SyntxChatHttpClient.${methodName} must exist`);
  return Reflect.apply(method as (value: unknown) => Promise<unknown>, client, [input]);
}

test("Flux3 native entry points reject malformed packets without credentials or HTTP", async () => {
  let networkCalls = 0;
  let credentialCalls = 0;
  const credentials = { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
    credentialCalls += 1;
    return operation("synthetic-flux3-native-credential");
  } };
  const client = new SyntxChatHttpClient({ credentialBroker: credentials, fetchImpl: async () => {
    networkCalls += 1;
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  } });

  for (const [method, input] of [
    ["createOwnerFlux3VideoChat", null],
    ["startFlux3VideoWithOwnedCandidate", {}],
    ["listOwnedFlux3VideoCandidates", {}],
    ["getOwnedFlux3VideoResult", {}]
  ] as const) {
    await assert.rejects(invoke(client, method, input), (error: unknown) =>
      error instanceof Error && error.name === "OwnerFlux3VideoNativeError" &&
      "code" in error && error.code === "INVALID_REQUEST");
  }

  assert.equal(credentialCalls, 0);
  assert.equal(networkCalls, 0);
});

test("captured I2V ACK and two exact-model outputs remain readable after reference TTL without echo claims", async () => {
  const flow = await createFlow("flux3_i2v");
  try {
    assert.equal(flow.chat.model_id, "flux3_i2v");
    assert.equal(flow.chat.dispatch_allowed, false);
    assert.ok(flow.ack);
    assert.equal(flow.ack.chat_uuid, flow.chat.chat_uuid);
    assert.equal(readOwnerFlux3VideoNativeDispatchStatus(flow.client, flow.chat)?.phase, "ACKNOWLEDGED");
    assert.equal(flow.calls.upload, 1);
    assert.equal(flow.calls.chat, 1);
    assert.equal(flow.calls.generate, 1);
    flow.clock.value += 16 * 60_000;

    const candidates = await flow.client.listOwnedFlux3VideoCandidates(Object.freeze({ ...flow.operation, chat: flow.chat }));
    assert.equal(candidates.status, "COMPLETE");
    assert.equal(candidates.owner_ack_status, "MATCHED");
    assert.equal(candidates.request_echo_status, "ABSENT");
    assert.equal(candidates.backend_acceptance, "UNPROVEN");
    assert.equal(candidates.contexts.length, 1);
    const resultContext = candidates.contexts[0]!;
    assert.equal("object_url" in resultContext, false);
    assert.equal("flux3_reference_handles" in resultContext, false);

    const result = await flow.client.getOwnedFlux3VideoResult({ result_context: resultContext,
      principal: flow.operation.principal, attemptId: ATTEMPT, linkService: flow.links, binding: BINDING });
    assert.equal(result.message_binding, "BOUND");
    assert.equal(result.model_echo, "MATCHED");
    assert.equal(result.provider_terminal_status, "UNPROVEN");
    assert.equal(result.artifacts.length, 2);
    assert.deepEqual(result.artifacts.map((artifact) => artifact.object_url), [
      "https://r2.syntx.ai/flux3-native/results/one.mp4", "https://r2.syntx.ai/flux3-native/results/two.mp4"
    ]);

    let foreignNetworkCalls = 0;
    const otherClient = new SyntxChatHttpClient({ credentialBroker: { async useCredential<T>(operation: (token: string) => Promise<T>) {
      return operation("synthetic-foreign-client-token");
    } }, fetchImpl: async () => {
      foreignNetworkCalls += 1;
      return response({});
    } });
    await assert.rejects(otherClient.getOwnedFlux3VideoResult({ result_context: resultContext,
      principal: flow.operation.principal, attemptId: ATTEMPT, linkService: flow.links, binding: BINDING }),
      (error: unknown) => error instanceof OwnerFlux3VideoNativeError && error.code === "RESULT_CONTEXT_INVALID");
    assert.equal(foreignNetworkCalls, 0);
    assert.equal(flow.calls.generate, 1);
    assert.equal(flow.calls.history, 1);
    assert.equal(flow.calls.result, 1);
  } finally { await flow.cleanup(); }
});

test("V2V private request preserves one typed video URL and local input duration does not cap requested output duration",
  { skip: process.platform === "win32" ? "POSIX executable fixture; real Windows ffprobe acceptance NOT_RUN" : false }, async () => {
  const flow = await createFlow("flux3_v2v");
  try {
    assert.equal(flow.chat.model_id, "flux3_v2v");
    assert.equal(flow.chat.sources[0]?.wire_type, "video");
    assert.equal(flow.chat.sources[0]?.duration_seconds, 240.5);
    assert.equal(flow.calls.upload, 1);
    assert.equal(flow.calls.generate, 1);
    const listed = await flow.client.listOwnedFlux3VideoCandidates(Object.freeze({ ...flow.operation, chat: flow.chat }));
    assert.equal(listed.status, "COMPLETE");
    assert.equal(listed.contexts.length, 1);
    const result = await flow.client.getOwnedFlux3VideoResult({ result_context: listed.contexts[0]!,
      principal: flow.operation.principal, attemptId: ATTEMPT, linkService: flow.links, binding: BINDING });
    assert.equal(result.artifacts.length, 2);
  } finally { await flow.cleanup(); }
});

test("contradictory present owner prompt echo denies result candidates despite a captured POST ACK", async () => {
  const echo = [{ id: "flux3-owner-echo-text", message_id: "flux3-native-ack-i2v",
    object_type: "text", object_text: "not the requested empty prompt" }];
  const flow = await createFlow("flux3_i2v", echo, "expected prompt");
  try {
    const candidates = await flow.client.listOwnedFlux3VideoCandidates(Object.freeze({ ...flow.operation, chat: flow.chat }));
    assert.equal(candidates.owner_ack_status, "MATCHED");
    assert.equal(candidates.request_echo_status, "CONTRADICTORY");
    assert.equal(candidates.status, "UNVERIFIED");
    assert.equal(candidates.contexts.length, 0);
    assert.equal(candidates.backend_acceptance, "UNPROVEN");
    assert.equal(flow.calls.generate, 1);
    assert.equal(flow.calls.history, 1);
  } finally { await flow.cleanup(); }
});

test("lost POST ACK stays outcome-unknown and cannot be adopted or replayed", async () => {
  const flow = await createFlow("flux3_i2v", [], "unique lost-ack prompt", true);
  try {
    assert.equal(flow.ack, null);
    const dispatch = readOwnerFlux3VideoNativeDispatchStatus(flow.client, flow.chat);
    assert.deepEqual(dispatch, { chat_uuid: flow.chat.chat_uuid, attempt_id: ATTEMPT, model_id: "flux3_i2v",
      phase: "OUTCOME_UNKNOWN", dispatch_attempted: true, owner_ack_bound: false, owner_echo_message_id: null });
    const listed = await flow.client.listOwnedFlux3VideoCandidates(Object.freeze({ ...flow.operation, chat: flow.chat }));
    assert.equal(listed.status, "UNVERIFIED");
    assert.equal(listed.owner_ack_status, "MISSING");
    assert.equal(listed.contexts.length, 0);
    assert.equal(flow.calls.history, 0);
    await assert.rejects(flow.client.startFlux3VideoWithOwnedCandidate(Object.freeze({ ...flow.operation, chat: flow.chat })),
      (error: unknown) => error instanceof OwnerFlux3VideoNativeError && error.code === "CHAT_CONTEXT_INVALID");
    assert.equal(flow.calls.generate, 1);
  } finally { await flow.cleanup(); }
});

test("input media provenance echo with another model label is partial-unproven, not an identity contradiction", async () => {
  const ackId = "flux3-native-ack-i2v";
  const echo = [
    { id: "flux3-owner-image-echo", message_id: ackId, object_type: "image",
      object_url: "https://r2.syntx.ai/flux3-i2v/hidden/scene.png", model_type: "flux3_image_tool" },
    { id: "flux3-owner-text-echo", message_id: ackId, object_type: "text", object_text: "explicit echo" },
    { id: "flux3-owner-null-echo", message_id: ackId, object_type: "text", object_text: null },
    { id: "flux3-owner-preview-echo", message_id: ackId, object_type: "preview", object_url: "https://r2.syntx.ai/previews/ignored.png" }
  ];
  const flow = await createFlow("flux3_i2v", echo, "explicit echo");
  try {
    const listed = await flow.client.listOwnedFlux3VideoCandidates(Object.freeze({ ...flow.operation, chat: flow.chat }));
    assert.equal(listed.owner_ack_status, "MATCHED");
    assert.equal(listed.request_echo_status, "PARTIAL_UNPROVEN");
    assert.equal(listed.status, "COMPLETE");
    assert.equal(listed.contexts.length, 1);
  } finally { await flow.cleanup(); }
});
