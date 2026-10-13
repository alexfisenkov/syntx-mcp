import assert from "node:assert/strict";
import test from "node:test";
import {
  createOwnerRunwayImageOwnedReferenceBindingIssuer,
  isOwnerRunwayImagePreparedCandidateForPrincipal,
  prepareOwnerRunwayImageRequest,
  type OwnerRunwayImageOwnedReferenceResolverContext,
  type OwnerRunwayImageOwnedReferenceResolution
} from "../src/application/owner-runway-image-request-preparer.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";

const catalog = loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION).discoveryCatalog;
const VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const NOW = Date.parse("2026-10-10T00:00:00.000Z");
const PRINCIPAL = Object.freeze({ tenant_id: "tenant_test", subject_id: "subject_test", connection_id: "link_test_0123456789abcdef" });
const HANDLES = ["runway_image_00000000-0000-4000-8000-000000000001", "runway_image_00000000-0000-4000-8000-000000000002", "runway_image_00000000-0000-4000-8000-000000000003"];
let clock = NOW;
const options = { catalog, catalog_version: VERSION, now: () => clock };

function resolve(context: OwnerRunwayImageOwnedReferenceResolverContext, index = 0, extra: Record<string, unknown> = {}): OwnerRunwayImageOwnedReferenceResolution {
  const sha = `sha256:${String(index + 1).padStart(64, "0")}`;
  return { ...context, file_url: `https://r2.syntx.ai/private/runway/${index + 1}.png`, mime_type: "image/png",
    width: 1200, height: 800, size: 2048 + index, sha256: sha, expires_at: NOW + 600_000,
    metadata_confidence: "CONTAINER_METADATA_ONLY", ...extra } as OwnerRunwayImageOwnedReferenceResolution;
}
function makeIssuer(fn: (context: OwnerRunwayImageOwnedReferenceResolverContext) => Promise<OwnerRunwayImageOwnedReferenceResolution> = async (c) => resolve(c, HANDLES.indexOf(c.reference_handle))) {
  return createOwnerRunwayImageOwnedReferenceBindingIssuer(fn, options);
}
const params = (resolution = "2112x912", temperature = 2.25) => ({ resolution, temperature });

test("all six literal resolutions and manual fractional temperatures are preserved with refs 0..3", async () => {
  clock = NOW;
  const resolutions = ["2112x912", "1920x1088", "1456x1088", "1088x1088", "1088x1456", "1088x1920"];
  const temperatures = [1, 1.375, 2.25, 3.5, 4.625, 5];
  for (const [index, resolution] of resolutions.entries()) {
    const issuer = makeIssuer();
    const handles = HANDLES.slice(0, index % 4);
    const set = await issuer.issue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant: "runway_frames", reference_handles: handles });
    const candidate = prepareOwnerRunwayImageRequest({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id,
      variant: "runway_frames", parameters: params(resolution, temperatures[index]!), reference_set: set, prompt: "  source wording 🙂  " }, options);
    assert.equal(candidate.request.settings.resolution, resolution);
    assert.equal(candidate.request.settings.temperature, temperatures[index]);
    assert.equal(candidate.request.settings.n, 1);
    assert.deepEqual(Object.keys(candidate.request.settings), ["n", "model_type", "resolution", "temperature", "file_urls"]);
    assert.equal(candidate.reference_count, handles.length);
    assert.equal(candidate.dispatch_allowed, false);
    assert.equal(candidate.backend_acceptance, "UNPROVEN");
    assert.deepEqual(candidate.cost_inputs, {});
    assert.equal(isOwnerRunwayImagePreparedCandidateForPrincipal(candidate, PRINCIPAL, PRINCIPAL.connection_id, NOW), true);
    assert.equal(JSON.stringify(candidate).includes("r2.syntx.ai"), false);
    issuer.close();
  }
});

test("references are nominal, privately URL-bound, source-capped and stable intent excludes relink and URL", async () => {
  clock = NOW;
  const issuer = makeIssuer();
  const set = await issuer.issue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant: "runway_frames", reference_handles: HANDLES.slice(0, 2) });
  const input = { principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant: "runway_frames" as const,
    parameters: params(), reference_set: set, prompt: "same intent" };
  const first = prepareOwnerRunwayImageRequest(input, options);
  assert.equal(first.request.settings.file_urls[0]!.url, "https://r2.syntx.ai/private/runway/1.png");
  assert.equal(Object.keys(first).includes("request"), false);
  assert.equal(first.intent_fingerprint, prepareOwnerRunwayImageRequest(input, options).intent_fingerprint);
  issuer.close();

  const otherPrincipal = Object.freeze({ ...PRINCIPAL, connection_id: "link_other_0123456789abcdef" });
  const issuer2 = makeIssuer(async (c) => resolve(c, HANDLES.indexOf(c.reference_handle), { file_url: `https://r2.syntx.ai/private/rotated/${c.reference_handle}.png` }));
  const set2 = await issuer2.issue({ principal: otherPrincipal, attempt_id: otherPrincipal.connection_id, variant: "runway_frames", reference_handles: HANDLES.slice(0, 2) });
  const second = prepareOwnerRunwayImageRequest({ ...input, principal: otherPrincipal, attempt_id: otherPrincipal.connection_id, reference_set: set2 }, options);
  assert.equal(first.intent_fingerprint, second.intent_fingerprint);
  await assert.rejects(makeIssuer(async (c) => resolve(c, 0, { size: 33_554_433 })).issue({ principal: PRINCIPAL,
    attempt_id: PRINCIPAL.connection_id, variant: "runway_frames", reference_handles: [HANDLES[0]!] }));
  await assert.rejects(issuer2.issue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant: "runway_frames",
    reference_handles: ["https://r2.syntx.ai/private/forged.png"] }));
  issuer2.close();
});

test("cloned sets and caller metadata cannot establish ownership; expired and clock-regressed references fail", async () => {
  clock = NOW;
  const issuer = makeIssuer();
  const set = await issuer.issue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant: "runway_frames", reference_handles: [HANDLES[0]!] });
  const fake = Object.freeze({ ...set });
  assert.throws(() => prepareOwnerRunwayImageRequest({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id,
    variant: "runway_frames", parameters: params(), reference_set: fake, prompt: "x" }, options));
  assert.throws(() => prepareOwnerRunwayImageRequest({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id,
    variant: "runway_frames", parameters: params(), reference_set: set, prompt: "" }, options));
  issuer.close();

  let local = NOW;
  const expiring = createOwnerRunwayImageOwnedReferenceBindingIssuer(async (c) => resolve(c, 0, { expires_at: NOW + 100 }), { ...options, now: () => local });
  const shortSet = await expiring.issue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant: "runway_frames", reference_handles: [HANDLES[0]!] });
  local = NOW + 100;
  assert.throws(() => prepareOwnerRunwayImageRequest({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id,
    variant: "runway_frames", parameters: params(), reference_set: shortSet, prompt: "x" }, { ...options, now: () => local }));
  expiring.close();
});
