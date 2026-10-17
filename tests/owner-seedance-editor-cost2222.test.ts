import assert from "node:assert/strict";
import test from "node:test";
import { statSync } from "node:fs";
import { join } from "node:path";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import { normalizeOwnerSeedanceEditorParameters } from "../src/application/owner-seedance-editor-parameters.js";
import {
  buildOwnerSeedanceEditorCostParameters,
  loadOwnerSeedanceEditorRuntimeCatalog
} from "../src/application/owner-seedance-editor-cost.js";

const CATALOG_DIRECTORY = join(process.cwd(), "catalog");
const CATALOG_VERSION = "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json";
const EDITOR_INPUT = Object.freeze({ model_id: "seedance-2.5-editor", prompt: "A calm landscape.", resolution: "720p" });
const EXPECTED_COST_KEYS = Object.freeze(["duration", "mode", "resolution", "size", "video_duration"]);

test("cost projection emits exactly the five source-form keys and stringifies rounded source duration", () => {
  const normalized = normalizeOwnerSeedanceEditorParameters(EDITOR_INPUT);
  assert.equal(normalized.dispatch_allowed, false);
  const projection = buildOwnerSeedanceEditorCostParameters(EDITOR_INPUT, 12.345);
  assert.deepEqual(projection, {
    video_duration: 0,
    duration: "12.35",
    mode: "edit",
    size: "adaptive",
    resolution: "720p"
  });
  assert.deepEqual(Object.keys(projection).sort(), EXPECTED_COST_KEYS);
  assert.equal(typeof projection.duration, "string");
  assert.equal(Object.isFrozen(projection), true);
});

test("projection accepts the exact normalized-input shape and ignores no caller-supplied override", () => {
  const inputWithOverride = { ...EDITOR_INPUT, duration: "99", video_duration: 9, mode: "create", size: "16:9" };
  assert.throws(() => normalizeOwnerSeedanceEditorParameters(inputWithOverride));
  assert.throws(() => buildOwnerSeedanceEditorCostParameters(inputWithOverride, 12));
  assert.deepEqual(buildOwnerSeedanceEditorCostParameters(EDITOR_INPUT, 4), {
    video_duration: 0, duration: "4.00", mode: "edit", size: "adaptive", resolution: "720p"
  });
});

test("projection rejects non-finite and out-of-range source durations", () => {
  for (const duration of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 3.999, 30.001]) {
    assert.throws(() => buildOwnerSeedanceEditorCostParameters(EDITOR_INPUT, duration));
  }
  assert.throws(() => buildOwnerSeedanceEditorCostParameters(EDITOR_INPUT, "12" as unknown as number));
  assert.doesNotThrow(() => buildOwnerSeedanceEditorCostParameters(EDITOR_INPUT, 4));
  assert.doesNotThrow(() => buildOwnerSeedanceEditorCostParameters(EDITOR_INPUT, 30));
});

test("runtime binding is derived from the Editor-owned exact C19 archive pin and separates model from form identity", () => {
  const before = statSync(join(CATALOG_DIRECTORY, "public", CATALOG_VERSION));
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = (async () => { networkCalls += 1; throw new Error("network access forbidden in this test"); }) as typeof fetch;
  try {
    const runtime = loadOwnerSeedanceEditorRuntimeCatalog(CATALOG_DIRECTORY);
    assert.ok(runtime.catalog instanceof DiscoveryCatalogRepository);
    assert.equal(runtime.catalog_version, CATALOG_VERSION);
    assert.deepEqual(runtime.cost_binding, {
      public_model_id: "seedance-2.5",
      model_type: "seedance-2.5",
      ai_name: "seedance",
      form_id: "seedance-editor",
      scope: "tool_video_inpaint",
      cost_keys: EXPECTED_COST_KEYS
    });
    assert.equal(Object.isFrozen(runtime), true);
    assert.equal(Object.isFrozen(runtime.cost_binding), true);
    assert.equal(Object.isFrozen(runtime.cost_binding.cost_keys), true);
    assert.equal(runtime.catalog.get("seedance-2.5").active, true);
    assert.equal(runtime.catalog.get("seedance-2.5").ai_name, "seedance");
    const snapshot = loadPublicCatalogVersion(CATALOG_VERSION, CATALOG_DIRECTORY);
    assert.equal(snapshot.ai.find((entry) => entry.value === "seedance-editor")?.scope, "tool_video_inpaint");
    assert.equal(networkCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
  const after = statSync(join(CATALOG_DIRECTORY, "public", CATALOG_VERSION));
  assert.equal(after.size, before.size);
  assert.equal(after.mtimeMs, before.mtimeMs);
});

test("runtime binding fails closed when required catalog identity or cost schema is absent", () => {
  assert.throws(() => loadOwnerSeedanceEditorRuntimeCatalog(join(CATALOG_DIRECTORY, "missing")));
});
