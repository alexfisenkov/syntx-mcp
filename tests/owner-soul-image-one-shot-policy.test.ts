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
import { OwnerSoulImageRequestPreparer } from "../src/application/owner-soul-image-request-preparer.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../src/catalog/selected-discovery-catalog.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { sha256CanonicalPayload, syntxPublicCatalogSnapshotSchema } from "../src/catalog/syntx-public-catalog.js";

const MODULE_URL = new URL("../src/application/owner-soul-image-one-shot-policy.js", import.meta.url).href;
const VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const CATALOG = new DiscoveryCatalogRepository(syntxPublicCatalogSnapshotSchema.parse(JSON.parse(readFileSync(
  join(process.cwd(), "catalog/public", VERSION), "utf8"
))));
const BINDING: AuthBinding = Object.freeze({ tenant_id: "soul-one-shot-tenant", subject: "soul-one-shot-subject" });
const ATTEMPT = "link_soul_oneshot_test_000000000001";
const PRINCIPAL = Object.freeze({ tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT });

function createRig(options: { styleId?: string; characterReferenceId?: string | number } = {}) {
  const calls = { styleGets: 0, characterGets: 0, statusReads: 0 };
  let now = 1_000;
  const broker: SyntxCredentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>) {
    return operation("synthetic-soul-one-shot-credential");
  } };
  const styleClient = new OwnerSoulStyleCatalogHttpClient({ credentialBroker: broker, fetchImpl: async (input, init) => {
    calls.styleGets += 1; assert.equal(String(input), "https://api.syntx.ai/api/v1/hf/lora/styles");
    assert.equal(init?.method, "GET");
    return Response.json({ items: [{ style_id: options.styleId ?? "private-style-identifier", name: "Reviewed style", image: "https://images.invalid/style.jpg" }], total: 1 });
  } });
  const characterClient = new OwnerSoulCharacterCatalogHttpClient({ credentialBroker: broker, fetchImpl: async (input, init) => {
    calls.characterGets += 1; assert.equal(String(input), "https://api.syntx.ai/api/v1/hf/lora/list");
    assert.equal(init?.method, "GET");
    return Response.json({ items: [{ id: "private-record-identifier", reference_id: options.characterReferenceId ?? 314,
      title: "Completed character", status: "completed" }], total: 1 });
  } });
  const linkService = new PerUserLinkService({} as never, { async getSnapshot(_binding: unknown, attemptId: string) {
    calls.statusReads += 1;
    return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
      status: "LINKED" as const, expires_at: null, linked: true };
  } } as never);
  const styleOptionsService = new OwnerSoulStyleOptionsService({ binding: BINDING, linkService, catalog: CATALOG,
    catalogVersion: VERSION, resolveClient: () => styleClient, now: () => now });
  const characterOptionsService = new OwnerSoulCharacterOptionsService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: VERSION, resolveClient: () => characterClient, now: () => now });
  const preparer = new OwnerSoulImageRequestPreparer({ binding: BINDING, linkService, styleOptionsService, characterOptionsService,
    catalog: CATALOG, catalog_version: VERSION, now: () => now });
  return { calls, styleOptionsService, characterOptionsService, preparer, get now() { return now; }, set now(value: number) { now = value; },
    async close() { await preparer.close(); await styleOptionsService.close(); await characterOptionsService.close(); } };
}

const baseIntent = Object.freeze({ prompt: "A quiet portrait in soft morning light", quality: "720p" as const,
  resolution: "2048x1152" as const, batch_size: 1 as const, enhance_prompt: false, seed: null,
  style: Object.freeze({ kind: "none" as const }), character: Object.freeze({ kind: "none" as const }) });

test("exposes a nominal Soul one-shot policy for an actual prepared candidate", async () => {
  let module: Record<string, unknown> | undefined;
  try { module = await import(MODULE_URL) as Record<string, unknown>; } catch { /* Expected RED until policy exists. */ }
  assert.equal(typeof module?.createOwnerSoulImageOneShotPermit, "function", "MISSING_OWNER_SOUL_ONE_SHOT_POLICY");
  assert.equal(typeof module?.consumeOwnerSoulImageOneShotPermit, "function", "MISSING_OWNER_SOUL_ONE_SHOT_CONSUMER");
});

