import assert from "node:assert/strict";
import test from "node:test";
import {
  createOwnerKontextImageOwnedReferenceBindingIssuer,
  getOwnerKontextImageSourceProfile,
  isOwnerKontextImagePreparedCandidateForPrincipal,
  OwnerKontextImagePrepareError,
  prepareOwnerKontextImageRequest,
  type OwnerKontextImageOwnedReferenceResolverContext
} from "../src/application/owner-kontext-image-request-preparer.js";
import {
  DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
  loadSelectedDiscoveryCatalog
} from "../src/catalog/selected-discovery-catalog.js";

const VARIANTS = ["flux-kontext-pro", "flux-kontext-max", "flux-kontext-multi"] as const;
const selectedCatalog = loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION).discoveryCatalog;
const NOW = Date.parse("2026-10-10T00:00:00.000Z");
const PRINCIPAL = Object.freeze({ tenant_id: "tenant_test", subject_id: "subject_test", connection_id: "link_test_0123456789abcdef" });

function resolvedReference(context: OwnerKontextImageOwnedReferenceResolverContext, index: number, overrides: Record<string, unknown> = {}) {
  return {
    ...context,
    file_url: `https://r2.syntx.ai/private/kontext/${index + 1}.png`,
    mime_type: "image/png",
    width: 1200 + index,
    height: 800 + index,
    size: 1_024 + index,
    sha256: `sha256:${String(index + 1).repeat(64)}`,
    expires_at: NOW + 600_000 - index * 60_000,
    metadata_confidence: "CONTAINER_METADATA_ONLY",
    ...overrides
  };
}

function makeIssuer(
  resolve: (context: OwnerKontextImageOwnedReferenceResolverContext) => Promise<unknown>,
  now = NOW
) {
  return createOwnerKontextImageOwnedReferenceBindingIssuer(resolve, {
    catalog: selectedCatalog,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    now: () => now
  });
}

test("source profiles validate each exact active Kontext record from selected e551 and retain policy confidence", () => {
  const profiles = VARIANTS.map((variant) => getOwnerKontextImageSourceProfile(
    variant, selectedCatalog, DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION
  ));
  assert.deepEqual(profiles.map((profile) => profile.model_id), VARIANTS);
  assert.deepEqual(profiles.map((profile) => profile.ai_name), ["flux", "flux", "flux"]);
  assert.deepEqual(profiles.map((profile) => profile.scope), ["image", "image", "image"]);
  assert.deepEqual(profiles.map((profile) => profile.reference_count), [
    { minimum: 0, maximum: 1, confidence: "CLIENT_FORM_ONLY_BACKEND_UNPROVEN" },
    { minimum: 0, maximum: 1, confidence: "CLIENT_FORM_ONLY_BACKEND_UNPROVEN" },
    { minimum: 1, maximum: 4, confidence: "CLIENT_FORM_ONLY_BACKEND_UNPROVEN" }
  ]);
  assert.deepEqual(profiles.map((profile) => profile.public_file_count_limit), [1, 1, 4]);
  assert.ok(profiles.every((profile) => profile.prompt_policy.required === true));
  assert.ok(profiles.every((profile) => profile.prompt_policy.local_max_utf8_bytes === 65_536));
  assert.ok(profiles.every((profile) => profile.prompt_policy.limit_confidence === "LOCAL_RESOURCE_GUARD_NOT_PROVIDER_LIMIT"));
  assert.ok(profiles.every((profile) => profile.prompt_admission === "SOURCE_REQUIRED_NONEMPTY_PRESERVE_INPUT_LOCAL_64KIB_GUARD"));
  assert.ok(profiles.every((profile) => profile.public_max_file_size === 0));
  assert.ok(profiles.every((profile) => profile.public_max_prompt_length === 0));
  assert.ok(profiles.every((profile) => profile.public_limit_semantics.file_size === "PROVIDER_SEMANTICS_UNPROVEN"));
  assert.ok(profiles.every((profile) => profile.public_limit_semantics.prompt === "NO_FRONTEND_CLIPPING_PROVIDER_SEMANTICS_UNPROVEN"));
  assert.ok(profiles.every((profile) => profile.public_catalog_version === DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION));
  assert.ok(profiles.every((profile) => /^sha256:[a-f0-9]{64}$/u.test(profile.profile_schema_hash)));
  assert.ok(profiles.every((profile) => profile.backend_acceptance === "UNPROVEN" && profile.dispatch_allowed === false));
  assert.ok(profiles.every(Object.isFrozen));
});

