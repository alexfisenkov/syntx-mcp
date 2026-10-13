import assert from "node:assert/strict";
import test from "node:test";
import {
  createOwnerStandardImageOwnedReferenceBindingIssuer,
  getOwnerStandardImageSourceProfile,
  isOwnerStandardImagePreparedCandidateForPrincipal,
  OWNER_STANDARD_IMAGE_VARIANTS,
  OwnerStandardImagePrepareError,
  prepareOwnerStandardImageRequest,
  type OwnerStandardImageOwnedReferenceResolution,
  type OwnerStandardImageOwnedReferenceResolverContext,
  type OwnerStandardImageReferenceMediaKind
} from "../src/application/owner-standard-image-request-preparer.js";
import {
  DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
  loadSelectedDiscoveryCatalog
} from "../src/catalog/selected-discovery-catalog.js";

const catalog = loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION).discoveryCatalog;
const NOW = Date.parse("2026-10-10T12:00:00.000Z");
const PRINCIPAL = Object.freeze({ tenant_id: "tenant_test", subject_id: "subject_test", connection_id: "link_standard_test_0123456789abcdef" });
const HANDLES = Array.from({ length: 36 }, (_, index) =>
  `standard_image_00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);

const parameterState: Readonly<Record<(typeof OWNER_STANDARD_IMAGE_VARIANTS)[number], Readonly<Record<string, string | null>>>> = Object.freeze({
  banana: Object.freeze({ aspect_ratio: "1:1", image_size: null, thinking_level: null }),
  "banana-2.1": Object.freeze({ aspect_ratio: "16:9", image_size: "2K", thinking_level: "medium" }),
  banana2: Object.freeze({ aspect_ratio: "4:3", image_size: "1K", thinking_level: null }),
  banana3: Object.freeze({ aspect_ratio: "3:2", image_size: "0.5K", thinking_level: null }),
  banana3_light: Object.freeze({ aspect_ratio: "2:3", image_size: "1K", thinking_level: null }),
  "gpt-image-1": Object.freeze({ aspect_ratio: "1:1", quality: null, details_quality: null }),
  "gpt-image-1.5": Object.freeze({ aspect_ratio: "3:2", quality: null, details_quality: null }),
  "gpt-image-2": Object.freeze({ aspect_ratio: "16:9", quality: "2K", details_quality: "high" }),
  "gpt-image-2.5-flare": Object.freeze({ aspect_ratio: "21:9", quality: "4K", details_quality: "max" }),
  "gpt-image-2.5-sunburst": Object.freeze({ aspect_ratio: "4:5", quality: "1K", details_quality: "xhigh" })
});

function resolverRecord(
  context: OwnerStandardImageOwnedReferenceResolverContext,
  index: number,
  kind: OwnerStandardImageReferenceMediaKind = "image",
  overrides: Record<string, unknown> = {}
) {
  const mime = kind === "video" ? "video/mp4" : kind === "file" ? "application/pdf" : "image/png";
  const extension = kind === "video" ? "mp4" : kind === "file" ? "pdf" : "png";
  return {
    ...context,
    file_url: `https://r2.syntx.ai/private/standard/${index + 1}.${extension}`,
    mime_type: mime,
    kind,
    width: kind === "image" ? 1200 + index : null,
    height: kind === "image" ? 800 + index : null,
    duration: kind === "video" ? 12.5 : null,
    size: 1024 + index,
    sha256: `sha256:${String(index + 1).padStart(64, "0")}`,
    expires_at: NOW + 600_000 - index * 10_000,
    metadata_confidence: "CONTAINER_METADATA_ONLY" as const,
    ...overrides
  };
}

function options(now = NOW) {
  return { catalog, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, now: () => now };
}

function makeIssuer(now = NOW) {
  return createOwnerStandardImageOwnedReferenceBindingIssuer(async (context) => {
    const index = HANDLES.indexOf(context.reference_handle);
    return resolverRecord(context, index);
  }, options(now));
}

async function issue(variant: (typeof OWNER_STANDARD_IMAGE_VARIANTS)[number], handles: readonly string[], resolve?: (context: OwnerStandardImageOwnedReferenceResolverContext) => Promise<OwnerStandardImageOwnedReferenceResolution>) {
  const issuer = resolve
    ? createOwnerStandardImageOwnedReferenceBindingIssuer(resolve, options())
    : makeIssuer();
  const referenceSet = await issuer.issue({
    principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant, reference_handles: handles
  });
  return { issuer, referenceSet };
}

