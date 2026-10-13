import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { OwnerSoulCharacterCatalogHttpClient } from "../src/adapter/syntx/owner-soul-character-catalog-http-client.js";
import { OwnerSoulStyleCatalogHttpClient } from "../src/adapter/syntx/owner-soul-style-catalog-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import type { AuthBinding } from "../src/auth/types.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { OwnerSoulCharacterOptionsService } from "../src/application/owner-soul-character-options-service.js";
import { OwnerSoulStyleOptionsService } from "../src/application/owner-soul-style-options-service.js";
import { getOwnerSoulImageSourceProfile } from "../src/application/owner-soul-image-source-profile.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../src/catalog/selected-discovery-catalog.js";
import { syntxPublicCatalogSnapshotSchema } from "../src/catalog/syntx-public-catalog.js";

const VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const CATALOG = new DiscoveryCatalogRepository(syntxPublicCatalogSnapshotSchema.parse(JSON.parse(readFileSync(
  join(process.cwd(), "catalog/public", VERSION), "utf8"
))));
const PROFILE = getOwnerSoulImageSourceProfile("higgsfield-soul", CATALOG, VERSION);
const BINDING: AuthBinding = Object.freeze({ tenant_id: "soul-preparer-tenant", subject: "soul-preparer-subject" });
const ATTEMPT = "link_soul_preparer_test_000000000001";
const PRINCIPAL = Object.freeze({ tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT });
const PREPARER_URL = new URL("../src/application/owner-soul-image-request-preparer.js", import.meta.url).href;

function linkedAttempt(attemptId: string) {
  return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
    status: "LINKED" as const, expires_at: null, linked: true };
}

function createRig(now = 1_000, selectedIds: { style_id?: string; reference_id?: string | number } = {}) {
  const calls = { style_gets: 0, character_gets: 0, status_reads: 0 };
  let clock = now;
  const broker: SyntxCredentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>) {
    return operation("synthetic-soul-selector-credential");
  } };
  const styleClient = new OwnerSoulStyleCatalogHttpClient({ credentialBroker: broker, fetchImpl: async (input, init) => {
    calls.style_gets += 1;
    assert.equal(String(input), "https://api.syntx.ai/api/v1/hf/lora/styles");
    assert.equal(init?.method, "GET");
    return Response.json({ items: [{ style_id: selectedIds.style_id ?? "source-style-private-id", name: "Reviewed style", image: "https://images.invalid/style.jpg" }], total: 1 });
  } });
  const characterClient = new OwnerSoulCharacterCatalogHttpClient({ credentialBroker: broker, fetchImpl: async (input, init) => {
    calls.character_gets += 1;
    assert.equal(String(input), "https://api.syntx.ai/api/v1/hf/lora/list");
    assert.equal(init?.method, "GET");
    return Response.json({ items: [{ id: "private-record-key", reference_id: selectedIds.reference_id ?? 314, title: "Completed Character", status: "completed" }], total: 1 });
  } });
  const linkService = new PerUserLinkService({} as never, { async getSnapshot(_binding: unknown, attemptId: string) {
    calls.status_reads += 1;
    return linkedAttempt(attemptId);
  } } as never);
  const styleOptionsService = new OwnerSoulStyleOptionsService({ binding: BINDING, linkService,
    catalog: CATALOG, catalogVersion: VERSION, resolveClient: () => styleClient, now: () => clock });
  const characterOptionsService = new OwnerSoulCharacterOptionsService({ binding: BINDING, linkService,
    catalog: CATALOG, catalog_version: VERSION, resolveClient: () => characterClient, now: () => clock });
  return { calls, linkService, styleOptionsService, characterOptionsService, get now() { return clock; }, set now(value: number) { clock = value; } };
}

const baseIntent = Object.freeze({ prompt: "A quiet portrait in a sunlit room", quality: "720p" as const,
  resolution: "2048x1152" as const, batch_size: 1 as const, enhance_prompt: false, seed: 0,
  style: Object.freeze({ kind: "none" as const }), character: Object.freeze({ kind: "none" as const }) });

