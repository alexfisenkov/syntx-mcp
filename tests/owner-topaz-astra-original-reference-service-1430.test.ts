import assert from "node:assert/strict";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import test from "node:test";

const SERVICE_MODULE_URL = new URL("../src/application/owner-topaz-astra-original-reference-service.js", import.meta.url).href;
const serviceModule = await import(SERVICE_MODULE_URL).catch(() => null) as Record<string, unknown> | null;
const ATTEMPT = "link_topaz_owner_reference_0123456789";
const BINDING = Object.freeze({ tenant_id: "topaz-reference-tenant", subject: "topaz-reference-owner" });
const MP4 = Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
  0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x32]);
const UPLOAD_URL = "https://r2.syntx.ai/topaz/uploaded/source.mp4";

function broker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>) { return operation("synthetic-topaz-owner-credential"); } };
}
function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}
async function createLinkedOwnerLinkService(attemptIds: readonly string[] = [ATTEMPT], now = () => 1_000) {
  let nextAttemptIndex = 0;
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: `synthetic-${attemptIds[nextAttemptIndex - 1]}`, approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: "synthetic-owner-token" });
      return { state: "LINKED" };
    }
  };
  const store = new InMemoryAuthLinkStore(now);
  const links = new PerUserLinkService(provider, store, { now, attemptIdGenerator: () => attemptIds[nextAttemptIndex++]! });
  for (const attemptId of attemptIds) {
    await links.createAttempt(BINDING); await links.issueHandoff(BINDING, attemptId); await links.checkAttempt(BINDING, attemptId);
  }
  return links;
}
async function ffprobeFixture() {
  const directory = await mkdtemp(join(tmpdir(), "syntx-topaz-service-"));
  const binary = join(directory, "ffprobe");
  await writeFile(binary, "#!/bin/sh\nprintf '%s' '{\"streams\":[{\"codec_type\":\"video\",\"codec_name\":\"h264\",\"width\":640,\"height\":360,\"nb_read_frames\":\"72\"}],\"format\":{\"format_name\":\"mov,mp4,m4a,3gp,3g2,mj2\",\"duration\":\"3.0\"}}'\n");
  await chmod(binary, 0o700);
  return { directory, binary };
}

