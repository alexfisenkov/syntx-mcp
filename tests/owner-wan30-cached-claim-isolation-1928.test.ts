import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { OwnerWan30EditGenerationService, OwnerWan30EditGenerationServiceError } from "../src/application/owner-wan30-edit-generation-service.js";
import type { OwnerWan30EditGenerationIntent } from "../src/application/owner-wan30-edit-generation-parameters.js";
import { OwnerWan30FirstLastGenerationService, OwnerWan30FirstLastGenerationServiceError } from "../src/application/owner-wan30-first-last-generation-service.js";
import type { OwnerWan30FirstLastGenerationIntent } from "../src/application/owner-wan30-first-last-generation-parameters.js";
import { OwnerWan30OmniGenerationService, OwnerWan30OmniGenerationServiceError } from "../src/application/owner-wan30-omni-generation-service.js";
import type { OwnerWan30OmniGenerationIntent } from "../src/application/owner-wan30-omni-generation-parameters.js";
import { OwnerWan30ReferenceGenerationService, OwnerWan30ReferenceGenerationServiceError } from "../src/application/owner-wan30-reference-generation-service.js";
import type { OwnerWan30ReferenceGenerationIntent } from "../src/application/owner-wan30-reference-generation-parameters.js";
import { createOwnerWan30EditOriginalProbe } from "../src/adapter/syntx/owner-wan30-edit-original-probe.js";
import type { OwnerWan30EditOriginalProbeRunner } from "../src/adapter/syntx/owner-wan30-edit-original-probe.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthBinding } from "../src/auth/types.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";

const NOW = Date.parse("2026-10-16T08:00:00.000Z");
const ATTEMPTS = ["link_cached_claim_owner_a_00000000001", "link_cached_claim_owner_b_00000000002"] as const;
const BINDING: AuthBinding = Object.freeze({ tenant_id: "synthetic-tenant", subject: "synthetic-mcp-subject" });
const CATALOG_VERSION = "sha256-19c882601bb8ecdba994adf819544ebf06fd2db30374335631bb6078a66e5a76.json";
const CATALOG_DIRECTORY = join(process.cwd(), "catalog");
const CATALOG = new DiscoveryCatalogRepository(loadPublicCatalogVersion(CATALOG_VERSION, CATALOG_DIRECTORY));
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const MP4 = Buffer.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0, 0x69, 0x73, 0x6f, 0x6d]);
const PROMPT = "Synthetic identical prompt for cached-claim isolation.";
const OMNI: OwnerWan30OmniGenerationIntent = Object.freeze({ model_id: "wan_30_omni", prompt: PROMPT,
  parameters: Object.freeze({ aspect_ratio: "16:9", resolution: "480P", video_duration: 2, prompt_extend: true, shot_type: "single", audio_setting: "auto", seed: null, native_audio: false, duration: 0, rendering_speed: "basic" }) });
const REFERENCE: OwnerWan30ReferenceGenerationIntent = Object.freeze({ model_id: "wan_30_reference", prompt: PROMPT,
  parameters: Object.freeze({ aspect_ratio: "16:9", resolution: "480P", video_duration: 2, prompt_extend: true, shot_type: "single", audio_setting: "auto", seed: null, native_audio: false, duration: 0, rendering_speed: "basic" }) });
const EDIT: OwnerWan30EditGenerationIntent = Object.freeze({ model_id: "wan_30_edit", prompt: PROMPT,
  parameters: Object.freeze({ aspect_ratio: "16:9", resolution: "480P", video_duration: 2, prompt_extend: true, shot_type: "single", audio_setting: "auto", seed: null, native_audio: true, duration: 2, rendering_speed: "basic" }) });
const FIRST_LAST: OwnerWan30FirstLastGenerationIntent = Object.freeze({ model_id: "wan_30_first_last_frame", prompt: PROMPT,
  parameters: Object.freeze({ aspect_ratio: "16:9", resolution: "480P", video_duration: 2, prompt_extend: true, seed: null, native_audio: false, rendering_speed: "basic" }) });