test("source profile refuses stale adjacent catalog candidates and mismatched public records", () => {
  assert.throws(() => getOwnerKontextImageSourceProfile(
    "flux-kontext-pro", selectedCatalog,
    "sha256-c6fdcc522def8f6f4ef2c172d23822164f0124b29bb5fe86e2b5dce5c54b9fbc.json"
  ), OwnerKontextImagePrepareError);
  const inactiveCatalog = {
    getModel(id: string) {
      const model = selectedCatalog.getModel(id);
      return { ...model, active: false };
    },
    fetched_at: selectedCatalog.fetched_at,
    source_hashes: selectedCatalog.source_hashes,
    catalog_metadata: selectedCatalog.catalog_metadata
  };
  assert.throws(() => getOwnerKontextImageSourceProfile(
    "flux-kontext-pro", inactiveCatalog, DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION
  ), OwnerKontextImagePrepareError);
});

test("reference issuer resolves ordered owner handles against per-variant selected profile and original expiry", async () => {
  const calls: unknown[] = [];
  const handles = [
    "kontext_image_00000000-0000-4000-8000-000000000001",
    "kontext_image_00000000-0000-4000-8000-000000000002"
  ];
  const issuer = createOwnerKontextImageOwnedReferenceBindingIssuer(async (context) => {
    calls.push(context);
    const index = handles.indexOf(context.reference_handle);
    return {
      principal: PRINCIPAL,
      attempt_id: PRINCIPAL.connection_id,
      variant: context.variant,
      model_id: context.model_id,
      ai_name: "flux",
      scope: "image",
      catalog_version: context.catalog_version,
      profile_schema_hash: context.profile_schema_hash,
      reference_handle: context.reference_handle,
      file_url: `https://r2.syntx.ai/private/kontext/${index + 1}.png`,
      mime_type: "image/png",
      width: 1200 + index,
      height: 800 + index,
      size: 1_024 + index,
      sha256: `sha256:${String(index + 1).repeat(64)}`,
      expires_at: NOW + 600_000 - index * 60_000,
      metadata_confidence: "CONTAINER_METADATA_ONLY"
    };
  }, {
    catalog: selectedCatalog,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    now: () => NOW
  });
  const set = await issuer.issue({
    principal: PRINCIPAL,
    attempt_id: PRINCIPAL.connection_id,
    variant: "flux-kontext-multi",
    reference_handles: handles
  });
  assert.equal(set.variant, "flux-kontext-multi");
  assert.equal(set.reference_count, 2);
  assert.equal(set.expires_at, NOW + 540_000);
  assert.deepEqual(calls.map((call) => (call as { reference_handle: string }).reference_handle), handles);
  assert.ok(calls.every((call) => (call as { profile_schema_hash: string }).profile_schema_hash ===
    getOwnerKontextImageSourceProfile("flux-kontext-multi", selectedCatalog,
      DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION).profile_schema_hash));
  assert.ok(Object.isFrozen(set));
  assert.deepEqual(Object.keys(set), []);
  assert.ok(!JSON.stringify(set).includes("r2.syntx.ai"));
  issuer.close();
});