test("Topaz owned original service module is present and requires live PerUserLinkService state", async () => {
  assert.ok(serviceModule, "MISSING_OWNER_TOPAZ_ASTRA_ORIGINAL_REFERENCE_SERVICE_MODULE");
  assert.equal(typeof serviceModule.OwnerTopazAstraOriginalReferenceService, "function");
  const Service = serviceModule.OwnerTopazAstraOriginalReferenceService as new (options: unknown) => {
    uploadOriginal(input: unknown): Promise<unknown>;
    close(): Promise<void>;
  };
  assert.throws(() => new Service({ ffprobePath: "/trusted/ffprobe", destination: "hidden", binding: BINDING,
    linkService: { async getStatus() { return { linked: true }; } }, resolveClient: () => null }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_REQUEST",
    "a DTO-shaped link-service mock must not count as genuine owner-link evidence");
  let clientLookups = 0;
  const prototypeClone = Object.create(PerUserLinkService.prototype) as PerUserLinkService;
  const cloneService = new Service({ ffprobePath: "/trusted/ffprobe", destination: "hidden", binding: BINDING,
    linkService: prototypeClone, resolveClient: () => { clientLookups += 1; return null; } });
  try {
    await assert.rejects(() => cloneService.uploadOriginal({ attemptId: ATTEMPT, model_id: "slp-2.5",
      filename: "original.mp4", mime_type: "video/mp4", bytes: MP4 }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "PRINCIPAL_NOT_LINKED",
      "a prototype-only clone cannot pass the real PerUserLinkService private-state check");
    assert.equal(clientLookups, 0, "the invalid link stops before client resolution and media probe");
  } finally { await cloneService.close(); }
});

test("trusted probe and hidden native upload produce only an owner handle, then release on close", async () => {
  const fixture = await ffprobeFixture();
  const now = () => 1_000;
  const linkService = await createLinkedOwnerLinkService([ATTEMPT], now);
  let fetchCalls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (input, init) => {
    fetchCalls += 1;
    assert.equal(new URL(String(input)).href, "https://api.syntx.ai/api/v1/chats/upload-files");
    const form = init?.body as FormData;
    assert.deepEqual(Array.from(form.keys()), ["files", "destination", "check_duplicates", "model_type"]);
    assert.equal(form.get("destination"), "hidden");
    assert.equal(form.get("check_duplicates"), "true");
    assert.equal(form.get("model_type"), "slp-2.5");
    const file = form.get("files");
    assert.ok(file instanceof File);
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()), MP4);
    return response({ files: [{ filename: "original.mp4", url: UPLOAD_URL, status: "success", size: MP4.byteLength,
      content_type: "video/mp4", duration: 3 }] });
  } });
  const Service = serviceModule?.OwnerTopazAstraOriginalReferenceService as (new (options: unknown) => {
    uploadOriginal(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
    resolveOriginal(input: unknown): Promise<Record<string, unknown>>;
    isOwnedOriginalResolution(value: unknown, input: unknown): boolean;
    withCapturedNativeOriginal<T>(value: unknown, input: unknown, consume: (client: unknown, reference: unknown) => T): T;
    invalidateAttempt(attemptId: unknown): Promise<void>;
    close(): Promise<void>;
  }) | undefined;
  assert.equal(typeof Service, "function");
  const service = new Service!({ ffprobePath: fixture.binary, destination: "hidden", binding: BINDING, linkService,
    resolveClient: () => client, now });
  try {
    const source = new Uint8Array(MP4);
    const receipt = await service.uploadOriginal({ attemptId: ATTEMPT, model_id: "slp-2.5", filename: "original.mp4",
      mime_type: "video/mp4", bytes: source });
    assert.deepEqual(source, MP4, "input bytes remain caller-owned");
    assert.equal(fetchCalls, 1);
    assert.equal(receipt.status, "uploaded");
    assert.match(String(receipt.topaz_original_handle), /^topaz_astra_original_[0-9a-f-]{36}$/u);
    assert.equal(receipt.duration_seconds, 3);
    assert.equal(receipt.decoded_frame_count, 72);
    assert.equal(receipt.expires_in_seconds, 900);
    for (const privateValue of [UPLOAD_URL, "original.mp4"]) assert.equal(JSON.stringify(receipt).includes(privateValue), false);
    const context = { attempt_id: ATTEMPT, topaz_original_handle: receipt.topaz_original_handle };
    const resolution = await service.resolveOriginal(context);
    assert.equal(service.isOwnedOriginalResolution(resolution, context), true);
    const native = service.withCapturedNativeOriginal(resolution, context, (capturedClient, reference) => ({ capturedClient, reference }));
    assert.equal(native.capturedClient, client);
    await service.invalidateAttempt(ATTEMPT);
    assert.equal(service.isOwnedOriginalResolution(resolution, context), false);
  } finally {
    await service.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("native upload UNKNOWN is suppressed across attempts and fresh probes for the same bytes", async () => {
  const fixture = await ffprobeFixture();
  let posts = 0;
  const secondAttempt = "link_topaz_owner_reference_abcdefghij";
  const linkService = await createLinkedOwnerLinkService([ATTEMPT, secondAttempt]);
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => { posts += 1; throw new Error("synthetic disconnect"); } });
  const Service = serviceModule!.OwnerTopazAstraOriginalReferenceService as new (options: unknown) => {
    uploadOriginal(input: unknown): Promise<unknown>; close(): Promise<void>;
  };
  const service = new Service({ ffprobePath: fixture.binary, destination: "hidden", binding: BINDING, linkService, resolveClient: () => client, now: () => 1_000 });
  try {
    const input = { attemptId: ATTEMPT, model_id: "slp-2.5", filename: "original.mp4", mime_type: "video/mp4", bytes: MP4 };
    await assert.rejects(() => service.uploadOriginal(input), (error: unknown) => error instanceof Error && "code" in error && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    await assert.rejects(() => service.uploadOriginal({ ...input, attemptId: secondAttempt }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    assert.equal(posts, 1);
  } finally { await service.close(); await rm(fixture.directory, { recursive: true, force: true }); }
});