test("issues and consumes one actual all-none candidate without exposing private request content or implying dispatch", async () => {
  const module = await import(MODULE_URL) as Record<string, unknown>;
  const create = module.createOwnerSoulImageOneShotPermit as (input: unknown) => Record<string, any>;
  const consume = module.consumeOwnerSoulImageOneShotPermit as (input: unknown) => Record<string, any>;
  const rig = createRig();
  try {
    const candidate = await rig.preparer.prepare({ attemptId: ATTEMPT, principal: PRINCIPAL, input: baseIntent });
    const permit = create({ preparer: rig.preparer, candidate, principal: PRINCIPAL, attemptId: ATTEMPT,
      catalog: CATALOG, catalog_version: VERSION, now: () => rig.now });
    assert.equal(permit.status, "NOMINAL_ONE_SHOT");
    assert.equal(permit.dispatch_allowed, false);
    assert.equal(permit.backend_acceptance, "UNPROVEN");
    assert.equal(permit.provider_execution, false);
    assert.equal(permit.model_id, "higgsfield-soul");
    assert.equal(permit.profile_schema_hash, candidate.profile_schema_hash);
    assert.equal(permit.request_fingerprint, candidate.request_fingerprint);
    assert.equal(permit.intent_fingerprint, candidate.intent_fingerprint);
    assert.deepEqual(permit.cost_routing, { ai_name: "higgsfield-soul", model_type: "higgsfield-soul" });
    assert.deepEqual(permit.cost_inputs, { quality: "720p", resolution: "2048x1152", batch_size: 1 });
    assert.equal(permit.cost_confidence, "SOURCE_JOINED_COST2_QUERY_FIELDS_NOT_QUOTE_BILLING_OR_HARDCAP");
    assert.equal(permit.source_projection_confidence, "EXPLICIT_SOURCE_UI_CONTROL_PROJECTION_NOT_CURRENT_CACHED_UI_REQUEST_REPLAY");
    assert.equal(permit.reference_strength, "UNRESOLVED_UNCONTROLLED_WIRE_FIELD");
    assert.equal(permit.expires_at_ms, candidate.expires_at_ms);
    const serialized = JSON.stringify(permit);
    assert.equal(serialized.includes("0.7"), false, "the source initializer is not injected as an effective default");
    for (const privateValue of [baseIntent.prompt, "private-style-identifier", "private-record-identifier", "314"]) {
      assert.equal(serialized.includes(privateValue), false);
    }
    assert.deepEqual(consume({ permit, candidate, principal: PRINCIPAL, attemptId: ATTEMPT }), {
      status: "consumed", dispatch_allowed: false, request_fingerprint: candidate.request_fingerprint
    });
    assert.throws(() => consume({ permit, candidate, principal: PRINCIPAL, attemptId: ATTEMPT }),
      (error: unknown) => (error as { code?: string }).code === "PERMIT_ALREADY_CONSUMED");
    assert.throws(() => create({ preparer: rig.preparer, candidate, principal: PRINCIPAL, attemptId: ATTEMPT,
      catalog: CATALOG, catalog_version: VERSION, now: () => rig.now }),
    (error: unknown) => (error as { code?: string }).code === "CANDIDATE_ALREADY_ISSUED");
    assert.equal(rig.calls.styleGets, 0); assert.equal(rig.calls.characterGets, 0);
    assert.equal(rig.calls.statusReads, 2);
  } finally { await rig.close(); }
});

