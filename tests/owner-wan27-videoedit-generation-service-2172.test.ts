import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import { getOwnerWan27VideoEditSourceProfile } from "../src/application/owner-wan27-videoedit-parameters.js";
import {
  createWan27VideoEditRuntimeFixture,
  WAN27_VIDEOEDIT_FIXTURE_ATTEMPT,
  WAN27_VIDEOEDIT_FIXTURE_IMAGE_URL,
  WAN27_VIDEOEDIT_FIXTURE_VIDEO_URL,
  type Wan27VideoEditRuntimeFixture
} from "./helpers/wan27-videoedit-runtime-fixture-2172.js";

const CATALOG_VERSION = "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json";
const PROMPT = "A slow camera move through a bright studio.";
let serial = 0;

type Context = Record<string, any>;
interface Api {
  readonly OwnerWan27VideoEditGenerationService: new (options: unknown) => Context;
  readonly OwnerWan27VideoEditGenerationServiceError: new (code: string) => Error & { readonly code: string; readonly recovery_id?: string };
  readonly OwnerWan27VideoEditReferenceService: new (options: unknown) => Context;
  createOwnerWan27VideoEditRequestPreparer(options: unknown): Context;
}
interface Runtime extends Wan27VideoEditRuntimeFixture {
  readonly api: Api;
  readonly service: Context;
  readonly referenceService: Context;
  readonly handles: readonly string[];
  readonly prompt: string;
  close(): Promise<void>;
}

async function loadApi(): Promise<Api> {
  let api: Partial<Api> = {};
  try {
    const [generation, references, preparer] = await Promise.all([
      import(new URL("../src/application/owner-wan27-videoedit-generation-service.js", import.meta.url).href),
      import(new URL("../src/application/owner-wan27-videoedit-reference-service.js", import.meta.url).href),
      import(new URL("../src/application/owner-wan27-videoedit-request-preparer.js", import.meta.url).href)
    ]);
    api = { ...generation, ...references, ...preparer };
  }
  catch (error) { if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ERR_MODULE_NOT_FOUND") throw error; }
  assert.equal(typeof api.OwnerWan27VideoEditGenerationService, "function", "the new exact WAN27 generation service must exist");
  return api as Api;
}

async function createRuntime(overrides: Parameters<typeof createWan27VideoEditRuntimeFixture>[0] = {}): Promise<Runtime> {
  const api = await loadApi();
  const fixture = await createWan27VideoEditRuntimeFixture(overrides);
  const profile = getOwnerWan27VideoEditSourceProfile();
  const catalog = new DiscoveryCatalogRepository(loadPublicCatalogVersion(CATALOG_VERSION, resolve(process.cwd(), "catalog")));
  const chatClient = fixture.createChatClient();
  const referenceService = new api.OwnerWan27VideoEditReferenceService({ binding: fixture.binding, linkService: fixture.linkService,
    resolveClient: () => chatClient, ffprobePath: fixture.ffprobePath, now: fixture.now });
  const preparer = api.createOwnerWan27VideoEditRequestPreparer({ referenceService, now: fixture.now });
  let service: Context | undefined;
  try {
    const image = await referenceService.uploadReference({ attemptId: fixture.attemptId, model_id: "wan_27_videoedit",
      filename: "reference.png", mime_type: "image/png", bytes: makePng() });
    const video = await referenceService.uploadReference({ attemptId: fixture.attemptId, model_id: "wan_27_videoedit",
      filename: "source.mp4", mime_type: "video/mp4", bytes: fixture.videoBytes() });
    const createAccountStatusService = () => new AccountStatusService(fixture.createReadClient(), fixture.now);
    const createModelAccessService = () => new ModelAccessService(catalog, fixture.createReadClient(), fixture.now);
    service = new api.OwnerWan27VideoEditGenerationService({ binding: fixture.binding, linkService: fixture.linkService, catalog,
      catalog_version: profile.source_pins.public_catalog_version, preparer, referenceService,
      resolveChatClient: () => chatClient, createAccountStatusService, createModelAccessService,
      resolveSubscription: (_attemptId: string, signal?: AbortSignal) => fixture.createReadClient().getSubscription(signal), now: fixture.now });
    return Object.assign(fixture, { api, service, referenceService, handles: [image.reference_handle, video.reference_handle], prompt: `${PROMPT} ${++serial}`,
      async close() { await service?.close(); await preparer.close(); await referenceService.close(); await fixture.cleanup(); } });
  } catch (error) {
    await service?.close(); await preparer.close(); await referenceService.close(); await fixture.cleanup(); throw error;
  }
}

function makePng(width = 300, height = 300): Buffer {
  const chunk = (name: string, data: Buffer) => {
    const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length); out.write(name, 4); data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, -4)), out.length - 4); return out;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const idat = Buffer.from([120, 156, 99, 0, 0, 0, 2, 0, 1]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}
function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); }
  return (crc ^ 0xffff_ffff) >>> 0;
}
function input(handles: readonly string[], prompt: string, attemptId = WAN27_VIDEOEDIT_FIXTURE_ATTEMPT) {
  return { attemptId, model_id: "wan_27_videoedit", prompt, resolution: "720P", aspect_ratio: "16:9",
    audio_setting: "origin", prompt_extend: false, seed: 0, duration_mode: "preserve_input", reference_handles: [...handles] };
}