test("all ten exact source profiles and full active fields prepare without defaults", async () => {
  assert.equal(OWNER_STANDARD_IMAGE_VARIANTS.length, 10);
  for (const variant of OWNER_STANDARD_IMAGE_VARIANTS) {
    const profile = getOwnerStandardImageSourceProfile(variant, catalog, DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION);
    assert.equal(profile.model_id, variant);
    assert.equal(profile.operation_id, "generate-image");
    assert.equal(profile.dispatch_allowed, false);
    assert.equal(profile.backend_acceptance, "UNPROVEN");
    const { issuer, referenceSet } = await issue(variant, []);
    const prompt = "  preserve exact spaces\n🙂  ";
    const candidate = prepareOwnerStandardImageRequest({
      principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant,
      parameters: parameterState[variant], reference_set: referenceSet, prompt
    }, options());
    assert.equal(candidate.request.prompt, prompt);
    assert.equal(candidate.request.settings.model_type, variant);
    assert.deepEqual(candidate.request.settings.file_urls, []);
    assert.equal(candidate.status, "blocked");
    assert.equal(candidate.dispatch_allowed, false);
    assert.equal(candidate.reference_count, 0);
    assert.equal(candidate.total_reference_count, 0);
    assert.equal(candidate.request_fingerprint.startsWith("sha256:"), true);
    if (variant === "gpt-image-2.5-flare" || variant === "gpt-image-2.5-sunburst") {
      assert.equal(Object.hasOwn(candidate.cost_inputs, "ref_count"), false);
    }
    assert.equal(Object.keys(candidate).includes("request"), false);
    assert.equal(JSON.stringify(candidate).includes("file_url"), false);
    assert.equal(JSON.stringify(candidate).includes("subject_test"), false);
    assert.equal(isOwnerStandardImagePreparedCandidateForPrincipal(candidate, PRINCIPAL, PRINCIPAL.connection_id, NOW), true);
    if (variant === "banana") {
      assert.equal(candidate.request.settings.image_size, null);
      assert.equal(Object.hasOwn(candidate.request.settings, "thinking_level"), false);
    }
    if (variant === "banana-2.1") assert.equal(candidate.request.settings.thinking_level, "medium");
    if (variant === "gpt-image-1" || variant === "gpt-image-1.5") {
      assert.equal(Object.hasOwn(candidate.request.settings, "quality"), false);
      assert.equal(Object.hasOwn(candidate.request.settings, "details_quality"), false);
    }
    issuer.close();
  }
});

test("ordered references stay source-derived and GPT cost ref_count is only positive image count", async () => {
  const handles = HANDLES.slice(0, 3);
  const { issuer, referenceSet } = await issue("gpt-image-2.5-flare", handles);
  const candidate = prepareOwnerStandardImageRequest({
    principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant: "gpt-image-2.5-flare",
    parameters: parameterState["gpt-image-2.5-flare"], reference_set: referenceSet, prompt: "three refs"
  }, options());
  assert.equal(candidate.reference_count, 3);
  assert.deepEqual(candidate.cost_inputs, { quality: "4K", details_quality: "max", ref_count: 3 });
  assert.deepEqual(candidate.request.settings.file_urls.map((entry) => entry.url), [1, 2, 3]
    .map((index) => `https://r2.syntx.ai/private/standard/${index}.png`));
  assert.deepEqual(candidate.references.map((reference) => reference.sha256), handles.map((_, index) =>
    `sha256:${String(index + 1).padStart(64, "0")}`));
  assert.ok(Object.isFrozen(candidate.references) && candidate.references.every(Object.isFrozen));
  issuer.close();
});

test("Banana 2.1 keeps mixed media counts separate while cost uses images only", async () => {
  const handles = HANDLES.slice(0, 3);
  const kinds: OwnerStandardImageReferenceMediaKind[] = ["image", "video", "file"];
  const { issuer, referenceSet } = await issue("banana-2.1", handles, async (context) => {
    const index = handles.indexOf(context.reference_handle);
    return resolverRecord(context, index, kinds[index]!);
  });
  assert.equal(referenceSet.reference_count, 1);
  assert.equal(referenceSet.total_reference_count, 3);
  assert.deepEqual(referenceSet.counts_by_kind, { image: 1, video: 1, file: 1 });
  const candidate = prepareOwnerStandardImageRequest({
    principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant: "banana-2.1",
    parameters: parameterState["banana-2.1"], reference_set: referenceSet, prompt: "mixed sources"
  }, options());
  assert.deepEqual(candidate.counts_by_kind, { image: 1, video: 1, file: 1 });
  assert.equal(candidate.reference_count, 1);
  assert.deepEqual(candidate.cost_inputs, { image_size: "2K" });
  assert.deepEqual(candidate.request.settings.file_urls.map((entry) => entry.type), kinds);
  assert.deepEqual(candidate.references.map((reference) => reference.kind), kinds);
  issuer.close();
});

