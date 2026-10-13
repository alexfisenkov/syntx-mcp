import assert from "node:assert/strict";
import test from "node:test";
import type { GenerationPrincipalRef } from "../src/domain/generation-operation.js";
import {
  createOwnerStandardImageOwnedReferenceBindingIssuer,
  prepareOwnerStandardImageRequest,
  OWNER_STANDARD_IMAGE_VARIANTS,
  type OwnerStandardImageOwnedReferenceResolverContext
} from "../src/application/owner-standard-image-request-preparer.js";
import {
  createOwnerStandardImageOneShotPermit,
  consumeOwnerStandardImageOneShotPermit,
  OwnerStandardImageOneShotPolicyError
} from "../src/application/owner-standard-image-one-shot-policy.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";

const VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const catalog = loadSelectedDiscoveryCatalog(VERSION).discoveryCatalog;
const NOW = Date.parse("2026-10-10T12:00:00.000Z");
const PRINCIPAL = Object.freeze({ tenant_id: "tenant_standard", subject_id: "owner_standard", connection_id: "link_standard_0123456789abcdef" });
const FOREIGN = Object.freeze({ tenant_id: "tenant_foreign", subject_id: "other", connection_id: "link_foreign_0123456789abcdef" });
const VARIANTS = OWNER_STANDARD_IMAGE_VARIANTS;
const PARAMETERS = Object.freeze({
  banana: { aspect_ratio: "1:1", image_size: null, thinking_level: null },
  "banana-2.1": { aspect_ratio: "16:9", image_size: "2K", thinking_level: "medium" },
  banana2: { aspect_ratio: "4:3", image_size: "1K", thinking_level: null },
  banana3: { aspect_ratio: "3:2", image_size: "0.5K", thinking_level: null },
  banana3_light: { aspect_ratio: "2:3", image_size: "1K", thinking_level: null },
  "gpt-image-1": { aspect_ratio: "1:1", quality: null, details_quality: null },
  "gpt-image-1.5": { aspect_ratio: "3:2", quality: null, details_quality: null },
  "gpt-image-2": { aspect_ratio: "16:9", quality: "2K", details_quality: "high" },
  "gpt-image-2.5-flare": { aspect_ratio: "21:9", quality: "4K", details_quality: "max" },
  "gpt-image-2.5-sunburst": { aspect_ratio: "4:5", quality: "1K", details_quality: "xhigh" }
} as const);
const HANDLES = Array.from({ length: 4 }, (_, index) => `standard_image_00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
const ACTIVE_SETTINGS_KEYS: Readonly<Record<typeof VARIANTS[number], readonly string[]>> = Object.freeze({
  banana: ["n", "model_type", "aspect_ratio", "image_size", "file_urls"],
  "banana-2.1": ["n", "model_type", "aspect_ratio", "image_size", "thinking_level", "file_urls"],
  banana2: ["n", "model_type", "aspect_ratio", "image_size", "file_urls"],
  banana3: ["n", "model_type", "aspect_ratio", "image_size", "file_urls"],
  banana3_light: ["n", "model_type", "aspect_ratio", "image_size", "file_urls"],
  "gpt-image-1": ["n", "model_type", "aspect_ratio", "file_urls"],
  "gpt-image-1.5": ["n", "model_type", "aspect_ratio", "file_urls"],
  "gpt-image-2": ["n", "model_type", "aspect_ratio", "quality", "details_quality", "file_urls"],
  "gpt-image-2.5-flare": ["n", "model_type", "aspect_ratio", "quality", "details_quality", "file_urls"],
  "gpt-image-2.5-sunburst": ["n", "model_type", "aspect_ratio", "quality", "details_quality", "file_urls"]
});

async function candidateFor(variant: typeof VARIANTS[number], kinds: readonly ("image" | "video" | "file")[] = [], now = NOW) {
  const issuer = createOwnerStandardImageOwnedReferenceBindingIssuer(async (context: Readonly<OwnerStandardImageOwnedReferenceResolverContext>) => {
    const index = HANDLES.indexOf(context.reference_handle);
    const kind = kinds[index]!;
    const mime = kind === "image" ? "image/png" : kind === "video" ? "video/mp4" : "application/pdf";
    const ext = kind === "image" ? "png" : kind === "video" ? "mp4" : "pdf";
    return { ...context, file_url: `https://r2.syntx.ai/private/standard/${index + 1}.${ext}`, mime_type: mime, kind,
      width: kind === "image" ? 1200 : null, height: kind === "image" ? 800 : null,
      duration: kind === "video" ? 12 : null, size: 1024 + index,
      sha256: `sha256:${String(index + 1).padStart(64, "0")}`, expires_at: now + 600_000 - index * 30_000,
      metadata_confidence: "CONTAINER_METADATA_ONLY" as const };
  }, { catalog, catalog_version: VERSION, now: () => now });
  const handles = HANDLES.slice(0, kinds.length);
  const reference_set = await issuer.issue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant, reference_handles: handles });
  const candidate = prepareOwnerStandardImageRequest({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant,
    parameters: PARAMETERS[variant], reference_set, prompt: "  preserve this prompt 🙂  " },
  { catalog, catalog_version: VERSION, now: () => now });
  return { candidate, issuer };
}