test("retains all 14 literal quality/resolution pairs at both batch values and keeps cost routing separate", async () => {
  const module = await import(MODULE_URL) as Record<string, unknown>;
  const create = module.createOwnerSoulImageOneShotPermit as (input: unknown) => Record<string, any>;
  const consume = module.consumeOwnerSoulImageOneShotPermit as (input: unknown) => Record<string, any>;
  const rig = createRig();
  const pairs: readonly (readonly ["720p" | "1080p", string])[] = [
    ["720p", "2048x1152"], ["720p", "1680x1120"], ["720p", "1536x1152"], ["720p", "1536x1536"],
    ["720p", "1152x1536"], ["720p", "1120x1680"], ["720p", "1152x2048"],
    ["1080p", "2048x1152"], ["1080p", "2016x1344"], ["1080p", "2048x1536"], ["1080p", "1536x1536"],
    ["1080p", "1536x2048"], ["1080p", "1344x2016"], ["1080p", "1152x2048"]
  ];
  try {
    let issued = 0;
    for (const [quality, resolution] of pairs) for (const batch_size of [1, 4] as const) {
      const candidate = await rig.preparer.prepare({ attemptId: ATTEMPT, principal: PRINCIPAL,
        input: { ...baseIntent, quality, resolution, batch_size, enhance_prompt: true, seed: 2_147_483_647 } });
      const permit = create({ preparer: rig.preparer, candidate, principal: PRINCIPAL, attemptId: ATTEMPT,
        catalog: CATALOG, catalog_version: VERSION, now: () => rig.now });
      assert.deepEqual(permit.cost_inputs, { quality, resolution, batch_size });
      assert.deepEqual(permit.cost_routing, { ai_name: "higgsfield-soul", model_type: "higgsfield-soul" });
      assert.equal(Object.hasOwn(permit.cost_inputs, "version"), false);
      assert.equal(permit.dispatch_allowed, false);
      assert.equal(permit.backend_acceptance, "UNPROVEN");
      assert.equal(permit.source_projection_confidence, "EXPLICIT_SOURCE_UI_CONTROL_PROJECTION_NOT_CURRENT_CACHED_UI_REQUEST_REPLAY");
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
      assert.equal(consume({ permit, candidate, principal: PRINCIPAL, attemptId: ATTEMPT }).status, "consumed");
      issued += 1;
    }
    assert.equal(issued, 28);
  } finally { await rig.close(); }
});

test("preserves all eleven selected style strengths and emits style_strength only for the selected branch", async () => {
  const module = await import(MODULE_URL) as Record<string, unknown>;
  const create = module.createOwnerSoulImageOneShotPermit as (input: unknown) => Record<string, any>;
  const consume = module.consumeOwnerSoulImageOneShotPermit as (input: unknown) => Record<string, any>;
  const rig = createRig();
  try {
    const styles = await rig.styleOptionsService.listOptions({ attemptId: ATTEMPT });
    for (let step = 0; step <= 10; step += 1) {
      const strength = step / 10;
      const candidate = await rig.preparer.prepare({ attemptId: ATTEMPT, principal: PRINCIPAL,
        input: { ...baseIntent, style: { kind: "selected", style_handle: styles.options[0]!.style_handle, strength } } });
      const permit = create({ preparer: rig.preparer, candidate, principal: PRINCIPAL, attemptId: ATTEMPT,
        catalog: CATALOG, catalog_version: VERSION, now: () => rig.now });
      assert.equal((candidate.request as { settings: Record<string, unknown> }).settings.style_strength, strength);
      assert.equal(Object.hasOwn(permit, "reference_strength"), true);
      assert.equal(permit.reference_strength, "UNRESOLVED_UNCONTROLLED_WIRE_FIELD");
      consume({ permit, candidate, principal: PRINCIPAL, attemptId: ATTEMPT });
    }
    const none = await rig.preparer.prepare({ attemptId: ATTEMPT, principal: PRINCIPAL, input: baseIntent });
    const nonePermit = create({ preparer: rig.preparer, candidate: none, principal: PRINCIPAL, attemptId: ATTEMPT,
      catalog: CATALOG, catalog_version: VERSION, now: () => rig.now });
    assert.equal(Object.hasOwn((none.request as { settings: Record<string, unknown> }).settings, "style_strength"), false);
    assert.equal(nonePermit.reference_strength, "UNRESOLVED_UNCONTROLLED_WIRE_FIELD");
  } finally { await rig.close(); }
});

test("preserves Character reference IDs as their source string or number type", async () => {
  const module = await import(MODULE_URL) as Record<string, unknown>;
  const create = module.createOwnerSoulImageOneShotPermit as (input: unknown) => Record<string, any>;
  for (const referenceId of [314, "typed-reference-value"] as const) {
    const rig = createRig({ characterReferenceId: referenceId });
    try {
      const choices = await rig.characterOptionsService.listOptions({ attemptId: ATTEMPT });
      const candidate = await rig.preparer.prepare({ attemptId: ATTEMPT, principal: PRINCIPAL,
        input: { ...baseIntent, character: { kind: "selected", character_handle: choices.options[0]!.character_handle! } } });
      const permit = create({ preparer: rig.preparer, candidate, principal: PRINCIPAL, attemptId: ATTEMPT,
        catalog: CATALOG, catalog_version: VERSION, now: () => rig.now });
      const request = candidate.request as { prompt: string; settings: Record<string, unknown> };
      assert.equal(request.settings.reference_id, referenceId);
      assert.equal(typeof request.settings.reference_id, typeof referenceId);
      assert.equal(JSON.stringify(permit).includes(String(referenceId)), false);
      assert.equal(permit.dispatch_allowed, false);
    } finally { await rig.close(); }
  }
});