test("Banana 2.1 admits the ordered 34-item mixed maximum with separate per-kind counts", async () => {
  const handles = HANDLES.slice(0, 34);
  const kinds: OwnerStandardImageReferenceMediaKind[] = handles.map((_, index) =>
    index < 14 ? "image" : index < 24 ? "video" : "file");
  const { issuer, referenceSet } = await issue("banana-2.1", handles, async (context) => {
    const index = handles.indexOf(context.reference_handle);
    return resolverRecord(context, index, kinds[index]!, { size: 1 });
  });
  assert.equal(referenceSet.reference_count, 14);
  assert.equal(referenceSet.total_reference_count, 34);
  assert.deepEqual(referenceSet.counts_by_kind, { image: 14, video: 10, file: 10 });
  const candidate = prepareOwnerStandardImageRequest({
    principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant: "banana-2.1",
    parameters: parameterState["banana-2.1"], reference_set: referenceSet, prompt: "all ordered media"
  }, options());
  assert.equal(candidate.references.length, 34);
  assert.deepEqual(candidate.references.map((entry) => entry.kind), kinds);
  assert.equal(candidate.request.settings.file_urls.length, 34);
  issuer.close();

  const tooManyHandles = makeIssuer();
  await assert.rejects(tooManyHandles.issue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id,
    variant: "banana-2.1", reference_handles: [...handles, HANDLES[34]!] }));
  tooManyHandles.close();
});

test("Banana 2.1 enforces per-media and aggregate source byte ceilings", async () => {
  const cases = [
    { kinds: ["image"] as const, sizes: [7_340_033] },
    { kinds: ["video"] as const, sizes: [20_971_521] },
    { kinds: ["file"] as const, sizes: [5_242_881] },
    { kinds: ["video", "video", "video", "video"] as const, sizes: [20_971_520, 20_971_520, 20_971_520, 20_971_520] }
  ];
  for (let caseIndex = 0; caseIndex < cases.length; caseIndex += 1) {
    const item = cases[caseIndex]!;
    const handles = HANDLES.slice(caseIndex * 4, caseIndex * 4 + item.kinds.length);
    const issuer = createOwnerStandardImageOwnedReferenceBindingIssuer(async (context) => {
      const index = handles.indexOf(context.reference_handle);
      return resolverRecord(context, index, item.kinds[index]!, { size: item.sizes[index] });
    }, options());
    await assert.rejects(issuer.issue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id,
      variant: "banana-2.1", reference_handles: handles }));
    issuer.close();
  }
});

test("issuer rejects mismatched kind/MIME, duplicate URL or digest, and extra resolver fields", async () => {
  const badMimeIssuer = createOwnerStandardImageOwnedReferenceBindingIssuer(async (context) =>
    resolverRecord(context, 0, "image", { mime_type: "application/pdf" }) as unknown as OwnerStandardImageOwnedReferenceResolution, options());
  await assert.rejects(badMimeIssuer.issue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id,
    variant: "banana-2.1", reference_handles: [HANDLES[4]] }));
  badMimeIssuer.close();

  const extraIssuer = createOwnerStandardImageOwnedReferenceBindingIssuer(async (context) => ({
    ...resolverRecord(context, 0), unexpected: "caller-controlled"
  }) as unknown as OwnerStandardImageOwnedReferenceResolution, options());
  await assert.rejects(extraIssuer.issue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id,
    variant: "banana", reference_handles: [HANDLES[11]!] }));
  extraIssuer.close();

  for (const collision of ["url", "sha"]) {
    const issuer = createOwnerStandardImageOwnedReferenceBindingIssuer(async (context) => {
      const index = HANDLES.indexOf(context.reference_handle);
      const record = resolverRecord(context, index);
      return context.reference_handle === HANDLES[5]
        ? collision === "url"
          ? { ...record, file_url: "https://r2.syntx.ai/private/standard/1.png" }
          : { ...record, sha256: `sha256:${"1".padStart(64, "0")}` }
        : record;
    }, options());
    await assert.rejects(issuer.issue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id,
      variant: "banana", reference_handles: [HANDLES[0]!, HANDLES[5]!] }));
    issuer.close();
  }
  await assert.rejects(makeIssuer().issue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id,
    variant: "banana", reference_handles: [HANDLES[0]!, HANDLES[0]!] }));
});

