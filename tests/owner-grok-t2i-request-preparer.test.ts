import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { syntxPublicCatalogSnapshotSchema } from "../src/catalog/syntx-public-catalog.js";
import { OwnerGrokT2iImageUploadService } from "../src/application/owner-grok-t2i-image-upload-service.js";

const CATALOG_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const BINDING = Object.freeze({ tenant_id: "grok-preparer-tenant", subject: "grok-preparer-subject" });
const ATTEMPT = "link_grok_preparer_000000000000001";
const PRINCIPAL = Object.freeze({ tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT });
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
  0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9]);
const CATALOG = new DiscoveryCatalogRepository(syntxPublicCatalogSnapshotSchema.parse(JSON.parse(readFileSync(
  join(process.cwd(), "catalog/public", CATALOG_VERSION), "utf8"
))));

function credentialBroker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> { return operation("synthetic-grok-preparer-credential"); } };
}
function jpegWithWidth(width: number): Buffer {
  const bytes = Buffer.from(JPEG); bytes[9] = (width >>> 8) & 0xff; bytes[10] = width & 0xff; return bytes;
}

test("preparer module exists as the source-bound Grok T2I request preparation seam", async () => {
  const moduleUrl = new URL("../src/application/owner-grok-t2i-request-preparer.js", import.meta.url).href;
  let module: Record<string, unknown> | null = null;
  try { module = await import(moduleUrl) as Record<string, unknown>; } catch { /* expected first RED if module is not present */ }
  assert.equal(typeof module?.createOwnerGrokT2iRequestPreparer, "function", "MISSING_OWNER_GROK_T2I_REQUEST_PREPARER");
});

test("constructor rejects a proxied upload service before triggering its prototype trap", async () => {
  const module = await import("../src/application/owner-grok-t2i-request-preparer.js") as Record<string, unknown>;
  const createPreparer = module.createOwnerGrokT2iRequestPreparer as (options: Record<string, unknown>) => unknown;
  const PrepareError = module.OwnerGrokT2iRequestPrepareError as new (...args: never[]) => Error & { code: string };
  const links = { async getStatus(_binding: unknown, attemptId: string) {
    return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED", status: "LINKED", expires_at: null, linked: true };
  } };
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async () => Response.json({ files: [] }) });
  const uploadService = new OwnerGrokT2iImageUploadService({ binding: BINDING, linkService: links,
    catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient: () => client });
  let prototypeTraps = 0;
  const proxied = new Proxy(uploadService, { getPrototypeOf() { prototypeTraps += 1; throw new Error("prototype trap"); } });
  try {
    assert.throws(() => createPreparer({ binding: BINDING, linkService: links, imageUploadService: proxied,
      catalog: CATALOG, catalog_version: CATALOG_VERSION }),
    (error: unknown) => error instanceof PrepareError && error.code === "PROFILE_BINDING_MISMATCH");
    assert.equal(prototypeTraps, 0);
  } finally { await uploadService.close(); }
});

test("all four model branches prepare explicit ordinary-sender settings without injecting defaults", async () => {
  const module = await import("../src/application/owner-grok-t2i-request-preparer.js") as Record<string, unknown>;
  const createPreparer = module.createOwnerGrokT2iRequestPreparer as (options: Record<string, unknown>) => {
    issue(input: unknown): Promise<Record<string, unknown>>;
    prepare(input: unknown): Promise<Record<string, unknown>>;
    isPreparedCandidateForPrincipal(candidate: unknown, principal: unknown, attemptId: string): boolean;
    close(): Promise<void>;
  };
  let posts = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async () => {
    posts += 1;
    return Response.json({ files: [] });
  } });
  const uploadService = new OwnerGrokT2iImageUploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) {
      return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED", status: "LINKED", expires_at: null, linked: true };
    } }, catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient: () => client });
  const preparer = createPreparer({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) {
      return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED", status: "LINKED", expires_at: null, linked: true };
    } }, imageUploadService: uploadService, catalog: CATALOG, catalog_version: CATALOG_VERSION,
    now: () => Date.parse("2026-10-11T00:00:00.000Z") });
  const cases = [
    { model_id: "grok_t2i", parameters: { aspect_ratio: "2:1", resolution: "2k", batch_size: 5 },
      settings: { n: 1, model_type: "grok_t2i", aspect_ratio: "2:1", resolution: "2k", batch_size: 5 } },
    { model_id: "grok_t2i_pro", parameters: { aspect_ratio: "3:4", resolution: "1k", batch_size: 2 },
      settings: { n: 1, model_type: "grok_t2i_pro", aspect_ratio: "3:4", resolution: "1k", batch_size: 2 } },
    { model_id: "grok_imagine_2", parameters: { aspect_ratio: "16:9", resolution: "2k", batch_size: 3, details_quality: "medium" },
      settings: { n: 1, model_type: "grok_imagine_2", aspect_ratio: "16:9", resolution: "2k", batch_size: 3, details_quality: "medium" } },
    { model_id: "grok_imagine_quality", parameters: { aspect_ratio: "2:3", resolution: "1k", batch_size: 4 },
      settings: { n: 1, model_type: "grok_imagine_quality", aspect_ratio: "2:3", resolution: "1k", batch_size: 4 } }
  ] as const;
  try {
    for (const item of cases) {
      const assetSet = await preparer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, model_id: item.model_id,
        prompt: "Keep this prompt exactly.", parameters: item.parameters, reference_handles: [] });
      const candidate = await preparer.prepare({ principal: PRINCIPAL, attempt_id: ATTEMPT, asset_set: assetSet });
      const sameIntentCandidate = await preparer.prepare({ principal: PRINCIPAL, attempt_id: ATTEMPT, asset_set: assetSet });
      assert.strictEqual(sameIntentCandidate, candidate, "re-preparing the same asset set reuses the original candidate");
      const request = candidate.request as { prompt: string; settings: Record<string, unknown> };
      assert.deepEqual(request, { prompt: "Keep this prompt exactly.", settings: { ...item.settings, file_urls: [] } });
      assert.equal(candidate.model_id, item.model_id);
      assert.equal(candidate.reference_count, 0);
      assert.equal(candidate.dispatch_allowed, false);
      assert.equal(candidate.backend_acceptance, "UNPROVEN");
      assert.match(String(candidate.request_fingerprint), /^sha256:[a-f0-9]{64}$/u);
      assert.match(String(candidate.intent_fingerprint), /^sha256:[a-f0-9]{64}$/u);
      assert.equal(preparer.isPreparedCandidateForPrincipal(candidate, PRINCIPAL, ATTEMPT), true);
      assert.equal(JSON.stringify(candidate).includes("Keep this prompt exactly."), false, "prompt-bearing request stays non-enumerable");
      assert.equal(JSON.stringify(candidate).includes("private"), false);
    }
    assert.equal(posts, 0, "preparation uses no upload or generation POST");
  } finally { await preparer.close(); await uploadService.close(); }
});