test("prepares the explicit all-none branch as a frozen source-shaped request without leaking prompt or private IDs", async () => {
  let module: Record<string, unknown> | undefined;
  try { module = await import(PREPARER_URL) as Record<string, unknown>; } catch { /* Expected RED until the preparer is added. */ }
  assert.equal(typeof module?.OwnerSoulImageRequestPreparer, "function", "MISSING_OWNER_SOUL_IMAGE_REQUEST_PREPARER");
  const Preparer = module!.OwnerSoulImageRequestPreparer as new (options: Record<string, unknown>) => {
    prepare(input: unknown): Promise<Record<string, unknown>>;
    close(): Promise<void>;
  };
  const rig = createRig();
  const preparer = new Preparer({ binding: BINDING, linkService: rig.linkService, styleOptionsService: rig.styleOptionsService, characterOptionsService: rig.characterOptionsService,
  catalog: CATALOG, catalog_version: VERSION, now: () => 1_000 });
  try {
    const candidate = await preparer.prepare({ attemptId: ATTEMPT, principal: PRINCIPAL, input: baseIntent });
    assert.equal(candidate.status, "PREPARED_SOURCE_SHAPED");
    assert.equal(candidate.dispatch_allowed, false);
    assert.equal(candidate.backend_acceptance, "UNPROVEN");
    assert.equal(candidate.reference_strength, "UNRESOLVED_UNCONTROLLED_WIRE_FIELD");
    assert.equal(candidate.source_projection_confidence, "EXPLICIT_SOURCE_UI_CONTROL_PROJECTION_NOT_CURRENT_CACHED_UI_REQUEST_REPLAY");
    assert.equal(candidate.profile_schema_hash, PROFILE.profile_schema_hash);
    assert.deepEqual(candidate.cost_routing, { ai_name: "higgsfield-soul", model_type: "higgsfield-soul" });
    assert.deepEqual(candidate.cost_inputs, { quality: "720p", resolution: "2048x1152", batch_size: 1 });
    assert.deepEqual(candidate.selection, { style: "none", character: "none" });
    assert.equal(candidate.expires_at_ms, 901_000);
    assert.equal(Object.getOwnPropertyDescriptor(candidate, "request")?.enumerable, false);
    const request = candidate.request as { prompt: string; settings: Record<string, unknown> };
    assert.equal(Object.isFrozen(request), true);
    assert.equal(Object.isFrozen(request.settings), true);
    assert.equal(request.prompt, baseIntent.prompt);
    assert.deepEqual(request.settings, { n: 1, model_type: "higgsfield-soul", quality: "720p", resolution: "2048x1152",
      batch_size: 1, enhance_prompt: false, seed: 0, style_id: "", reference_id: "", file_urls: [] });
    assert.equal(Object.hasOwn(request.settings, "style_strength"), false);
    const serialized = JSON.stringify(candidate);
    assert.equal(serialized.includes(baseIntent.prompt), false);
    assert.equal(serialized.includes("source-style-private-id"), false);
    assert.equal(serialized.includes("private-record-key"), false);
    assert.equal(serialized.includes("314"), false);
    assert.equal(rig.calls.style_gets, 0);
    assert.equal(rig.calls.character_gets, 0);
    assert.equal(rig.calls.status_reads, 2, "each prepare is bracketed by two actual linked-account status preflights");
  } finally { await preparer.close(); await rig.styleOptionsService.close(); await rig.characterOptionsService.close(); }
});

test("revalidates selected Style and Character through their actual issuers and keeps only raw request fields private", async () => {
  const module = await import(PREPARER_URL) as Record<string, unknown>;
  const Preparer = module.OwnerSoulImageRequestPreparer as new (options: Record<string, unknown>) => {
    prepare(input: unknown): Promise<Record<string, unknown>>;
    isPreparedCandidateForPrincipal(candidate: unknown, context: unknown): boolean;
    close(): Promise<void>;
  };
  const rig = createRig(50_000, { reference_id: "typed-private-character-value" });
  const preparer = new Preparer({ binding: BINDING, linkService: rig.linkService, styleOptionsService: rig.styleOptionsService,
    characterOptionsService: rig.characterOptionsService, catalog: CATALOG, catalog_version: VERSION, now: () => rig.now });
  try {
    const styles = await rig.styleOptionsService.listOptions({ attemptId: ATTEMPT });
    rig.now = 75_000;
    const characters = await rig.characterOptionsService.listOptions({ attemptId: ATTEMPT });
    const intent = { ...baseIntent, style: { kind: "selected", style_handle: styles.options[0]!.style_handle, strength: 0.7 },
      character: { kind: "selected", character_handle: characters.options[0]!.character_handle! } };
    rig.now = 100_000;
    const candidate = await preparer.prepare({ attemptId: ATTEMPT, principal: PRINCIPAL, input: intent });
    assert.equal(candidate.expires_at_ms, 350_000, "candidate expiry is the minimum original expiry across selected handles, not a renewed TTL");
    assert.deepEqual(candidate.selection, { style: "selected", character: "selected" });
    const safeParameters = candidate.parameters as Record<string, unknown>;
    assert.deepEqual(safeParameters.style, { kind: "selected", strength: 0.7 });
    assert.deepEqual(safeParameters.character, { kind: "selected" });
    const request = candidate.request as { prompt: string; settings: Record<string, unknown> };
    assert.equal(request.settings.style_id, "source-style-private-id");
    assert.equal(request.settings.style_strength, 0.7);
    assert.equal(request.settings.reference_id, "typed-private-character-value");
    assert.equal(rig.calls.style_gets, 2, "selection preparation performs one actual fresh Style GET after listing");
    assert.equal(rig.calls.character_gets, 2, "selection preparation performs one actual fresh Character GET after listing");
    assert.equal(preparer.isPreparedCandidateForPrincipal(candidate, { attemptId: ATTEMPT, principal: PRINCIPAL }), true);
    assert.equal(Object.getOwnPropertyDescriptor(candidate, "request")?.enumerable, false);
    const serialized = JSON.stringify(candidate);
    for (const privateValue of [request.prompt, "source-style-private-id", "typed-private-character-value", styles.options[0]!.style_handle,
      characters.options[0]!.character_handle!]) assert.equal(serialized.includes(privateValue), false);
    rig.styleOptionsService.invalidateAttempt(ATTEMPT);
    assert.equal(preparer.isPreparedCandidateForPrincipal(candidate, { attemptId: ATTEMPT, principal: PRINCIPAL }), false,
      "a selected Style revocation synchronously invalidates the prepared candidate");
  } finally { await preparer.close(); await rig.styleOptionsService.close(); await rig.characterOptionsService.close(); }
});

