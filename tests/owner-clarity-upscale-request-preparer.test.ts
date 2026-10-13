import assert from "node:assert/strict";
import test from "node:test";
import {
  createOwnerClarityUpscaleOwnedImageBindingIssuer,
  OwnerClarityUpscalePrepareError,
  isOwnerClarityUpscalePreparedCandidateForPrincipal,
  prepareOwnerClarityUpscaleRequest,
  type PrepareOwnerClarityUpscaleRequestInput
} from "../src/application/owner-clarity-upscale-request-preparer.js";
import type { GenerationPrincipalRef } from "../src/domain/generation-operation.js";

const ATTEMPT = "link_owner_clarity_attempt_000001";
const PRINCIPAL = Object.freeze({ tenant_id: "owner-tenant", subject_id: "owner-subject", connection_id: ATTEMPT });
const IMAGE = Object.freeze({
  principal: PRINCIPAL,
  attempt_id: ATTEMPT,
  scope: "tool_image_upscaler",
  model_id: "clarity",
  file_url: "https://r2.syntx.ai/private/clarity-upload?sig=opaque",
  mime_type: "image/png",
  width: 2000,
  height: 1000
});

function input(overrides: Partial<PrepareOwnerClarityUpscaleRequestInput> = {}): PrepareOwnerClarityUpscaleRequestInput {
  return {
    principal: PRINCIPAL,
    attempt_id: ATTEMPT,
    prompt: "clean edges",
    parameters: { professional_mode: false, scale_factor: 2, strength: 0.85, cfg: 6, denoise: 0.2 },
    image_binding: IMAGE as never,
    ...overrides
  } as PrepareOwnerClarityUpscaleRequestInput;
}

async function expectPrepareError(callback: () => unknown, code: string): Promise<void> {
  await assert.rejects(Promise.resolve().then(callback),
    (error: unknown) => error instanceof OwnerClarityUpscalePrepareError && error.code === code);
}

async function issueBinding(metadata: unknown = IMAGE, principal: Readonly<GenerationPrincipalRef> = PRINCIPAL, attemptId = ATTEMPT) {
  const resolverCalls: unknown[][] = [];
  const issuer = createOwnerClarityUpscaleOwnedImageBindingIssuer(async (receivedAttemptId, receivedPrincipal, opaqueHandle) => {
    resolverCalls.push([receivedAttemptId, receivedPrincipal, opaqueHandle]);
    return metadata;
  });
  const binding = await issuer.issue({ principal, attempt_id: attemptId, opaque_image_handle: "opaque-upload-handle-001" });
  return { binding, resolverCalls };
}

async function prepareCandidate(overrides: Partial<PrepareOwnerClarityUpscaleRequestInput> = {}) {
  const metadata = overrides.image_binding ?? IMAGE as never;
  const request = input({ ...overrides, image_binding: {} as never });
  const { binding } = await issueBinding(metadata, request.principal, request.attempt_id);
  return prepareOwnerClarityUpscaleRequest({ ...request, image_binding: binding });
}

test("prepares an immutable source-reviewed candidate with all six Clarity wire settings", async () => {
  const candidate = await prepareCandidate();
  assert.equal(candidate.status, "blocked");
  assert.equal(candidate.dispatch_allowed, false);
  assert.equal(candidate.backend_acceptance, "unproven");
  assert.equal(candidate.model_id, "clarity");
  assert.equal(candidate.ai_name, "clarity");
  assert.equal(candidate.source_binding.settings_inventory_sha256,
    "sha256:00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61");
  assert.equal(candidate.source_binding.parent_sha256,
    "sha256:8b00e34ae7e8d848c3967255648ce8839853690643a68726cf3faee26b913587");
  assert.equal(candidate.source_binding.submit_helper_sha256,
    "sha256:83fdb2ef6086fc92c8497abd6fbfb4cb4f673a8cc44b695e3d865fd6dc021aad");
  assert.equal(candidate.source_binding.file_mapper_sha256,
    "sha256:8a1c0d06d68b82d97ac6a58ed7caf8d2e759d31cc10f0b1ceb26d676fa664706");
  assert.match(candidate.profile_schema_hash, /^sha256:[a-f0-9]{64}$/u);
  assert.deepEqual(candidate.query, { ai_name: "clarity" });
  assert.deepEqual(candidate.request, {
    prompt: "clean edges",
    settings: {
      n: 1,
      model_type: "clarity",
      scale: 0.5,
      is_professional_mode: false,
      strength: 0.85,
      cfg: 6,
      denoise: 0.2,
      file_urls: [{ type: "image", url: IMAGE.file_url }]
    }
  });
  assert.equal(candidate.mime_confidence, "UPLOAD_DECLARED_NOT_SNIFFED");
  assert.equal(candidate.dispatch_allowed, false);
  assert.equal(Object.isFrozen(candidate), true);
  assert.equal(Object.isFrozen(candidate.request.settings.file_urls), true);
  assert.match(candidate.request_fingerprint, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(isOwnerClarityUpscalePreparedCandidateForPrincipal(candidate, PRINCIPAL, ATTEMPT), true);
  assert.equal(isOwnerClarityUpscalePreparedCandidateForPrincipal(candidate, PRINCIPAL, `${ATTEMPT}-other`), false);
  assert.equal(isOwnerClarityUpscalePreparedCandidateForPrincipal(candidate, { ...PRINCIPAL, subject_id: "foreign" }, ATTEMPT), false);
  const safe = JSON.stringify({ fingerprint: candidate.request_fingerprint, profile: candidate.profile_id });
  assert.equal(safe.includes(IMAGE.file_url), false);
});

test("rejects a plausible but unissued raw upload record", () => {
  assert.throws(() => prepareOwnerClarityUpscaleRequest(input()),
    (error: unknown) => error instanceof OwnerClarityUpscalePrepareError && error.code === "IMAGE_BINDING_INVALID");
});

test("issuer resolves only an opaque handle and binds the result to principal, attempt, scope and model", async () => {
  const { binding, resolverCalls } = await issueBinding();
  assert.deepEqual(resolverCalls, [[ATTEMPT, PRINCIPAL, "opaque-upload-handle-001"]]);
  assert.equal(Object.hasOwn(binding, "file_url"), false);
  const candidate = prepareOwnerClarityUpscaleRequest({ ...input(), image_binding: binding });
  assert.equal(candidate.image.width, 2000);
  assert.equal(candidate.model_id, "clarity");
  assert.throws(() => prepareOwnerClarityUpscaleRequest({ ...input(), image_binding: Object.freeze({ ...binding }) as never }),
    (error: unknown) => error instanceof OwnerClarityUpscalePrepareError && error.code === "IMAGE_BINDING_INVALID");
  const issuer = createOwnerClarityUpscaleOwnedImageBindingIssuer(async () => IMAGE);
  await assert.rejects(issuer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, opaque_image_handle: IMAGE.file_url }),
    (error: unknown) => error instanceof OwnerClarityUpscalePrepareError && error.code === "INVALID_REQUEST");
});

