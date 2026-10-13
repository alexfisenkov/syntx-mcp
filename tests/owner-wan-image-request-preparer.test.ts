import assert from "node:assert/strict";
import test from "node:test";
import {
  createOwnerWanImageOwnedReferenceBindingIssuer,
  isOwnerWanImagePreparedCandidateForPrincipal,
  OwnerWanImagePrepareError,
  prepareOwnerWanImageRequest,
  type OwnerWanImageOwnedReferenceResolverContext
} from "../src/application/owner-wan-image-request-preparer.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";

const VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const catalog = loadSelectedDiscoveryCatalog(VERSION).discoveryCatalog;
const NOW = Date.parse("2026-10-10T00:00:00.000Z");
const PRINCIPAL = Object.freeze({ tenant_id: "tenant_test", subject_id: "subject_test", connection_id: "link_test_0123456789abcdef" });
const VARIANTS = ["wan_25_i2i_preview", "wan_26_image", "wan_27_image", "wan_27_image_pro"] as const;
const HANDLES = Array.from({ length: 10 }, (_, index) => `wan_image_00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);

let clock = NOW;
const options = { catalog, catalog_version: VERSION, now: () => clock };

function metadata(orientation: number | null = 1, width = 1200, height = 800) {
  if (orientation === null) return { orientation: null, projected_width: null, projected_height: null, confidence: "UNSUPPORTED_OR_MALFORMED_METADATA" };
  const swap = orientation >= 5;
  return { orientation, projected_width: swap ? height : width, projected_height: swap ? width : height,
    confidence: "HEADER_ORIENTATION_PROJECTION_NOT_BROWSER_DECODE" };
}

function resolverValue(context: OwnerWanImageOwnedReferenceResolverContext, index: number, extra: Record<string, unknown> = {}) {
  const sha256 = `sha256:${String(index + 1).repeat(64)}`;
  return { ...context, file_url: `https://r2.syntx.ai/private/wan/${index + 1}.png`, mime_type: "image/png",
    width: 1200, height: 800, size: 2_048 + index, sha256, expires_at: NOW + 600_000,
    metadata_confidence: "CONTAINER_METADATA_ONLY", coordinate_source_sha256: sha256,
    coordinate_metadata: metadata(1), ...extra };
}

function makeIssuer(resolve: (context: OwnerWanImageOwnedReferenceResolverContext) => Promise<unknown> = (context) => {
  const index = HANDLES.indexOf(context.reference_handle);
  return Promise.resolve(resolverValue(context, index < 0 ? 0 : index));
}) {
  return createOwnerWanImageOwnedReferenceBindingIssuer(resolve, options);
}

function fullParameters(variant: typeof VARIANTS[number], count: number, bboxList?: readonly (readonly number[][])[]) {
  const newBbox = bboxList ?? Array.from({ length: count }, () => []);
  return {
    aspect_ratio: "1:1",
    resolution: variant.startsWith("wan_25") || variant.startsWith("wan_26") ? "720P" : "1K",
    batch_size: 2,
    prompt_extend: true,
    seed: null,
    color_palette: variant === "wan_27_image" || variant === "wan_27_image_pro"
      ? [{ hex: "#FF0000", ratio: "50.00%" }, { hex: "#00FF00", ratio: "30.00%" }, { hex: "#0000FF", ratio: "20.00%" }]
      : null,
    bbox_list: newBbox
  };
}

async function issue(issuer: ReturnType<typeof makeIssuer>, variant: typeof VARIANTS[number], handles: readonly string[]) {
  return issuer.issue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant, reference_handles: handles });
}