function issue(candidate: object, options: { principal?: GenerationPrincipalRef; attemptId?: string; catalogVersion?: string; now?: () => number } = {}) {
  return createOwnerStandardImageOneShotPermit({ candidate, principal: options.principal ?? PRINCIPAL,
    attemptId: options.attemptId ?? PRINCIPAL.connection_id, catalog, catalog_version: options.catalogVersion ?? VERSION,
    now: options.now ?? (() => NOW) });
}

function expectPolicyError(callback: () => unknown, code: string): void {
  assert.throws(callback, (error: unknown) => error instanceof OwnerStandardImageOneShotPolicyError && error.code === code);
}

test("issues and consumes one nominal permit for all ten source variants without granting account or cost approval", async () => {
  for (const variant of VARIANTS) {
    const { candidate, issuer } = await candidateFor(variant);
    try {
      const permit = issue(candidate);
      assert.equal(candidate.status, "blocked");
      assert.equal(candidate.dispatch_allowed, false);
      assert.equal(candidate.backend_acceptance, "UNPROVEN");
      assert.equal(permit.status, "nominal");
      assert.equal(permit.dispatch_allowed, false);
      assert.equal(permit.variant, variant);
      assert.equal(permit.model_id, variant);
      assert.equal(permit.ai_name, variant.startsWith("banana") ? "banana" : "sora-images");
      assert.equal(permit.profile_schema_hash, candidate.profile_schema_hash);
      assert.equal(permit.request_fingerprint, candidate.request_fingerprint);
      assert.equal(permit.intent_fingerprint, candidate.intent_fingerprint);
      assert.equal(permit.expires_at, candidate.expires_at);
      assert.deepEqual(Object.keys(candidate.request.settings), ACTIVE_SETTINGS_KEYS[variant]);
      assert.equal(candidate.request.settings.n, 1);
      assert.equal(candidate.request.settings.model_type, variant);
      assert.equal(candidate.request.prompt, candidate.prompt);
      assert.equal("account" in permit || "cost" in permit || "plan" in permit, false);
      assert.equal(JSON.stringify(candidate).includes("r2.syntx.ai"), false);
      const result = consumeOwnerStandardImageOneShotPermit({ permit, candidate, principal: PRINCIPAL,
        attemptId: PRINCIPAL.connection_id });
      assert.deepEqual(result, { status: "consumed", dispatch_allowed: false, request_fingerprint: candidate.request_fingerprint });
      expectPolicyError(() => consumeOwnerStandardImageOneShotPermit({ permit, candidate, principal: PRINCIPAL,
        attemptId: PRINCIPAL.connection_id }), "PERMIT_ALREADY_CONSUMED");
      expectPolicyError(() => issue(candidate), "CANDIDATE_ALREADY_ISSUED");
    } finally { issuer.close(); }
  }
});

