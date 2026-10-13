import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { OwnerSoulCharacterCatalogHttpClient } from "../src/adapter/syntx/owner-soul-character-catalog-http-client.js";
import { OwnerSoulCharacterOptionsService, OwnerSoulCharacterOptionsServiceError,
  isOwnerSoulCharacterHandleResolution, isOwnerSoulRevalidatedCharacterHandle, isOwnerSoulRevalidatedCharacterForContext,
  readOwnerSoulCharacterRevalidationProvenance, getOwnerSoulCharacterReferenceId } from "../src/application/owner-soul-character-options-service.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../src/catalog/selected-discovery-catalog.js";
import { syntxPublicCatalogSnapshotSchema } from "../src/catalog/syntx-public-catalog.js";
import type { AuthBinding } from "../src/auth/types.js";
import { getOwnerSoulImageSourceProfile } from "../src/application/owner-soul-image-source-profile.js";

const VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const CATALOG = new DiscoveryCatalogRepository(syntxPublicCatalogSnapshotSchema.parse(JSON.parse(readFileSync(
  join(process.cwd(), "catalog/public", VERSION), "utf8"
))));
const PROFILE = getOwnerSoulImageSourceProfile("higgsfield-soul", CATALOG, VERSION);
const BINDING: AuthBinding = Object.freeze({ tenant_id: "soul-character-tenant", subject: "soul-character-subject" });
const ATTEMPT = "link_soul_character_00000000000000000001";
const OTHER_ATTEMPT = "link_soul_character_00000000000000000002";
const SOURCE_MAPPING = "sha256:a11bcb0b533f7f3f9f1668e5bab290ef5d0ba85410df5b78f18e361db96b9391";
const PRINCIPAL = Object.freeze({ tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT });
const CHARACTER_ROWS = [
  { id: "record-private-string", reference_id: "ref-private-string", title: "String Character", status: "completed" },
  { id: 17, reference_id: 9001, title: "Numeric Character", status: "completed" },
  { id: "record-working", reference_id: 23, title: "Still Training", status: "in-progress" },
  { id: "record-null", reference_id: null, title: "Explicit null", status: "not-ready" },
  { id: "record-missing", title: "Missing value", status: "queue" }
];

function linkedAttempt(attemptId: string, linked = true) {
  return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
    status: linked ? "LINKED" as const : "UNLINKED" as const, expires_at: null, linked };
}

function createRig(options: { snapshots?: readonly unknown[][]; now?: () => number; isLinked?: (attemptId: string) => boolean } = {}) {
  const calls = { credentials: 0, fetches: 0, resolvedClients: 0 };
  const snapshots = options.snapshots ?? [CHARACTER_ROWS, CHARACTER_ROWS];
  const credentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
    calls.credentials += 1; return operation("synthetic-soul-character-credential");
  } };
  const client = new OwnerSoulCharacterCatalogHttpClient({ credentialBroker, fetchImpl: async (input, init) => {
    calls.fetches += 1;
    assert.equal(String(input), "https://api.syntx.ai/api/v1/hf/lora/list");
    assert.equal(new URL(String(input)).search, ""); assert.equal(init?.method, "GET"); assert.equal(init?.redirect, "error");
    const rows = snapshots[Math.min(calls.fetches - 1, snapshots.length - 1)]!;
    return Response.json({ items: rows, total: rows.length }, { headers: { "content-type": "application/json" } });
  } });
  const linkService = { async getStatus(_binding: AuthBinding, attemptId: string) {
    return linkedAttempt(attemptId, options.isLinked?.(attemptId) ?? true);
  } };
  const service = new OwnerSoulCharacterOptionsService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: VERSION, resolveClient: (attemptId: string) => { calls.resolvedClients += 1; assert.ok(attemptId.startsWith("link_")); return client; },
    now: options.now ?? (() => 1000) });
  return { service, calls };
}

