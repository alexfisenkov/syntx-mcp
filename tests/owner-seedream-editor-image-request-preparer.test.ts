import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { loadMaplessSettingsInventoryVersion } from "../src/catalog/mapless-settings-inventory.js";
import { loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import { OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION as C5, OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION as SETTINGS_62 } from "../src/application/owner-seedream-editor-original-upload-source-profile.js";
import { OWNER_SEEDREAM_IMAGE_VARIANTS } from "../src/application/owner-seedream-image-parameters.js";

const moduleUrl = new URL("../src/application/owner-seedream-editor-image-request-preparer.js", import.meta.url).href;
const api = await import(moduleUrl).catch(() => null) as Record<string, unknown> | null;
const policyUrl = new URL("../src/application/owner-seedream-editor-image-one-shot-policy.js", import.meta.url).href;
const policy = await import(policyUrl).catch(() => null) as Record<string, unknown> | null;
const CATALOG = loadSelectedDiscoveryCatalog(C5, join(process.cwd(), "catalog")).discoveryCatalog;
const SETTINGS = loadMaplessSettingsInventoryVersion(SETTINGS_62, join(process.cwd(), "catalog"));
const VARIANT_RESOLUTIONS: Record<string, readonly string[]> = { "seedream-4": ["1K", "2K", "4K"], "seedream-4.5": ["2K", "4K"],
  "seedream-5": ["2K", "3K", "4K"], "seedream-5.0-flash": ["1K", "1.5K", "2K"], "seedream-5.0-pro": ["1K", "2K"] };
const RATIOS = ["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"];
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const ATTEMPT = "link_seedream_editor_preparer_0123456789";
const BINDING = Object.freeze({ tenant_id: "seedream-preparer-tenant", subject: "seedream-preparer-subject" });

function broker(): SyntxCredentialBroker { return { async useCredential<T>(operation: (credential: string) => Promise<T>) { return operation("synthetic-editor-credential"); } }; }
function linked(attempt_id: string) { return { attempt_id, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const, status: "LINKED" as const, expires_at: null, linked: true }; }
function response(payload: unknown): Response { return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }); }
function principal(attemptId = ATTEMPT) { return { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: attemptId }; }

async function fixture(nowInput: number | (() => number) = 10_000, sameUrl = false) {
  const now = typeof nowInput === "function" ? nowInput : () => nowInput;
  let serial = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (_input, init) => {
    const form = init?.body as FormData; const file = form.get("files") as File; serial += 1;
    const suffix = file.name.startsWith("drawing") ? `drawing-${serial}` : `original-${serial}`;
    return response({ files: [{ url: `https://r2.syntx.ai/editor/${sameUrl ? "same" : suffix}.png`, file_id: suffix,
      ...(form.get("destination") === "uploaded" ? { mime_type: file.type, size: file.size, status: "accepted" } : {}) }] });
  } });
  const { OwnerSeedreamEditorOriginalReferenceService } = await import("../src/application/owner-seedream-editor-original-reference-service.js");
  const { OwnerSeedreamEditorDrawingReferenceService } = await import("../src/application/owner-seedream-editor-drawing-reference-service.js");
  const linkService = { async getStatus(_binding: unknown, attempt: string) { return linked(attempt); } };
  const originalReferenceService = new OwnerSeedreamEditorOriginalReferenceService({ binding: BINDING, linkService, catalog: CATALOG,
    public_catalog_version: C5, settings_inventory: SETTINGS, settings_inventory_version: SETTINGS_62, resolveClient: () => client, now });
  const drawingReferenceService = new OwnerSeedreamEditorDrawingReferenceService({ originalReferenceService, binding: BINDING, linkService,
    catalog: CATALOG, public_catalog_version: C5, settings_inventory: SETTINGS, settings_inventory_version: SETTINGS_62, resolveClient: () => client, now });
  const create = api?.createOwnerSeedreamEditorImageRequestPreparer as (options: unknown) => any;
  assert.equal(typeof create, "function", "MISSING_SEEDREAM_EDITOR_IMAGE_REQUEST_PREPARER");
  const preparer = create({ binding: BINDING, linkService, originalReferenceService, drawingReferenceService, now });
  const original = await originalReferenceService.upload({ attemptId: ATTEMPT, variant: "seedream-5", content_base64: PNG.toString("base64"), filename: "original.png", mime_type: "image/png" });
  const drawing = await drawingReferenceService.uploadDrawing({ attemptId: ATTEMPT, variant: "seedream-5", original_handle: original.reference_handle,
    content_base64: PNG.toString("base64"), filename: "drawing.png", mime_type: "image/png" });
  return { preparer, originalReferenceService, drawingReferenceService, original, drawing };
}

