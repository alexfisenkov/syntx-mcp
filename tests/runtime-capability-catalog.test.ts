import assert from "node:assert/strict";
import test from "node:test";
import {
  loadRuntimeCapabilityOverlay,
  RuntimeCapabilityCatalog,
  runtimeCapabilityOverlaySchema
} from "../src/catalog/runtime-capability-catalog.js";
import { sha256CanonicalPayload } from "../src/catalog/syntx-public-catalog.js";

test("runtime catalog accounts for every discovery identity without enabling writes", () => {
  const catalog = new RuntimeCapabilityCatalog();
  const records = catalog.list();
  assert.equal(records.length, 193);
  assert.equal(records.filter((record) => record.active).length, 156);
  assert.equal(
    records.filter((record) => record.contract_status === "OBSERVED_PARTIAL")
      .length,
    4
  );
  assert.equal(records.every((record) => record.runtime_usable === false), true);
});

test("observed canaries preserve exact public cost keys and hashed schemas", () => {
  const catalog = new RuntimeCapabilityCatalog();
  assert.deepEqual(catalog.get("banana3_light").cost_parameter_names, [
    "image_size"
  ]);
  assert.deepEqual(
    catalog.get("hailuo-2.3-fast").cost_parameter_names,
    ["resolution", "video_duration"]
  );
  const speech = catalog.get("eleven_multilingual_v2");
  assert.deepEqual(speech.cost_parameter_names, ["chars_count", "mode"]);
  assert.equal(speech.request_schema?.additionalProperties, false);
  assert.match(speech.schema_hash ?? "", /^sha256:[a-f0-9]{64}$/u);
});

test("public-only records are explicit rather than guessed runtime schemas", () => {
  const catalog = new RuntimeCapabilityCatalog();
  const publicOnly = catalog
    .list()
    .find((record) => record.contract_status === "PUBLIC_CONSTRAINTS_ONLY");
  assert.ok(publicOnly);
  assert.equal(publicOnly.request_schema, null);
  assert.equal(publicOnly.schema_hash, null);
  assert.equal(publicOnly.create_status, "OPEN");
});

test("overlay parser rejects hash drift, duplicates, and public-catalog mismatch", () => {
  const source = loadRuntimeCapabilityOverlay();
  const hashDrift = structuredClone(source);
  hashDrift.entries[0]!.request_schema.required = [];
  assert.equal(runtimeCapabilityOverlaySchema.safeParse(hashDrift).success, false);

  const duplicate = structuredClone(source);
  duplicate.entries.push(structuredClone(duplicate.entries[0]!));
  assert.equal(runtimeCapabilityOverlaySchema.safeParse(duplicate).success, false);

  const mismatch = structuredClone(source);
  mismatch.entries[0]!.ai_name = "wrong-family";
  assert.throws(
    () => new RuntimeCapabilityCatalog(undefined, mismatch),
    /overlay drifted/u
  );
});

test("request schema required names are unique and declared properties", () => {
  const source = loadRuntimeCapabilityOverlay();
  const duplicateRequired = structuredClone(source);
  duplicateRequired.entries[0]!.request_schema.required = ["prompt", "prompt"];
  duplicateRequired.entries[0]!.schema_hash = sha256CanonicalPayload(
    duplicateRequired.entries[0]!.request_schema
  );
  assert.equal(
    runtimeCapabilityOverlaySchema.safeParse(duplicateRequired).success,
    false
  );

  const missingProperty = structuredClone(source);
  missingProperty.entries[0]!.request_schema.required = ["prompt", "absent"];
  missingProperty.entries[0]!.schema_hash = sha256CanonicalPayload(
    missingProperty.entries[0]!.request_schema
  );
  assert.equal(
    runtimeCapabilityOverlaySchema.safeParse(missingProperty).success,
    false
  );
});

test("overlay rejects stale public hashes and unknown artifact references", () => {
  const source = loadRuntimeCapabilityOverlay();
  const stalePublicHash = structuredClone(source);
  stalePublicHash.public_catalog_source_hashes.models = `sha256:${"0".repeat(64)}`;
  assert.throws(
    () => new RuntimeCapabilityCatalog(undefined, stalePublicHash),
    /public catalog source hashes/u
  );

  const unknownArtifact = structuredClone(source);
  unknownArtifact.entries[0]!.source_artifact_urls.push(
    "https://syntx.ai/assets/1788368942/unknown.js"
  );
  assert.equal(
    runtimeCapabilityOverlaySchema.safeParse(unknownArtifact).success,
    false
  );
});

test("overlay rejects duplicate artifact URLs, hashes, and entry references", () => {
  const source = loadRuntimeCapabilityOverlay();
  const duplicateArtifact = structuredClone(source);
  duplicateArtifact.source_artifacts.push(
    structuredClone(duplicateArtifact.source_artifacts[0]!)
  );
  assert.equal(
    runtimeCapabilityOverlaySchema.safeParse(duplicateArtifact).success,
    false
  );

  const duplicateArtifactHash = structuredClone(source);
  duplicateArtifactHash.source_artifacts[1]!.sha256 =
    duplicateArtifactHash.source_artifacts[0]!.sha256;
  assert.equal(
    runtimeCapabilityOverlaySchema.safeParse(duplicateArtifactHash).success,
    false
  );

  const duplicateReference = structuredClone(source);
  duplicateReference.entries[0]!.source_artifact_urls.push(
    duplicateReference.entries[0]!.source_artifact_urls[0]!
  );
  assert.equal(
    runtimeCapabilityOverlaySchema.safeParse(duplicateReference).success,
    false
  );
});

test("returned runtime records are defensive copies", () => {
  const catalog = new RuntimeCapabilityCatalog();
  const first = catalog.get("banana3_light");
  first.cost_parameter_names.push("unexpected");
  first.notes.push("unexpected");
  assert.deepEqual(catalog.get("banana3_light").cost_parameter_names, [
    "image_size"
  ]);
  assert.equal(catalog.get("banana3_light").notes.includes("unexpected"), false);
});