test("wire projector preserves every literal ratio branch and resolution, batch, and quality controls", async () => {
  const module = await import("../src/application/owner-grok-t2i-request-preparer.js") as Record<string, unknown>;
  const createPreparer = module.createOwnerGrokT2iRequestPreparer as (options: Record<string, unknown>) => {
    issue(input: unknown): Promise<Record<string, unknown>>;
    prepare(input: unknown): Promise<Record<string, unknown>>;
    isPreparedCandidateForPrincipal(candidate: unknown, principal: unknown, attemptId: string): boolean;
    close(): Promise<void>;
  };
  const attemptId = "link_grok_preparer_matrix_00001";
  const principal = { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: attemptId };
  const links = { async getStatus(_binding: unknown, id: string) {
    return { attempt_id: id, authorization_profile: "OBSERVED_OWNER_AUTHORIZED", status: "LINKED", expires_at: null, linked: true };
  } };
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async () => Response.json({ files: [] }) });
  const uploadService = new OwnerGrokT2iImageUploadService({ binding: BINDING, linkService: links,
    catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient: () => client });
  const preparer = createPreparer({ binding: BINDING, linkService: links, imageUploadService: uploadService,
    catalog: CATALOG, catalog_version: CATALOG_VERSION });
  const baseRatios = ["1:1", "1:2", "2:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9"] as const;
  const imagineRatios = ["1:1", "2:3", "3:2", "9:16", "16:9"] as const;
  const matrix = [
    ...baseRatios.map((aspect_ratio, index) => ({ model_id: "grok_t2i" as const, aspect_ratio, index })),
    ...baseRatios.map((aspect_ratio, index) => ({ model_id: "grok_t2i_pro" as const, aspect_ratio, index })),
    ...imagineRatios.map((aspect_ratio, index) => ({ model_id: "grok_imagine_2" as const, aspect_ratio, index })),
    ...imagineRatios.map((aspect_ratio, index) => ({ model_id: "grok_imagine_quality" as const, aspect_ratio, index }))
  ];
  try {
    for (const item of matrix) {
      const resolution = item.index % 2 === 0 ? "1k" : "2k";
      const batch_size = (item.index % 5) + 1;
      const details_quality = item.index % 2 === 0 ? "low" : "medium";
      const parameters = { aspect_ratio: item.aspect_ratio, resolution, batch_size,
        ...(item.model_id === "grok_imagine_2" ? { details_quality } : {}) };
      const assetSet = await preparer.issue({ principal, attempt_id: attemptId, model_id: item.model_id, prompt: "Literal matrix",
        parameters, reference_handles: [] });
      const candidate = await preparer.prepare({ principal, attempt_id: attemptId, asset_set: assetSet });
      const expectedSettings = { n: 1, model_type: item.model_id, aspect_ratio: item.aspect_ratio, resolution, batch_size,
        ...(item.model_id === "grok_imagine_2" ? { details_quality } : {}), file_urls: [] };
      assert.deepEqual((candidate.request as { settings: Record<string, unknown> }).settings, expectedSettings);
      const expectedCost = item.model_id === "grok_t2i" || item.model_id === "grok_t2i_pro" ? { batch_size }
        : item.model_id === "grok_imagine_2" ? { batch_size, resolution, details_quality }
          : { batch_size, resolution };
      assert.deepEqual(candidate.cost_inputs, expectedCost);
      assert.deepEqual(candidate.source_wire_binding, {
        helper: "video.js", build_id: "1791467421",
        sha256: "sha256:de1f4d8ddb8f79a909aad5a0e62c876995dbaada01946e395d62a3da7e62b2ae",
        confidence: "SOURCE_MAPPED_ORDINARY_EXPLICIT_NOT_RENDERED_GROK_SUBMIT"
      });
      assert.equal((candidate.source_cost_binding as { cost2_sha256: string }).cost2_sha256,
        "sha256:c343afcc3f7a63dcfe479d4407a75dea0791309d0414d1f82e5aca1abdc4cfb9");
      assert.match(String(candidate.request_fingerprint), /^sha256:[a-f0-9]{64}$/u);
    }
  } finally { await preparer.close(); await uploadService.close(); }
});