test("projects every explicit quality-resolution pair at both supported batch sizes without adding unresolved fields", async () => {
  const module = await import(PREPARER_URL) as Record<string, unknown>;
  const Preparer = module.OwnerSoulImageRequestPreparer as new (options: Record<string, unknown>) => {
    prepare(input: unknown): Promise<Record<string, unknown>>;
    close(): Promise<void>;
  };
  const rig = createRig();
  const preparer = new Preparer({ binding: BINDING, linkService: rig.linkService, styleOptionsService: rig.styleOptionsService,
    characterOptionsService: rig.characterOptionsService, catalog: CATALOG, catalog_version: VERSION, now: () => rig.now });
  const pairs: readonly (readonly ["720p" | "1080p", string])[] = [
    ["720p", "2048x1152"], ["720p", "1680x1120"], ["720p", "1536x1152"], ["720p", "1536x1536"],
    ["720p", "1152x1536"], ["720p", "1120x1680"], ["720p", "1152x2048"],
    ["1080p", "2048x1152"], ["1080p", "2016x1344"], ["1080p", "2048x1536"], ["1080p", "1536x1536"],
    ["1080p", "1536x2048"], ["1080p", "1344x2016"], ["1080p", "1152x2048"]
  ];
  try {
    for (const [quality, resolution] of pairs) for (const batch_size of [1, 4] as const) {
      const candidate = await preparer.prepare({ attemptId: ATTEMPT, principal: PRINCIPAL,
        input: { ...baseIntent, quality, resolution, batch_size, enhance_prompt: true, seed: 2_147_483_647 } });
      const request = candidate.request as { prompt: string; settings: Record<string, unknown> };
      assert.equal(request.settings.quality, quality);
      assert.equal(request.settings.resolution, resolution);
      assert.equal(request.settings.batch_size, batch_size);
      assert.equal(request.settings.enhance_prompt, true);
      assert.equal(request.settings.seed, 2_147_483_647);
      assert.deepEqual(request.settings.file_urls, []);
      assert.equal(Object.hasOwn(request.settings, "version"), false);
      assert.equal(Object.hasOwn(request.settings, "reference_strength"), false);
      assert.equal(Object.hasOwn(request.settings, "style_strength"), false);
      assert.equal(candidate.source_projection_confidence, "EXPLICIT_SOURCE_UI_CONTROL_PROJECTION_NOT_CURRENT_CACHED_UI_REQUEST_REPLAY");
    }
    assert.equal(rig.calls.style_gets, 0);
    assert.equal(rig.calls.character_gets, 0);
  } finally { await preparer.close(); await rig.styleOptionsService.close(); await rig.characterOptionsService.close(); }
});