test("lists only current selectable opaque Character handles and keeps string/number IDs typed privately", async () => {
  const rig = createRig();
  try {
    const result = await rig.service.listOptions({ attemptId: ATTEMPT });
    assert.equal(result.status, "OPTIONS_ISSUED");
    assert.equal(result.model_id, "higgsfield-soul");
    assert.equal(result.catalog_version, VERSION);
    assert.equal(result.source_mapping_sha256, SOURCE_MAPPING);
    assert.equal(result.generation_allowed, false);
    assert.equal(result.expires_in_seconds, 300);
    assert.equal(result.confidence_scope, "AUTHENTICATED_CURRENT_ACCOUNT_LIST_MEMBERSHIP_NOT_UPSTREAM_OWNER_FILTER_OR_PROVIDER_PERMISSION");
    assert.deepEqual(result.options.map(({ label, status, selectable, reference_id_type }) => [label, status, selectable, reference_id_type]), [
      ["String Character", "completed", true, "string"], ["Numeric Character", "completed", true, "number"],
      ["Still Training", "in-progress", false, "number"], ["Explicit null", "not-ready", false, "unavailable"],
      ["Missing value", "queue", false, "unavailable"]
    ]);
    assert.equal(result.summary.reference_id_type_counts.null, 1);
    assert.equal(result.summary.reference_id_type_counts.missing, 1);
    assert.ok(result.options[0]?.character_handle && /^soul_character_[0-9a-f-]{36}$/u.test(result.options[0].character_handle));
    assert.equal(result.options[2]?.character_handle, null);
    const serialized = JSON.stringify(result);
    for (const raw of ["record-private-string", "ref-private-string", "9001", "record-working", "record-null"]) {
      assert.equal(serialized.includes(raw), false);
    }
    const cached = await rig.service.resolveCharacterHandle({ attemptId: ATTEMPT, character_handle: result.options[0]!.character_handle! });
    assert.equal(isOwnerSoulCharacterHandleResolution(cached), true);
    const stringContext = { attemptId: ATTEMPT, principal: PRINCIPAL, character_handle: result.options[0]!.character_handle!,
      model_id: "higgsfield-soul", catalog_version: VERSION, source_mapping_sha256: SOURCE_MAPPING,
      profile_schema_hash: PROFILE.profile_schema_hash };
    await assert.rejects(getOwnerSoulCharacterReferenceId(cached, stringContext),
      (error: unknown) => error instanceof OwnerSoulCharacterOptionsServiceError && error.code === "OPTION_HANDLE_NOT_FOUND");
    assert.equal(JSON.stringify(cached).includes("ref-private-string"), false);
    assert.equal(rig.calls.fetches, 1, "cache-only resolve does not read the upstream list");
    const refreshed = await rig.service.revalidateCharacterHandle({ attemptId: ATTEMPT, character_handle: result.options[1]!.character_handle! });
    assert.equal(isOwnerSoulRevalidatedCharacterHandle(refreshed), true);
    const numericContext = { attemptId: ATTEMPT, principal: PRINCIPAL, character_handle: result.options[1]!.character_handle!,
      model_id: "higgsfield-soul", catalog_version: VERSION, source_mapping_sha256: SOURCE_MAPPING,
      profile_schema_hash: PROFILE.profile_schema_hash };
    assert.equal(await getOwnerSoulCharacterReferenceId(refreshed, numericContext), 9001);
    assert.equal(isOwnerSoulRevalidatedCharacterForContext(refreshed, numericContext), true);
    assert.deepEqual(readOwnerSoulCharacterRevalidationProvenance(rig.service, refreshed, numericContext), {
      original_expires_at_ms: 301_000, catalog_version: VERSION, source_mapping_sha256: SOURCE_MAPPING,
      profile_schema_hash: PROFILE.profile_schema_hash
    });
    assert.equal(isOwnerSoulRevalidatedCharacterForContext({ ...refreshed }, numericContext), false,
      "a JSON clone has no nominal revalidation authority");
    assert.equal(readOwnerSoulCharacterRevalidationProvenance(rig.service, { ...refreshed }, numericContext), null);
    assert.equal(isOwnerSoulRevalidatedCharacterForContext(refreshed, { ...numericContext, character_handle: stringContext.character_handle }), false,
      "a revalidated value is bound to the exact selected opaque handle");
    assert.equal(rig.calls.fetches, 2, "one explicit revalidation performs one new list read");
    rig.service.invalidateAttempt(ATTEMPT);
    assert.equal(isOwnerSoulRevalidatedCharacterForContext(refreshed, numericContext), false, "revocation invalidates the issuer context");
    assert.equal(readOwnerSoulCharacterRevalidationProvenance(rig.service, refreshed, numericContext), null);
    await assert.rejects(getOwnerSoulCharacterReferenceId(refreshed, numericContext),
      (error: unknown) => error instanceof OwnerSoulCharacterOptionsServiceError && error.code === "OPTION_HANDLE_NOT_FOUND");
  } finally { await rig.service.close(); }
});