test("preparer builds blocked full-state candidate for all variants without filling or rewriting state", async () => {
  const variants = [
    { variant: "flux-kontext-pro", references: [] as string[], resolution: "1344x768" },
    { variant: "flux-kontext-max", references: [] as string[], resolution: "1024x1024" },
    { variant: "flux-kontext-multi", references: ["kontext_image_00000000-0000-4000-8000-000000000003"], resolution: "768x1344" }
  ] as const;
  for (const item of variants) {
    const issuer = createOwnerKontextImageOwnedReferenceBindingIssuer(async (context) => ({
      principal: PRINCIPAL,
      attempt_id: context.attempt_id,
      variant: context.variant,
      model_id: context.model_id,
      ai_name: context.ai_name,
      scope: context.scope,
      catalog_version: context.catalog_version,
      profile_schema_hash: context.profile_schema_hash,
      reference_handle: context.reference_handle,
      file_url: "https://r2.syntx.ai/private/kontext/owned.png",
      mime_type: "image/png",
      width: 1001,
      height: 777,
      size: 2_048,
      sha256: `sha256:${"a".repeat(64)}`,
      expires_at: NOW + 600_000,
      metadata_confidence: "CONTAINER_METADATA_ONLY"
    }), {
      catalog: selectedCatalog,
      catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
      now: () => NOW
    });
    const referenceSet = await issuer.issue({
      principal: PRINCIPAL,
      attempt_id: PRINCIPAL.connection_id,
      variant: item.variant,
      reference_handles: item.references
    });
    const parameters = { resolution: item.resolution, cfg: 1.05, steps: 10.5, image_strength: 0.123 };
    const candidate = prepareOwnerKontextImageRequest({
      principal: PRINCIPAL,
      attempt_id: PRINCIPAL.connection_id,
      variant: item.variant,
      parameters,
      reference_set: referenceSet,
      workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA",
      prompt: "  preserve contextual request  "
    }, {
      catalog: selectedCatalog,
      catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
      now: () => NOW
    });
    assert.equal(candidate.status, "blocked");
    assert.equal(candidate.dispatch_allowed, false);
    assert.equal(candidate.backend_acceptance, "UNPROVEN");
    assert.equal(candidate.model_id, item.variant);
    assert.equal(candidate.model_type, item.variant);
    assert.equal(candidate.ai_name, "flux");
    assert.equal(candidate.scope, "image");
    assert.equal(candidate.workflow_policy, "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA");
    assert.equal(candidate.request.prompt, "  preserve contextual request  ");
    assert.deepEqual(candidate.request.settings, {
      n: 1,
      model_type: item.variant,
      workflow_type: "default",
      civitai_loras: [],
      resolution: item.resolution,
      cfg: 1.05,
      steps: 10.5,
      image_strength: 0.123,
      file_urls: item.references.length === 0 ? [] : [{ type: "image", url: "https://r2.syntx.ai/private/kontext/owned.png" }]
    });
    assert.equal(Object.hasOwn(candidate.request.settings, "raw"), false);
    assert.equal(Object.keys(candidate).includes("request"), false);
    assert.equal(JSON.stringify(candidate).includes("r2.syntx.ai"), false);
    assert.equal(candidate.request_fingerprint.startsWith("sha256:"), true);
    assert.equal(isOwnerKontextImagePreparedCandidateForPrincipal(
      candidate, PRINCIPAL, PRINCIPAL.connection_id, NOW
    ), true);
    assert.equal(Object.isFrozen(candidate), true);
    assert.equal(Object.isFrozen(candidate.request.settings.file_urls), true);
    const inputImages = (candidate as unknown as { readonly input_images?: unknown }).input_images;
    assert.deepEqual(inputImages, item.references.length === 0 ? [] : [{
      mime_type: "image/png",
      width: 1001,
      height: 777,
      size: 2_048,
      sha256: `sha256:${"a".repeat(64)}`,
      metadata_confidence: "CONTAINER_METADATA_ONLY"
    }]);
    assert.equal(Object.isFrozen(inputImages), true);
    if (Array.isArray(inputImages) && inputImages.length > 0) {
      assert.equal(Object.isFrozen(inputImages[0]), true);
      assert.deepEqual(Object.keys(inputImages[0] as object).sort(), [
        "height", "metadata_confidence", "mime_type", "sha256", "size", "width"
      ]);
    }
    assert.equal(candidate.expires_at, item.references.length === 0 ? NOW + 900_000 : NOW + 600_000);
    issuer.close();
  }
});

test("prepared candidate input metadata is source-derived and caller metadata is rejected", async () => {
  let originalReceipt: ReturnType<typeof resolvedReference> | undefined;
  const issuer = makeIssuer(async (context) => {
    originalReceipt = resolvedReference(context, 0);
    return originalReceipt;
  });
  const referenceSet = await issuer.issue({
    principal: PRINCIPAL,
    attempt_id: PRINCIPAL.connection_id,
    variant: "flux-kontext-pro",
    reference_handles: ["kontext_image_00000000-0000-4000-8000-000000000051"]
  });
  originalReceipt!.width = 1;
  originalReceipt!.size = 1;
  originalReceipt!.sha256 = `sha256:${"0".repeat(64)}`;
  const base = {
    principal: PRINCIPAL,
    attempt_id: PRINCIPAL.connection_id,
    variant: "flux-kontext-pro" as const,
    parameters: { resolution: "1344x768", cfg: 1, steps: 10, image_strength: 0.5 },
    reference_set: referenceSet,
    workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA" as const,
    prompt: "metadata remains tied to owned input"
  };
  const candidate = prepareOwnerKontextImageRequest(base, {
    catalog: selectedCatalog,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    now: () => NOW
  });
  assert.deepEqual((candidate as unknown as { readonly input_images?: unknown }).input_images, [{
    mime_type: "image/png",
    width: 1200,
    height: 800,
    size: 1_024,
    sha256: `sha256:${"1".repeat(64)}`,
    metadata_confidence: "CONTAINER_METADATA_ONLY"
  }]);
  assert.throws(() => prepareOwnerKontextImageRequest({
    ...base,
    input_images: [{ mime_type: "image/jpeg", width: 1, height: 1, size: 1, sha256: `sha256:${"0".repeat(64)}` }]
  }, {
    catalog: selectedCatalog,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    now: () => NOW
  }), OwnerKontextImagePrepareError);
  assert.equal(JSON.stringify(candidate).includes("file_url"), false);
  assert.equal(JSON.stringify(candidate).includes("reference_handle"), false);
  assert.equal(JSON.stringify(candidate).includes("tenant_test"), false);
  issuer.close();
});