test("reference sets and candidates bind principal, variant, original expiry, and invalidation", async () => {
  const { issuer, referenceSet } = await issue("banana2", [HANDLES[6]!]);
  const input = { principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant: "banana2" as const,
    parameters: parameterState.banana2, reference_set: referenceSet, prompt: "bound" };
  const candidate = prepareOwnerStandardImageRequest(input, options());
  assert.throws(() => prepareOwnerStandardImageRequest({ ...input, variant: "banana3" }, options()), OwnerStandardImagePrepareError);
  assert.throws(() => prepareOwnerStandardImageRequest({ ...input, principal: { ...PRINCIPAL, subject_id: "other" } }, options()), OwnerStandardImagePrepareError);
  assert.equal(isOwnerStandardImagePreparedCandidateForPrincipal(candidate,
    { ...PRINCIPAL, subject_id: "other" }, PRINCIPAL.connection_id, NOW), false);
  assert.equal(isOwnerStandardImagePreparedCandidateForPrincipal(candidate, PRINCIPAL, PRINCIPAL.connection_id, referenceSet.expires_at), false);
  issuer.invalidateAttempt(PRINCIPAL.connection_id);
  assert.equal(isOwnerStandardImagePreparedCandidateForPrincipal(candidate, PRINCIPAL, PRINCIPAL.connection_id, NOW), false);
  assert.throws(() => prepareOwnerStandardImageRequest(input, options()), OwnerStandardImagePrepareError);
  issuer.close();
});

test("semantic intent stays stable across attempts and private upload identities, but binds order, bytes, and settings", async () => {
  const attemptA = "link_image_attempt_000000000001";
  const attemptB = "link_image_attempt_000000000002";
  const attemptTenantC = "link_image_attempt_000000000003";
  const attemptSubjectD = "link_image_attempt_000000000004";
  const handlesA = [HANDLES[15]!, HANDLES[16]!];
  const handlesB = [HANDLES[17]!, HANDLES[18]!];
  const handlesC = [HANDLES[19]!, HANDLES[20]!];
  const handlesTenantC = [HANDLES[21]!, HANDLES[22]!];
  const handlesSubjectD = [HANDLES[23]!, HANDLES[24]!];
  const logicalIndex = new Map([[handlesA[0]!, 0], [handlesA[1]!, 1], [handlesB[0]!, 0], [handlesB[1]!, 1],
    [handlesC[0]!, 0], [handlesC[1]!, 1], [handlesTenantC[0]!, 0], [handlesTenantC[1]!, 1],
    [handlesSubjectD[0]!, 0], [handlesSubjectD[1]!, 1]]);
  const principalFor = (connectionId: string, tenantId = "tenant_test", subjectId = "subject_test") => ({
    tenant_id: tenantId, subject_id: subjectId, connection_id: connectionId
  });
  let alterSecondContent = false;
  const issuer = createOwnerStandardImageOwnedReferenceBindingIssuer(async (context) => {
    const index = logicalIndex.get(context.reference_handle)!;
    const attemptOffset = context.attempt_id === attemptA ? 600_000 : 480_000;
    return {
      ...context,
      file_url: `https://r2.syntx.ai/private/intent/${context.attempt_id}/${index}.png`,
      mime_type: "image/png",
      kind: "image",
      width: 1000 + index,
      height: 800 + index,
      duration: null,
      size: 2048 + index,
      sha256: `sha256:${String(index + 1 + (alterSecondContent && index === 1 ? 4 : 0)).padStart(64, "0")}`,
      expires_at: NOW + attemptOffset,
      metadata_confidence: "CONTAINER_METADATA_ONLY" as const
    };
  }, options());
  const prepare = async (attemptId: string, handles: readonly string[], parameterInput = parameterState.banana2,
    principal = principalFor(attemptId)) => {
    const referenceSet = await issuer.issue({ principal, attempt_id: attemptId,
      variant: "banana2", reference_handles: handles });
    return prepareOwnerStandardImageRequest({ principal, attempt_id: attemptId, variant: "banana2",
      parameters: parameterInput, reference_set: referenceSet, prompt: "same semantic request" }, options());
  };
  const first = await prepare(attemptA, handlesA);
  const second = await prepare(attemptB, handlesB);
  assert.equal(first.intent_fingerprint, second.intent_fingerprint);
  assert.notEqual(first.request_fingerprint, second.request_fingerprint);
  assert.notEqual(first.expires_at, second.expires_at);

  const reversed = await prepare(attemptA, [...handlesA].reverse());
  assert.notEqual(first.intent_fingerprint, reversed.intent_fingerprint);
  alterSecondContent = true;
  const changedBytes = await prepare(attemptA, handlesC);
  assert.notEqual(first.intent_fingerprint, changedBytes.intent_fingerprint);
  const changedSettings = await prepare(attemptA, handlesC, {
    aspect_ratio: "16:9", image_size: "1K", thinking_level: null
  });
  assert.notEqual(first.intent_fingerprint, changedSettings.intent_fingerprint);
  const otherTenant = await prepare(attemptTenantC, handlesTenantC, parameterState.banana2,
    principalFor(attemptTenantC, "tenant_other", "subject_test"));
  const otherSubject = await prepare(attemptSubjectD, handlesSubjectD, parameterState.banana2,
    principalFor(attemptSubjectD, "tenant_test", "subject_other"));
  assert.notEqual(first.intent_fingerprint, otherTenant.intent_fingerprint);
  assert.notEqual(first.intent_fingerprint, otherSubject.intent_fingerprint);
  await assert.rejects(issuer.issue({ principal: principalFor(attemptA), attempt_id: attemptB,
    variant: "banana2", reference_handles: [] }));
  const referenceSet = await issuer.issue({ principal: principalFor(attemptA), attempt_id: attemptA,
    variant: "banana2", reference_handles: [] });
  assert.throws(() => prepareOwnerStandardImageRequest({ principal: principalFor(attemptB), attempt_id: attemptA,
    variant: "banana2", parameters: parameterState.banana2, reference_set: referenceSet,
    prompt: "mismatch" }, options()), OwnerStandardImagePrepareError);
  assert.ok(Object.isFrozen(first) && /^sha256:[a-f0-9]{64}$/u.test(first.intent_fingerprint));
  issuer.close();
});