test("rejects candidate clones, foreign issuers, altered contexts, proxies, and unsafe caller inputs", async () => {
  const module = await import(MODULE_URL) as Record<string, unknown>;
  const create = module.createOwnerSoulImageOneShotPermit as (input: unknown) => Record<string, any>;
  const consume = module.consumeOwnerSoulImageOneShotPermit as (input: unknown) => Record<string, any>;
  const first = createRig(); const second = createRig();
  try {
    const candidate = await first.preparer.prepare({ attemptId: ATTEMPT, principal: PRINCIPAL, input: baseIntent });
    const permit = create({ preparer: first.preparer, candidate, principal: PRINCIPAL, attemptId: ATTEMPT,
      catalog: CATALOG, catalog_version: VERSION, now: () => first.now });
    assert.throws(() => create({ preparer: first.preparer, candidate: { ...candidate }, principal: PRINCIPAL,
      attemptId: ATTEMPT, catalog: CATALOG, catalog_version: VERSION, now: () => first.now }),
    (error: unknown) => (error as { code?: string }).code === "CANDIDATE_UNBOUND");
    assert.throws(() => create({ preparer: second.preparer, candidate, principal: PRINCIPAL,
      attemptId: ATTEMPT, catalog: CATALOG, catalog_version: VERSION, now: () => first.now }),
    (error: unknown) => (error as { code?: string }).code === "CANDIDATE_UNBOUND");
    assert.throws(() => consume({ permit: { ...permit }, candidate, principal: PRINCIPAL, attemptId: ATTEMPT }),
      (error: unknown) => (error as { code?: string }).code === "PERMIT_INVALID");
    const wrongPrincipal = Object.freeze({ ...PRINCIPAL, subject_id: "another-subject" });
    assert.throws(() => consume({ permit, candidate, principal: wrongPrincipal, attemptId: ATTEMPT }),
      (error: unknown) => (error as { code?: string }).code === "PRINCIPAL_MISMATCH");
    assert.throws(() => consume({ permit, candidate, principal: PRINCIPAL, attemptId: "link_soul_oneshot_test_000000000002" }),
      (error: unknown) => (error as { code?: string }).code === "PRINCIPAL_MISMATCH");
    assert.equal(consume({ permit, candidate, principal: PRINCIPAL, attemptId: ATTEMPT }).status, "consumed",
      "rejected clone/context attempts do not consume the genuine permit");

    let getterCalls = 0;
    const accessor = Object.defineProperties({}, {
      preparer: { enumerable: true, get() { getterCalls += 1; return first.preparer; } },
      candidate: { value: candidate, enumerable: true }, principal: { value: PRINCIPAL, enumerable: true },
      attemptId: { value: ATTEMPT, enumerable: true }, catalog: { value: CATALOG, enumerable: true },
      catalog_version: { value: VERSION, enumerable: true }
    });
    assert.throws(() => create(accessor), (error: unknown) => (error as { code?: string }).code === "INVALID_REQUEST");
    assert.equal(getterCalls, 0);
    assert.throws(() => create({ preparer: first.preparer, candidate, principal: PRINCIPAL, attemptId: ATTEMPT,
      catalog: CATALOG, catalog_version: VERSION, reference_strength: 0.7 }),
    (error: unknown) => (error as { code?: string }).code === "INVALID_REQUEST");
  } finally { await first.close(); await second.close(); }
});