test("all four exact e551 variants issue the complete reference count range and preserve handle order", async () => {
  clock = NOW;
  const calls: string[] = [];
  const issuer = makeIssuer(async (context) => {
    calls.push(context.reference_handle);
    return resolverValue(context, HANDLES.indexOf(context.reference_handle));
  });
  const counts = [[1, 3], [1, 4], [0, 9], [0, 9]] as const;
  for (let index = 0; index < VARIANTS.length; index += 1) {
    const variant = VARIANTS[index]!;
    const [minimum, maximum] = counts[index]!;
    const set = await issue(issuer, variant, HANDLES.slice(0, minimum)).catch((error: unknown) => {
      throw new Error(`minimum ${variant}: ${String((error as { code?: unknown }).code)}`);
    });
    assert.equal(set.variant, variant);
    assert.equal(set.reference_count, minimum);
    assert.deepEqual(Object.keys(set), []);
    const maximumSet = await issue(issuer, variant, HANDLES.slice(0, maximum)).catch((error: unknown) => {
      throw new Error(`maximum ${variant}: ${String((error as { code?: unknown }).code)}`);
    });
    assert.equal(maximumSet.reference_count, maximum);
    assert.deepEqual(calls.slice(-maximum), HANDLES.slice(0, maximum));
  }
  issuer.close();
});

test("full seven-control candidate creates exactly the ten source-shaped wire settings and hides private URLs", async () => {
  clock = NOW;
  for (const variant of VARIANTS) {
    const handles = variant.startsWith("wan_25") || variant.startsWith("wan_26") ? [HANDLES[0]!] : [];
    const issuer = makeIssuer();
    const set = await issue(issuer, variant, handles);
    const candidate = prepareOwnerWanImageRequest({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant,
      parameters: fullParameters(variant, handles.length), reference_set: set, prompt: "  keep the original prompt  ", bbox_coordinate_policy: null }, options);
    assert.deepEqual(Object.keys(candidate.request.settings), ["n", "model_type", "aspect_ratio", "resolution", "batch_size",
      "prompt_extend", "seed", "color_palette", "bbox_list", "file_urls"]);
    assert.equal(candidate.request.prompt, "  keep the original prompt  ");
    assert.equal(candidate.request.settings.n, 1);
    assert.equal(candidate.request.settings.model_type, variant);
    assert.equal(candidate.request.settings.batch_size, 2);
    assert.equal(candidate.cost_inputs.batch_size, 2);
    assert.equal("size" in candidate.cost_inputs, false);
    assert.equal(candidate.bbox_coordinate_policy, null);
    assert.equal(candidate.dispatch_allowed, false);
    assert.equal(candidate.backend_acceptance, "UNPROVEN");
    assert.equal(candidate.request_fingerprint.startsWith("sha256:"), true);
    assert.equal(Object.keys(candidate).includes("request"), false);
    assert.equal(JSON.stringify(candidate).includes("r2.syntx.ai"), false);
    assert.equal(candidate.request.settings.file_urls.length, handles.length);
    assert.equal(isOwnerWanImagePreparedCandidateForPrincipal(candidate, PRINCIPAL, PRINCIPAL.connection_id, NOW), true);
    assert.ok(Object.isFrozen(candidate) && Object.isFrozen(candidate.request.settings));
    issuer.close();
  }
});