test("projects all eleven explicit selected-style strengths and only the selected branch emits style_strength", async () => {
  const module = await import(PREPARER_URL) as Record<string, unknown>;
  const Preparer = module.OwnerSoulImageRequestPreparer as new (options: Record<string, unknown>) => {
    prepare(input: unknown): Promise<Record<string, unknown>>;
    close(): Promise<void>;
  };
  const rig = createRig();
  const preparer = new Preparer({ binding: BINDING, linkService: rig.linkService, styleOptionsService: rig.styleOptionsService,
    characterOptionsService: rig.characterOptionsService, catalog: CATALOG, catalog_version: VERSION, now: () => rig.now });
  try {
    const styles = await rig.styleOptionsService.listOptions({ attemptId: ATTEMPT });
    for (let step = 0; step <= 10; step += 1) {
      const strength = step / 10;
      const candidate = await preparer.prepare({ attemptId: ATTEMPT, principal: PRINCIPAL,
        input: { ...baseIntent, style: { kind: "selected", style_handle: styles.options[0]!.style_handle, strength } } });
      const request = candidate.request as { prompt: string; settings: Record<string, unknown> };
      assert.equal(request.settings.style_strength, strength);
      assert.equal(request.settings.style_id, "source-style-private-id");
    }
    const none = await preparer.prepare({ attemptId: ATTEMPT, principal: PRINCIPAL, input: baseIntent });
    assert.equal(Object.hasOwn((none.request as { settings: Record<string, unknown> }).settings, "style_strength"), false);
  } finally { await preparer.close(); await rig.styleOptionsService.close(); await rig.characterOptionsService.close(); }
});

test("fingerprints exclude attempt and opaque handle while retaining typed source IDs and all semantic intent", async () => {
  const module = await import(PREPARER_URL) as Record<string, unknown>;
  const Preparer = module.OwnerSoulImageRequestPreparer as new (options: Record<string, unknown>) => {
    prepare(input: unknown): Promise<Record<string, unknown>>;
    close(): Promise<void>;
  };
  const rig = createRig();
  const preparer = new Preparer({ binding: BINDING, linkService: rig.linkService, styleOptionsService: rig.styleOptionsService,
    characterOptionsService: rig.characterOptionsService, catalog: CATALOG, catalog_version: VERSION, now: () => rig.now });
  const secondAttempt = "link_soul_preparer_test_000000000002";
  const secondPrincipal = Object.freeze({ ...PRINCIPAL, connection_id: secondAttempt });
  try {
    const firstStyles = await rig.styleOptionsService.listOptions({ attemptId: ATTEMPT });
    const firstChars = await rig.characterOptionsService.listOptions({ attemptId: ATTEMPT });
    const secondStyles = await rig.styleOptionsService.listOptions({ attemptId: secondAttempt });
    const secondChars = await rig.characterOptionsService.listOptions({ attemptId: secondAttempt });
    const selected = (styleHandle: string, characterHandle: string) => ({ ...baseIntent,
      style: { kind: "selected" as const, style_handle: styleHandle, strength: 0.4 },
      character: { kind: "selected" as const, character_handle: characterHandle } });
    const first = await preparer.prepare({ attemptId: ATTEMPT, principal: PRINCIPAL,
      input: selected(firstStyles.options[0]!.style_handle, firstChars.options[0]!.character_handle!) });
    const second = await preparer.prepare({ attemptId: secondAttempt, principal: secondPrincipal,
      input: selected(secondStyles.options[0]!.style_handle, secondChars.options[0]!.character_handle!) });
    assert.equal(first.intent_fingerprint, second.intent_fingerprint);
    assert.notEqual(first.request_fingerprint, second.request_fingerprint);
    const changed = await preparer.prepare({ attemptId: ATTEMPT, principal: PRINCIPAL,
      input: { ...selected(firstStyles.options[0]!.style_handle, firstChars.options[0]!.character_handle!), seed: 1 } });
    assert.notEqual(first.intent_fingerprint, changed.intent_fingerprint);
  } finally { await preparer.close(); await rig.styleOptionsService.close(); await rig.characterOptionsService.close(); }
});

test("preserves a fresh numeric Character reference_id without string coercion", async () => {
  const module = await import(PREPARER_URL) as Record<string, unknown>;
  const Preparer = module.OwnerSoulImageRequestPreparer as new (options: Record<string, unknown>) => {
    prepare(input: unknown): Promise<Record<string, unknown>>;
    close(): Promise<void>;
  };
  const rig = createRig(1_000, { reference_id: 314 });
  const preparer = new Preparer({ binding: BINDING, linkService: rig.linkService, styleOptionsService: rig.styleOptionsService,
    characterOptionsService: rig.characterOptionsService, catalog: CATALOG, catalog_version: VERSION, now: () => rig.now });
  try {
    const listed = await rig.characterOptionsService.listOptions({ attemptId: ATTEMPT });
    const candidate = await preparer.prepare({ attemptId: ATTEMPT, principal: PRINCIPAL,
      input: { ...baseIntent, character: { kind: "selected", character_handle: listed.options[0]!.character_handle! } } });
    const request = candidate.request as { prompt: string; settings: Record<string, unknown> };
    assert.equal(request.settings.reference_id, 314);
    assert.equal(typeof request.settings.reference_id, "number");
  } finally { await preparer.close(); await rig.styleOptionsService.close(); await rig.characterOptionsService.close(); }
});