test("issuer rejects resolver scope, principal, model and geometry drift without reading getters", async () => {
  for (const metadata of [
    { ...IMAGE, scope: "tool_image_inpaint" },
    { ...IMAGE, model_id: "banana-2.1" },
    { ...IMAGE, principal: { ...PRINCIPAL, subject_id: "foreign" } },
    { ...IMAGE, attempt_id: `${ATTEMPT}-other` },
    { ...IMAGE, width: 0 }
  ]) {
    await expectPrepareError(() => issueBinding(metadata),
      metadata.principal?.subject_id === "foreign" || metadata.attempt_id !== ATTEMPT ? "PRINCIPAL_MISMATCH" : "IMAGE_BINDING_INVALID");
  }
  let getterCalls = 0;
  const accessorMetadata = { ...IMAGE };
  Object.defineProperty(accessorMetadata, "width", { enumerable: true, get() { getterCalls += 1; return 2000; } });
  await expectPrepareError(() => issueBinding(accessorMetadata), "IMAGE_BINDING_INVALID");
  assert.equal(getterCalls, 0);
});

test("professional scale uses verified geometry, rounds the 8000px ceiling down, and divides by four", async () => {
  const candidate = await prepareCandidate({
    parameters: { professional_mode: true, scale_factor: 3.25, strength: 0.1, cfg: 2, denoise: 0.7 },
    image_binding: { ...IMAGE, width: 2000, height: 1000 } as never
  });
  assert.equal(candidate.request.settings.scale, 0.8125);
  assert.equal(candidate.request.settings.is_professional_mode, true);
  assert.equal(candidate.request.settings.strength, 0.1);
  assert.equal(candidate.request.settings.cfg, 2);
  assert.equal(candidate.request.settings.denoise, 0.7);

  const floored = await prepareCandidate({
    parameters: { professional_mode: true, scale_factor: 1.33, strength: 0.55, cfg: 5, denoise: 0.31 },
    image_binding: { ...IMAGE, width: 6000, height: 1000 } as never
  });
  assert.equal(floored.request.settings.scale, 0.3325);
});

test("professional mode permits only geometry-bounded factors from one through six", async () => {
  for (const scale_factor of [0.99, 2.015, 6.01, 1.005]) {
    await expectPrepareError(() => prepareCandidate({
      parameters: { professional_mode: true, scale_factor, strength: 0.5, cfg: 5, denoise: 0.3 }
    }), "PARAMETERS_INVALID");
  }
  await expectPrepareError(() => prepareCandidate({
    parameters: { professional_mode: true, scale_factor: 2.01, strength: 0.5, cfg: 5, denoise: 0.3 },
    image_binding: { ...IMAGE, width: 4000, height: 1000 } as never
  }), "PARAMETERS_INVALID");
  const max = await prepareCandidate({
    parameters: { professional_mode: true, scale_factor: 2, strength: 0.5, cfg: 5, denoise: 0.3 },
    image_binding: { ...IMAGE, width: 4000, height: 1000 } as never
  });
  assert.equal(max.request.settings.scale, 0.5);
});