test("prompt must be explicit nonblank input and the original string is preserved", async () => {
  const issuer = makeIssuer(async (context) => resolvedReference(context, 0));
  const referenceSet = await issuer.issue({
    principal: PRINCIPAL,
    attempt_id: PRINCIPAL.connection_id,
    variant: "flux-kontext-pro",
    reference_handles: []
  });
  const prompt = "  preserve these spaces and newline\n🙂  ";
  const candidate = prepareOwnerKontextImageRequest({
    principal: PRINCIPAL,
    attempt_id: PRINCIPAL.connection_id,
    variant: "flux-kontext-pro",
    parameters: { resolution: "1024x1024", cfg: 1.05, steps: 10.5, image_strength: 0.123 },
    reference_set: referenceSet,
    workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA",
    prompt
  }, {
    catalog: selectedCatalog,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    now: () => NOW
  });
  assert.equal(candidate.request.prompt, prompt);
  assert.equal(candidate.source_readiness, "SOURCE_JOINED_PROMPT_POLICY");
  assert.equal(candidate.dispatch_allowed, false);
  issuer.close();
});

test("prompt rejects missing, blank, coerced, control-bearing, and malformed Unicode values", async () => {
  const issuer = makeIssuer(async (context) => resolvedReference(context, 0));
  const referenceSet = await issuer.issue({
    principal: PRINCIPAL,
    attempt_id: PRINCIPAL.connection_id,
    variant: "flux-kontext-pro",
    reference_handles: []
  });
  const base = {
    principal: PRINCIPAL,
    attempt_id: PRINCIPAL.connection_id,
    variant: "flux-kontext-pro" as const,
    parameters: { resolution: "1024x1024", cfg: 1.05, steps: 10.5, image_strength: 0.123 },
    reference_set: referenceSet,
    workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA" as const
  };
  const assertPromptInvalid = (input: unknown) => assert.throws(() => prepareOwnerKontextImageRequest(input, {
    catalog: selectedCatalog, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, now: () => NOW
  }), (error: unknown) => error instanceof OwnerKontextImagePrepareError && error.code === "PROMPT_INVALID");
  assertPromptInvalid(base);
  for (const prompt of ["", "   ", "\n\t  ", 42, null, "nul\u0000blocked", "bell\u0007blocked", "del\u007fblocked", "\ud800"]) {
    assertPromptInvalid({ ...base, prompt });
  }
  let getterCalls = 0;
  const accessorInput = { ...base };
  Object.defineProperty(accessorInput, "prompt", {
    enumerable: true,
    get() { getterCalls += 1; return "must not invoke"; }
  });
  assertPromptInvalid(accessorInput);
  assert.equal(getterCalls, 0);
  issuer.close();
});

test("prompt local UTF-8 resource guard accepts exactly 64 KiB and rejects overflow without trimming", async () => {
  const issuer = makeIssuer(async (context) => resolvedReference(context, 0));
  const referenceSet = await issuer.issue({
    principal: PRINCIPAL,
    attempt_id: PRINCIPAL.connection_id,
    variant: "flux-kontext-max",
    reference_handles: []
  });
  const base = {
    principal: PRINCIPAL,
    attempt_id: PRINCIPAL.connection_id,
    variant: "flux-kontext-max" as const,
    parameters: { resolution: "1024x1024", cfg: 1.05, steps: 10.5, image_strength: 0.123 },
    reference_set: referenceSet,
    workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA" as const
  };
  const maxPrompt = ` ${"🙂".repeat(16_383)}   `;
  assert.equal(Buffer.byteLength(maxPrompt, "utf8"), 65_536);
  const accepted = prepareOwnerKontextImageRequest({ ...base, prompt: maxPrompt }, {
    catalog: selectedCatalog, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, now: () => NOW
  });
  assert.throws(() => prepareOwnerKontextImageRequest({ ...base, prompt: `${maxPrompt} ` }, {
    catalog: selectedCatalog, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, now: () => NOW
  }), (error: unknown) => error instanceof OwnerKontextImagePrepareError && error.code === "PROMPT_INVALID");
  assert.equal(accepted.request.prompt, maxPrompt);
  issuer.close();
});