test("positive reference arrays come from actual 765 handles and retain ordered private URLs at 5/3 selector maxima", async () => {
  const module = await import("../src/application/owner-grok-t2i-request-preparer.js") as Record<string, unknown>;
  const createPreparer = module.createOwnerGrokT2iRequestPreparer as (options: Record<string, unknown>) => {
    issue(input: unknown): Promise<Record<string, unknown>>;
    prepare(input: unknown): Promise<Record<string, unknown>>;
    isPreparedCandidateForPrincipal(candidate: unknown, principal: unknown, attemptId: string): boolean;
    close(): Promise<void>;
  };
  const attemptId = "link_grok_preparer_refs_00000001";
  const principal = { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: attemptId };
  let uploads = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async (_url, init) => {
    uploads += 1;
    const form = init?.body as FormData;
    assert.equal(form.get("destination"), "uploaded");
    assert.equal(form.get("check_duplicates"), "true");
    return Response.json({ files: [{ id: `grok-owned-${uploads}`, url: `https://r2.syntx.ai/private/grok/owned-${uploads}.jpg`,
      mime_type: "image/jpeg", size: (form.get("files") as File).size }] });
  } });
  const links = { async getStatus(_binding: unknown, id: string) {
    return { attempt_id: id, authorization_profile: "OBSERVED_OWNER_AUTHORIZED", status: "LINKED", expires_at: null, linked: true };
  } };
  const uploadService = new OwnerGrokT2iImageUploadService({ binding: BINDING, linkService: links,
    catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient: () => client });
  const preparer = createPreparer({ binding: BINDING, linkService: links, imageUploadService: uploadService,
    catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => Date.parse("2026-10-11T01:00:00.000Z") });
  try {
    const imagineHandles: string[] = [];
    for (let index = 1; index <= 5; index += 1) {
      const bytes = jpegWithWidth(index);
      const receipt = await uploadService.upload({ attemptId, model_id: "grok_imagine_2", content_base64: bytes.toString("base64"),
        filename: `imagine-${index}.jpg`, mime_type: "image/jpeg" });
      imagineHandles.push(String(receipt.reference_handle));
    }
    const imagineAssetSet = await preparer.issue({ principal, attempt_id: attemptId, model_id: "grok_imagine_2",
      prompt: "Five ordered refs", parameters: { aspect_ratio: "2:3", resolution: "2k", batch_size: 5, details_quality: "low" },
      reference_handles: imagineHandles });
    const imagineCandidate = await preparer.prepare({ principal, attempt_id: attemptId, asset_set: imagineAssetSet });
    assert.equal(imagineCandidate.reference_count, 5);
    assert.deepEqual(imagineCandidate.cost_inputs, { batch_size: 5, resolution: "2k", details_quality: "low", ref_count: 5 });
    assert.deepEqual((imagineCandidate.request as { settings: Record<string, unknown> }).settings.file_urls,
      Array.from({ length: 5 }, (_unused, index) => ({ type: "image", url: `https://r2.syntx.ai/private/grok/owned-${index + 1}.jpg` })));
    assert.equal(JSON.stringify(imagineAssetSet).includes("r2.syntx.ai"), false);
    assert.equal(JSON.stringify(imagineCandidate).includes("r2.syntx.ai"), false);
    for (let count = 1; count < imagineHandles.length; count += 1) {
      const prefixSet = await preparer.issue({ principal, attempt_id: attemptId, model_id: "grok_imagine_2",
        prompt: `Imagine refs ${count}`, parameters: { aspect_ratio: "2:3", resolution: "1k", batch_size: 1, details_quality: "low" },
        reference_handles: imagineHandles.slice(0, count) });
      const prefixCandidate = await preparer.prepare({ principal, attempt_id: attemptId, asset_set: prefixSet });
      assert.equal(prefixCandidate.reference_count, count);
      assert.equal((prefixCandidate.request as { settings: Record<string, unknown> }).settings.file_urls instanceof Array, true);
      assert.equal(((prefixCandidate.request as { settings: { file_urls: unknown[] } }).settings.file_urls).length, count);
      assert.equal((prefixCandidate.cost_inputs as Record<string, unknown>).ref_count, count);
    }

    const qualityHandles: string[] = [];
    for (let index = 6; index <= 8; index += 1) {
      const bytes = jpegWithWidth(index);
      const receipt = await uploadService.upload({ attemptId, model_id: "grok_imagine_quality", content_base64: bytes.toString("base64"),
        filename: `quality-${index}.jpg`, mime_type: "image/jpeg" });
      qualityHandles.push(String(receipt.reference_handle));
    }
    const qualityAssetSet = await preparer.issue({ principal, attempt_id: attemptId, model_id: "grok_imagine_quality",
      prompt: "Three ordered refs", parameters: { aspect_ratio: "16:9", resolution: "1k", batch_size: 1 }, reference_handles: qualityHandles });
    const qualityCandidate = await preparer.prepare({ principal, attempt_id: attemptId, asset_set: qualityAssetSet });
    assert.equal(qualityCandidate.reference_count, 3);
    assert.deepEqual(qualityCandidate.cost_inputs, { batch_size: 1, resolution: "1k" }, "Quality has no inferred ref_count cost key");
    assert.deepEqual((qualityCandidate.request as { settings: Record<string, unknown> }).settings.file_urls,
      Array.from({ length: 3 }, (_unused, index) => ({ type: "image", url: `https://r2.syntx.ai/private/grok/owned-${index + 6}.jpg` })));
    for (let count = 1; count < qualityHandles.length; count += 1) {
      const prefixSet = await preparer.issue({ principal, attempt_id: attemptId, model_id: "grok_imagine_quality",
        prompt: `Quality refs ${count}`, parameters: { aspect_ratio: "2:3", resolution: "2k", batch_size: 5 },
        reference_handles: qualityHandles.slice(0, count) });
      const prefixCandidate = await preparer.prepare({ principal, attempt_id: attemptId, asset_set: prefixSet });
      assert.equal(prefixCandidate.reference_count, count);
      assert.equal(((prefixCandidate.request as { settings: { file_urls: unknown[] } }).settings.file_urls).length, count);
      assert.equal(Object.hasOwn(prefixCandidate.cost_inputs as object, "ref_count"), false);
    }
    await uploadService.invalidateAttempt(attemptId);
    assert.equal(preparer.isPreparedCandidateForPrincipal(imagineCandidate, principal, attemptId), false,
      "the guard notices independent invalidation of an underlying 765 reference");
    assert.equal(preparer.isPreparedCandidateForPrincipal(qualityCandidate, principal, attemptId), false);
    assert.equal(uploads, 8);
  } finally { await preparer.close(); await uploadService.close(); }
});

