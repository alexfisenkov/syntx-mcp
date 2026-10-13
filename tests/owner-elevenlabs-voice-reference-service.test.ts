import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";

const MODULE_URL = new URL("../src/application/owner-elevenlabs-voice-reference-service.js", import.meta.url).href;
const serviceModule = await import(MODULE_URL).catch(() => null) as Record<string, unknown> | null;
const ATTEMPT = "link_elevenlabs_voice_reference_0123456789";
const BINDING = Object.freeze({ tenant_id: "elevenlabs-tenant", subject: "elevenlabs-subject" });
const CREDENTIAL = "synthetic-elevenlabs-voice-reference-credential";
const stores = new Set<InMemoryAuthLinkStore>();

afterEach(() => {
  for (const store of stores) store.close();
  stores.clear();
});

function code(error: unknown, expected: string): boolean {
  return error instanceof Error && "code" in error && error.code === expected;
}

async function linkedService(now: () => number, attemptId = ATTEMPT, binding = BINDING): Promise<PerUserLinkService> {
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: `challenge-${attemptId}`, approval_url: "https://example.invalid/" }; },
    async pollChallenge(_id, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: CREDENTIAL });
      return { state: "LINKED" };
    }
  };
  const store = new InMemoryAuthLinkStore(now);
  stores.add(store);
  const links = new PerUserLinkService(provider, store, { now, defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => attemptId });
  await links.createAttempt(binding);
  await links.issueHandoff(binding, attemptId);
  assert.equal((await links.checkAttempt(binding, attemptId)).status, "LINKED");
  return links;
}

function makeService(links: PerUserLinkService, fetchImpl: typeof fetch, now: () => number, clientOverride?: unknown) {
  const broker: SyntxCredentialBroker = {
    async useCredential<T>(operation: (credential: string) => Promise<T>) {
      return links.useCredential(BINDING, ATTEMPT, (credential) => operation(credential.value));
    }
  };
  const client = clientOverride ?? new SyntxHttpClient({ credentialBroker: broker, fetchImpl });
  const Service = serviceModule?.OwnerElevenLabsVoiceReferenceService as (new (options: unknown) => {
    listVoices(input: unknown): Promise<Record<string, unknown>>;
    resolveVoice(input: unknown): Promise<Record<string, unknown>>;
    isOwnedVoiceResolution(value: unknown, context: unknown): boolean;
    invalidateAttempt(attemptId: string): Promise<void>;
    close(): Promise<void>;
  }) | undefined;
  assert.equal(typeof Service, "function", "MISSING_ELEVENLABS_VOICE_REFERENCE_SERVICE");
  const service = new Service!({ binding: BINDING, linkService: links, resolveClient: () => client, now });
  return { service, client };
}

test("ElevenLabs voice selector service exists as an owner-only reference issuer", () => {
  assert.ok(serviceModule, "MISSING_ELEVENLABS_VOICE_REFERENCE_SERVICE_MODULE");
  assert.equal(typeof serviceModule.OwnerElevenLabsVoiceReferenceService, "function");
});