test("reference cardinality follows only the explicit variant policy and Multi order", async () => {
  const handles = [1, 2, 3, 4, 5].map((number) =>
    `kontext_image_00000000-0000-4000-8000-${String(number).padStart(12, "0")}`);
  const issuer = makeIssuer(async (context) => resolvedReference(context, handles.indexOf(context.reference_handle)));
  let attemptIndex = 0;
  const principalFor = () => Object.freeze({
    tenant_id: PRINCIPAL.tenant_id,
    subject_id: PRINCIPAL.subject_id,
    connection_id: `link_test_policy_${String(++attemptIndex).padStart(12, "0")}`
  });
  for (const variant of ["flux-kontext-pro", "flux-kontext-max"] as const) {
    for (const reference_handles of [[], [handles[0]!]]) {
      const principal = principalFor();
      const set = await issuer.issue({ principal, attempt_id: principal.connection_id, variant, reference_handles });
      assert.equal(set.variant, variant);
      assert.equal(set.reference_count, reference_handles.length);
    }
    const principal = principalFor();
    await assert.rejects(issuer.issue({
      principal, attempt_id: principal.connection_id, variant, reference_handles: handles.slice(0, 2)
    }), OwnerKontextImagePrepareError);
  }
  const noMultiReferencePrincipal = principalFor();
  await assert.rejects(issuer.issue({
    principal: noMultiReferencePrincipal, attempt_id: noMultiReferencePrincipal.connection_id,
    variant: "flux-kontext-multi", reference_handles: []
  }), OwnerKontextImagePrepareError);
  const tooManyMultiPrincipal = principalFor();
  await assert.rejects(issuer.issue({
    principal: tooManyMultiPrincipal, attempt_id: tooManyMultiPrincipal.connection_id,
    variant: "flux-kontext-multi", reference_handles: handles
  }), OwnerKontextImagePrepareError);
  const multiPrincipal = principalFor();
  const set = await issuer.issue({
    principal: multiPrincipal, attempt_id: multiPrincipal.connection_id,
    variant: "flux-kontext-multi", reference_handles: handles.slice(0, 4)
  });
  const candidate = prepareOwnerKontextImageRequest({
    principal: multiPrincipal,
    attempt_id: multiPrincipal.connection_id,
    variant: "flux-kontext-multi",
    parameters: { resolution: "768x1344", cfg: 2.35, steps: 17.5, image_strength: 0.123 },
    reference_set: set,
    workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA",
    prompt: "ordered reference request"
  }, { catalog: selectedCatalog, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, now: () => NOW });
  assert.deepEqual(candidate.request.settings.file_urls.map(({ url }) => url), [1, 2, 3, 4]
    .map((number) => `https://r2.syntx.ai/private/kontext/${number}.png`));
  issuer.close();
});

test("prepared candidate rejects copied sets, cross-principal use, variant drift, expiry and revocation", async () => {
  const handle = "kontext_image_00000000-0000-4000-8000-000000000011";
  const issuer = makeIssuer(async (context) => resolvedReference(context, 0));
  const set = await issuer.issue({
    principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id,
    variant: "flux-kontext-pro", reference_handles: [handle]
  });
  const input = {
    principal: PRINCIPAL,
    attempt_id: PRINCIPAL.connection_id,
    variant: "flux-kontext-pro" as const,
    parameters: { resolution: "1152x896", cfg: 1.05, steps: 15.5, image_strength: 0.123 },
    reference_set: set,
    workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA" as const,
    prompt: "binding request"
  };
  const candidate = prepareOwnerKontextImageRequest(input, {
    catalog: selectedCatalog, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, now: () => NOW
  });
  const copiedSet = { ...set };
  assert.throws(() => prepareOwnerKontextImageRequest({ ...input, reference_set: copiedSet }, {
    catalog: selectedCatalog, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, now: () => NOW
  }), OwnerKontextImagePrepareError);
  assert.throws(() => prepareOwnerKontextImageRequest({
    ...input, principal: { ...PRINCIPAL, subject_id: "other_subject" }
  }, { catalog: selectedCatalog, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, now: () => NOW }),
  OwnerKontextImagePrepareError);
  assert.throws(() => prepareOwnerKontextImageRequest({ ...input, variant: "flux-kontext-max" }, {
    catalog: selectedCatalog, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, now: () => NOW
  }), OwnerKontextImagePrepareError);
  assert.throws(() => prepareOwnerKontextImageRequest({
    ...input,
    parameters: { resolution: "1152x896", cfg: 1.05, steps: 15.5 }
  }, { catalog: selectedCatalog, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, now: () => NOW }),
  OwnerKontextImagePrepareError);
  assert.throws(() => prepareOwnerKontextImageRequest({
    ...input,
    parameters: { resolution: "1152x896", cfg: 1.05, steps: 15.5, image_strength: 0.123, file_urls: [] }
  }, { catalog: selectedCatalog, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, now: () => NOW }),
  OwnerKontextImagePrepareError);
  const prompted = prepareOwnerKontextImageRequest({ ...input, prompt: " prompt accepted " }, {
    catalog: selectedCatalog, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, now: () => NOW
  });
  assert.equal(prompted.request.prompt, " prompt accepted ");
  assert.equal(isOwnerKontextImagePreparedCandidateForPrincipal(
    candidate, { ...PRINCIPAL, subject_id: "other_subject" }, PRINCIPAL.connection_id, NOW
  ), false);
  assert.equal(isOwnerKontextImagePreparedCandidateForPrincipal(
    candidate, PRINCIPAL, PRINCIPAL.connection_id, set.expires_at
  ), false);
  assert.throws(() => prepareOwnerKontextImageRequest(input, {
    catalog: selectedCatalog, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, now: () => set.expires_at
  }), OwnerKontextImagePrepareError);
  assert.equal(candidate.expires_at, set.expires_at);
  issuer.invalidateAttempt(PRINCIPAL.connection_id);
  assert.equal(isOwnerKontextImagePreparedCandidateForPrincipal(
    candidate, PRINCIPAL, PRINCIPAL.connection_id, NOW
  ), false);
  assert.throws(() => prepareOwnerKontextImageRequest(input, {
    catalog: selectedCatalog, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, now: () => NOW
  }), OwnerKontextImagePrepareError);
});

