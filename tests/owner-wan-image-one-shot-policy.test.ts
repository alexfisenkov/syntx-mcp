import assert from "node:assert/strict";
import test from "node:test";
import type { GenerationPrincipalRef } from "../src/domain/generation-operation.js";
import {
  createOwnerWanImageOneShotPermit,
  consumeOwnerWanImageOneShotPermit,
  OwnerWanImageOneShotPolicyError
} from "../src/application/owner-wan-image-one-shot-policy.js";
import {
  createOwnerWanImageOwnedReferenceBindingIssuer,
  prepareOwnerWanImageRequest,
  type OwnerWanImageOwnedReferenceResolverContext,
  type OwnerWanImagePreparedCandidate
} from "../src/application/owner-wan-image-request-preparer.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";

const VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const catalog = loadSelectedDiscoveryCatalog(VERSION).discoveryCatalog;
const PRINCIPAL = Object.freeze({ tenant_id: "tenant_wan", subject_id: "owner_wan", connection_id: "link_wan_0123456789abcdef" });
const FOREIGN = Object.freeze({ tenant_id: "tenant_other", subject_id: "owner_other", connection_id: "link_other_0123456789abcdef" });
const VARIANTS = ["wan_25_i2i_preview", "wan_26_image", "wan_27_image", "wan_27_image_pro"] as const;
const HANDLES = Array.from({ length: 9 }, (_, index) => `wan_image_00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);

function params(variant: typeof VARIANTS[number], count: number, patch: Record<string, unknown> = {}) {
  return {
    aspect_ratio: "1:1",
    resolution: variant.startsWith("wan_25") || variant.startsWith("wan_26") ? "720P" : "1K",
    batch_size: 2,
    prompt_extend: true,
    seed: null,
    color_palette: variant === "wan_27_image" || variant === "wan_27_image_pro"
      ? [{ hex: "#FF0000", ratio: "50.00%" }, { hex: "#00FF00", ratio: "30.00%" }, { hex: "#0000FF", ratio: "20.00%" }]
      : null,
    bbox_list: Array.from({ length: count }, () => []),
    ...patch
  };
}

async function candidateFor(variant: typeof VARIANTS[number], count?: number, parameterPatch: Record<string, unknown> = {}) {
  const actualCount = count ?? (variant.startsWith("wan_25") || variant.startsWith("wan_26") ? 1 : 0);
  const now = Date.now();
  const issuer = createOwnerWanImageOwnedReferenceBindingIssuer(async (context: Readonly<OwnerWanImageOwnedReferenceResolverContext>) => {
    const index = HANDLES.indexOf(context.reference_handle);
    const sha256 = `sha256:${String(index + 1).repeat(64)}`;
    return {
      ...context,
      file_url: `https://r2.syntx.ai/private/wan-one-shot/${index + 1}.png`,
      mime_type: "image/png",
      width: 1200,
      height: 800,
      size: 2_048 + index,
      sha256,
      expires_at: now + 600_000,
      metadata_confidence: "CONTAINER_METADATA_ONLY",
      coordinate_source_sha256: sha256,
      coordinate_metadata: { orientation: 1, projected_width: 1200, projected_height: 800,
        confidence: "HEADER_ORIENTATION_PROJECTION_NOT_BROWSER_DECODE" }
    };
  }, { catalog, catalog_version: VERSION });
  const set = await issuer.issue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant,
    reference_handles: HANDLES.slice(0, actualCount) });
  const candidate = prepareOwnerWanImageRequest({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant,
    parameters: params(variant, actualCount, parameterPatch), reference_set: set, prompt: "  keep this exact prompt  ",
    bbox_coordinate_policy: null }, { catalog, catalog_version: VERSION });
  return { candidate, issuer };
}

function issue(candidate: OwnerWanImagePreparedCandidate, options: { principal?: GenerationPrincipalRef; attemptId?: string; catalogVersion?: string; now?: () => number } = {}) {
  return createOwnerWanImageOneShotPermit({
    candidate,
    principal: options.principal ?? PRINCIPAL,
    attemptId: options.attemptId ?? PRINCIPAL.connection_id,
    catalog,
    catalog_version: options.catalogVersion ?? VERSION,
    ...(options.now ? { now: options.now } : {})
  });
}