const TEMP_DIRS: string[] = [];
after(async () => { await Promise.all(TEMP_DIRS.map((directory) => rm(directory, { recursive: true, force: true }))); });

type Family = "omni" | "reference" | "edit" | "first-last";
interface Job { readonly actor: string; readonly chat: string; readonly model: string; readonly prompt: string; readonly referenceUrls: readonly string[]; readonly ack: string; readonly output: string }
interface SyntheticWorld {
  readonly linkService: PerUserLinkService;
  readonly clients: ReadonlyMap<string, SyntxChatHttpClient>;
  readonly jobs: Job[];
  readonly generationPostsByAttempt: Map<string, number>;
  readonly clientFor: (attemptId: string) => SyntxChatHttpClient;
  readonly createAccountStatusService: (attemptId: string) => AccountStatusService;
  readonly createModelAccessService: (attemptId: string, catalog: DiscoveryCatalogRepository) => ModelAccessService;
  readonly probe: OwnerWan30EditOriginalProbeRunner;
}

function ffprobeMetadata(): string { return JSON.stringify({ streams: [{ codec_type: "video", width: 854, height: 480, duration: "2.000000", avg_frame_rate: "30/1", r_frame_rate: "30/1", nb_frames: "60" }], format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "2.000000" } }); }
async function makeProbe() {
  const directory = await mkdtemp(join(tmpdir(), "wan30-claim-isolation-")); TEMP_DIRS.push(directory);
  const binary = join(directory, "ffprobe-fixture"), script = `process.stdout.write(${JSON.stringify(ffprobeMetadata())});`;
  await writeFile(binary, `#!${process.execPath}\n${script}\n`, { mode: 0o700, flag: "wx" });
  return createOwnerWan30EditOriginalProbe({ ffprobePath: binary });
}

async function linkTwoSyntheticAccounts(): Promise<PerUserLinkService> {
  let next = 0;
  const store = new InMemoryAuthLinkStore(() => NOW);
  const linkService = new PerUserLinkService({} as never, store, { now: () => NOW, attemptIdGenerator: () => ATTEMPTS[next++]! });
  for (const [index, attemptId] of ATTEMPTS.entries()) {
    const created = await linkService.createAttempt(BINDING);
    assert.equal(created.attempt_id, attemptId);
    await store.beginHandoff(BINDING, attemptId);
    await store.attachChallenge(BINDING, attemptId, `synthetic-upstream-${index}`);
    await store.beginPoll(BINDING, attemptId);
    await store.markLinked(BINDING, attemptId, Object.freeze({ scheme: "Bearer", value: `synthetic-account-${index}` }));
  }
  assert.equal((await linkService.getStatus(BINDING, ATTEMPTS[0])).status, "LINKED");
  assert.equal((await linkService.getStatus(BINDING, ATTEMPTS[1])).status, "LINKED");
  const firstCredential = await store.useCredential(BINDING, ATTEMPTS[0], (credential) => credential.value);
  const secondCredential = await store.useCredential(BINDING, ATTEMPTS[1], (credential) => credential.value);
  assert.notEqual(firstCredential, secondCredential, "synthetic linked attempts represent different Telegram accounts");
  return linkService;
}