test("empty-reference owner candidate uses one original local TTL and cannot renew it by reissuing", async () => {
  const issuer = makeIssuer(async () => { throw new Error("no resolver should be called for an empty set"); });
  const input = {
    principal: PRINCIPAL,
    attempt_id: PRINCIPAL.connection_id,
    variant: "flux-kontext-max" as const,
    parameters: { resolution: "1024x1024", cfg: 1.05, steps: 10.5, image_strength: 0.123 },
    workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA" as const,
    prompt: "resolution options"
  };
  const set = await issuer.issue({
    principal: input.principal, attempt_id: input.attempt_id, variant: input.variant, reference_handles: []
  });
  const candidate = prepareOwnerKontextImageRequest({ ...input, reference_set: set }, {
    catalog: selectedCatalog, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, now: () => NOW + 100_000
  });
  assert.equal(set.expires_at, NOW + 900_000);
  assert.equal(candidate.expires_at, NOW + 900_000);
  const resolutions = ["1344x768", "1152x896", "1024x1024", "896x1152", "768x1344"] as const;
  for (const resolution of resolutions) {
    const normalized = prepareOwnerKontextImageRequest({
      ...input,
      parameters: { resolution, cfg: 1.05, steps: 10.5, image_strength: 0.123 },
      reference_set: set
    }, {
      catalog: selectedCatalog, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, now: () => NOW + 100_000
    });
    assert.equal(normalized.request.settings.resolution, resolution);
  }
  const withoutPolicy = {
    principal: input.principal,
    attempt_id: input.attempt_id,
    variant: input.variant,
    parameters: input.parameters
  };
  assert.throws(() => prepareOwnerKontextImageRequest({ ...withoutPolicy, reference_set: set }, {
    catalog: selectedCatalog, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, now: () => NOW
  }), OwnerKontextImagePrepareError);
  await assert.rejects(issuer.issue({
    principal: input.principal, attempt_id: input.attempt_id, variant: input.variant, reference_handles: []
  }), OwnerKontextImagePrepareError);
  issuer.close();
});

test("expired empty-reference attempt can issue a fresh set without renewing before original expiry", async () => {
  let now = NOW;
  const issuer = createOwnerKontextImageOwnedReferenceBindingIssuer(async () => {
    throw new Error("empty-reference issuance must not call the resolver");
  }, {
    catalog: selectedCatalog,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    now: () => now
  });
  const attemptId = "link_test_empty_reissue_000001";
  const request = {
    principal: { tenant_id: "tenant_test", subject_id: "subject_test", connection_id: attemptId },
    attempt_id: attemptId,
    variant: "flux-kontext-pro" as const,
    reference_handles: [] as string[]
  };
  const original = await issuer.issue(request);
  await assert.rejects(issuer.issue(request), OwnerKontextImagePrepareError);
  now = original.expires_at + 1;
  const reissued = await issuer.issue(request);
  assert.equal(reissued.expires_at, now + 900_000);
  issuer.close();
});

test("empty-reference issue latch is per attempt and variant while retaining the attempt principal binding", async () => {
  const issuer = makeIssuer(async () => { throw new Error("empty-reference issuance must not call the resolver"); });
  const attemptId = "link_test_variant_empty_000001";
  const principal = Object.freeze({ tenant_id: "tenant_test", subject_id: "subject_test", connection_id: attemptId });
  const pro = await issuer.issue({
    principal, attempt_id: attemptId, variant: "flux-kontext-pro", reference_handles: []
  });
  const max = await issuer.issue({
    principal, attempt_id: attemptId, variant: "flux-kontext-max", reference_handles: []
  });
  assert.equal(pro.variant, "flux-kontext-pro");
  assert.equal(max.variant, "flux-kontext-max");
  assert.equal(pro.expires_at, max.expires_at);
  await assert.rejects(issuer.issue({
    principal, attempt_id: attemptId, variant: "flux-kontext-pro", reference_handles: []
  }), OwnerKontextImagePrepareError);
  const otherPrincipal = Object.freeze({ tenant_id: "tenant_test", subject_id: "other_subject", connection_id: attemptId });
  await assert.rejects(issuer.issue({
    principal: otherPrincipal, attempt_id: attemptId, variant: "flux-kontext-max", reference_handles: []
  }), OwnerKontextImagePrepareError);
  issuer.close();
});