test("selected Style and Character original expiries bound the permit; expiry and revocation prevent consumption", async () => {
  const module = await import(MODULE_URL) as Record<string, unknown>;
  const create = module.createOwnerSoulImageOneShotPermit as (input: unknown) => Record<string, any>;
  const consume = module.consumeOwnerSoulImageOneShotPermit as (input: unknown) => Record<string, any>;
  const rig = createRig();
  try {
    const styles = await rig.styleOptionsService.listOptions({ attemptId: ATTEMPT });
    const characters = await rig.characterOptionsService.listOptions({ attemptId: ATTEMPT });
    rig.now = 200_000;
    const candidate = await rig.preparer.prepare({ attemptId: ATTEMPT, principal: PRINCIPAL, input: { ...baseIntent,
      style: { kind: "selected", style_handle: styles.options[0]!.style_handle, strength: 0.7 },
      character: { kind: "selected", character_handle: characters.options[0]!.character_handle! } } });
    assert.equal(candidate.expires_at_ms, 301_000, "both revalidated handles retain their original list snapshot deadline");
    const permit = create({ preparer: rig.preparer, candidate, principal: PRINCIPAL, attemptId: ATTEMPT,
      catalog: CATALOG, catalog_version: VERSION, now: () => rig.now });
    assert.equal(permit.expires_at_ms, 301_000, "permit expiry cannot outlive selected source handles");
    rig.now = 301_000;
    assert.throws(() => consume({ permit, candidate, principal: PRINCIPAL, attemptId: ATTEMPT }),
      (error: unknown) => (error as { code?: string }).code === "PERMIT_EXPIRED");
  } finally { await rig.close(); }

  const revoked = createRig();
  try {
    const styles = await revoked.styleOptionsService.listOptions({ attemptId: ATTEMPT });
    const candidate = await revoked.preparer.prepare({ attemptId: ATTEMPT, principal: PRINCIPAL,
      input: { ...baseIntent, style: { kind: "selected", style_handle: styles.options[0]!.style_handle, strength: 0.4 } } });
    const permit = create({ preparer: revoked.preparer, candidate, principal: PRINCIPAL, attemptId: ATTEMPT,
      catalog: CATALOG, catalog_version: VERSION, now: () => revoked.now });
    revoked.styleOptionsService.invalidateAttempt(ATTEMPT);
    assert.throws(() => consume({ permit, candidate, principal: PRINCIPAL, attemptId: ATTEMPT }),
      (error: unknown) => (error as { code?: string }).code === "CANDIDATE_UNBOUND");
  } finally { await revoked.close(); }
});

test("rejects clock rollback, catalog-version mismatch, and selected-catalog profile drift", async () => {
  const module = await import(MODULE_URL) as Record<string, unknown>;
  const create = module.createOwnerSoulImageOneShotPermit as (input: unknown) => Record<string, any>;
  const consume = module.consumeOwnerSoulImageOneShotPermit as (input: unknown) => Record<string, any>;
  const rig = createRig(); let now = rig.now;
  try {
    const candidate = await rig.preparer.prepare({ attemptId: ATTEMPT, principal: PRINCIPAL, input: baseIntent });
    assert.throws(() => create({ preparer: rig.preparer, candidate, principal: PRINCIPAL, attemptId: ATTEMPT,
      catalog: CATALOG, catalog_version: `${VERSION}.other`, now: () => now }),
    (error: unknown) => (error as { code?: string }).code === "CATALOG_BINDING_MISMATCH");
    const driftedSnapshot = JSON.parse(readFileSync(join(process.cwd(), "catalog/public", VERSION), "utf8")) as {
      models: Array<{ value: string; label: string }>;
      sources: { models: { canonical_sha256: string } };
    };
    const soulRow = driftedSnapshot.models.find((row) => row.value === "higgsfield-soul");
    assert.ok(soulRow);
    soulRow.label = `${soulRow.label} drift`;
    driftedSnapshot.sources.models.canonical_sha256 = sha256CanonicalPayload(driftedSnapshot.models);
    const driftedCatalog = new DiscoveryCatalogRepository(syntxPublicCatalogSnapshotSchema.parse(driftedSnapshot));
    assert.throws(() => create({ preparer: rig.preparer, candidate, principal: PRINCIPAL, attemptId: ATTEMPT,
      catalog: driftedCatalog, catalog_version: VERSION, now: () => now }),
    (error: unknown) => (error as { code?: string }).code === "CATALOG_BINDING_MISMATCH");
    const permit = create({ preparer: rig.preparer, candidate, principal: PRINCIPAL, attemptId: ATTEMPT,
      catalog: CATALOG, catalog_version: VERSION, now: () => now });
    now -= 1;
    assert.throws(() => consume({ permit, candidate, principal: PRINCIPAL, attemptId: ATTEMPT }),
      (error: unknown) => (error as { code?: string }).code === "CLOCK_INVALID");
  } finally { await rig.close(); }
});
