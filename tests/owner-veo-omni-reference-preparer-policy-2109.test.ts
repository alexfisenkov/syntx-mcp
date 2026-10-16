import assert from "node:assert/strict";
import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { OwnerVeoOmniReferenceService } from "../src/application/owner-veo-omni-reference-service.js";
import type { OwnerVeoOmniReferenceWireCandidate } from "../src/application/owner-veo-omni-reference-wire.js";
import { getOwnerVeoOmniReferenceProfile } from "../src/application/owner-veo-omni-reference-profile.js";

const ATTEMPT_A = "link_veo_omni_2109_owner_0123456789abcdef";
const ATTEMPT_B = "link_veo_omni_2109_owner_fedcba9876543210";
const ATTEMPT_C = "link_veo_omni_2109_owner_0011223344556677";
const BINDING = Object.freeze({ tenant_id: "veo-omni-preparer-2109-tenant", subject: "veo-omni-preparer-2109-owner" });
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const NOW = 10_000;

interface PreparedCandidate extends Readonly<Record<string, unknown>> {
  readonly status: "blocked";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly model_id: "veo_omni";
  readonly profile_sha256: string;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly expires_at: number;
  readonly sources: readonly Readonly<Record<string, unknown>>[];
}
interface CandidateBinding extends Readonly<Record<string, unknown>> {
  readonly attempt_id: string;
  readonly principal: Readonly<{ tenant_id: string; subject_id: string; connection_id: string }>;
  readonly model_id: "veo_omni";
  readonly profile_sha256: string;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly expires_at: number;
  readonly reference_epoch: number;
  readonly sources: readonly Readonly<Record<string, unknown>>[];
  readonly cost_parameters: Readonly<Record<string, unknown>>;
}
interface Preparer {
  prepare(input: unknown, signal?: AbortSignal): Promise<PreparedCandidate>;
  inspectCandidate(candidate: unknown): CandidateBinding | undefined;
  getPrivateRequest(candidate: unknown): OwnerVeoOmniReferenceWireCandidate;
  revalidateCandidate(candidate: unknown, signal?: AbortSignal): Promise<CandidateBinding>;
  withCapturedReferences<T>(candidate: unknown, consume: (client: SyntxChatHttpClient, wire: OwnerVeoOmniReferenceWireCandidate) => T): T;
  isBoundToReferenceService(service: unknown): boolean;
  invalidateAttempt(attemptId: unknown): Promise<void>;
  close(): Promise<void>;
}
interface PreparerModule {
  readonly createOwnerVeoOmniReferenceRequestPreparer: (input: unknown) => Preparer;
  readonly isOwnerVeoOmniReferenceRequestPreparer: (value: unknown) => boolean;
  readonly isOwnerVeoOmniReferencePreparedCandidate: (value: unknown) => boolean;
}
interface PermitContext {
  readonly preparer: Preparer;
  readonly candidate: PreparedCandidate;
  readonly principal: CandidateBinding["principal"];
  readonly attemptId: string;
  readonly permit: Readonly<Record<string, unknown>>;
}
interface PolicyModule {
  readonly createOwnerVeoOmniReferenceOneShotPermit: (input: unknown) => Promise<Readonly<Record<string, unknown>>>;
  readonly revalidateOwnerVeoOmniReferenceOneShotPermit: (input: unknown) => Promise<void>;
  readonly consumeOwnerVeoOmniReferenceOneShotPermit: (input: unknown) => Readonly<Record<string, unknown>>;
}

const compiledRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const PREPARER_URL = pathToFileURL(join(compiledRoot, "src/application/owner-veo-omni-reference-request-preparer.js")).href;
const POLICY_URL = pathToFileURL(join(compiledRoot, "src/application/owner-veo-omni-reference-one-shot-policy.js")).href;
async function loadPreparerModule(): Promise<PreparerModule | undefined> {
  try { return await import(PREPARER_URL) as unknown as PreparerModule; } catch { return undefined; }
}
async function loadPolicyModule(): Promise<PolicyModule | undefined> {
  try { return await import(POLICY_URL) as unknown as PolicyModule; } catch { return undefined; }
}
function needsPreparer(value: PreparerModule | undefined): PreparerModule {
  assert.ok(value, "the Omni owned-reference preparer module exists");
  assert.equal(typeof value.createOwnerVeoOmniReferenceRequestPreparer, "function");
  return value;
}
function needsPolicy(value: PolicyModule | undefined): PolicyModule {
  assert.ok(value, "the Omni reference one-shot policy module exists");
  assert.equal(typeof value.createOwnerVeoOmniReferenceOneShotPermit, "function");
  assert.equal(typeof value.revalidateOwnerVeoOmniReferenceOneShotPermit, "function");
  assert.equal(typeof value.consumeOwnerVeoOmniReferenceOneShotPermit, "function");
  return value;
}
function hasCode(code: string) {
  return (error: unknown): boolean => !!error && typeof error === "object" && "code" in error && error.code === code;
}
function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}
function broker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
    return operation("synthetic-veo-omni-preparer-credential");
  } };
}
function videoBytes(): Uint8Array {
  const bytes = new Uint8Array(28), view = new DataView(bytes.buffer);
  view.setUint32(0, 20); bytes.set(new TextEncoder().encode("ftypisom"), 4); bytes.set(new TextEncoder().encode("mp41"), 16);
  view.setUint32(20, 8); bytes.set(new TextEncoder().encode("mdat"), 24); return bytes;
}
function pngWithWidth(width: number): Buffer {
  const bytes = Buffer.from(PNG_1X1);
  bytes.writeUInt32BE(width, 16);
  return bytes;
}
async function ffprobeFixture(): Promise<{ readonly path: string; readonly directory: string }> {
  const directory = await mkdtemp(join(tmpdir(), "syntx-veo-omni-preparer-2109-"));
  const binary = join(directory, "ffprobe-fixture");
  const output = JSON.stringify({ streams: [{ codec_type: "video", codec_name: "h264", width: 640, height: 360,
    duration: "1.25", disposition: { attached_pic: 0 } }], format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "1.25" } });
  const program = `#!${process.execPath}\nconst fs=require("node:fs");const args=process.argv.slice(2);const input=args.at(-1);if(!input||!fs.statSync(input).isFile())process.exit(41);const p=args.indexOf("-protocol_whitelist");if(p<0||args[p+1]!=="file")process.exit(42);process.stdout.write(${JSON.stringify(output)});\n`;
  await writeFile(binary, program, { mode: 0o700, flag: "wx" });
  await chmod(binary, 0o700);
  return { path: await realpath(binary), directory };
}
async function linkedOwners(attemptIds: readonly string[], now: () => number): Promise<PerUserLinkService> {
  let next = 0;
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: `omni-preparer-${next}`, approval_url: "https://example.invalid/approval" }; },
    async pollChallenge(_id, receiveCredential) { await receiveCredential({ scheme: "Bearer", value: "synthetic-owner-link-token" }); return { state: "LINKED" }; }
  };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(now), { now, attemptIdGenerator: () => attemptIds[next++]! });
  for (const attemptId of attemptIds) {
    await links.createAttempt(BINDING);
    await links.issueHandoff(BINDING, attemptId);
    await links.checkAttempt(BINDING, attemptId);
  }
  return links;
}
function syntheticClient(urlPrefix = "https://r2.syntx.ai/veo-omni/reference-"): SyntxChatHttpClient {
  let upload = 0;
  return new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (input, init) => {
    assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
    const form = init?.body as FormData, file = form.get("files");
    assert.ok(file instanceof File);
    assert.equal(form.get("destination"), "uploaded");
    assert.equal(form.get("check_duplicates"), "true");
    assert.equal(form.get("model_type"), "veo_omni");
    upload += 1;
    const extension = file.name.endsWith(".mp4") ? "mp4" : "png";
    return jsonResponse({ files: [{ id: `omni-preparer-${upload}`, url: `${urlPrefix}${upload}.${extension}`,
      status: "uploaded", mime_type: file.type, size: file.size }] });
  } });
}
interface Runtime {
  readonly service: OwnerVeoOmniReferenceService;
  readonly preparer: Preparer;
  readonly clients: Map<string, SyntxChatHttpClient>;
  readonly now: () => number;
  readonly setNow: (value: number) => void;
  close(): Promise<void>;
}
async function makeRuntime(attemptIds: readonly string[], ffprobePath = process.execPath): Promise<Runtime> {
  let current = NOW;
  const now = () => current;
  const setNow = (value: number) => { current = value; };
  const links = await linkedOwners(attemptIds, now), clients = new Map<string, SyntxChatHttpClient>();
  for (const attemptId of attemptIds) clients.set(attemptId, syntheticClient());
  const service = new OwnerVeoOmniReferenceService({ binding: BINDING, linkService: links,
    resolveClient: (attemptId: string) => clients.get(attemptId), ffprobePath, now });
  const module = needsPreparer(await loadPreparerModule());
  const preparer = module.createOwnerVeoOmniReferenceRequestPreparer({ referenceService: service, now });
  return { service, preparer, clients, now, setNow, async close() { await preparer.close(); await service.close(); } };
}
async function uploadImage(service: OwnerVeoOmniReferenceService, attemptId: string, filename: string, bytes: Uint8Array = PNG_1X1): Promise<string> {
  return (await service.uploadReference({ attemptId, filename, mime_type: "image/png", bytes })).reference_handle;
}
async function uploadVideo(service: OwnerVeoOmniReferenceService, attemptId: string): Promise<string> {
  return (await service.uploadReference({ attemptId, filename: "reference.mp4", mime_type: "video/mp4", bytes: videoBytes() })).reference_handle;
}
function rawInput(attemptId: string, handles: readonly string[], overrides: Record<string, unknown> = {}) {
  return { attemptId, prompt: "Compose a calm moving scene [[ref:1]]", input_type: "image", upscale: 0,
    aspect_ratio: "16:9", video_duration: 4, reference_handles: handles, ...overrides };
}
function asCandidate(value: unknown): PreparedCandidate { return value as PreparedCandidate; }
function asBinding(value: unknown): CandidateBinding { return value as CandidateBinding; }