test("prompt validation preserves exact Unicode intent and enforces source UTF-16-plus-LF budgets", async () => {
  const module = await import("../src/application/owner-grok-t2i-request-preparer.js") as Record<string, unknown>;
  const createPreparer = module.createOwnerGrokT2iRequestPreparer as (options: Record<string, unknown>) => {
    issue(input: unknown): Promise<Record<string, unknown>>;
    prepare(input: unknown): Promise<Record<string, unknown>>;
    close(): Promise<void>;
  };
  const links = { async getStatus(_binding: unknown, id: string) {
    return { attempt_id: id, authorization_profile: "OBSERVED_OWNER_AUTHORIZED", status: "LINKED", expires_at: null, linked: true };
  } };
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async () => Response.json({ files: [] }) });
  const uploadService = new OwnerGrokT2iImageUploadService({ binding: BINDING, linkService: links,
    catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient: () => client });
  const preparer = createPreparer({ binding: BINDING, linkService: links, imageUploadService: uploadService,
    catalog: CATALOG, catalog_version: CATALOG_VERSION });
  const cases = [
    { model_id: "grok_t2i", maximum: 5_000, parameters: { aspect_ratio: "1:1", resolution: "1k", batch_size: 1 } },
    { model_id: "grok_t2i_pro", maximum: 5_000, parameters: { aspect_ratio: "1:1", resolution: "1k", batch_size: 1 } },
    { model_id: "grok_imagine_2", maximum: 1_000, parameters: { aspect_ratio: "1:1", resolution: "1k", batch_size: 1, details_quality: "low" } },
    { model_id: "grok_imagine_quality", maximum: 1_000, parameters: { aspect_ratio: "1:1", resolution: "1k", batch_size: 1 } }
  ] as const;
  try {
    for (let index = 0; index < cases.length; index += 1) {
      const item = cases[index]!;
      const attemptId = `link_grok_prompt_boundary_${String(index + 1).padStart(2, "0")}`;
      const principal = { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: attemptId };
      const prompt = "😀".repeat(item.maximum / 2);
      const assetSet = await preparer.issue({ principal, attempt_id: attemptId, model_id: item.model_id, prompt,
        parameters: item.parameters, reference_handles: [] });
      const candidate = await preparer.prepare({ principal, attempt_id: attemptId, asset_set: assetSet });
      assert.equal((candidate.request as { prompt: string }).prompt, prompt, "valid original prompt is not clipped or normalized");
      await assert.rejects(preparer.issue({ principal, attempt_id: attemptId, model_id: item.model_id, prompt: `${prompt}x`,
        parameters: item.parameters, reference_handles: [] }),
      (error: unknown) => error instanceof (module.OwnerGrokT2iRequestPrepareError as new (...args: never[]) => Error & { code: string }) &&
        (error as Error & { code: string }).code === "PROMPT_INVALID");
    }
    const attemptId = "link_grok_prompt_lf_00000001";
    const principal = { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: attemptId };
    const lfPrompt = "x" + "\n".repeat(499) + " ";
    const lfAssetSet = await preparer.issue({ principal, attempt_id: attemptId, model_id: "grok_imagine_2", prompt: lfPrompt,
      parameters: { aspect_ratio: "1:1", resolution: "1k", batch_size: 1, details_quality: "low" }, reference_handles: [] });
    const lfCandidate = await preparer.prepare({ principal, attempt_id: attemptId, asset_set: lfAssetSet });
    assert.equal((lfCandidate.request as { prompt: string }).prompt, lfPrompt);
    await assert.rejects(preparer.issue({ principal, attempt_id: attemptId, model_id: "grok_imagine_2", prompt: `${lfPrompt}x`,
      parameters: { aspect_ratio: "1:1", resolution: "1k", batch_size: 1, details_quality: "low" }, reference_handles: [] }),
    (error: unknown) => error instanceof (module.OwnerGrokT2iRequestPrepareError as new (...args: never[]) => Error & { code: string }) &&
      (error as Error & { code: string }).code === "PROMPT_INVALID");
  } finally { await preparer.close(); await uploadService.close(); }
});

test("zero-reference asset issuance still requires a freshly linked matching principal", async () => {
  const module = await import("../src/application/owner-grok-t2i-request-preparer.js") as Record<string, unknown>;
  const createPreparer = module.createOwnerGrokT2iRequestPreparer as (options: Record<string, unknown>) => {
    issue(input: unknown): Promise<Record<string, unknown>>;
    close(): Promise<void>;
  };
  let linked = false, clientResolutions = 0;
  const links = { async getStatus(_binding: unknown, id: string) {
    return { attempt_id: id, authorization_profile: "OBSERVED_OWNER_AUTHORIZED",
      status: linked ? "LINKED" : "UNLINKED", expires_at: null, linked };
  } };
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async () => Response.json({ files: [] }) });
  const uploadService = new OwnerGrokT2iImageUploadService({ binding: BINDING, linkService: links,
    catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient: () => { clientResolutions += 1; return client; } });
  const preparer = createPreparer({ binding: BINDING, linkService: links, imageUploadService: uploadService,
    catalog: CATALOG, catalog_version: CATALOG_VERSION });
  try {
    const wrongPrincipal = { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT };
    await assert.rejects(preparer.issue({ principal: wrongPrincipal, attempt_id: ATTEMPT, model_id: "grok_t2i",
      prompt: "No refs", parameters: { aspect_ratio: "1:1", resolution: "1k", batch_size: 1 }, reference_handles: [] }),
    (error: unknown) => error instanceof (module.OwnerGrokT2iRequestPrepareError as new (...args: never[]) => Error & { code: string }) &&
      (error as Error & { code: string }).code === "PRINCIPAL_NOT_LINKED");
    assert.equal(clientResolutions, 0);
    linked = true;
    const assetSet = await preparer.issue({ principal: wrongPrincipal, attempt_id: ATTEMPT, model_id: "grok_t2i",
      prompt: "No refs", parameters: { aspect_ratio: "1:1", resolution: "1k", batch_size: 1 }, reference_handles: [] });
    assert.equal(assetSet.reference_count, 0);
  } finally { await preparer.close(); await uploadService.close(); }
});