test("Seedream Editor image preparer exposes the frozen actual-class ABI", () => {
  assert.ok(api, "MISSING_SEEDREAM_EDITOR_IMAGE_REQUEST_PREPARER_MODULE");
  assert.equal(typeof api!.createOwnerSeedreamEditorImageRequestPreparer, "function");
  assert.equal(typeof api!.isOwnerSeedreamEditorImageRequestPreparer, "function");
  const Constructor = api!.OwnerSeedreamEditorImageRequestPreparer as new (...args: never[]) => object;
  assert.throws(() => new Constructor(), (error: unknown) => error instanceof Error && "code" in error && error.code === "SERVICE_BINDING_MISMATCH");
});

test("prepares every 104 explicit controls with null or genuine drawing, exact private wire and 944 cost projection", async () => {
  const fx = await fixture();
  try {
    let cases = 0;
    for (const variant of OWNER_SEEDREAM_IMAGE_VARIANTS) {
      const original = await fx.originalReferenceService.upload({ attemptId: ATTEMPT, variant, content_base64: PNG.toString("base64"), filename: "original.png", mime_type: "image/png" });
      const drawing = await fx.drawingReferenceService.uploadDrawing({ attemptId: ATTEMPT, variant, original_handle: original.reference_handle,
        content_base64: PNG.toString("base64"), filename: "drawing.png", mime_type: "image/png" });
      for (const resolution of VARIANT_RESOLUTIONS[variant]!) for (const aspect_ratio of RATIOS) {
      for (const drawing_handle of [null, drawing.drawing_handle]) {
        const candidate = await fx.preparer.prepare({ attemptId: ATTEMPT, variant, prompt: "Keep the subject intact.",
          parameters: { aspect_ratio, resolution }, original_handle: original.reference_handle, drawing_handle: drawing_handle ? drawing.drawing_handle : null });
        const request = fx.preparer.getPrivateRequest(candidate);
        assert.deepEqual(Object.keys(request).sort(), ["prompt", "settings"]);
        assert.deepEqual(Object.keys(request.settings).sort(), ["aspect_ratio", "file_urls", "model_type", "n", "resolution", "stream"]);
        assert.equal(request.settings.n, 1); assert.equal(request.settings.stream, false); assert.equal(request.settings.model_type, variant);
        assert.deepEqual(request.settings.file_urls.map((file: { type: string }) => file.type), ["image", ...(drawing_handle ? ["image"] : [])]);
        assert.equal(request.settings.file_urls[0].url.includes("original-"), true);
        if (drawing_handle) assert.equal(request.settings.file_urls[1].url.includes("drawing-"), true);
        assert.equal("mask" in request.settings, false); assert.equal("image_size" in request.settings, false);
        assert.equal(candidate.dispatch_allowed, false); assert.equal(candidate.backend_acceptance, "UNPROVEN");
        assert.deepEqual(candidate.cost_route, { family: "seedream", variant });
        assert.deepEqual(candidate.cost_inputs, variant === "seedream-5.0-pro" ? { batch_size: drawing_handle ? 2 : 1, resolution } : {});
        assert.deepEqual(Object.keys(candidate).sort(), ["backend_acceptance", "cost_inputs", "cost_route", "dispatch_allowed", "expires_at",
          "intent_fingerprint", "parameters", "profile_id", "profile_schema_hash", "references", "request_fingerprint", "source_binding",
          "source_readiness", "status", "variant"].sort());
        assert.equal(fx.preparer.inspectCandidate({ ...candidate }), undefined);
        assert.equal(fx.preparer.inspectCandidate(candidate).drawing_handle, drawing_handle ? drawing.drawing_handle : null);
        const publicJson = JSON.stringify(candidate);
        assert.equal(publicJson.includes("https://r2.syntx.ai"), false);
        assert.equal(publicJson.includes(original.reference_handle), false);
        assert.equal(publicJson.includes(drawing.drawing_handle), false);
        assert.equal(publicJson.includes("seedream-preparer-tenant"), false);
        assert.equal(publicJson.includes("Keep the subject intact."), false);
        cases += 1;
        await fx.preparer.invalidateAttempt(ATTEMPT);
      }
      }
    }
    assert.equal(cases, 208);
  } finally { await fx.preparer.close(); await fx.drawingReferenceService.close(); await fx.originalReferenceService.close(); }
});