test("exports the nominal preparer factory and current-bound candidate guard", async () => {
  const module = await loadPreparerModule();
  assert.ok(module, "the owned-reference preparer module exists");
  assert.equal(typeof module.createOwnerVeoOmniReferenceRequestPreparer, "function");
  assert.equal(typeof module.isOwnerVeoOmniReferenceRequestPreparer, "function");
  assert.equal(typeof module.isOwnerVeoOmniReferencePreparedCandidate, "function");
});

test("prepares ordered image references into a safe candidate and exact private source wire", async () => {
  const ffprobe = await ffprobeFixture();
  const runtime = await makeRuntime([ATTEMPT_A], ffprobe.path);
  try {
    const secondPng = pngWithWidth(2);
    const handleOne = await uploadImage(runtime.service, ATTEMPT_A, "first.png", PNG_1X1);
    const handleTwo = await uploadImage(runtime.service, ATTEMPT_A, "second.png", secondPng);
    const input = rawInput(ATTEMPT_A, [handleTwo, handleOne], { prompt: "A scene starring [[ref:2]] before [[ref:1]]" });
    const candidate = asCandidate(await runtime.preparer.prepare(input));
    const preparerModule = needsPreparer(await loadPreparerModule());
    assert.equal(preparerModule.isOwnerVeoOmniReferenceRequestPreparer(runtime.preparer), true);
    assert.equal(preparerModule.isOwnerVeoOmniReferencePreparedCandidate(candidate), true);
    assert.equal(candidate.status, "blocked");
    assert.equal(candidate.dispatch_allowed, false);
    assert.equal(candidate.backend_acceptance, "UNPROVEN");
    assert.equal(candidate.model_id, "veo_omni");
    assert.equal(candidate.profile_sha256, getOwnerVeoOmniReferenceProfile().profile_sha256);
    assert.deepEqual(candidate.sources.map((source) => source.reference_handle), [handleTwo, handleOne]);
    assert.equal(JSON.stringify(candidate).includes("r2.syntx.ai"), false);
    assert.equal(JSON.stringify(candidate).includes("A scene starring"), false);
    const binding = asBinding(runtime.preparer.inspectCandidate(candidate));
    assert.deepEqual(binding.cost_parameters, { upscale: 0, video_duration: 4 });
    assert.equal(JSON.stringify(binding).includes("r2.syntx.ai"), false);
    assert.equal(JSON.stringify(binding).includes("A scene starring"), false);

    const privateWire = runtime.preparer.getPrivateRequest(candidate);
    assert.equal(privateWire.status, "SOURCE_BOUND_REFERENCE_WIRE_CANDIDATE");
    assert.equal(privateWire.ai_name, "veo3");
    assert.equal(privateWire.prompt, "A scene starring <<<https://r2.syntx.ai/veo-omni/reference-1.png>>> before <<<https://r2.syntx.ai/veo-omni/reference-2.png>>>");
    assert.deepEqual(privateWire.settings, { model_type: "veo_omni", type: "image", upscale: 0,
      aspect_ratio: "16:9", video_duration: 4, file_urls: [
        { type: "image", url: "https://r2.syntx.ai/veo-omni/reference-2.png" },
        { type: "image", url: "https://r2.syntx.ai/veo-omni/reference-1.png" }
      ] });
    assert.deepEqual(privateWire.cost_parameters, { upscale: 0, video_duration: 4 });
    assert.equal("mode" in privateWire.settings, false);
    assert.equal(privateWire.generation_permit, false);
    let capturedClient: SyntxChatHttpClient | undefined;
    const capturedWire = runtime.preparer.withCapturedReferences(candidate, (client, wire) => {
      capturedClient = client;
      return wire;
    });
    assert.equal(capturedClient, runtime.clients.get(ATTEMPT_A));
    assert.equal(capturedWire, privateWire);
  } finally { await runtime.close(); await rm(ffprobe.directory, { recursive: true, force: true }); }
});