test("candidate selection guard expires at the original Character-handle deadline", async () => {
  const module = await import(PREPARER_URL) as Record<string, unknown>;
  const Preparer = module.OwnerSoulImageRequestPreparer as new (options: Record<string, unknown>) => {
    prepare(input: unknown): Promise<Record<string, unknown>>;
    isPreparedCandidateForPrincipal(candidate: unknown, context: unknown): boolean;
    close(): Promise<void>;
  };
  const rig = createRig();
  const preparer = new Preparer({ binding: BINDING, linkService: rig.linkService, styleOptionsService: rig.styleOptionsService,
    characterOptionsService: rig.characterOptionsService, catalog: CATALOG, catalog_version: VERSION, now: () => rig.now });
  try {
    const listed = await rig.characterOptionsService.listOptions({ attemptId: ATTEMPT });
    const candidate = await preparer.prepare({ attemptId: ATTEMPT, principal: PRINCIPAL,
      input: { ...baseIntent, character: { kind: "selected", character_handle: listed.options[0]!.character_handle! } } });
    assert.equal(candidate.expires_at_ms, 301_000);
    assert.equal(preparer.isPreparedCandidateForPrincipal(candidate, { attemptId: ATTEMPT, principal: PRINCIPAL }), true);
    rig.now = 301_000;
    assert.equal(preparer.isPreparedCandidateForPrincipal(candidate, { attemptId: ATTEMPT, principal: PRINCIPAL }), false);
  } finally { await preparer.close(); await rig.styleOptionsService.close(); await rig.characterOptionsService.close(); }
});

test("candidate rejects accessor-shaped input and is synchronously invalid after close", async () => {
  const module = await import(PREPARER_URL) as Record<string, unknown>;
  const Preparer = module.OwnerSoulImageRequestPreparer as new (options: Record<string, unknown>) => {
    prepare(input: unknown): Promise<Record<string, unknown>>;
    isPreparedCandidateForPrincipal(candidate: unknown, context: unknown): boolean;
    close(): Promise<void>;
  };
  const rig = createRig();
  const preparer = new Preparer({ binding: BINDING, linkService: rig.linkService, styleOptionsService: rig.styleOptionsService,
    characterOptionsService: rig.characterOptionsService, catalog: CATALOG, catalog_version: VERSION, now: () => rig.now });
  let getterCalls = 0;
  try {
    const accessorInput = Object.defineProperties({}, {
      attemptId: { value: ATTEMPT, enumerable: true }, principal: { value: PRINCIPAL, enumerable: true },
      input: { get() { getterCalls += 1; return baseIntent; }, enumerable: true }
    });
    await assert.rejects(preparer.prepare(accessorInput), (error: unknown) =>
      typeof error === "object" && error !== null && Reflect.get(error, "code") === "INVALID_REQUEST");
    assert.equal(getterCalls, 0);
    await assert.rejects(preparer.prepare({ attemptId: ATTEMPT, principal: PRINCIPAL,
      input: { ...baseIntent, reference_strength: 0.6 } }), (error: unknown) =>
      typeof error === "object" && error !== null && Reflect.get(error, "code") === "INVALID_REQUEST");
    const fixedStrength = await preparer.prepare({ attemptId: ATTEMPT, principal: PRINCIPAL,
      input: { ...baseIntent, reference_strength: 0.7 } });
    assert.equal(fixedStrength.reference_strength, "EXPLICIT_SOURCE_FIXED_0_7_BACKEND_UNPROVEN");
    assert.equal((fixedStrength.parameters as Record<string, unknown>).reference_strength, 0.7);
    assert.equal((fixedStrength.request as { settings: Record<string, unknown> }).settings.reference_strength, 0.7);
    const candidate = await preparer.prepare({ attemptId: ATTEMPT, principal: PRINCIPAL, input: baseIntent });
    await preparer.close();
    assert.equal(preparer.isPreparedCandidateForPrincipal(candidate, { attemptId: ATTEMPT, principal: PRINCIPAL }), false);
  } finally { await preparer.close(); await rig.styleOptionsService.close(); await rig.characterOptionsService.close(); }
});