test("an empty current-account list is inconclusive and leaves the explicit none branch unblocked", async () => {
  const rig = createRig({ snapshots: [[]] });
  try {
    const result = await rig.service.listOptions({ attemptId: ATTEMPT });
    assert.equal(result.status, "EMPTY_INCONCLUSIVE");
    assert.equal(result.summary.outcome, "EMPTY_INCONCLUSIVE");
    assert.deepEqual(result.options, []);
    assert.equal(result.generation_allowed, false);
  } finally { await rig.service.close(); }
});

test("a fresh list must preserve the exact typed reference_id and completed status", async () => {
  const cases = [
    [{ id: "record", reference_id: 9001, title: "Typed", status: "completed" },
      { id: "record", reference_id: "9001", title: "Typed", status: "completed" }],
    [{ id: 17, reference_id: 9001, title: "Typed", status: "completed" },
      { id: "17", reference_id: 9001, title: "Typed", status: "completed" }],
    [{ id: "record", reference_id: 9001, title: "Typed", status: "completed" },
      { id: "record", reference_id: 9001, title: "Renamed", status: "completed" }],
    [{ id: "record", reference_id: "ref", title: "Typed", status: "completed" },
      { id: "record", reference_id: "ref", title: "Typed", status: "queue" }]
  ];
  for (const [initial, changed] of cases) {
    const rig = createRig({ snapshots: [[initial], [changed]] });
    try {
      const listed = await rig.service.listOptions({ attemptId: ATTEMPT });
      await assert.rejects(rig.service.revalidateCharacterHandle({ attemptId: ATTEMPT, character_handle: listed.options[0]!.character_handle! }),
        (error: unknown) => error instanceof OwnerSoulCharacterOptionsServiceError && error.code === "OPTION_HANDLE_NOT_FOUND");
      assert.equal(rig.calls.fetches, 2);
    } finally { await rig.service.close(); }
  }
});

test("superseded snapshots, foreign attempts, explicit raw IDs, and expired original TTL are rejected", async () => {
  let now = 1_000;
  const rig = createRig({ snapshots: [CHARACTER_ROWS, CHARACTER_ROWS], now: () => now });
  try {
    const first = await rig.service.listOptions({ attemptId: ATTEMPT });
    const oldHandle = first.options[0]!.character_handle!;
    const second = await rig.service.listOptions({ attemptId: ATTEMPT });
    await assert.rejects(rig.service.resolveCharacterHandle({ attemptId: ATTEMPT, character_handle: oldHandle }),
      (error: unknown) => error instanceof OwnerSoulCharacterOptionsServiceError && error.code === "OPTION_HANDLE_NOT_FOUND");
    await assert.rejects(rig.service.resolveCharacterHandle({ attemptId: OTHER_ATTEMPT, character_handle: second.options[0]!.character_handle! }),
      (error: unknown) => error instanceof OwnerSoulCharacterOptionsServiceError && error.code === "OPTION_HANDLE_NOT_FOUND");
    await assert.rejects(rig.service.resolveCharacterHandle({ attemptId: ATTEMPT, character_handle: "soul_character_00000000-0000-0000-0000-000000000001",
      reference_id: "ref-private-string" } as unknown),
    (error: unknown) => error instanceof OwnerSoulCharacterOptionsServiceError && error.code === "INVALID_REQUEST");
    now += 300_000;
    await assert.rejects(rig.service.resolveCharacterHandle({ attemptId: ATTEMPT, character_handle: second.options[0]!.character_handle! }),
      (error: unknown) => error instanceof OwnerSoulCharacterOptionsServiceError && error.code === "OPTION_HANDLE_EXPIRED");
    assert.equal(rig.calls.fetches, 2, "resolving an expired handle does not refresh or renew its 300-second TTL");
  } finally { await rig.service.close(); }
});

test("principal revocation during a fresh revalidation fails closed", async () => {
  let linked = true; let fetches = 0;
  const credentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
    return operation("synthetic-soul-character-credential");
  } };
  const client = new OwnerSoulCharacterCatalogHttpClient({ credentialBroker, fetchImpl: async () => {
    fetches += 1; if (fetches === 2) linked = false;
    return Response.json({ items: CHARACTER_ROWS, total: CHARACTER_ROWS.length });
  } });
  const linkService = { async getStatus(_binding: AuthBinding, attemptId: string) {
    return linkedAttempt(attemptId, linked);
  } };
  const service = new OwnerSoulCharacterOptionsService({ binding: BINDING, linkService, catalog: CATALOG, catalog_version: VERSION,
    resolveClient: () => client, now: () => 1000 });
  try {
    const listed = await service.listOptions({ attemptId: ATTEMPT });
    await assert.rejects(service.revalidateCharacterHandle({ attemptId: ATTEMPT, character_handle: listed.options[0]!.character_handle! }),
      (error: unknown) => error instanceof OwnerSoulCharacterOptionsServiceError && error.code === "PRINCIPAL_NOT_LINKED");
    assert.equal(fetches, 2, "one fresh source list is read; no retry after principal revocation");
  } finally { await service.close(); }
});