test("bbox uses explicit local projection, ordered per-reference bounds, and permits unknown unboxed references", async () => {
  clock = NOW;
  const issuer = makeIssuer(async (context) => {
    const index = HANDLES.indexOf(context.reference_handle);
    return resolverValue(context, index, { coordinate_metadata: index === 0 ? metadata(6) : metadata(null) });
  });
  const set = await issue(issuer, "wan_27_image", HANDLES.slice(0, 2));
  const valid = prepareOwnerWanImageRequest({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant: "wan_27_image",
    parameters: fullParameters("wan_27_image", 2, [[[10, 20, 500, 900]], []]), reference_set: set, prompt: "subject",
    bbox_coordinate_policy: "LOCAL_HEADER_ORIENTATION_PROJECTION_UNVERIFIED_BROWSER" }, options);
  assert.equal(valid.bbox_coordinate_policy, "LOCAL_HEADER_ORIENTATION_PROJECTION_UNVERIFIED_BROWSER");
  assert.equal(valid.input_images[0]!.coordinate_metadata.projected_width, 800);
  assert.equal(valid.input_images[1]!.coordinate_metadata.confidence, "UNSUPPORTED_OR_MALFORMED_METADATA");
  assert.equal(valid.request.settings.bbox_list[0]![0]![2], 500);
  await assert.rejects(Promise.resolve().then(() => prepareOwnerWanImageRequest({ principal: PRINCIPAL,
    attempt_id: PRINCIPAL.connection_id, variant: "wan_27_image",
    parameters: fullParameters("wan_27_image", 2, [[], [[10, 20, 100, 100]]]), reference_set: set, prompt: "subject",
    bbox_coordinate_policy: "LOCAL_HEADER_ORIENTATION_PROJECTION_UNVERIFIED_BROWSER" }, options)),
  (error: unknown) => error instanceof OwnerWanImagePrepareError && error.code === "BBOX_GEOMETRY_UNAVAILABLE");
  await assert.rejects(Promise.resolve().then(() => prepareOwnerWanImageRequest({ principal: PRINCIPAL,
    attempt_id: PRINCIPAL.connection_id, variant: "wan_27_image",
    parameters: fullParameters("wan_27_image", 2, [[[10, 20, 801, 900]], []]), reference_set: set, prompt: "subject",
    bbox_coordinate_policy: "LOCAL_HEADER_ORIENTATION_PROJECTION_UNVERIFIED_BROWSER" }, options)),
  (error: unknown) => error instanceof OwnerWanImagePrepareError && error.code === "BBOX_GEOMETRY_UNAVAILABLE");
  issuer.close();
});

test("Pro 4K with references stays rejected and a raw URL cannot replace an owner handle", async () => {
  clock = NOW;
  const issuer = makeIssuer();
  const set = await issue(issuer, "wan_27_image_pro", [HANDLES[0]!]);
  await assert.rejects(Promise.resolve().then(() => prepareOwnerWanImageRequest({ principal: PRINCIPAL,
    attempt_id: PRINCIPAL.connection_id, variant: "wan_27_image_pro", parameters: {
      ...fullParameters("wan_27_image_pro", 1), resolution: "4K" }, reference_set: set, prompt: "subject", bbox_coordinate_policy: null }, options)), OwnerWanImagePrepareError);
  await assert.rejects(issue(issuer, "wan_27_image", ["https://r2.syntx.ai/private/forged.png"]), OwnerWanImagePrepareError);
  issuer.close();
});

test("issued references and candidates stay nominal, model-bound, and detached from caller mutation", async () => {
  clock = NOW;
  const issuer = makeIssuer();
  const set = await issue(issuer, "wan_27_image", [HANDLES[0]!]);
  assert.throws(() => prepareOwnerWanImageRequest({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id,
    variant: "wan_27_image_pro", parameters: fullParameters("wan_27_image_pro", 1), reference_set: set, prompt: "subject", bbox_coordinate_policy: null }, options),
  (error: unknown) => error instanceof OwnerWanImagePrepareError && error.code === "REFERENCE_UNAVAILABLE");
  const parameters: Record<string, unknown> = fullParameters("wan_27_image", 1);
  const candidate = prepareOwnerWanImageRequest({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id,
    variant: "wan_27_image", parameters, reference_set: set, prompt: "subject", bbox_coordinate_policy: null }, options);
  parameters.seed = 17;
  parameters.batch_size = 4;
  assert.equal(candidate.request.settings.seed, null);
  assert.equal(candidate.request.settings.batch_size, 2);
  assert.equal(candidate.request.settings.file_urls[0]!.url, "https://r2.syntx.ai/private/wan/1.png");
  issuer.close();
});

test("resolver rejects mismatched coordinate hashes, invalid dimension limits, and unsafe URLs", async () => {
  clock = NOW;
  const errors = [
    { coordinate_source_sha256: `sha256:${"f".repeat(64)}` },
    { width: 200 },
    { file_url: "https://example.invalid/image.png" }
  ];
  for (let index = 0; index < errors.length; index += 1) {
    const issuer = makeIssuer((context) => Promise.resolve(resolverValue(context, index, errors[index]!)));
    await assert.rejects(issue(issuer, "wan_27_image", [HANDLES[index]!]),
      (error: unknown) => error instanceof OwnerWanImagePrepareError && error.code === "REFERENCE_UNAVAILABLE");
    issuer.close();
  }
  const duplicateUrlIssuer = makeIssuer((context) => Promise.resolve(resolverValue(context, 0)));
  await assert.rejects(issue(duplicateUrlIssuer, "wan_27_image", HANDLES.slice(0, 2)),
    (error: unknown) => error instanceof OwnerWanImagePrepareError && error.code === "REFERENCE_UNAVAILABLE");
  duplicateUrlIssuer.close();
});

