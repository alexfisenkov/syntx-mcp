import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import { OWNER_GPT26_PUBLIC_CATALOG_VERSION } from "../src/application/owner-gpt26-image-source-profile.js";
import { createOwnerStandardImageOwnedReferenceBindingIssuer, prepareOwnerStandardImageRequest,
  isOwnerStandardImagePreparedCandidateForPrincipal, OwnerStandardImagePrepareError } from "../src/application/owner-standard-image-request-preparer.js";
import { createOwnerStandardImageOneShotPermit, consumeOwnerStandardImageOneShotPermit } from "../src/application/owner-standard-image-one-shot-policy.js";

const CATALOG = loadSelectedDiscoveryCatalog(OWNER_GPT26_PUBLIC_CATALOG_VERSION).discoveryCatalog;
const NOW = Date.parse("2026-11-10T13:00:00Z");
const PRINCIPAL = Object.freeze({ tenant_id: "tenant_gpt26", subject_id: "owner_gpt26",
  connection_id: "link_gpt26_native_attempt_000001" });
const HANDLES = Array.from({ length: 3 }, (_, i) => `standard_image_00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`);
const PARAMETERS = Object.freeze({ aspect_ratio: "16:9", quality: "1K", details_quality: "high", output_format: "gif" });

function issuer(sizes: number[], catalog = CATALOG, version: string = OWNER_GPT26_PUBLIC_CATALOG_VERSION) {
  return createOwnerStandardImageOwnedReferenceBindingIssuer(async context => {
    const index = HANDLES.indexOf(context.reference_handle);
    return { ...context, file_url: `https://r2.syntx.ai/private/gpt26/${index + 1}.png`,
      mime_type: "image/png", kind: "image" as const, width: 1024, height: 768, duration: null,
      size: sizes[index]!, sha256: `sha256:${String(index + 1).padStart(64, "0")}`,
      expires_at: NOW + 600_000, metadata_confidence: "CONTAINER_METADATA_ONLY" as const };
  }, { catalog, catalog_version: version, now: () => NOW });
}

test("GPT26 native candidate binds fresh catalog, ordered references, output format and one-use permit", async () => {
  const binding = issuer([1024, 2048]);
  try {
    const reference_set = await binding.issue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id,
      variant: "gpt-image-2.6-flare", reference_handles: HANDLES.slice(0, 2) });
    const candidate = prepareOwnerStandardImageRequest({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id,
      variant: "gpt-image-2.6-flare", parameters: PARAMETERS, reference_set, prompt: "Preserve product detail" },
    { catalog: CATALOG, catalog_version: OWNER_GPT26_PUBLIC_CATALOG_VERSION, now: () => NOW });
    assert.deepEqual(candidate.request.settings, { n: 1, model_type: "gpt-image-2.6-flare",
      ...PARAMETERS, file_urls: [{ type: "image", url: "https://r2.syntx.ai/private/gpt26/1.png" },
        { type: "image", url: "https://r2.syntx.ai/private/gpt26/2.png" }] });
    assert.deepEqual(candidate.cost_inputs, { quality: "1K", details_quality: "high", output_format: "gif", ref_count: 2 });
    assert.equal(isOwnerStandardImagePreparedCandidateForPrincipal(candidate, PRINCIPAL, PRINCIPAL.connection_id, NOW), true);
    const permit = createOwnerStandardImageOneShotPermit({ candidate, principal: PRINCIPAL,
      attemptId: PRINCIPAL.connection_id, catalog: CATALOG, catalog_version: OWNER_GPT26_PUBLIC_CATALOG_VERSION,
      now: () => NOW });
    assert.equal(permit.variant, "gpt-image-2.6-flare");
    assert.equal(permit.catalog_version, OWNER_GPT26_PUBLIC_CATALOG_VERSION);
    assert.deepEqual(consumeOwnerStandardImageOneShotPermit({ permit, candidate, principal: PRINCIPAL,
      attemptId: PRINCIPAL.connection_id }), { status: "consumed", dispatch_allowed: false,
      request_fingerprint: candidate.request_fingerprint });
  } finally { binding.close(); }
});

test("GPT26 reference set enforces separate 32 MiB file and 80 MiB total limits", async () => {
  for (const sizes of [[33 * 1024 * 1024], [30 * 1024 * 1024, 30 * 1024 * 1024, 30 * 1024 * 1024]]) {
    const binding = issuer(sizes);
    try {
      await assert.rejects(binding.issue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id,
        variant: "gpt-image-2.6-sunburst", reference_handles: HANDLES.slice(0, sizes.length) }),
      (error: unknown) => error instanceof OwnerStandardImagePrepareError && error.code === "REFERENCE_UNAVAILABLE");
    } finally { binding.close(); }
  }
});

test("current 80 MiB local admission ceiling covers historical GPT2/2.5 without changing their E551 source profiles", async () => {
  const oldCatalog = loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION).discoveryCatalog;
  for (const variant of ["gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"] as const) {
    const binding = issuer([30 * 1024 * 1024, 30 * 1024 * 1024, 30 * 1024 * 1024], oldCatalog,
      DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION);
    try {
      await assert.rejects(binding.issue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id,
        variant, reference_handles: HANDLES }),
      (error: unknown) => error instanceof OwnerStandardImagePrepareError && error.code === "REFERENCE_UNAVAILABLE");
    } finally { binding.close(); }
  }
});