test("mixed video references keep ordered typed files and cost-only video_ref", async (t) => {
  if (process.platform === "win32") { t.skip("POSIX fake ffprobe fixture; actual Windows ffprobe NOT_RUN"); return; }
  const ffprobe = await ffprobeFixture();
  const runtime = await makeRuntime([ATTEMPT_A], ffprobe.path);
  try {
    const video = await uploadVideo(runtime.service, ATTEMPT_A);
    const image = await uploadImage(runtime.service, ATTEMPT_A, "reference.png");
    const candidate = asCandidate(await runtime.preparer.prepare(rawInput(ATTEMPT_A, [video, image], {
      input_type: "references", upscale: 3, video_duration: 10, prompt: "Move these two references together [[ref:1]]"
    })));
    const binding = asBinding(runtime.preparer.inspectCandidate(candidate));
    assert.equal(binding.sources[0]!.kind, "video");
    assert.equal(binding.sources[1]!.kind, "image");
    assert.deepEqual(binding.cost_parameters, { upscale: 3, video_duration: 10, mode: "video_ref" });
    const wire = runtime.preparer.getPrivateRequest(candidate);
    assert.deepEqual(wire.settings.file_urls, [
      { type: "video", url: "https://r2.syntx.ai/veo-omni/reference-1.mp4" },
      { type: "image", url: "https://r2.syntx.ai/veo-omni/reference-2.png" }
    ]);
    assert.deepEqual(wire.cost_parameters, { upscale: 3, video_duration: 10, mode: "video_ref" });
    assert.equal("mode" in wire.settings, false);
    assert.equal(wire.settings.type, "references");
  } finally { await runtime.close(); await rm(ffprobe.directory, { recursive: true, force: true }); }
});