test("2172 success binds mixed owned inputs, exact WAN wire and fresh fractional cost twice", async () => {
  const runtime = await createRuntime();
  try {
    const result = await runtime.service.generate(input(runtime.handles, runtime.prompt));
    assert.equal(result.status, "completed"); assert.equal(result.model_id, "wan_27_videoedit");
    assert.equal(result.backend_acceptance, "UNPROVEN"); assert.equal(result.provider_terminal_status, "UNPROVEN");
    assert.equal(result.cost_cap_enforced, false);
    assert.equal(result.source_binding.public_catalog_version, CATALOG_VERSION);
    assert.equal(result.source_binding.profile_sha256, getOwnerWan27VideoEditSourceProfile().source_sha256);
    assert.match(result.recovery_id, /^wan27_videoedit_recovery_[0-9a-f-]{36}$/u);
    assert.deepEqual(runtime.stats.quoteParameters[0], { duration: "4.25", resolution: "720P", video_duration: "4.25" });
    assert.deepEqual(runtime.stats.lastSettings, { model_type: "wan_27_videoedit", resolution: "720P", aspect_ratio: "16:9",
      video_duration: 4.25, audio_setting: "origin", prompt_extend: false, seed: 0, native_audio: false, shot_type: "single",
      duration: 4.25, rendering_speed: "basic", file_urls: [
        { type: "image", url: WAN27_VIDEOEDIT_FIXTURE_IMAGE_URL }, { type: "video", url: WAN27_VIDEOEDIT_FIXTURE_VIDEO_URL }
      ] });
    assert.deepEqual({ uploads: runtime.stats.uploadPosts, chats: runtime.stats.chatPosts, generations: runtime.stats.generationPosts,
      history: runtime.stats.historyGets, results: runtime.stats.resultGets, quotes: runtime.stats.accessReads,
      balances: runtime.stats.accountReads, subscriptions: runtime.stats.subscriptionReads },
    { uploads: 2, chats: 1, generations: 1, history: 1, results: 1, quotes: 2, balances: 2, subscriptions: 4 });
  } finally { await runtime.close(); }
});

test("2172 free plan, denied access, and insufficient balance block WAN GEN", async (t) => {
  for (const patch of [{ free: true }, { denied: true }, { lowBalance: true }] as const) {
    await t.test(JSON.stringify(patch), async () => {
      const runtime = await createRuntime(patch);
      try {
        await assert.rejects(runtime.service.generate(input(runtime.handles, runtime.prompt)));
        assert.equal(runtime.stats.generationPosts, 0); assert.equal(runtime.stats.chatPosts, 0);
      } finally { await runtime.close(); }
    });
  }
});

test("2172 stale second quote after chat creation blocks the one GEN POST", async () => {
  const runtime = await createRuntime({ staleSecondQuote: true });
  try {
    await assert.rejects(runtime.service.generate(input(runtime.handles, runtime.prompt)));
    assert.equal(runtime.stats.chatPosts, 1); assert.equal(runtime.stats.accessReads, 2);
    assert.equal(runtime.stats.accountReads, 2); assert.equal(runtime.stats.generationPosts, 0);
  } finally { await runtime.close(); }
});

test("2172 lost generation acknowledgement remains unknown and GET reconciliation never retries GEN", async () => {
  const runtime = await createRuntime({ loseAck: true });
  try {
    let recoveryId = "";
    await assert.rejects(runtime.service.generate(input(runtime.handles, runtime.prompt)), (error: unknown) => {
      assert.ok(error instanceof runtime.api.OwnerWan27VideoEditGenerationServiceError);
      recoveryId = error.recovery_id ?? "";
      return error.code === "OUTCOME_UNKNOWN" && /^wan27_videoedit_recovery_/u.test(recoveryId);
    });
    assert.equal(runtime.stats.generationPosts, 1);
    await assert.rejects(runtime.service.reconcile({ attemptId: WAN27_VIDEOEDIT_FIXTURE_ATTEMPT, recovery_id: recoveryId }), (error: unknown) =>
      error instanceof runtime.api.OwnerWan27VideoEditGenerationServiceError && error.code === "OUTCOME_UNKNOWN" && error.recovery_id === recoveryId);
    assert.equal(runtime.stats.generationPosts, 1); assert.equal(runtime.stats.historyGets, 0); assert.equal(runtime.stats.resultGets, 0);
  } finally { await runtime.close(); }
});

test("2172 known-ack pending recovery remains GET-only after reference TTL expires", async () => {
  const runtime = await createRuntime({ initiallyPending: true });
  try {
    let recoveryId = "";
    await assert.rejects(runtime.service.generate(input(runtime.handles, runtime.prompt)), (error: unknown) => {
      recoveryId = (error as { recovery_id?: string }).recovery_id ?? ""; return true;
    });
    assert.ok(recoveryId); assert.equal(runtime.stats.generationPosts, 1);
    runtime.setHistoryReady(true); runtime.advanceTime(16 * 60_000);
    const result = await runtime.service.reconcile({ attemptId: WAN27_VIDEOEDIT_FIXTURE_ATTEMPT, recovery_id: recoveryId });
    assert.equal(result.status, "completed"); assert.equal(result.recovery_id, recoveryId);
    assert.equal(runtime.stats.generationPosts, 1);
  } finally { await runtime.close(); }
});
