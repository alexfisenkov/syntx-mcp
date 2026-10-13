import assert from "node:assert/strict";
import test from "node:test";
import {
  createOwnerMagnificUpscaleOwnedImageBindingIssuer,
  getOwnerMagnificUpscaleSourceProfile,
  isOwnerMagnificUpscalePreparedCandidateForPrincipal,
  OwnerMagnificUpscalePrepareError,
  prepareOwnerMagnificUpscaleRequest,
  type OwnerMagnificUpscaleOwnedImageResolution,
  type OwnerMagnificUpscaleOwnedImageBindingIssueInput,
  type PrepareOwnerMagnificUpscaleRequestInput
} from "../src/application/owner-magnific-upscale-request-preparer.js";
import type { OwnerMagnificUpscaleVariant } from "../src/application/owner-magnific-upscale-parameters.js";

const ATTEMPT = "link_owner_magnific_attempt_000001";
const PRINCIPAL = Object.freeze({ tenant_id: "owner-tenant", subject_id: "owner-subject", connection_id: ATTEMPT });
const FILE_URL = "https://r2.syntx.ai/private/magnific-image?sig=opaque";
const PARAMETERS = Object.freeze({
  scale_factor: "2x",
  optimized_for: "standard",
  engine: "automatic",
  creativity: 3,
  hdr: 3,
  resemblance: 3,
  fractality: 3,
  sharpen: 30,
  smart_grain: 30,
  ultra_detail: 30,
  flavor: "sublime"
} as const);
const DIMENSIONS = Object.freeze({ width: 512, height: 512 });
const NOW = 1_000;

function resolution(
  variant: OwnerMagnificUpscaleVariant,
  overrides: Record<string, unknown> = {}
): OwnerMagnificUpscaleOwnedImageResolution {
  return {
    principal: PRINCIPAL,
    attempt_id: ATTEMPT,
    variant,
    model_id: variant,
    scope: "tool_image_upscaler",
    catalog_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
    profile_schema_hash: getOwnerMagnificUpscaleSourceProfile(variant).profile_schema_hash,
    file_url: FILE_URL,
    mime_type: "image/png",
    width: DIMENSIONS.width,
    height: DIMENSIONS.height,
    size: 5_461,
    sha256: `sha256:${"a".repeat(64)}`,
    expires_at: 2_000,
    metadata_confidence: "CONTAINER_METADATA_ONLY",
    ...overrides
  } as OwnerMagnificUpscaleOwnedImageResolution;
}

function issueInput(variant: OwnerMagnificUpscaleVariant = "creative"): OwnerMagnificUpscaleOwnedImageBindingIssueInput {
  return { principal: PRINCIPAL, attempt_id: ATTEMPT, variant, opaque_image_handle: "magnific_image_opaque_0001" };
}

function prepareInput(
  image_binding: unknown,
  variant: OwnerMagnificUpscaleVariant = "creative",
  overrides: Record<string, unknown> = {}
): PrepareOwnerMagnificUpscaleRequestInput {
  return {
    principal: PRINCIPAL,
    attempt_id: ATTEMPT,
    variant,
    parameters: PARAMETERS,
    image_binding,
    ...overrides
  } as PrepareOwnerMagnificUpscaleRequestInput;
}

async function issue(
  variant: OwnerMagnificUpscaleVariant = "creative",
  image: unknown = resolution(variant),
  now: () => number = () => NOW
) {
  const calls: unknown[] = [];
  const issuer = createOwnerMagnificUpscaleOwnedImageBindingIssuer(async (context) => {
    calls.push(context);
    return image;
  }, { now });
  return { issuer, calls, binding: await issuer.issue(issueInput(variant)) };
}

async function expectError(callback: () => unknown, code: string): Promise<void> {
  await assert.rejects(Promise.resolve().then(callback),
    (error: unknown) => error instanceof OwnerMagnificUpscalePrepareError && error.code === code);
}