test("an in-flight reference resolution pins principal for empty sets on the same attempt", async () => {
  let release: ((value: unknown) => void) | undefined;
  let context: OwnerKontextImageOwnedReferenceResolverContext | undefined;
  let calls = 0;
  const issuer = makeIssuer((resolverContext) => {
    calls += 1;
    context = resolverContext;
    return new Promise((resolve) => { release = resolve; });
  });
  const proAttempt = issuer.issue({
    principal: PRINCIPAL,
    attempt_id: PRINCIPAL.connection_id,
    variant: "flux-kontext-pro",
    reference_handles: ["kontext_image_00000000-0000-4000-8000-000000000041"]
  });
  const otherPrincipal = Object.freeze({
    tenant_id: PRINCIPAL.tenant_id, subject_id: "other_subject", connection_id: PRINCIPAL.connection_id
  });
  await assert.rejects(issuer.issue({
    principal: otherPrincipal,
    attempt_id: PRINCIPAL.connection_id,
    variant: "flux-kontext-max",
    reference_handles: []
  }), OwnerKontextImagePrepareError);
  assert.equal(calls, 1);
  release!(resolvedReference(context!, 0));
  await proAttempt;
  issuer.close();
});

test("idle invalidations leave no issuance tombstones and expired 128 empty sets release global capacity", async () => {
  let now = NOW;
  const issuer = createOwnerKontextImageOwnedReferenceBindingIssuer(async () => {
    throw new Error("empty-reference issuance must not call the resolver");
  }, {
    catalog: selectedCatalog,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    now: () => now
  });
  for (let index = 0; index < 200; index += 1) {
    issuer.invalidateAttempt(`link_test_idle_${String(index).padStart(10, "0")}`);
  }
  const first = { tenant_id: "tenant_test", subject_id: "subject_test", connection_id: "link_test_capacity_00000001" };
  const firstSet = await issuer.issue({
    principal: first, attempt_id: first.connection_id, variant: "flux-kontext-pro", reference_handles: []
  });
  for (let index = 2; index <= 128; index += 1) {
    const principal = {
      tenant_id: "tenant_test", subject_id: "subject_test",
      connection_id: `link_test_capacity_${String(index).padStart(8, "0")}`
    };
    await issuer.issue({
      principal, attempt_id: principal.connection_id, variant: "flux-kontext-max", reference_handles: []
    });
  }
  await assert.rejects(issuer.issue({
    principal: { tenant_id: "tenant_test", subject_id: "subject_test", connection_id: "link_test_capacity_00000129" },
    attempt_id: "link_test_capacity_00000129", variant: "flux-kontext-pro", reference_handles: []
  }), OwnerKontextImagePrepareError);
  now = firstSet.expires_at + 1;
  const freshPrincipal = { tenant_id: "tenant_test", subject_id: "subject_test", connection_id: "link_test_capacity_00000129" };
  const fresh = await issuer.issue({
    principal: freshPrincipal,
    attempt_id: freshPrincipal.connection_id,
    variant: "flux-kontext-pro",
    reference_handles: []
  });
  assert.equal(fresh.expires_at, now + 900_000);
  issuer.close();
});