test("ordinary mode permits only enabled 1.5x or 2x presets", async () => {
  const firstPreset = await prepareCandidate({
    parameters: { professional_mode: false, scale_factor: 1.5, strength: 0.3, cfg: 4, denoise: 0.4 },
    image_binding: { ...IMAGE, width: 5000, height: 3000 } as never
  });
  assert.equal(firstPreset.request.settings.scale, 0.375);
  await expectPrepareError(() => prepareCandidate({
    parameters: { professional_mode: false, scale_factor: 2, strength: 0.3, cfg: 4, denoise: 0.4 },
    image_binding: { ...IMAGE, width: 5000, height: 3000 } as never
  }), "PARAMETERS_INVALID");
  await expectPrepareError(() => prepareCandidate({
    parameters: { professional_mode: false, scale_factor: 1.25, strength: 0.3, cfg: 4, denoise: 0.4 }
  }), "PARAMETERS_INVALID");
});

test("all caller-controlled settings are explicit, closed and bounded", async () => {
  const invalidParameters = [
    { professional_mode: false, scale_factor: 1.5, strength: 0.09, cfg: 4, denoise: 0.3 },
    { professional_mode: false, scale_factor: 1.5, strength: 1.01, cfg: 4, denoise: 0.3 },
    { professional_mode: false, scale_factor: 1.5, strength: 0.5, cfg: 1, denoise: 0.3 },
    { professional_mode: false, scale_factor: 1.5, strength: 0.5, cfg: 9.5, denoise: 0.3 },
    { professional_mode: false, scale_factor: 1.5, strength: 0.5, cfg: 4, denoise: 0.71 },
    { professional_mode: false, scale_factor: 1.5, strength: 0.505, cfg: 4, denoise: 0.3 },
    { professional_mode: false, scale_factor: 1.5, strength: 0.5, cfg: 4, denoise: 0.305 },
    { professional_mode: false, scale_factor: 1.5, strength: 0.5, cfg: 4, denoise: 0.3, model_type: "banana-2.1" },
    { professional_mode: false, scale_factor: 1.5, strength: 0.5, cfg: 4 }
  ];
  for (const parameters of invalidParameters) {
    await expectPrepareError(() => prepareCandidate({ parameters }), "PARAMETERS_INVALID");
  }
});

test("missing prompt is omitted rather than replaced with a default", async () => {
  const candidate = await prepareCandidate({ prompt: undefined });
  assert.equal(Object.hasOwn(candidate.request, "prompt"), false);
});

test("source MIME declarations are carried as unverified input metadata, not output claims", async () => {
  for (const mime_type of ["image/jpeg", "image/png", "image/avif", "image/webp"]) {
    const candidate = await prepareCandidate({ image_binding: { ...IMAGE, mime_type } as never });
    assert.equal(candidate.image.mime_type, mime_type);
    assert.equal(candidate.mime_confidence, "UPLOAD_DECLARED_NOT_SNIFFED");
  }
  for (const mime_type of ["image/jpg", "image/gif", "image/svg+xml", "application/octet-stream"]) {
    await expectPrepareError(() => prepareCandidate({ image_binding: { ...IMAGE, mime_type } as never }), "IMAGE_BINDING_INVALID");
  }
});

test("image binding must be safe, single-image, geometry-bearing and bound to exact owner context/model", async () => {
  for (const image_binding of [
    { ...IMAGE, model_id: "banana-2.1" },
    { ...IMAGE, file_url: "https://example.invalid/private.png" },
    { ...IMAGE, file_url: "https://r2.syntx.ai/" },
    { ...IMAGE, width: 0 },
    { ...IMAGE, height: -1 },
    { ...IMAGE, width: 4.5 },
    { ...IMAGE, extra: "not-accepted" }
  ]) {
    await expectPrepareError(() => prepareCandidate({ image_binding: image_binding as never }), "IMAGE_BINDING_INVALID");
  }
  for (const image_binding of [
    { ...IMAGE, attempt_id: `${ATTEMPT}-foreign` },
    { ...IMAGE, principal: { ...PRINCIPAL, subject_id: "another-owner" } }
  ]) {
    await expectPrepareError(() => prepareCandidate({ image_binding: image_binding as never }), "PRINCIPAL_MISMATCH");
  }
  await expectPrepareError(() => prepareCandidate({
    principal: { ...PRINCIPAL, subject_id: "foreign" }, image_binding: IMAGE as never
  }), "PRINCIPAL_MISMATCH");
});

test("rejects proxy/getter inputs before reading attacker-controlled fields", async () => {
  let getterCalls = 0;
  const parameters = {};
  Object.defineProperty(parameters, "professional_mode", { enumerable: true, get() { getterCalls += 1; return false; } });
  await expectPrepareError(() => prepareCandidate({ parameters }), "PARAMETERS_INVALID");
  await expectPrepareError(() => prepareOwnerClarityUpscaleRequest(new Proxy(input(), {})), "INVALID_REQUEST");
  assert.equal(getterCalls, 0);
});

test("local prompt cap rejects oversized text but does not require a prompt", async () => {
  await expectPrepareError(() => prepareCandidate({ prompt: "x".repeat(5001) }), "PARAMETERS_INVALID");
});