test("foreign, cloned, and unavailable reference handles are rejected without leaking upstream error detail", async () => {
  const module = await import("../src/application/owner-grok-t2i-request-preparer.js") as Record<string, unknown>;
  const createPreparer = module.createOwnerGrokT2iRequestPreparer as (options: Record<string, unknown>) => {
    issue(input: unknown): Promise<Record<string, unknown>>;
    prepare(input: unknown): Promise<unknown>;
    close(): Promise<void>;
  };
  const PrepareError = module.OwnerGrokT2iRequestPrepareError as new (...args: never[]) => Error & { code: string };
  const invalidHandle = `grok_t2i_image_${"f".repeat(8)}-${"a".repeat(4)}-${"b".repeat(4)}-${"c".repeat(4)}-${"d".repeat(12)}`;
  const attemptId = "link_grok_preparer_forgery_0001";
  const principal = { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: attemptId };
  const links = { async getStatus(_binding: unknown, id: string) {
    return { attempt_id: id, authorization_profile: "OBSERVED_OWNER_AUTHORIZED", status: "LINKED", expires_at: null, linked: true };
  } };
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async () => Response.json({ files: [] }) });
  const uploadService = new OwnerGrokT2iImageUploadService({ binding: BINDING, linkService: links,
    catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient: () => client });
  const preparer = createPreparer({ binding: BINDING, linkService: links, imageUploadService: uploadService,
    catalog: CATALOG, catalog_version: CATALOG_VERSION });
  try {
    const assetSet = await preparer.issue({ principal, attempt_id: attemptId, model_id: "grok_imagine_quality", prompt: "Valid intent",
      parameters: { aspect_ratio: "1:1", resolution: "1k", batch_size: 1 }, reference_handles: [] });
    await assert.rejects(preparer.prepare({ principal: { ...principal, connection_id: `${attemptId}x` }, attempt_id: `${attemptId}x`, asset_set: assetSet }),
      (error: unknown) => error instanceof PrepareError && error.code === "ASSET_UNAVAILABLE");
    await assert.rejects(preparer.prepare({ principal, attempt_id: attemptId, asset_set: { ...assetSet } }),
      (error: unknown) => error instanceof PrepareError && error.code === "ASSET_UNAVAILABLE");
    await assert.rejects(preparer.issue({ principal, attempt_id: attemptId, model_id: "grok_t2i", prompt: "Valid intent",
      parameters: { aspect_ratio: "1:1", resolution: "1k", batch_size: 1 }, reference_handles: [invalidHandle] }),
    (error: unknown) => error instanceof PrepareError && error.code === "INVALID_REQUEST");
    await assert.rejects(preparer.issue({ principal, attempt_id: attemptId, model_id: "grok_imagine_quality", prompt: "Valid intent",
      parameters: { aspect_ratio: "1:1", resolution: "1k", batch_size: 1 }, reference_handles: Array(4).fill(invalidHandle) }),
    (error: unknown) => error instanceof PrepareError && error.code === "INVALID_REQUEST");
    await assert.rejects(preparer.issue({ principal, attempt_id: attemptId, model_id: "grok_imagine_quality", prompt: "Valid intent",
      parameters: { aspect_ratio: "1:1", resolution: "1k", batch_size: 1 }, reference_handles: [invalidHandle, invalidHandle] }),
    (error: unknown) => error instanceof PrepareError && error.code === "INVALID_REQUEST");
    const forgedHandle = `grok_t2i_image_${"a".repeat(8)}-${"b".repeat(4)}-${"c".repeat(4)}-${"d".repeat(4)}-${"e".repeat(12)}`;
    await assert.rejects(preparer.issue({ principal, attempt_id: attemptId, model_id: "grok_imagine_quality", prompt: "Valid intent",
      parameters: { aspect_ratio: "1:1", resolution: "1k", batch_size: 1 }, reference_handles: [forgedHandle] }),
    (error: unknown) => error instanceof PrepareError && error.code === "ASSET_UNAVAILABLE");
  } finally { await preparer.close(); await uploadService.close(); }
});