test("issuer bounds distinct nominal sets per attempt and releases them on invalidation", async () => {
  const issuer = makeIssuer(async (context) => resolvedReference(context, 0));
  const principal = Object.freeze({
    tenant_id: "tenant_test", subject_id: "subject_test", connection_id: "link_test_set_capacity_000001"
  });
  for (let index = 1; index <= 128; index += 1) {
    const handle = `kontext_image_00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    await issuer.issue({
      principal,
      attempt_id: principal.connection_id,
      variant: "flux-kontext-pro",
      reference_handles: [handle]
    });
  }
  await assert.rejects(issuer.issue({
    principal,
    attempt_id: principal.connection_id,
    variant: "flux-kontext-pro",
    reference_handles: ["kontext_image_00000000-0000-4000-8000-000000000129"]
  }), OwnerKontextImagePrepareError);
  issuer.invalidateAttempt(principal.connection_id);
  const fresh = await issuer.issue({
    principal,
    attempt_id: principal.connection_id,
    variant: "flux-kontext-pro",
    reference_handles: ["kontext_image_00000000-0000-4000-8000-000000000129"]
  });
  assert.equal(fresh.reference_count, 1);
  issuer.close();
});

test("issuer permits four delayed resolver operations but fails closed at the fifth", async () => {
  const pendingReleases: Array<(value: unknown) => void> = [];
  const contexts: OwnerKontextImageOwnedReferenceResolverContext[] = [];
  const issuer = makeIssuer((context) => {
    contexts.push(context);
    return new Promise((resolve) => { pendingReleases.push(resolve); });
  });
  const requests = Array.from({ length: 4 }, (_, index) => {
    const connectionId = `link_test_pending_${String(index).padStart(12, "0")}`;
    const principal = Object.freeze({ tenant_id: "tenant_test", subject_id: "subject_test", connection_id: connectionId });
    return issuer.issue({
      principal,
      attempt_id: connectionId,
      variant: "flux-kontext-pro",
      reference_handles: [`kontext_image_00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`]
    });
  });
  assert.equal(contexts.length, 4);
  const fifthId = "link_test_pending_000000000004";
  await assert.rejects(issuer.issue({
    principal: { tenant_id: "tenant_test", subject_id: "subject_test", connection_id: fifthId },
    attempt_id: fifthId,
    variant: "flux-kontext-pro",
    reference_handles: ["kontext_image_00000000-0000-4000-8000-000000000005"]
  }), OwnerKontextImagePrepareError);
  for (let index = 0; index < pendingReleases.length; index += 1) {
    pendingReleases[index]!(resolvedReference(contexts[index]!, index));
  }
  const sets = await Promise.all(requests);
  assert.equal(sets.length, 4);
  issuer.close();
});

test("attempt invalidation during an asynchronous owned-reference resolve revokes the late result", async () => {
  let release: ((value: unknown) => void) | undefined;
  let resolverContext: OwnerKontextImageOwnedReferenceResolverContext | undefined;
  const issuer = makeIssuer((context) => {
    resolverContext = context;
    return new Promise((resolve) => { release = resolve; });
  });
  const pending = issuer.issue({
    principal: PRINCIPAL,
    attempt_id: PRINCIPAL.connection_id,
    variant: "flux-kontext-pro",
    reference_handles: ["kontext_image_00000000-0000-4000-8000-000000000021"]
  });
  assert.ok(resolverContext);
  issuer.invalidateAttempt(PRINCIPAL.connection_id);
  release!(resolvedReference(resolverContext!, 0));
  await assert.rejects(pending, OwnerKontextImagePrepareError);
  issuer.close();
});

test("closing the issuer while resolve is pending cannot mint a late reference set", async () => {
  let release: ((value: unknown) => void) | undefined;
  let resolverContext: OwnerKontextImageOwnedReferenceResolverContext | undefined;
  const issuer = makeIssuer((context) => {
    resolverContext = context;
    return new Promise((resolve) => { release = resolve; });
  });
  const pending = issuer.issue({
    principal: PRINCIPAL,
    attempt_id: PRINCIPAL.connection_id,
    variant: "flux-kontext-pro",
    reference_handles: ["kontext_image_00000000-0000-4000-8000-000000000022"]
  });
  assert.ok(resolverContext);
  issuer.close();
  release!(resolvedReference(resolverContext!, 0));
  await assert.rejects(pending, OwnerKontextImagePrepareError);
});

test("resolver receipt must match exact issued context, canonical MIME, safe URL, metadata and original TTL", async () => {
  const handle = "kontext_image_00000000-0000-4000-8000-000000000031";
  let override: Record<string, unknown> = {};
  let getterCalls = 0;
  const issuer = makeIssuer(async (context) => {
    const base = resolvedReference(context, 0, override);
    if (override.accessor === true) {
      delete (base as Record<string, unknown>).accessor;
      Object.defineProperty(base, "width", { enumerable: true, get() { getterCalls += 1; return 1200; } });
    }
    return base;
  });
  const invalidReceipts = [
    { variant: "flux-kontext-max" },
    { ai_name: "other" },
    { mime_type: "image/jpg" },
    { file_url: "javascript:alert(1)" },
    { width: 0 },
    { height: Number.POSITIVE_INFINITY },
    { size: 0 },
    { sha256: "sha256:invalid" },
    { expires_at: NOW },
    { expires_at: NOW + 900_001 },
    { metadata_confidence: "PIXELS_VERIFIED" }
  ];
  for (let index = 0; index < invalidReceipts.length; index += 1) {
    override = invalidReceipts[index]!;
    await assert.rejects(issuer.issue({
      principal: PRINCIPAL,
      attempt_id: PRINCIPAL.connection_id,
      variant: "flux-kontext-pro",
      reference_handles: [handle]
    }), OwnerKontextImagePrepareError);
  }
  override = { accessor: true };
  await assert.rejects(issuer.issue({
    principal: PRINCIPAL,
    attempt_id: PRINCIPAL.connection_id,
    variant: "flux-kontext-pro",
    reference_handles: [handle]
  }), OwnerKontextImagePrepareError);
  assert.equal(getterCalls, 0);
  let resolverCalls = 0;
  const noCallIssuer = makeIssuer(async (context) => {
    resolverCalls += 1;
    return resolvedReference(context, 0);
  });
  await assert.rejects(noCallIssuer.issue({
    principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id,
    variant: "flux-kontext-pro", reference_handles: ["https://r2.syntx.ai/private/image.png"]
  }), OwnerKontextImagePrepareError);
  await assert.rejects(noCallIssuer.issue({
    principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id,
    variant: "flux-kontext-multi", reference_handles: [handle, handle]
  }), OwnerKontextImagePrepareError);
  assert.equal(resolverCalls, 0);
  issuer.close();
  noCallIssuer.close();
});