async function world(): Promise<SyntheticWorld> {
  const linkService = await linkTwoSyntheticAccounts(), jobs: Job[] = [], generationPostsByAttempt = new Map<string, number>(), clients = new Map<string, SyntxChatHttpClient>();
  let probePromise: ReturnType<typeof makeProbe> | undefined;
  const lazyProbe: OwnerWan30EditOriginalProbeRunner = Object.freeze({
    probe: async (input: unknown) => (await (probePromise ??= makeProbe())).probe(input)
  });
  let uploadSequence = 0, chatSequence = 0, messageSequence = 0;
  const brokerFor = (attemptId: string): SyntxCredentialBroker => ({
    async useCredential<T>(operation: (credential: string) => Promise<T>) {
      const record = await linkService.getStatus(BINDING, attemptId);
      if (!record.linked) throw new Error("Synthetic account is not linked");
      return operation(`synthetic-token-for-${attemptId}`);
    }
  });
  const fetchFor = (actor: string): typeof fetch => async (input, init) => {
    const url = new URL(String(input)), method = init?.method ?? "GET";
    let body: unknown = null;
    if (typeof init?.body === "string") body = JSON.parse(init.body);
    if (url.pathname === "/api/v1/user/balance") return Response.json({ balance: "1000" });
    if (url.pathname === "/api/v1/user/subscription") return Response.json({ active: true, type: "PRO", end_date: "2026-10-17T08:00:00.000Z" });
    if (url.pathname === "/api/v2/get_model_info") return Response.json({ access: true, cost: 1, discount_cost: null, free_remaining_generations: null, limit: null, show_warning: null });
    if (url.pathname === "/api/v1/chats/upload-files" && method === "POST") {
      uploadSequence += 1;
      return Response.json({ files: [{ id: `synthetic-file-${uploadSequence}`, url: `https://r2.syntx.ai/synthetic-reference-${uploadSequence}.mp4` }] });
    }
    if (url.pathname === "/api/v1/chats" && method === "POST") { chatSequence += 1; return Response.json({ uuid: `synthetic-chat-${chatSequence}` }); }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") {
      const request = body as { chat_id: string; prompt: string; settings: { model_type: string; file_urls?: readonly { url: string }[] } };
      messageSequence += 1;
      const job: Job = { actor, chat: request.chat_id, model: request.settings.model_type, prompt: request.prompt,
        referenceUrls: Object.freeze((request.settings.file_urls ?? []).map((reference) => reference.url)), ack: String(900_000 + messageSequence),
        output: `https://r2.syntx.ai/synthetic-output-${messageSequence}.mp4` };
      jobs.push(job); generationPostsByAttempt.set(actor, (generationPostsByAttempt.get(actor) ?? 0) + 1);
      return Response.json({ id: Number(job.ack) });
    }
    const chatPath = /^\/api\/v1\/chats\/(synthetic-chat-\d+)\/(\d{1,16}|messages|synthetic-bot-synthetic-chat-\d+)$/u.exec(url.pathname);
    if (chatPath) {
      const job = [...jobs].reverse().find((candidate) => candidate.chat === chatPath[1]); assert.ok(job);
      if (chatPath[2] === "messages") {
        const ownerObjects = historyOwnerObjects(job);
        const messages = [
          { id: job.ack, chat_id: 4123, author_id: 501, message_object: ownerObjects },
          { id: `synthetic-bot-${job.chat}`, chat_id: 4123, author_id: -1, message_object: [{ id: `synthetic-result-${job.chat}`, message_id: `synthetic-bot-${job.chat}`, object_type: "video", model_type: job.model }] }
        ];
        return Response.json({ messages, pagination: { page: Number(url.searchParams.get("page")), page_size: 10, total_count: messages.length, total_pages: 1, has_next: false, has_previous: false } });
      }
      if (chatPath[2] === job.ack) return Response.json({ id: Number(job.ack), chat_id: 4123, author_id: 501, message_object: liveAckObjects(job) });
      return Response.json({ id: chatPath[2], chat_id: 4123, author_id: -1, message_object: [{ id: `synthetic-result-${job.chat}`, message_id: chatPath[2], object_type: "video", model_type: job.model, completed: true, object_url: job.output }] });
    }
    if (/\/inprogress$/u.test(url.pathname)) return Response.json([]);
    throw new Error(`Unexpected synthetic ${method} ${url.pathname} by ${actor}`);
  };
  for (const attemptId of ATTEMPTS) clients.set(attemptId, new SyntxChatHttpClient({ credentialBroker: brokerFor(attemptId), fetchImpl: fetchFor(attemptId), maxResponseBytes: 1024 * 1024 }));
  const clientFor = (attemptId: string) => clients.get(attemptId)!;
  const httpFor = (attemptId: string) => new SyntxHttpClient({ credentialBroker: brokerFor(attemptId), fetchImpl: fetchFor(attemptId) });
  const createAccountStatusService = (attemptId: string) => new AccountStatusService(httpFor(attemptId), () => NOW);
  const createModelAccessService = (attemptId: string, catalog: DiscoveryCatalogRepository) => new ModelAccessService(catalog, httpFor(attemptId), () => NOW);
  return { linkService, clients, jobs, generationPostsByAttempt, createAccountStatusService, createModelAccessService, probe: lazyProbe, clientFor };
}