test("candidate validation rejects source-profile drift and monotonic-clock rollback", async () => {
  const module = await import("../src/application/owner-grok-t2i-request-preparer.js") as Record<string, unknown>;
  const createPreparer = module.createOwnerGrokT2iRequestPreparer as (options: Record<string, unknown>) => {
    issue(input: unknown): Promise<Record<string, unknown>>;
    prepare(input: unknown): Promise<Record<string, unknown>>;
    isPreparedCandidateForPrincipal(candidate: unknown, principal: unknown, attemptId: string): boolean;
    close(): Promise<void>;
  };
  const PrepareError = module.OwnerGrokT2iRequestPrepareError as new (...args: never[]) => Error & { code: string };
  const attemptId = "link_grok_preparer_drift_00001";
  const principal = { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: attemptId };
  const links = { async getStatus(_binding: unknown, id: string) {
    return { attempt_id: id, authorization_profile: "OBSERVED_OWNER_AUTHORIZED", status: "LINKED", expires_at: null, linked: true };
  } };
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async () => Response.json({ files: [] }) });
  const uploadService = new OwnerGrokT2iImageUploadService({ binding: BINDING, linkService: links,
    catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient: () => client });
  let drift = false;
  const mutableCatalog = {
    getModel(modelId: string) {
      const record = CATALOG.getModel(modelId);
      return drift ? { ...record, default: !record.default } : record;
    },
    fetched_at: CATALOG.fetched_at, source_hashes: CATALOG.source_hashes, catalog_metadata: CATALOG.catalog_metadata,
    catalog_kind: CATALOG.catalog_kind, runtime_usable: CATALOG.runtime_usable
  };
  let now = Date.parse("2026-10-11T02:00:00.000Z");
  const preparer = createPreparer({ binding: BINDING, linkService: links, imageUploadService: uploadService,
    catalog: mutableCatalog, catalog_version: CATALOG_VERSION, now: () => now });
  try {
    const assetSet = await preparer.issue({ principal, attempt_id: attemptId, model_id: "grok_t2i", prompt: "Source check",
      parameters: { aspect_ratio: "1:1", resolution: "1k", batch_size: 1 }, reference_handles: [] });
    const candidate = await preparer.prepare({ principal, attempt_id: attemptId, asset_set: assetSet });
    drift = true;
    assert.equal(preparer.isPreparedCandidateForPrincipal(candidate, principal, attemptId), false);
    await assert.rejects(preparer.prepare({ principal, attempt_id: attemptId, asset_set: assetSet }),
      (error: unknown) => error instanceof PrepareError && error.code === "PROFILE_BINDING_MISMATCH");
  } finally { await preparer.close(); await uploadService.close(); }

  let clock = Date.parse("2026-10-11T03:00:00.000Z");
  const clockPreparer = createPreparer({ binding: BINDING, linkService: links, imageUploadService: uploadService,
    catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => clock });
  try {
    const assetSet = await clockPreparer.issue({ principal, attempt_id: attemptId, model_id: "grok_t2i", prompt: "Clock check",
      parameters: { aspect_ratio: "1:1", resolution: "1k", batch_size: 1 }, reference_handles: [] });
    const candidate = await clockPreparer.prepare({ principal, attempt_id: attemptId, asset_set: assetSet });
    clock -= 1;
    assert.equal(clockPreparer.isPreparedCandidateForPrincipal(candidate, principal, attemptId), false);
    await assert.rejects(clockPreparer.prepare({ principal, attempt_id: attemptId, asset_set: assetSet }),
      (error: unknown) => error instanceof PrepareError && error.code === "CLOCK_INVALID");
  } finally { await clockPreparer.close(); await uploadService.close(); }
});

test("asset and candidate expiry stays at the original 15-minute deadline without renewal", async () => {
  const module = await import("../src/application/owner-grok-t2i-request-preparer.js") as Record<string, unknown>;
  const createPreparer = module.createOwnerGrokT2iRequestPreparer as (options: Record<string, unknown>) => {
    issue(input: unknown): Promise<Record<string, unknown>>;
    prepare(input: unknown): Promise<Record<string, unknown>>;
    isPreparedCandidateForPrincipal(candidate: unknown, principal: unknown, attemptId: string): boolean;
    close(): Promise<void>;
  };
  const PrepareError = module.OwnerGrokT2iRequestPrepareError as new (...args: never[]) => Error & { code: string };
  const attemptId = "link_grok_preparer_expiry_00001";
  const principal = { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: attemptId };
  const links = { async getStatus(_binding: unknown, id: string) {
    return { attempt_id: id, authorization_profile: "OBSERVED_OWNER_AUTHORIZED", status: "LINKED", expires_at: null, linked: true };
  } };
  let now = Date.parse("2026-10-11T04:00:00.000Z");
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async () => Response.json({ files: [] }) });
  const uploadService = new OwnerGrokT2iImageUploadService({ binding: BINDING, linkService: links,
    catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient: () => client });
  const preparer = createPreparer({ binding: BINDING, linkService: links, imageUploadService: uploadService,
    catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => now });
  try {
    const assetSet = await preparer.issue({ principal, attempt_id: attemptId, model_id: "grok_t2i", prompt: "Original deadline",
      parameters: { aspect_ratio: "1:1", resolution: "1k", batch_size: 1 }, reference_handles: [] });
    const candidate = await preparer.prepare({ principal, attempt_id: attemptId, asset_set: assetSet });
    assert.equal(assetSet.expires_at, now + 15 * 60_000);
    assert.equal(candidate.expires_at, assetSet.expires_at);
    now += 14 * 60_000;
    assert.equal(preparer.isPreparedCandidateForPrincipal(candidate, principal, attemptId), true);
    now += 60_000;
    assert.equal(preparer.isPreparedCandidateForPrincipal(candidate, principal, attemptId), false);
    await assert.rejects(preparer.prepare({ principal, attempt_id: attemptId, asset_set: assetSet }),
      (error: unknown) => error instanceof PrepareError && error.code === "ASSET_EXPIRED");
  } finally { await preparer.close(); await uploadService.close(); }
});