test("accepts strict null-prototype contract records and latches a backward clock as invalid", async () => {
  const { candidate, issuer } = await candidateFor("gpt-image-1.5");
  let clock = NOW;
  try {
    const createInput = Object.assign(Object.create(null) as Record<string, unknown>, {
      candidate, principal: PRINCIPAL, attemptId: PRINCIPAL.connection_id, catalog, catalog_version: VERSION, now: () => clock
    });
    const permit = createOwnerStandardImageOneShotPermit(createInput);
    const consumeInput = Object.assign(Object.create(null) as Record<string, unknown>, {
      permit, candidate, principal: PRINCIPAL, attemptId: PRINCIPAL.connection_id
    });
    clock -= 1;
    expectPolicyError(() => consumeOwnerStandardImageOneShotPermit(consumeInput), "CLOCK_INVALID");
    clock = NOW;
    expectPolicyError(() => consumeOwnerStandardImageOneShotPermit(consumeInput), "PERMIT_EXPIRED");
  } finally { issuer.close(); }
});

test("binds all mixed reference kinds and preserves exact active wire settings", async () => {
  const { candidate, issuer } = await candidateFor("banana-2.1", ["image", "video", "file"]);
  try {
    assert.deepEqual(candidate.request.settings.file_urls.map((item) => item.type), ["image", "video", "file"]);
    assert.deepEqual(Object.keys(candidate.request.settings), ["n", "model_type", "aspect_ratio", "image_size", "thinking_level", "file_urls"]);
    const permit = issue(candidate);
    assert.equal(permit.request_fingerprint, candidate.request_fingerprint);
    assert.ok(Object.isFrozen(candidate.request.settings));
    assert.ok(Object.isFrozen(candidate.request.settings.file_urls));
    assert.ok(candidate.request.settings.file_urls.every(Object.isFrozen));
    assert.throws(() => { (candidate.request.settings.file_urls[0] as { url: string }).url = "https://evil.example/x"; }, TypeError);
    assert.equal(consumeOwnerStandardImageOneShotPermit({ permit, candidate, principal: PRINCIPAL,
      attemptId: PRINCIPAL.connection_id }).status, "consumed");
  } finally { issuer.close(); }
});

test("rejects forged, copied, cross-candidate, foreign-principal, wrong-source and revoked candidates before consume", async () => {
  const first = await candidateFor("gpt-image-2");
  const second = await candidateFor("gpt-image-2", []);
  try {
    expectPolicyError(() => issue({ ...first.candidate }), "CANDIDATE_UNBOUND");
    expectPolicyError(() => issue(first.candidate, { principal: FOREIGN, attemptId: FOREIGN.connection_id }), "CANDIDATE_UNBOUND");
    expectPolicyError(() => issue(first.candidate, { catalogVersion: "future.json" }), "CATALOG_BINDING_MISMATCH");
    const permit = issue(first.candidate);
    expectPolicyError(() => consumeOwnerStandardImageOneShotPermit({ permit: { ...permit }, candidate: first.candidate,
      principal: PRINCIPAL, attemptId: PRINCIPAL.connection_id }), "PERMIT_INVALID");
    expectPolicyError(() => consumeOwnerStandardImageOneShotPermit({ permit, candidate: second.candidate,
      principal: PRINCIPAL, attemptId: PRINCIPAL.connection_id }), "CANDIDATE_MISMATCH");
    expectPolicyError(() => consumeOwnerStandardImageOneShotPermit({ permit, candidate: first.candidate,
      principal: FOREIGN, attemptId: FOREIGN.connection_id }), "PRINCIPAL_MISMATCH");
    first.issuer.invalidateAttempt(PRINCIPAL.connection_id);
    expectPolicyError(() => consumeOwnerStandardImageOneShotPermit({ permit, candidate: first.candidate,
      principal: PRINCIPAL, attemptId: PRINCIPAL.connection_id }), "CANDIDATE_MISMATCH");
  } finally { first.issuer.close(); second.issuer.close(); }
});

test("permit expires at the candidate's original reference expiry and cannot be reissued", async () => {
  const { candidate, issuer } = await candidateFor("banana2", ["image"]);
  let clock = candidate.expires_at - 1;
  try {
    const permit = issue(candidate, { now: () => clock });
    assert.equal(permit.expires_at, candidate.expires_at);
    clock = candidate.expires_at;
    expectPolicyError(() => consumeOwnerStandardImageOneShotPermit({ permit, candidate, principal: PRINCIPAL,
      attemptId: PRINCIPAL.connection_id }), "PERMIT_EXPIRED");
    expectPolicyError(() => issue(candidate, { now: () => clock }), "CANDIDATE_EXPIRED");
  } finally { issuer.close(); }
});