test("rejects invalid owned kind counts, cloned candidates, cross-service candidates, and changed clients", async (t) => {
  if (process.platform === "win32") { t.skip("POSIX fake ffprobe fixture; actual Windows ffprobe NOT_RUN"); return; }
  const ffprobe = await ffprobeFixture();
  const runtimeA = await makeRuntime([ATTEMPT_A, ATTEMPT_B], ffprobe.path);
  const runtimeB = await makeRuntime([ATTEMPT_A], ffprobe.path);
  try {
    const image = await uploadImage(runtimeA.service, ATTEMPT_A, "image.png");
    const video = await uploadVideo(runtimeA.service, ATTEMPT_A);
    await assert.rejects(runtimeA.preparer.prepare(rawInput(ATTEMPT_A, [video], { input_type: "image" })),
      (error: unknown) => hasCode("INVALID_REQUEST")(error) || hasCode("INVALID_REFERENCE_COUNT")(error) || hasCode("PARAMETERS_INVALID")(error) || hasCode("REFERENCE_UNAVAILABLE")(error) || hasCode("WIRE_INVALID")(error));

    const candidate = asCandidate(await runtimeA.preparer.prepare(rawInput(ATTEMPT_A, [image])));
    const cloned = Object.freeze({ ...candidate });
    const module = needsPreparer(await loadPreparerModule());
    assert.equal(module.isOwnerVeoOmniReferencePreparedCandidate(cloned), false);
    assert.throws(() => runtimeA.preparer.getPrivateRequest(cloned), (error: unknown) => hasCode("CANDIDATE_UNBOUND")(error) || hasCode("CANDIDATE_EXPIRED")(error));
    const otherPreparer = needsPreparer(await loadPreparerModule()).createOwnerVeoOmniReferenceRequestPreparer({ referenceService: runtimeB.service, now: runtimeB.now });
    assert.equal(otherPreparer.isBoundToReferenceService(runtimeA.service), false);
    assert.throws(() => otherPreparer.getPrivateRequest(candidate), (error: unknown) => hasCode("CANDIDATE_UNBOUND")(error));

    const originalClient = runtimeA.clients.get(ATTEMPT_A)!;
    runtimeA.clients.set(ATTEMPT_A, new SyntxChatHttpClient({ credentialBroker: broker() }));
    await assert.rejects(runtimeA.preparer.revalidateCandidate(candidate), (error: unknown) =>
      hasCode("CANDIDATE_EXPIRED")(error) || hasCode("REFERENCE_UNAVAILABLE")(error));
    runtimeA.clients.set(ATTEMPT_A, originalClient);
    await assert.rejects(runtimeA.service.resolveReferences({ attemptId: ATTEMPT_B, reference_handles: [image] }),
      (error: unknown) => hasCode("REFERENCE_UNAVAILABLE")(error));
  } finally {
    await runtimeA.close(); await runtimeB.close(); await rm(ffprobe.directory, { recursive: true, force: true });
  }
});