test("four concurrent owner-principal preflights hit the pending cap and close drains all four", async () => {
  const module = await import("../src/application/owner-grok-t2i-request-preparer.js") as Record<string, unknown>;
  const createPreparer = module.createOwnerGrokT2iRequestPreparer as (options: Record<string, unknown>) => {
    issue(input: unknown): Promise<unknown>;
    close(): Promise<void>;
  };
  const PrepareError = module.OwnerGrokT2iRequestPrepareError as new (...args: never[]) => Error & { code: string };
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async () => Response.json({ files: [] }) });
  const uploadLinks = { async getStatus(_binding: unknown, id: string) {
    return { attempt_id: id, authorization_profile: "OBSERVED_OWNER_AUTHORIZED", status: "LINKED", expires_at: null, linked: true };
  } };
  const uploadService = new OwnerGrokT2iImageUploadService({ binding: BINDING, linkService: uploadLinks,
    catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient: () => client });
  let entered = 0, markAllEntered!: () => void;
  const allEntered = new Promise<void>((resolve) => { markAllEntered = resolve; });
  const blockedLinks = { async getStatus() {
    entered += 1; if (entered === 4) markAllEntered();
    return await new Promise<never>(() => {});
  } };
  const preparer = createPreparer({ binding: BINDING, linkService: blockedLinks, imageUploadService: uploadService,
    catalog: CATALOG, catalog_version: CATALOG_VERSION });
  const controllers = Array.from({ length: 4 }, () => new AbortController());
  const pending = Array.from({ length: 4 }, (_unused, index) => {
    const attemptId = `link_grok_pending_773_0000${String(index + 1).padStart(2, "0")}`;
    const principal = { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: attemptId };
    return preparer.issue({ principal, attempt_id: attemptId, model_id: "grok_t2i", prompt: "Pending",
      parameters: { aspect_ratio: "1:1", resolution: "1k", batch_size: 1 }, reference_handles: [], signal: controllers[index]!.signal });
  });
  try {
    await allEntered;
    const fifthAttempt = "link_grok_pending_773_000005";
    await assert.rejects(preparer.issue({ principal: { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: fifthAttempt },
      attempt_id: fifthAttempt, model_id: "grok_t2i", prompt: "Pending", parameters: { aspect_ratio: "1:1", resolution: "1k", batch_size: 1 },
      reference_handles: [] }), (error: unknown) => error instanceof PrepareError && error.code === "SERVICE_BUSY");
    assert.equal(entered, 4);
    controllers[0]!.abort();
    await assert.rejects(pending[0]!, (error: unknown) => error instanceof PrepareError && error.code === "REQUEST_ABORTED");
    await preparer.close();
    const results = await Promise.allSettled(pending);
    assert.equal(results.length, 4);
    assert.ok(results.every((result) => result.status === "rejected"));
    assert.equal(entered, 4);
  } finally { await preparer.close(); await uploadService.close(); }
});

test("active nominal asset sets are bounded at 128", async () => {
  const module = await import("../src/application/owner-grok-t2i-request-preparer.js") as Record<string, unknown>;
  const createPreparer = module.createOwnerGrokT2iRequestPreparer as (options: Record<string, unknown>) => {
    issue(input: unknown): Promise<Record<string, unknown>>;
    prepare(input: unknown): Promise<Record<string, unknown>>;
    isPreparedCandidateForPrincipal(candidate: unknown, principal: unknown, attemptId: string): boolean;
    close(): Promise<void>;
  };
  const PrepareError = module.OwnerGrokT2iRequestPrepareError as new (...args: never[]) => Error & { code: string };
  const links = { async getStatus(_binding: unknown, id: string) {
    return { attempt_id: id, authorization_profile: "OBSERVED_OWNER_AUTHORIZED", status: "LINKED", expires_at: null, linked: true };
  } };
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async () => Response.json({ files: [] }) });
  const uploadService = new OwnerGrokT2iImageUploadService({ binding: BINDING, linkService: links,
    catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient: () => client });
  let now = Date.parse("2026-10-11T05:00:00.000Z");
  const preparer = createPreparer({ binding: BINDING, linkService: links, imageUploadService: uploadService,
    catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => now });
  let firstCandidate: Record<string, unknown> | undefined;
  try {
    for (let index = 1; index <= 128; index += 1) {
      const attemptId = `link_grok_asset_cap_773_${String(index).padStart(3, "0")}`;
      const principal = { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: attemptId };
      const assetSet = await preparer.issue({ principal, attempt_id: attemptId, model_id: "grok_t2i", prompt: "Capacity",
        parameters: { aspect_ratio: "1:1", resolution: "1k", batch_size: 1 }, reference_handles: [] });
      const candidate = await preparer.prepare({ principal, attempt_id: attemptId, asset_set: assetSet });
      if (index === 1) firstCandidate = candidate;
    }
    const blockedAttempt = "link_grok_asset_cap_773_129";
    await assert.rejects(preparer.issue({ principal: { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: blockedAttempt },
      attempt_id: blockedAttempt, model_id: "grok_t2i", prompt: "Capacity", parameters: { aspect_ratio: "1:1", resolution: "1k", batch_size: 1 },
      reference_handles: [] }), (error: unknown) => error instanceof PrepareError && error.code === "CAPACITY_EXCEEDED");
    now += 15 * 60_000;
    const prunedAttempt = "link_grok_asset_cap_773_130";
    const pruned = await preparer.issue({ principal: { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: prunedAttempt },
      attempt_id: prunedAttempt, model_id: "grok_t2i", prompt: "Expired sets pruned", parameters: { aspect_ratio: "1:1", resolution: "1k", batch_size: 1 },
      reference_handles: [] });
    assert.equal(pruned.reference_count, 0);
    const prunedCandidate = await preparer.prepare({ principal: { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: prunedAttempt },
      attempt_id: prunedAttempt, asset_set: pruned });
    assert.equal(prunedCandidate.expires_at, now + 15 * 60_000);
    assert.equal(preparer.isPreparedCandidateForPrincipal(firstCandidate, { tenant_id: BINDING.tenant_id,
      subject_id: BINDING.subject, connection_id: "link_grok_asset_cap_773_001" }, "link_grok_asset_cap_773_001"), false);
  } finally { await preparer.close(); await uploadService.close(); }
});