test("bbox coordinate policy is caller-explicit and rejects omitted or implicit attestations", async () => {
  clock = NOW;
  const issuer = makeIssuer();
  const set = await issue(issuer, "wan_27_image", [HANDLES[0]!]);
  const base = { principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant: "wan_27_image" as const,
    parameters: fullParameters("wan_27_image", 1, [[[0, 0, 100, 100]]]), reference_set: set, prompt: "subject" };
  assert.throws(() => prepareOwnerWanImageRequest({ ...base, bbox_coordinate_policy: null }, options),
    (error: unknown) => error instanceof OwnerWanImagePrepareError && error.code === "INVALID_REQUEST");
  assert.throws(() => prepareOwnerWanImageRequest(base, options), OwnerWanImagePrepareError);
  issuer.close();
});

test("empty reference sets for 27 models are cached only within their principal/attempt/variant TTL", async () => {
  clock = NOW;
  const issuer = makeIssuer();
  const first = await issue(issuer, "wan_27_image", []);
  assert.equal(await issue(issuer, "wan_27_image", []), first);
  const pro = await issue(issuer, "wan_27_image_pro", []);
  assert.notEqual(pro, first);
  clock = NOW + 15 * 60_000;
  const renewed = await issue(issuer, "wan_27_image", []);
  assert.notEqual(renewed, first);
  assert.equal(first.expires_at, NOW + 15 * 60_000);
  issuer.close();
});

test("principal mismatch, original expiry, revoke, pending cancellation, and close fail closed", async () => {
  clock = NOW;
  const issuer = makeIssuer();
  const set = await issue(issuer, "wan_27_image", [HANDLES[0]!]);
  assert.throws(() => prepareOwnerWanImageRequest({ principal: { ...PRINCIPAL, subject_id: "other" },
    attempt_id: PRINCIPAL.connection_id, variant: "wan_27_image", parameters: fullParameters("wan_27_image", 1),
    reference_set: set, prompt: "subject", bbox_coordinate_policy: null }, options), OwnerWanImagePrepareError);
  issuer.invalidateAttempt(PRINCIPAL.connection_id);
  assert.throws(() => prepareOwnerWanImageRequest({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id,
    variant: "wan_27_image", parameters: fullParameters("wan_27_image", 1), reference_set: set, prompt: "subject", bbox_coordinate_policy: null }, options), OwnerWanImagePrepareError);

  let resolveLate!: (value: unknown) => void;
  const pendingIssuer = makeIssuer(() => new Promise<unknown>((resolve) => { resolveLate = resolve; }));
  const pending = issue(pendingIssuer, "wan_27_image", [HANDLES[0]!]);
  await Promise.resolve();
  pendingIssuer.invalidateAttempt(PRINCIPAL.connection_id);
  resolveLate(resolverValue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant: "wan_27_image",
    model_id: "wan_27_image", ai_name: "wan_image", scope: "image", catalog_version: VERSION,
    profile_schema_hash: "sha256:" + "0".repeat(64), reference_handle: HANDLES[0]! }, 0));
  await assert.rejects(pending, OwnerWanImagePrepareError);
  pendingIssuer.close();

  const expiring = await issue(issuer, "wan_27_image", [HANDLES[1]!]);
  clock = expiring.expires_at;
  assert.throws(() => prepareOwnerWanImageRequest({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id,
    variant: "wan_27_image", parameters: fullParameters("wan_27_image", 1), reference_set: expiring, prompt: "subject", bbox_coordinate_policy: null }, options),
  OwnerWanImagePrepareError);
  issuer.close();
  await assert.rejects(issue(issuer, "wan_27_image", []), OwnerWanImagePrepareError);
});