test("source profile binds each selected variant identity and source lineage without dispatch capability", () => {
  for (const variant of ["creative", "precision_v1", "precision_v2"] as const) {
    const profile = getOwnerMagnificUpscaleSourceProfile(variant);
    assert.equal(profile.ai_name, "magnific");
    assert.equal(profile.model_id, variant);
    assert.equal(profile.variant, variant);
    assert.match(profile.profile_schema_hash, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(profile.operation_id, "upscale-image");
    assert.equal(profile.source_route, "design/generate");
    assert.equal(profile.dispatch_allowed, false);
    assert.equal(profile.backend_acceptance, "UNPROVEN");
    assert.equal(profile.runtime_activation, false);
    assert.equal(profile.local_input_size.maximum_bytes, 10 * 1024 * 1024);
    assert.equal(profile.local_input_size.confidence, "SOURCE_UI_FALLBACK_NOT_PROVIDER_LIMIT");
    assert.equal(profile.local_input_size.public_zero_semantics,
      "ZERO_FALLS_BACK_TO_10MIB_FRONTEND_ONLY_NOT_PROVIDER_LIMIT");
    assert.deepEqual(profile.source_binding.form_sha256,
      "sha256:0d3559b37f3ce20528638a45307e7ce30a9cf9a6aa2e446b059f30830aae14e8");
    assert.equal(profile.source_binding.file_upload_component_sha256,
      "sha256:2eddb5ee7f0b41cd31f56a2345542d9b5d70da419d1c2b1d003afc36519869d5");
    assert.equal(Object.isFrozen(profile), true);
  }
  assert.notEqual(getOwnerMagnificUpscaleSourceProfile("creative").profile_schema_hash,
    getOwnerMagnificUpscaleSourceProfile("precision_v1").profile_schema_hash);
});

test("issuer receives exact trusted owner, variant, catalog and profile context and returns no URL", async () => {
  const { binding, calls } = await issue("precision_v2");
  const profile = getOwnerMagnificUpscaleSourceProfile("precision_v2");
  assert.deepEqual(calls, [{
    principal: PRINCIPAL,
    attempt_id: ATTEMPT,
    opaque_image_handle: "magnific_image_opaque_0001",
    variant: "precision_v2",
    model_id: "precision_v2",
    scope: "tool_image_upscaler",
    catalog_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
    profile_schema_hash: profile.profile_schema_hash
  }]);
  assert.equal(Object.hasOwn(binding, "file_url"), false);
  assert.equal(Object.isFrozen(binding), true);
});

test("all three variants prepare literal full bodies with one owned URL and exact source metadata", async () => {
  for (const variant of ["creative", "precision_v1", "precision_v2"] as const) {
    const { binding } = await issue(variant);
    const candidate = prepareOwnerMagnificUpscaleRequest(prepareInput(binding, variant), { now: () => 1_500 });
    assert.equal(candidate.status, "blocked");
    assert.equal(candidate.dispatch_allowed, false);
    assert.equal(candidate.backend_acceptance, "UNPROVEN");
    assert.equal(candidate.ai_name, "magnific");
    assert.equal(candidate.variant, variant);
    assert.equal(candidate.model_id, variant);
    assert.equal(candidate.model_type, variant);
    assert.equal(candidate.operation_id, "upscale-image");
    assert.equal(candidate.source_route, "design/generate");
    assert.deepEqual(candidate.query, { ai_name: "magnific" });
    assert.deepEqual(candidate.image, {
      mime_type: "image/png", width: 512, height: 512, size: 5_461,
      sha256: `sha256:${"a".repeat(64)}`, metadata_confidence: "CONTAINER_METADATA_ONLY"
    });
    assert.deepEqual(candidate.request, {
      settings: {
        n: 1,
        model_type: variant,
        width: 512,
        height: 512,
        scale_factor: "2x",
        optimized_for: "standard",
        engine: "automatic",
        creativity: 3,
        hdr: 3,
        resemblance: 3,
        fractality: 3,
        sharpen: 30,
        smart_grain: 30,
        ultra_detail: 30,
        flavor: "sublime",
        file_urls: [{ type: "image", url: FILE_URL }]
      }
    });
    assert.equal(candidate.expires_at, 2_000);
    assert.equal(Object.isFrozen(candidate), true);
    assert.equal(Object.isFrozen(candidate.request.settings), true);
    assert.equal(Object.isFrozen(candidate.request.settings.file_urls), true);
    assert.match(candidate.request_fingerprint, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(isOwnerMagnificUpscalePreparedCandidateForPrincipal(candidate, PRINCIPAL, ATTEMPT, 1_999), true);
    assert.equal(isOwnerMagnificUpscalePreparedCandidateForPrincipal(candidate, PRINCIPAL, `${ATTEMPT}-other`, 1_999), false);
    assert.equal(isOwnerMagnificUpscalePreparedCandidateForPrincipal(candidate, { ...PRINCIPAL, subject_id: "foreign" }, ATTEMPT, 1_999), false);
    assert.equal(isOwnerMagnificUpscalePreparedCandidateForPrincipal(candidate, PRINCIPAL, ATTEMPT, 2_000), false);
  }
});

test("prompt is optional and empty is omitted; UTF-8 cap is client-local and controls reject", async () => {
  const { binding } = await issue();
  const noPrompt = prepareOwnerMagnificUpscaleRequest(prepareInput(binding), { now: () => NOW });
  const emptyPrompt = prepareOwnerMagnificUpscaleRequest(prepareInput(binding, "creative", { prompt: "" }), { now: () => NOW });
  const prompt = prepareOwnerMagnificUpscaleRequest(prepareInput(binding, "creative", { prompt: "A red fox" }), { now: () => NOW });
  const { binding: precisionV1Binding } = await issue("precision_v1");
  const { binding: precisionV2Binding } = await issue("precision_v2");
  assert.equal(Object.hasOwn(noPrompt.request, "prompt"), false);
  assert.equal(Object.hasOwn(emptyPrompt.request, "prompt"), false);
  assert.equal(prompt.request.prompt, "A red fox");
  assert.throws(() => prepareOwnerMagnificUpscaleRequest(prepareInput(precisionV1Binding, "precision_v1", { prompt: "é".repeat(2_501) }), { now: () => NOW }),
    (error: unknown) => error instanceof OwnerMagnificUpscalePrepareError && error.code === "PARAMETERS_INVALID");
  assert.throws(() => prepareOwnerMagnificUpscaleRequest(prepareInput(precisionV2Binding, "precision_v2", { prompt: "bad\u0000text" }), { now: () => NOW }),
    (error: unknown) => error instanceof OwnerMagnificUpscalePrepareError && error.code === "PARAMETERS_INVALID");
  assert.equal(getOwnerMagnificUpscaleSourceProfile("creative").prompt_policy.confidence, "CLIENT_LOCAL_LIMIT_NOT_PROVIDER_PROMISE");
  assert.deepEqual(getOwnerMagnificUpscaleSourceProfile("creative").prompt_policy.ui_visibility, {
    creative: true, precision_v1: false, precision_v2: false
  });
});

test("issued bindings reject copied, raw, foreign, mismatched, or modified input without caller URL authority", async () => {
  const { binding } = await issue();
  assert.throws(() => prepareOwnerMagnificUpscaleRequest(prepareInput({ ...binding }), { now: () => NOW }),
    (error: unknown) => error instanceof OwnerMagnificUpscalePrepareError && error.code === "IMAGE_BINDING_INVALID");
  assert.throws(() => prepareOwnerMagnificUpscaleRequest(prepareInput(resolution("creative"))),
    (error: unknown) => error instanceof OwnerMagnificUpscalePrepareError && error.code === "IMAGE_BINDING_INVALID");
  for (const bad of [
    { ...prepareInput(binding), model_id: "creative" },
    { ...prepareInput(binding), file_url: FILE_URL },
    { ...prepareInput(binding), unexpected: true },
    { ...prepareInput(binding), principal: { ...PRINCIPAL, subject_id: "foreign" } }
  ]) {
    assert.throws(() => prepareOwnerMagnificUpscaleRequest(bad, { now: () => NOW }),
      (error: unknown) => error instanceof OwnerMagnificUpscalePrepareError);
  }
});

test("resolver metadata must match exact source/profile, owner, variant, MIME, URL, size, digest and geometry", async () => {
  const invalidDtos: Array<[Record<string, unknown>, string]> = [
    [{ scope: "tool_image_edit" }, "PROFILE_BINDING_MISMATCH"],
    [{ model_id: "precision_v1" }, "PROFILE_BINDING_MISMATCH"],
    [{ variant: "precision_v1" }, "PROFILE_BINDING_MISMATCH"],
    [{ catalog_version: "other" }, "PROFILE_BINDING_MISMATCH"],
    [{ profile_schema_hash: "sha256:" + "0".repeat(64) }, "PROFILE_BINDING_MISMATCH"],
    [{ attempt_id: `${ATTEMPT}-other` }, "PRINCIPAL_MISMATCH"],
    [{ principal: { ...PRINCIPAL, subject_id: "other" } }, "PRINCIPAL_MISMATCH"],
    [{ file_url: "https://example.invalid/image.png" }, "IMAGE_BINDING_INVALID"],
    [{ mime_type: "image/gif" }, "IMAGE_BINDING_INVALID"],
    [{ width: 0 }, "IMAGE_BINDING_INVALID"],
    [{ height: 1.5 }, "IMAGE_BINDING_INVALID"],
    [{ size: 0 }, "IMAGE_BINDING_INVALID"],
    [{ size: 10 * 1024 * 1024 + 1 }, "IMAGE_BINDING_INVALID"],
    [{ sha256: "a".repeat(64) }, "IMAGE_BINDING_INVALID"],
    [{ metadata_confidence: "PIXEL_VERIFIED" }, "IMAGE_BINDING_INVALID"]
  ];
  for (const [override, expected] of invalidDtos) {
    await expectError(async () => issue("creative", resolution("creative", override)), expected);
  }
});

test("expired, renewed, invalidated, and resolver-failed bindings cannot prepare candidates", async () => {
  await expectError(() => issue("creative", resolution("creative", { expires_at: NOW }), () => NOW), "IMAGE_BINDING_EXPIRED");
  const expiring = await issue("creative", resolution("creative", { expires_at: NOW + 10 }), () => NOW);
  await expectError(() => prepareOwnerMagnificUpscaleRequest(prepareInput(expiring.binding), { now: () => NOW + 10 }), "IMAGE_BINDING_EXPIRED");

  let renewalRead = 0;
  const renewed = createOwnerMagnificUpscaleOwnedImageBindingIssuer(async () => {
    const value = resolution("creative");
    return { ...value, expires_at: value.expires_at + renewalRead++ };
  }, { now: () => NOW });
  await renewed.issue(issueInput());
  await expectError(() => renewed.issue(issueInput()), "IMAGE_BINDING_INVALID");

  const revocable = await issue();
  const candidate = prepareOwnerMagnificUpscaleRequest(prepareInput(revocable.binding), { now: () => NOW });
  revocable.issuer.invalidateAttempt(ATTEMPT);
  await expectError(() => prepareOwnerMagnificUpscaleRequest(prepareInput(revocable.binding), { now: () => NOW }), "IMAGE_BINDING_INVALID");
  assert.equal(isOwnerMagnificUpscalePreparedCandidateForPrincipal(candidate, PRINCIPAL, ATTEMPT, NOW), false);

  const failed = createOwnerMagnificUpscaleOwnedImageBindingIssuer(async () => { throw new Error("private resolver failure"); }, { now: () => NOW });
  await expectError(() => failed.issue(issueInput()), "IMAGE_BINDING_INVALID");
});

test("resolver and prepare records reject proxy/accessor/symbol/prototype inputs before getters run", async () => {
  let getterCalls = 0;
  const accessorDto = resolution("creative");
  Object.defineProperty(accessorDto, "width", { enumerable: true, get() { getterCalls += 1; return 512; } });
  await expectError(() => issue("creative", accessorDto), "IMAGE_BINDING_INVALID");
  const issuer = createOwnerMagnificUpscaleOwnedImageBindingIssuer(async () => resolution("creative"), { now: () => NOW });
  await expectError(() => issuer.issue(new Proxy(issueInput(), {})), "INVALID_REQUEST");
  await expectError(() => issuer.issue({ ...issueInput(), [Symbol("extra")]: true } as never), "INVALID_REQUEST");
  const rawPrepare = prepareInput({});
  await expectError(() => prepareOwnerMagnificUpscaleRequest(new Proxy(rawPrepare, {}), { now: () => NOW }), "INVALID_REQUEST");
  const foreign = Object.assign(Object.create({ injected: true }), issueInput());
  await expectError(() => issuer.issue(foreign), "INVALID_REQUEST");
  assert.equal(getterCalls, 0);
});