test("invalidates epochs synchronously, drains pending work, expires without refresh, and close leaves the store open", async (t) => {
  if (process.platform === "win32") { t.skip("POSIX fake ffprobe fixture; actual Windows ffprobe NOT_RUN"); return; }
  const ffprobe = await ffprobeFixture();
  const runtime = await makeRuntime([ATTEMPT_A], ffprobe.path);
  try {
    const handle = await uploadImage(runtime.service, ATTEMPT_A, "lifecycle.png");
    const input = rawInput(ATTEMPT_A, [handle]);
    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(runtime.preparer.prepare(input, aborted.signal), (error: unknown) => hasCode("REQUEST_ABORTED")(error));
    const afterAbort = asCandidate(await runtime.preparer.prepare(input));
    assert.equal(needsPreparer(await loadPreparerModule()).isOwnerVeoOmniReferencePreparedCandidate(afterAbort), true);
    const pendingPrepare = runtime.preparer.prepare(input);
    const invalidating = runtime.preparer.invalidateAttempt(ATTEMPT_A);
    await assert.rejects(pendingPrepare, (error: unknown) => hasCode("REQUEST_ABORTED")(error) || hasCode("CANDIDATE_EXPIRED")(error) || hasCode("REFERENCE_EXPIRED")(error) || hasCode("REFERENCE_UNAVAILABLE")(error));
    await invalidating;

    const nextHandle = await uploadImage(runtime.service, ATTEMPT_A, "expiry.png", pngWithWidth(2));
    const nextInput = rawInput(ATTEMPT_A, [nextHandle]);
    const nextCandidate = asCandidate(await runtime.preparer.prepare(nextInput));
    const expiry = asBinding(runtime.preparer.inspectCandidate(nextCandidate)).expires_at;
    runtime.setNow(expiry);
    const guard = needsPreparer(await loadPreparerModule()).isOwnerVeoOmniReferencePreparedCandidate;
    assert.equal(guard(nextCandidate), false);
    await assert.rejects(Promise.resolve().then(() => runtime.preparer.getPrivateRequest(nextCandidate)),
      (error: unknown) => hasCode("CANDIDATE_EXPIRED")(error));

    const runtimeB = await makeRuntime([ATTEMPT_B], ffprobe.path);
    try {
      const closeHandle = await uploadImage(runtimeB.service, ATTEMPT_B, "close.png", pngWithWidth(2));
      const closingInput = rawInput(ATTEMPT_B, [closeHandle]);
      const pendingClose = runtimeB.preparer.prepare(closingInput);
      const closing = runtimeB.preparer.close();
      await assert.rejects(pendingClose, (error: unknown) => hasCode("CANDIDATE_EXPIRED")(error) || hasCode("SERVICE_CLOSED")(error) || hasCode("REQUEST_ABORTED")(error));
      await closing;
      const afterClose = await runtimeB.service.uploadReference({ attemptId: ATTEMPT_B, filename: "after-close.png", mime_type: "image/png",
        bytes: pngWithWidth(3) });
      assert.equal(afterClose.kind, "image");
    } finally { await runtimeB.close(); }
  } finally { await runtime.close(); await rm(ffprobe.directory, { recursive: true, force: true }); }
});