test("input accessors, caller URLs/metadata and malformed prompts reject without invoking getters", async () => {
  const { issuer, referenceSet } = await issue("gpt-image-2", []);
  const base = { principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant: "gpt-image-2" as const,
    parameters: parameterState["gpt-image-2"], reference_set: referenceSet, prompt: "safe" };
  let calls = 0;
  const accessor = { ...base };
  Object.defineProperty(accessor, "prompt", { enumerable: true, get() { calls += 1; return "x"; } });
  assert.throws(() => prepareOwnerStandardImageRequest(accessor, options()), OwnerStandardImagePrepareError);
  assert.equal(calls, 0);
  const proxyInput = new Proxy(base, { getPrototypeOf() { calls += 1; throw new Error("proxy trap"); } });
  assert.throws(() => prepareOwnerStandardImageRequest(proxyInput, options()), OwnerStandardImagePrepareError);
  assert.equal(calls, 0);
  for (const prompt of ["", "  ", "bad\u0000prompt", "\ud800", "x".repeat(65_537)]) {
    assert.throws(() => prepareOwnerStandardImageRequest({ ...base, prompt }, options()), OwnerStandardImagePrepareError);
  }
  assert.throws(() => prepareOwnerStandardImageRequest({ ...base, file_urls: [] }, options()), OwnerStandardImagePrepareError);
  issuer.close();
});

test("foreign resolver objects and stale source epochs cannot bind to an owned set", async () => {
  let getterCalls = 0;
  const accessorIssuer = createOwnerStandardImageOwnedReferenceBindingIssuer(async (context) => {
    const record = resolverRecord(context, 0);
    Object.defineProperty(record, "mime_type", { enumerable: true, get() { getterCalls += 1; return "image/png"; } });
    return record as unknown as OwnerStandardImageOwnedReferenceResolution;
  }, options());
  await assert.rejects(accessorIssuer.issue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id,
    variant: "banana", reference_handles: [HANDLES[12]!] }));
  assert.equal(getterCalls, 0);
  accessorIssuer.close();

  const normalIssuer = makeIssuer();
  const set = await normalIssuer.issue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id,
    variant: "banana", reference_handles: [] });
  assert.throws(() => prepareOwnerStandardImageRequest({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id,
    variant: "banana", parameters: parameterState.banana, reference_set: set, prompt: "fresh" }, {
    catalog, catalog_version: "future-catalog.json", now: () => NOW
  }), OwnerStandardImagePrepareError);
  normalIssuer.close();
});

test("empty reference sets are principal/attempt/variant latched and use one local TTL", async () => {
  const issuer = createOwnerStandardImageOwnedReferenceBindingIssuer(async () => { throw new Error("empty set resolved"); }, options());
  const set = await issuer.issue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant: "gpt-image-1", reference_handles: [] });
  assert.equal(set.expires_at, NOW + 900_000);
  await assert.rejects(issuer.issue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant: "gpt-image-1", reference_handles: [] }));
  issuer.close();
});