function expectPolicyError(callback: () => unknown, code: string): void {
  assert.throws(callback, (error: unknown) => error instanceof OwnerWanImageOneShotPolicyError && error.code === code);
}

test("one nominal permit binds all four WAN variants to the exact source settings and consumes once", async () => {
  for (const variant of VARIANTS) {
    const { candidate, issuer } = await candidateFor(variant);
    try {
      const permit = issue(candidate);
      assert.equal(permit.status, "nominal");
      assert.equal(permit.dispatch_allowed, false);
      assert.equal(permit.variant, variant);
      assert.equal(permit.model_id, variant);
      assert.equal(permit.ai_name, "wan_image");
      assert.equal(permit.request_fingerprint, candidate.request_fingerprint);
      assert.equal(permit.expires_at, candidate.expires_at);
      assert.equal("account" in permit || "cost" in permit || "plan" in permit, false);
      assert.deepEqual(Object.keys(candidate.cost_inputs), ["batch_size"]);
      assert.deepEqual(Object.keys(candidate.request.settings), ["n", "model_type", "aspect_ratio", "resolution", "batch_size",
        "prompt_extend", "seed", "color_palette", "bbox_list", "file_urls"]);
      expectPolicyError(() => consumeOwnerWanImageOneShotPermit({ permit, candidate, principal: FOREIGN,
        attemptId: FOREIGN.connection_id }), "PRINCIPAL_MISMATCH");
      assert.deepEqual(consumeOwnerWanImageOneShotPermit({ permit, candidate, principal: PRINCIPAL,
        attemptId: PRINCIPAL.connection_id }), {
        status: "consumed", dispatch_allowed: false, request_fingerprint: candidate.request_fingerprint
      });
      expectPolicyError(() => consumeOwnerWanImageOneShotPermit({ permit, candidate, principal: PRINCIPAL,
        attemptId: PRINCIPAL.connection_id }), "PERMIT_ALREADY_CONSUMED");
      expectPolicyError(() => issue(candidate), "CANDIDATE_ALREADY_ISSUED");
    } finally { issuer.close(); }
  }
});

test("candidate creation rejects foreign principals, a mismatched catalog and accessor inputs", async () => {
  const { candidate, issuer } = await candidateFor("wan_27_image");
  try {
    expectPolicyError(() => issue(candidate, { principal: FOREIGN, attemptId: FOREIGN.connection_id }), "CANDIDATE_UNBOUND");
    expectPolicyError(() => issue(candidate, { catalogVersion: "other" }), "CATALOG_BINDING_MISMATCH");
    const accessor = Object.defineProperty({}, "candidate", { enumerable: true, get() { throw new Error("must not execute"); } });
    expectPolicyError(() => createOwnerWanImageOneShotPermit(accessor), "INVALID_REQUEST");
  } finally { issuer.close(); }
});

test("permit expiry follows original candidate/reference expiry and never permits reissue", async () => {
  const { candidate, issuer } = await candidateFor("wan_27_image", 2);
  let clock = candidate.expires_at - 1;
  try {
    const permit = issue(candidate, { now: () => clock });
    assert.equal(permit.expires_at, candidate.expires_at);
    clock = candidate.expires_at;
    expectPolicyError(() => consumeOwnerWanImageOneShotPermit({ permit, candidate, principal: PRINCIPAL,
      attemptId: PRINCIPAL.connection_id }), "PERMIT_EXPIRED");
    expectPolicyError(() => issue(candidate, { now: () => clock }), "CANDIDATE_EXPIRED");
  } finally { issuer.close(); }
});

test("a second privately prepared intent cannot borrow another candidate's permit", async () => {
  const first = await candidateFor("wan_27_image", 1);
  const second = await candidateFor("wan_27_image", 1, { batch_size: 3 });
  try {
    const permit = issue(first.candidate);
    expectPolicyError(() => consumeOwnerWanImageOneShotPermit({ permit, candidate: second.candidate,
      principal: PRINCIPAL, attemptId: PRINCIPAL.connection_id }), "CANDIDATE_MISMATCH");
    assert.equal(second.candidate.request.settings.batch_size, 3);
  } finally { first.issuer.close(); second.issuer.close(); }
});