test("candidate binds semantics to content and source, excludes nonce and private URL, and only accepts exact input", async () => {
  const fx = await fixture();
  try {
    const create = api!.createOwnerSeedreamEditorImageRequestPreparer as (options: unknown) => any;
    const other = create({ binding: BINDING, linkService: { async getStatus(_b: unknown, id: string) { return linked(id); } },
      originalReferenceService: fx.originalReferenceService, drawingReferenceService: fx.drawingReferenceService, now: () => 10_000 });
    const one = await fx.preparer.prepare({ attemptId: ATTEMPT, variant: "seedream-5", prompt: "Exact prompt",
      parameters: { aspect_ratio: "1:1", resolution: "2K" }, original_handle: fx.original.reference_handle, drawing_handle: null });
    const secondAttempt = "link_seedream_editor_preparer_1123456789";
    const secondOriginal = await fx.originalReferenceService.upload({ attemptId: secondAttempt, variant: "seedream-5", content_base64: PNG.toString("base64"), filename: "original.png", mime_type: "image/png" });
    const two = await other.prepare({ attemptId: secondAttempt, variant: "seedream-5", prompt: "Exact prompt",
      parameters: { aspect_ratio: "1:1", resolution: "2K" }, original_handle: secondOriginal.reference_handle, drawing_handle: null });
    assert.equal(one.intent_fingerprint, two.intent_fingerprint);
    assert.notEqual(one.request_fingerprint, two.request_fingerprint);
    await assert.rejects(() => fx.preparer.prepare({ attemptId: ATTEMPT, variant: "seedream-5", prompt: "Exact prompt",
      parameters: { aspect_ratio: "1:1", resolution: "2K" }, original_handle: fx.original.reference_handle,
      drawing_handle: null, extra: true }), (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_REQUEST");
    await assert.rejects(() => fx.preparer.prepare(new Proxy({}, { get() { throw new Error("hostile getter"); } })),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_REQUEST");
    const candidate = one;
    const createPermit = policy!.createOwnerSeedreamEditorImageOneShotPermit as (input: unknown) => Promise<any>;
    const revalidate = policy!.revalidateOwnerSeedreamEditorImageOneShotPermit as (input: unknown) => Promise<void>;
    const consume = policy!.consumeOwnerSeedreamEditorImageOneShotPermit as (input: unknown) => unknown;
    const args = { preparer: fx.preparer, candidate, principal: principal(), attemptId: ATTEMPT };
    await assert.rejects(() => createPermit({ ...args, candidate: { ...candidate } }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "CANDIDATE_UNBOUND");
    await assert.rejects(() => createPermit({ ...args, principal: principal("link_seedream_editor_preparer_foreign_123456789") }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "PRINCIPAL_MISMATCH");
    const permit = await createPermit(args);
    assert.equal(permit.dispatch_allowed, false); assert.equal(permit.backend_acceptance, "UNPROVEN");
    await revalidate({ ...args, permit });
    assert.deepEqual(consume({ ...args, permit }), { status: "consumed", dispatch_allowed: false, request_fingerprint: candidate.request_fingerprint });
    assert.throws(() => consume({ ...args, permit }), (error: unknown) => error instanceof Error && "code" in error && error.code === "PERMIT_ALREADY_CONSUMED");
    await other.close();
  } finally { await fx.preparer.close(); await fx.drawingReferenceService.close(); await fx.originalReferenceService.close(); }
});

test("fresh revalidation rejects expiry and link loss", async () => {
  let now = 50_000, linkedState = true;
  const fx = await fixture(() => now);
  const linkService = { async getStatus(_binding: unknown, attempt: string) { return linkedState ? linked(attempt) : { ...linked(attempt), status: "REVOKED", linked: false }; } };
  const create = api!.createOwnerSeedreamEditorImageRequestPreparer as (options: unknown) => any;
  const preparer = create({ binding: BINDING, linkService, originalReferenceService: fx.originalReferenceService,
    drawingReferenceService: fx.drawingReferenceService, now: () => now });
  try {
    const expiring = await preparer.prepare({ attemptId: ATTEMPT, variant: "seedream-5", prompt: "Сохранить 🐈", parameters: { aspect_ratio: "1:1", resolution: "2K" },
      original_handle: fx.original.reference_handle, drawing_handle: null });
    assert.equal(preparer.getPrivateRequest(expiring).prompt, "Сохранить 🐈");
    now += 900_001;
    await assert.rejects(() => preparer.revalidateCandidate(expiring),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "CANDIDATE_EXPIRED");
  } finally { await preparer.close(); }
  now = 60_000; linkedState = true;
  const active = create({ binding: BINDING, linkService, originalReferenceService: fx.originalReferenceService,
    drawingReferenceService: fx.drawingReferenceService, now: () => now });
  try {
    const candidate = await active.prepare({ attemptId: ATTEMPT, variant: "seedream-5", prompt: "Recheck source", parameters: { aspect_ratio: "1:1", resolution: "2K" },
      original_handle: fx.original.reference_handle, drawing_handle: fx.drawing.drawing_handle });
    linkedState = false;
    await assert.rejects(() => active.revalidateCandidate(candidate),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "PRINCIPAL_MISMATCH");
  } finally { await active.close(); await fx.drawingReferenceService.close(); await fx.originalReferenceService.close(); }
});

test("genuine original revocation and revoked proxies cannot be upgraded into candidates", async () => {
  const fx = await fixture();
  try {
    const candidate = await fx.preparer.prepare({ attemptId: ATTEMPT, variant: "seedream-5", prompt: "Source-bound", parameters: { aspect_ratio: "1:1", resolution: "2K" },
      original_handle: fx.original.reference_handle, drawing_handle: fx.drawing.drawing_handle });
    await fx.originalReferenceService.invalidateAttempt(ATTEMPT);
    await assert.rejects(() => fx.preparer.revalidateCandidate(candidate),
      (error: unknown) => error instanceof Error && "code" in error && ["REFERENCE_UNAVAILABLE", "REFERENCE_EXPIRED"].includes(String(error.code)));
    const revocable = Proxy.revocable({}, {}); revocable.revoke();
    await assert.rejects(() => fx.preparer.prepare(revocable.proxy),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_REQUEST");
  } finally { await fx.preparer.close(); await fx.drawingReferenceService.close(); await fx.originalReferenceService.close(); }
});

test("candidate capacity is bounded and close drains four pending preparations", async () => {
  const fx = await fixture();
  try {
    for (let index = 0; index < 128; index += 1) await fx.preparer.prepare({ attemptId: ATTEMPT, variant: "seedream-5", prompt: `candidate ${index}`,
      parameters: { aspect_ratio: "1:1", resolution: "2K" }, original_handle: fx.original.reference_handle, drawing_handle: null });
    await assert.rejects(() => fx.preparer.prepare({ attemptId: ATTEMPT, variant: "seedream-5", prompt: "over limit",
      parameters: { aspect_ratio: "1:1", resolution: "2K" }, original_handle: fx.original.reference_handle, drawing_handle: null }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "CAPACITY_EXCEEDED");
  } finally { await fx.preparer.close(); await fx.drawingReferenceService.close(); await fx.originalReferenceService.close(); }

  const draining = await fixture();
  let release!: () => void, started!: () => void, calls = 0, closed = false;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const fourStarted = new Promise<void>((resolve) => { started = resolve; });
  const linkService = { async getStatus(_binding: unknown, attempt: string) { calls += 1; if (calls <= 4) { if (calls === 4) started(); await gate; } return linked(attempt); } };
  const create = api!.createOwnerSeedreamEditorImageRequestPreparer as (options: unknown) => any;
  const preparer = create({ binding: BINDING, linkService, originalReferenceService: draining.originalReferenceService,
    drawingReferenceService: draining.drawingReferenceService });
  const input = { attemptId: ATTEMPT, variant: "seedream-5", prompt: "drain", parameters: { aspect_ratio: "1:1", resolution: "2K" },
    original_handle: draining.original.reference_handle, drawing_handle: null };
  const firstFour = Array.from({ length: 4 }, () => preparer.prepare(input));
  await fourStarted;
  await assert.rejects(() => preparer.prepare(input), (error: unknown) => error instanceof Error && "code" in error && error.code === "SERVICE_BUSY");
  const closing = preparer.close().then(() => { closed = true; });
  assert.equal(closed, false);
  release();
  const outcomes = await Promise.allSettled(firstFour);
  assert.ok(outcomes.every((outcome) => outcome.status === "rejected"));
  await closing; assert.equal(closed, true);
  await preparer.close();
  await draining.drawingReferenceService.close(); await draining.originalReferenceService.close();
});

test("stable typed-URL dedup keeps the original first when the real pair shares one URL", async () => {
  const fx = await fixture(70_000, true);
  try {
    const candidate = await fx.preparer.prepare({ attemptId: ATTEMPT, variant: "seedream-5", prompt: "Deduplicate typed file URL",
      parameters: { aspect_ratio: "1:1", resolution: "2K" }, original_handle: fx.original.reference_handle, drawing_handle: fx.drawing.drawing_handle });
    const request = fx.preparer.getPrivateRequest(candidate);
    assert.deepEqual(request.settings.file_urls, [{ type: "image", url: "https://r2.syntx.ai/editor/same.png" }]);
    assert.equal(candidate.references.length, 2, "content provenance remains distinct after wire URL deduplication");
  } finally { await fx.preparer.close(); await fx.drawingReferenceService.close(); await fx.originalReferenceService.close(); }
});