test("prepare accepts an optional caller signal and rejects pre-abort before principal lookup, including cached candidates", async () => {
  const module = await import("../src/application/owner-grok-t2i-request-preparer.js") as Record<string, unknown>;
  const createPreparer = module.createOwnerGrokT2iRequestPreparer as (options: Record<string, unknown>) => {
    issue(input: unknown): Promise<Record<string, unknown>>;
    prepare(input: unknown): Promise<Record<string, unknown>>;
    isPreparedCandidateForPrincipal(candidate: unknown, principal: unknown, attemptId: string): boolean;
    close(): Promise<void>;
  };
  const PrepareError = module.OwnerGrokT2iRequestPrepareError as new (...args: never[]) => Error & { code: string };
  let statusCalls = 0;
  const links = { async getStatus(_binding: unknown, attemptId: string) {
    statusCalls += 1;
    return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED", status: "LINKED", expires_at: null, linked: true };
  } };
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async () => Response.json({ files: [] }) });
  const uploadService = new OwnerGrokT2iImageUploadService({ binding: BINDING, linkService: links,
    catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient: () => client });
  const preparer = createPreparer({ binding: BINDING, linkService: links, imageUploadService: uploadService,
    catalog: CATALOG, catalog_version: CATALOG_VERSION });
  try {
    const assetSet = await preparer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, model_id: "grok_t2i", prompt: "Cancel",
      parameters: { aspect_ratio: "1:1", resolution: "1k", batch_size: 1 }, reference_handles: [] });
    const candidate = await preparer.prepare({ principal: PRINCIPAL, attempt_id: ATTEMPT, asset_set: assetSet });
    const before = statusCalls;
    const controller = new AbortController(); controller.abort();
    await assert.rejects(preparer.prepare({ principal: PRINCIPAL, attempt_id: ATTEMPT, asset_set: assetSet, signal: controller.signal }),
      (error: unknown) => error instanceof PrepareError && error.code === "REQUEST_ABORTED");
    assert.equal(statusCalls, before);
    assert.equal(preparer.isPreparedCandidateForPrincipal(candidate, PRINCIPAL, ATTEMPT), true);
  } finally { await preparer.close(); await uploadService.close(); }
});

test("caller abort drains actual owned-reference resolution without revoking another attempt or accepting its late principal", async () => {
  const module = await import("../src/application/owner-grok-t2i-request-preparer.js") as Record<string, unknown>;
  const createPreparer = module.createOwnerGrokT2iRequestPreparer as (options: Record<string, unknown>) => {
    issue(input: unknown): Promise<Record<string, unknown>>;
    prepare(input: unknown): Promise<Record<string, unknown>>;
    isPreparedCandidateForPrincipal(candidate: unknown, principal: unknown, attemptId: string): boolean;
    close(): Promise<void>;
  };
  const PrepareError = module.OwnerGrokT2iRequestPrepareError as new (...args: never[]) => Error & { code: string };
  const stalledAttempt = "link_grok_prepare_cancel_stalled_01";
  const otherAttempt = "link_grok_prepare_cancel_other_001";
  const stalledPrincipal = { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: stalledAttempt };
  const otherPrincipal = { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: otherAttempt };
  let stallAtStatusCall = Number.POSITIVE_INFINITY;
  let stalledStatusCalls = 0;
  let entered!: () => void;
  let release!: (value: Record<string, unknown>) => void;
  const enteredStatus = new Promise<void>((resolve) => { entered = resolve; });
  const lateStatus = new Promise<Record<string, unknown>>((resolve) => { release = resolve; });
  const links = { async getStatus(_binding: unknown, attemptId: string) {
    if (attemptId === stalledAttempt) {
      stalledStatusCalls += 1;
      if (stalledStatusCalls === stallAtStatusCall) { entered(); return lateStatus; }
    }
    return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED", status: "LINKED", expires_at: null, linked: true };
  } };
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async (_url, init) => {
    const form = init?.body as FormData;
    return Response.json({ files: [{ id: "grok-cancel-owned", url: "https://r2.syntx.ai/private/grok/cancel-owned.jpg",
      mime_type: "image/jpeg", size: (form.get("files") as File).size }] });
  } });
  const uploadService = new OwnerGrokT2iImageUploadService({ binding: BINDING, linkService: links,
    catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient: () => client });
  const preparer = createPreparer({ binding: BINDING, linkService: links, imageUploadService: uploadService,
    catalog: CATALOG, catalog_version: CATALOG_VERSION });
  try {
    const receipt = await uploadService.upload({ attemptId: stalledAttempt, model_id: "grok_imagine_2", content_base64: JPEG.toString("base64"),
      filename: "cancel-owned.jpg", mime_type: "image/jpeg" });
    const stalledAsset = await preparer.issue({ principal: stalledPrincipal, attempt_id: stalledAttempt, model_id: "grok_imagine_2", prompt: "Cancel",
      parameters: { aspect_ratio: "2:3", resolution: "1k", batch_size: 1, details_quality: "low" },
      reference_handles: [String(receipt.reference_handle)] });
    const otherAsset = await preparer.issue({ principal: otherPrincipal, attempt_id: otherAttempt, model_id: "grok_t2i", prompt: "Keep going",
      parameters: { aspect_ratio: "1:1", resolution: "1k", batch_size: 1 }, reference_handles: [] });
    stallAtStatusCall = stalledStatusCalls + 2; // prepare's own principal check, then actual resolver principal check
    const controller = new AbortController();
    const pending = preparer.prepare({ principal: stalledPrincipal, attempt_id: stalledAttempt, asset_set: stalledAsset, signal: controller.signal });
    let entryGuard: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([enteredStatus, pending.then(() => { throw new Error("prepare settled before entering the stalled principal lookup"); },
        (error: unknown) => { throw error; }), new Promise<void>((_resolve, reject) => {
        entryGuard = setTimeout(() => reject(new Error("prepare did not enter the stalled principal lookup")), 1_000);
      })]);
    } finally { if (entryGuard) clearTimeout(entryGuard); }
    controller.abort();
    await assert.rejects(pending, (error: unknown) => error instanceof PrepareError && error.code === "REQUEST_ABORTED");
    const otherCandidate = await preparer.prepare({ principal: otherPrincipal, attempt_id: otherAttempt, asset_set: otherAsset });
    assert.equal(preparer.isPreparedCandidateForPrincipal(otherCandidate, otherPrincipal, otherAttempt), true);
    release({ attempt_id: stalledAttempt, authorization_profile: "OBSERVED_OWNER_AUTHORIZED", status: "LINKED", expires_at: null, linked: true });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(preparer.isPreparedCandidateForPrincipal(otherCandidate, otherPrincipal, otherAttempt), true);
  } finally { await preparer.close(); await uploadService.close(); }
});