function historyOwnerObjects(job: Job): Array<Record<string, unknown>> {
  if (job.model === "wan_30_first_last_frame") return [
    { id: "owner-text", message_id: job.ack, object_type: "text", model_type: job.model },
    { id: "owner-first", message_id: job.ack, object_type: "image", model_type: job.model },
    { id: "owner-last", message_id: job.ack, object_type: "image", model_type: job.model }
  ];
  const referenceType = job.model === "wan_30_edit" ? "video" : "image";
  return [
    { id: "owner-text", message_id: job.ack, object_type: "text", model_type: job.model },
    { id: "owner-reference", message_id: job.ack, object_type: referenceType, model_type: job.model }
  ];
}
function isClaimError(family: Family, error: unknown): error is Error & { code: string; recovery_id?: string; diagnostic?: unknown } {
  if (family === "omni") return error instanceof OwnerWan30OmniGenerationServiceError && error.code === "INTENT_ALREADY_CLAIMED";
  if (family === "reference") return error instanceof OwnerWan30ReferenceGenerationServiceError && error.code === "INTENT_ALREADY_CLAIMED";
  if (family === "edit") return error instanceof OwnerWan30EditGenerationServiceError && error.code === "INTENT_ALREADY_CLAIMED";
  return error instanceof OwnerWan30FirstLastGenerationServiceError && error.code === "INTENT_ALREADY_CLAIMED";
}
function liveAckObjects(job: Job): Array<Record<string, unknown>> {
  const history = historyOwnerObjects(job);
  return history.map((item, index) => ({ id: 920_000 + index, message_id: Number(job.ack), object_type: item.object_type,
    model_type: job.model, object_text: item.object_type === "text" ? job.prompt : null,
    object_url: item.object_type === "image" || item.object_type === "video" ? job.referenceUrls[index === 0 ? 0 : index - 1] ?? job.referenceUrls[0] : null,
    completed: null, task_id: null }));
}

function servicesFor(input: SyntheticWorld & { clientFor: (attemptId: string) => SyntxChatHttpClient }): {
  readonly omni: OwnerWan30OmniGenerationService; readonly reference: OwnerWan30ReferenceGenerationService;
  readonly edit: OwnerWan30EditGenerationService; readonly firstLast: OwnerWan30FirstLastGenerationService;
} {
  const common = { binding: BINDING, linkService: input.linkService, catalog: CATALOG, catalog_version: CATALOG_VERSION,
    catalogDirectory: CATALOG_DIRECTORY, resolveClient: input.clientFor, createAccountStatusService: input.createAccountStatusService,
    createModelAccessService: input.createModelAccessService, now: () => NOW, timeoutMs: 10_000 };
  return { omni: new OwnerWan30OmniGenerationService(common), reference: new OwnerWan30ReferenceGenerationService(common),
    edit: new OwnerWan30EditGenerationService({ ...common, originalProbe: input.probe }),
    firstLast: new OwnerWan30FirstLastGenerationService(common) };
}