test("lists only opaque owner references and resolves a genuine voice for the bound attempt", async () => {
  let now = 1_000_000, gets = 0;
  const links = await linkedService(() => now);
  const { service } = makeService(links, async (input, init) => {
    gets += 1;
    assert.equal(new URL(String(input)).href, "https://api.syntx.ai/api/v1/audio/elevenlabs/voice_examples?page=1&page_size=10");
    assert.equal(init?.method, "GET");
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${CREDENTIAL}`);
    return new Response(JSON.stringify({ page: 1, total: 12, facets: { gender: ["female"] }, results: [
      { voice_id: "provider_voice_A", name: "Studio voice", url: "https://signed.invalid/voice", metadata: { secret: "private" } }
    ] }), { headers: { "content-type": "application/json" } });
  }, () => now);
  try {
    const page = await service.listVoices({ attemptId: ATTEMPT });
    assert.equal(page.status, "available");
    assert.equal(page.page, 1); assert.equal(page.page_size, 10); assert.equal(page.total, 12); assert.equal(page.has_more, true);
    assert.equal(page.coverage, "PARTIAL_PAGE_ONLY");
    assert.equal(page.ownership_confidence, "UNPROVEN");
    assert.equal(page.source_confidence, "CURRENT_SOURCE_ROUTE");
    const voices = page.voices as Array<Record<string, unknown>>;
    assert.equal(voices.length, 1);
    assert.equal(voices[0]?.name, "Studio voice");
    assert.match(String(voices[0]?.voice_ref), /^owner_elevenlabs_voice_[0-9a-f-]{36}$/u);
    for (const secret of ["provider_voice_A", "signed.invalid", "private"]) assert.equal(JSON.stringify(page).includes(secret), false);

    const context = { attemptId: ATTEMPT, voice_ref: voices[0]?.voice_ref };
    const resolved = await service.resolveVoice(context);
    assert.equal(resolved.voice_id, "provider_voice_A");
    assert.equal(service.isOwnedVoiceResolution(resolved, context), true);
    assert.equal(service.isOwnedVoiceResolution({ ...resolved }, context), false);
    assert.equal(gets, 1);
    await links.revoke(BINDING, ATTEMPT);
    await assert.rejects(service.resolveVoice(context), (error: unknown) => code(error, "PRINCIPAL_NOT_LINKED"));
    assert.equal(service.isOwnedVoiceResolution(resolved, context), false);
  } finally { await service.close(); }
});

test("voice references remain stable for a repeated same-attempt selection until expiry", async () => {
  let now = 2_000_000;
  const links = await linkedService(() => now);
  const { service } = makeService(links, async () => new Response(JSON.stringify({ page: 1, total: 1, facets: {}, results: [
    { voice_id: "provider_voice_stable", name: "Stable voice" }
  ] }), { headers: { "content-type": "application/json" } }), () => now);
  try {
    const first = await service.listVoices({ attemptId: ATTEMPT });
    const again = await service.listVoices({ attemptId: ATTEMPT });
    const firstVoiceRef = (first.voices as Array<Record<string, unknown>>)[0]?.voice_ref;
    assert.equal(firstVoiceRef, (again.voices as Array<Record<string, unknown>>)[0]?.voice_ref);
    const context = { attemptId: ATTEMPT, voice_ref: firstVoiceRef };
    assert.equal(service.isOwnedVoiceResolution({}, context), false);
    const owned = await service.resolveVoice(context);
    assert.equal(service.isOwnedVoiceResolution(owned, context), true);
    now += 15 * 60_000 + 1;
    assert.equal(service.isOwnedVoiceResolution(owned, context), false);
    await assert.rejects(service.resolveVoice(context), (error: unknown) => code(error, "VOICE_REFERENCE_UNAVAILABLE"));
  } finally { await service.close(); }
});

test("rechecks the real linked principal after the native GET and mints no reference after revoke", async () => {
  let now = 3_000_000, gets = 0;
  const links = await linkedService(() => now);
  const { service } = makeService(links, async () => {
    gets += 1;
    await links.revoke(BINDING, ATTEMPT);
    return new Response(JSON.stringify({ page: 1, total: 1, facets: {}, results: [
      { voice_id: "provider_voice_revoked", name: "Must not escape" }
    ] }), { headers: { "content-type": "application/json" } });
  }, () => now);
  try {
    await assert.rejects(service.listVoices({ attemptId: ATTEMPT }), (error: unknown) => code(error, "PRINCIPAL_NOT_LINKED"));
    assert.equal(gets, 1);
  } finally { await service.close(); }
});

test("rejects raw voice-id inputs and fake native clients", async () => {
  let now = 4_000_000;
  const links = await linkedService(() => now);
  const fake = { async listElevenLabsVoices() { return { voices: [{ voice_id: "raw", name: "fake" }] }; } };
  const { service } = makeService(links, async () => { throw new Error("must not fetch"); }, () => now, fake);
  try {
    await assert.rejects(service.listVoices({ attemptId: ATTEMPT, voice_id: "provider_voice_raw" }),
      (error: unknown) => code(error, "INVALID_REQUEST"));
    await assert.rejects(service.listVoices({ attemptId: ATTEMPT }),
      (error: unknown) => code(error, "NATIVE_CLIENT_INVALID"));
  } finally { await service.close(); }
});

test("rejects revoked proxy dependencies without leaking proxy errors", () => {
  const Service = serviceModule?.OwnerElevenLabsVoiceReferenceService as (new (options: unknown) => unknown) | undefined;
  assert.equal(typeof Service, "function");
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  assert.throws(() => new Service!({ binding: BINDING, linkService: revoked.proxy,
    resolveClient: () => null, now: () => 0 }), (error: unknown) => code(error, "INVALID_REQUEST"));
});

test("voice-list rows that would expose a URL as a display name fail closed", async () => {
  let now = 4_500_000;
  const links = await linkedService(() => now);
  const { service } = makeService(links, async () => new Response(JSON.stringify({ page: 1, total: 1, facets: {}, results: [
    { voice_id: "provider_voice_url_name", name: "https://signed.invalid/voice" }
  ] }), { headers: { "content-type": "application/json" } }), () => now);
  try {
    await assert.rejects(service.listVoices({ attemptId: ATTEMPT }), (error: unknown) => code(error, "VOICE_LIST_UNAVAILABLE"));
  } finally { await service.close(); }
});

test("voice references cannot be listed through a foreign attempt", async () => {
  let now = 4_750_000, gets = 0;
  const links = await linkedService(() => now);
  const { service } = makeService(links, async () => {
    gets += 1; return new Response("[]", { headers: { "content-type": "application/json" } });
  }, () => now);
  try {
    await assert.rejects(service.listVoices({ attemptId: "link_elevenlabs_foreign_0123456789" }),
      (error: unknown) => code(error, "PRINCIPAL_NOT_LINKED"));
    assert.equal(gets, 0);
  } finally { await service.close(); }
});

test("attempt invalidation revokes its voice refs and rejects a forged reference", async () => {
  let now = 5_000_000;
  const links = await linkedService(() => now);
  const { service } = makeService(links, async () => new Response(JSON.stringify([{ voice_id: "provider_voice_A", name: "Voice A" }]),
    { headers: { "content-type": "application/json" } }), () => now);
  try {
    const page = await service.listVoices({ attemptId: ATTEMPT });
    const voiceRef = (page.voices as Array<Record<string, unknown>>)[0]?.voice_ref;
    await assert.rejects(service.resolveVoice({ attemptId: ATTEMPT, voice_ref: "owner_elevenlabs_voice_00000000-0000-4000-8000-000000000000" }),
      (error: unknown) => code(error, "VOICE_REFERENCE_UNAVAILABLE"));
    const context = { attemptId: ATTEMPT, voice_ref: voiceRef };
    const owned = await service.resolveVoice(context);
    assert.equal(service.isOwnedVoiceResolution(owned, context), true);
    await service.invalidateAttempt(ATTEMPT);
    assert.equal(service.isOwnedVoiceResolution(owned, context), false);
    await assert.rejects(service.resolveVoice(context), (error: unknown) => code(error, "PRINCIPAL_NOT_LINKED"));
    await assert.rejects(service.listVoices({ attemptId: ATTEMPT }), (error: unknown) => code(error, "PRINCIPAL_NOT_LINKED"));
  } finally { await service.close(); }
});

test("voice-reference capacity fails closed without evicting an earlier owner's selection", async () => {
  let now = 6_000_000, page = 0;
  const links = await linkedService(() => now);
  const { service } = makeService(links, async () => {
    page += 1;
    const prefix = page === 1 ? "provider_voice_first_" : "provider_voice_next_";
    return new Response(JSON.stringify({ page: 1, total: 200, facets: {},
      results: Array.from({ length: 100 }, (_, index) => ({ voice_id: `${prefix}${index}`, name: `Voice ${index}` })) }),
    { headers: { "content-type": "application/json" } });
  }, () => now);
  try {
    const first = await service.listVoices({ attemptId: ATTEMPT });
    assert.equal((first.voices as unknown[]).length, 100);
    const firstRef = (first.voices as Array<Record<string, unknown>>)[0]?.voice_ref;
    await assert.rejects(service.listVoices({ attemptId: ATTEMPT }), (error: unknown) => code(error, "CAPACITY_EXCEEDED"));
    const resolved = await service.resolveVoice({ attemptId: ATTEMPT, voice_ref: firstRef });
    assert.equal(resolved.voice_id, "provider_voice_first_0");
    assert.equal(page, 2);
  } finally { await service.close(); }
});

test("close aborts and drains a pending voice GET before returning", async () => {
  let now = 7_000_000, gets = 0, markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const links = await linkedService(() => now);
  const { service } = makeService(links, async (_input, init) => {
    gets += 1; markStarted();
    await new Promise<void>((resolve) => init?.signal?.addEventListener("abort", () => resolve(), { once: true }));
    return new Response(JSON.stringify([]), { headers: { "content-type": "application/json" } });
  }, () => now);
  const pending = service.listVoices({ attemptId: ATTEMPT }).then(
    () => ({ code: "UNEXPECTED_SUCCESS" }),
    (error: unknown) => ({ code: error instanceof Error && "code" in error ? String(error.code) : "UNKNOWN_ERROR" })
  );
  await started;
  await service.close();
  assert.equal((await pending).code, "REQUEST_ABORTED");
  assert.equal(gets, 1);
  await assert.rejects(service.listVoices({ attemptId: ATTEMPT }), (error: unknown) => code(error, "SERVICE_CLOSED"));
});