test("clock rollback invalidates revalidated authority and cannot unbox its private reference", async () => {
  let now = 10_000;
  const rig = createRig({ now: () => now });
  try {
    const listed = await rig.service.listOptions({ attemptId: ATTEMPT });
    const handle = listed.options[0]!.character_handle!;
    const fresh = await rig.service.revalidateCharacterHandle({ attemptId: ATTEMPT, character_handle: handle });
    const context = { attemptId: ATTEMPT, principal: PRINCIPAL, character_handle: handle, model_id: "higgsfield-soul",
      catalog_version: VERSION, source_mapping_sha256: SOURCE_MAPPING, profile_schema_hash: PROFILE.profile_schema_hash };
    assert.equal(isOwnerSoulRevalidatedCharacterForContext(fresh, context), true);
    now -= 1;
    assert.equal(isOwnerSoulRevalidatedCharacterForContext(fresh, context), false);
    await assert.rejects(getOwnerSoulCharacterReferenceId(fresh, context),
      (error: unknown) => error instanceof OwnerSoulCharacterOptionsServiceError && error.code === "OPTION_HANDLE_NOT_FOUND");
  } finally { await rig.service.close(); }
});

test("fresh revalidation does not renew the original five-minute handle expiry", async () => {
  let now = 20_000;
  const rig = createRig({ now: () => now });
  try {
    const listed = await rig.service.listOptions({ attemptId: ATTEMPT });
    const handle = listed.options[0]!.character_handle!;
    const fresh = await rig.service.revalidateCharacterHandle({ attemptId: ATTEMPT, character_handle: handle });
    const context = { attemptId: ATTEMPT, principal: PRINCIPAL, character_handle: handle, model_id: "higgsfield-soul",
      catalog_version: VERSION, source_mapping_sha256: SOURCE_MAPPING, profile_schema_hash: PROFILE.profile_schema_hash };
    assert.equal(isOwnerSoulRevalidatedCharacterForContext(fresh, context), true);
    now += 300_000;
    assert.equal(isOwnerSoulRevalidatedCharacterForContext(fresh, context), false);
    await assert.rejects(getOwnerSoulCharacterReferenceId(fresh, context),
      (error: unknown) => error instanceof OwnerSoulCharacterOptionsServiceError && error.code === "OPTION_HANDLE_NOT_FOUND");
    assert.equal(rig.calls.fetches, 2, "revalidation reads once but does not refresh the issued capability TTL");
  } finally { await rig.service.close(); }
});

test("close drains an aborted fixed-route list read", async () => {
  let fetchEntered: (() => void) | undefined;
  const reachedFetch = new Promise<void>((resolve) => { fetchEntered = resolve; });
  const credentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
    return operation("synthetic-soul-character-credential");
  } };
  let hold = true;
  const client = new OwnerSoulCharacterCatalogHttpClient({ credentialBroker, fetchImpl: async (_input, init) => {
    fetchEntered?.();
    if (hold) await new Promise<void>((_resolve, reject) => {
      const signal = init?.signal; assert.ok(signal instanceof AbortSignal);
      const abort = () => reject(new DOMException("aborted", "AbortError"));
      if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
    });
    return Response.json({ items: CHARACTER_ROWS, total: CHARACTER_ROWS.length });
  } });
  const linkService = { async getStatus(_binding: AuthBinding, attemptId: string) {
    return linkedAttempt(attemptId);
  } };
  const service = new OwnerSoulCharacterOptionsService({ binding: BINDING, linkService, catalog: CATALOG, catalog_version: VERSION,
    resolveClient: () => client, now: () => 1000 });
  const pending = service.listOptions({ attemptId: ATTEMPT });
  await reachedFetch;
  const closing = service.close();
  await assert.rejects(pending, (error: unknown) => error instanceof OwnerSoulCharacterOptionsServiceError && error.code === "UPSTREAM_REQUEST_ABORTED");
  await closing;
});