async function perform(family: Family, service: ReturnType<typeof servicesFor>["omni"] | ReturnType<typeof servicesFor>["reference"] | ReturnType<typeof servicesFor>["edit"] | ReturnType<typeof servicesFor>["firstLast"], attemptId: string): Promise<{ readonly result: { readonly recovery_id: string; readonly artifacts: readonly { readonly url: string }[] }; readonly repeat: () => Promise<unknown> }> {
  if (family === "omni") {
    const target = service as OwnerWan30OmniGenerationService, upload = await target.uploadOmniImage({ attemptId, content_base64: PNG.toString("base64"), filename: "source.png", mime_type: "image/png" });
    const result = await target.generate({ attemptId, input: OMNI, image_handle: upload.image_handle });
    return { result, repeat: () => target.generate({ attemptId, input: OMNI, image_handle: upload.image_handle }) };
  }
  if (family === "reference") {
    const target = service as OwnerWan30ReferenceGenerationService, upload = await target.uploadReferenceImage({ attemptId, content_base64: PNG.toString("base64"), filename: "source.png", mime_type: "image/png" });
    const result = await target.generate({ attemptId, input: REFERENCE, image_handle: upload.image_handle });
    return { result, repeat: () => target.generate({ attemptId, input: REFERENCE, image_handle: upload.image_handle }) };
  }
  if (family === "edit") {
    const target = service as OwnerWan30EditGenerationService, upload = await target.uploadEditVideo({ attemptId, content_base64: MP4.toString("base64"), filename: "source.mp4", mime_type: "video/mp4" });
    const result = await target.generate({ attemptId, input: EDIT, video_handle: upload.video_handle });
    return { result, repeat: () => target.generate({ attemptId, input: EDIT, video_handle: upload.video_handle }) };
  }
  const target = service as OwnerWan30FirstLastGenerationService;
  const first = await target.upload({ attemptId, role: "first_frame", content_base64: PNG.toString("base64"), filename: "first.png", mime_type: "image/png" });
  const last = await target.upload({ attemptId, role: "last_frame", content_base64: PNG.toString("base64"), filename: "last.png", mime_type: "image/png" });
  const result = await target.generate({ attemptId, input: FIRST_LAST, first_frame_handle: first.frame_handle, last_frame_handle: last.frame_handle });
  return { result, repeat: () => target.generate({ attemptId, input: FIRST_LAST, first_frame_handle: first.frame_handle, last_frame_handle: last.frame_handle }) };
}

async function verifyFamily(family: Family): Promise<void> {
  const input = await world(), targets = servicesFor(input), service = targets[family === "first-last" ? "firstLast" : family];
  try {
    assert.notEqual(input.clients.get(ATTEMPTS[0]), input.clients.get(ATTEMPTS[1]));
    const first = await perform(family, service, ATTEMPTS[0]);
    assert.equal(first.result.artifacts.length, 1);
    assert.equal(input.generationPostsByAttempt.get(ATTEMPTS[0]), 1);
    const beforeB = input.generationPostsByAttempt.get(ATTEMPTS[1]) ?? 0;
    let foreignResult: Awaited<ReturnType<typeof perform>> | undefined, foreignError: unknown;
    try { foreignResult = await perform(family, service, ATTEMPTS[1]); } catch (error) { foreignError = error; }
    assert.ok(isClaimError(family, foreignError), foreignResult
      ? `attempt B received attempt A recovery_id=${foreignResult.result.recovery_id} artifact_url=${foreignResult.result.artifacts[0]?.url}`
      : `attempt B did not receive the typed INTENT_ALREADY_CLAIMED error: ${String(foreignError)}`);
    const isolatedError = foreignError as { recovery_id?: string; diagnostic?: unknown; message?: string };
    assert.equal(isolatedError.recovery_id, undefined);
    assert.equal(isolatedError.diagnostic, undefined);
    assert.ok(!String(isolatedError.message ?? "").includes(first.result.artifacts[0]!.url));
    assert.equal(input.generationPostsByAttempt.get(ATTEMPTS[1]) ?? 0, beforeB, "foreign claim must not post another generation");
    const ownCached = await first.repeat() as { recovery_id: string; artifacts: readonly { url: string }[] };
    assert.equal(ownCached.recovery_id, first.result.recovery_id);
    assert.equal(ownCached.artifacts[0]?.url, first.result.artifacts[0]?.url);
  } finally {
    await Promise.all([targets.omni.close(), targets.reference.close(), targets.edit.close(), targets.firstLast.close()]);
  }
}

test("multiple linked attempts for one MCP binding are isolated from cross-attempt cached generation claims", async (t) => {
  for (const family of ["omni", "reference", "edit", "first-last"] as const) {
    await t.test(family, async (subtest) => {
      if (family === "edit" && process.platform === "win32") {
        subtest.skip("POSIX executable fixture; real Windows ffprobe acceptance NOT_RUN");
        return;
      }
      await verifyFamily(family);
    });
  }
});