test("one-shot requires revalidation, claims equal source intent across new handles and relinks, but permits changed intent", async () => {
  const module = needsPolicy(await loadPolicyModule());
  const ffprobe = await ffprobeFixture();
  const links = await linkedOwners([ATTEMPT_A, ATTEMPT_B, ATTEMPT_C], () => NOW);
  const clients = new Map([[ATTEMPT_A, syntheticClient()], [ATTEMPT_B, syntheticClient()], [ATTEMPT_C, syntheticClient()]]);
  const serviceA = new OwnerVeoOmniReferenceService({ binding: BINDING, linkService: links,
    resolveClient: (attemptId: string) => clients.get(attemptId), ffprobePath: ffprobe.path, now: () => NOW });
  const serviceB = new OwnerVeoOmniReferenceService({ binding: BINDING, linkService: links,
    resolveClient: (attemptId: string) => clients.get(attemptId), ffprobePath: ffprobe.path, now: () => NOW });
  const serviceC = new OwnerVeoOmniReferenceService({ binding: BINDING, linkService: links,
    resolveClient: (attemptId: string) => clients.get(attemptId), ffprobePath: ffprobe.path, now: () => NOW });
  const api = needsPreparer(await loadPreparerModule());
  const prepA = api.createOwnerVeoOmniReferenceRequestPreparer({ referenceService: serviceA, now: () => NOW });
  const prepB = api.createOwnerVeoOmniReferenceRequestPreparer({ referenceService: serviceB, now: () => NOW });
  const prepC = api.createOwnerVeoOmniReferenceRequestPreparer({ referenceService: serviceC, now: () => NOW });
  try {
    const handleA = await uploadImage(serviceA, ATTEMPT_A, "one.png");
    const handleB = await uploadImage(serviceB, ATTEMPT_B, "two.png");
    const handleC = await uploadImage(serviceC, ATTEMPT_C, "three.png");
    const prompt = `One shared semantic intent ${Date.now()}`;
    const candidateA = asCandidate(await prepA.prepare(rawInput(ATTEMPT_A, [handleA], { prompt })));
    const candidateB = asCandidate(await prepB.prepare(rawInput(ATTEMPT_B, [handleB], { prompt })));
    assert.notEqual(handleA, handleB);
    assert.equal(candidateA.intent_fingerprint, candidateB.intent_fingerprint);
    assert.notEqual(candidateA.request_fingerprint, candidateB.request_fingerprint);
    const principalA = asBinding(prepA.inspectCandidate(candidateA)).principal;
    const principalB = asBinding(prepB.inspectCandidate(candidateB)).principal;
    assert.equal(principalA.tenant_id, principalB.tenant_id);
    assert.equal(principalA.subject_id, principalB.subject_id);
    assert.notEqual(principalA.connection_id, principalB.connection_id);

    const permitA = await module.createOwnerVeoOmniReferenceOneShotPermit({ preparer: prepA, candidate: candidateA,
      principal: principalA, attemptId: ATTEMPT_A });
    const contextA: PermitContext = { preparer: prepA, candidate: candidateA, principal: principalA, attemptId: ATTEMPT_A, permit: permitA };
    assert.equal(permitA.status, "nominal");
    assert.equal(permitA.dispatch_allowed, false);
    assert.throws(() => module.consumeOwnerVeoOmniReferenceOneShotPermit(contextA), hasCode("PERMIT_NOT_REVALIDATED"));
    await assert.rejects(module.createOwnerVeoOmniReferenceOneShotPermit({ preparer: prepA, candidate: candidateA,
      principal: principalA, attemptId: ATTEMPT_A }), hasCode("CANDIDATE_ALREADY_ISSUED"));
    await assert.rejects(module.createOwnerVeoOmniReferenceOneShotPermit({ preparer: prepA, candidate: candidateA,
      principal: principalA, attemptId: ATTEMPT_B }), hasCode("PRINCIPAL_MISMATCH"));

    const permitB = await module.createOwnerVeoOmniReferenceOneShotPermit({ preparer: prepB, candidate: candidateB,
      principal: principalB, attemptId: ATTEMPT_B });
    const contextB: PermitContext = { preparer: prepB, candidate: candidateB, principal: principalB, attemptId: ATTEMPT_B, permit: permitB };
    await Promise.all([
      module.revalidateOwnerVeoOmniReferenceOneShotPermit(contextA),
      module.revalidateOwnerVeoOmniReferenceOneShotPermit(contextB)
    ]);
    const racing = await Promise.allSettled([
      Promise.resolve().then(() => module.consumeOwnerVeoOmniReferenceOneShotPermit(contextA)),
      Promise.resolve().then(() => module.consumeOwnerVeoOmniReferenceOneShotPermit(contextB))
    ]);
    assert.equal(racing.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(racing.filter((result) => result.status === "rejected").length, 1);
    const rejected = racing.find((result) => result.status === "rejected");
    assert.ok(rejected && rejected.status === "rejected");
    assert.ok(hasCode("INTENT_ALREADY_CLAIMED")(rejected.reason));
    const winnerContext = racing[0]!.status === "fulfilled" ? contextA : contextB;
    assert.throws(() => module.consumeOwnerVeoOmniReferenceOneShotPermit(winnerContext), hasCode("PERMIT_ALREADY_CONSUMED"));

    const changedPrompt = `${prompt} with one changed detail`;
    const candidateC = asCandidate(await prepC.prepare(rawInput(ATTEMPT_C, [handleC], { prompt: changedPrompt, upscale: 1 })));
    assert.notEqual(candidateA.intent_fingerprint, candidateC.intent_fingerprint);
    const principalC = asBinding(prepC.inspectCandidate(candidateC)).principal;
    const permitC = await module.createOwnerVeoOmniReferenceOneShotPermit({ preparer: prepC, candidate: candidateC,
      principal: principalC, attemptId: ATTEMPT_C });
    const contextC: PermitContext = { preparer: prepC, candidate: candidateC, principal: principalC, attemptId: ATTEMPT_C, permit: permitC };
    await module.revalidateOwnerVeoOmniReferenceOneShotPermit(contextC);
    assert.equal(module.consumeOwnerVeoOmniReferenceOneShotPermit(contextC).status, "consumed");
  } finally {
    await Promise.all([prepA.close(), prepB.close(), prepC.close()]);
    await Promise.all([serviceA.close(), serviceB.close(), serviceC.close()]);
    await rm(ffprobe.directory, { recursive: true, force: true });
  }
});
