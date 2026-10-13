import assert from "node:assert/strict";
import test from "node:test";
import { projectDurableOwnerV2PreparedRequest, selectDurableOwnerV2Request } from "../src/runtime/durable-owner-generation-v2.js";

test("trusted local V2 selector binds a variant outside caller parameters", () => {
  const request = {
    model_id: "banana-2.1",
    operation_id: "generate-image",
    catalog_version: "fixture-catalog-version",
    parameters: { prompt: "synthetic only" }
  };
  const before = structuredClone(request);
  const selected = selectDurableOwnerV2Request(request, [
    { model_id: "banana-2.1", operation_id: "generate-image", variant_id: "banana21-image-2k-medium-landscape" }
  ]);
  assert.deepEqual(selected, { ...request, variant_id: "banana21-image-2k-medium-landscape" });
  assert.deepEqual(request, before);
  assert.equal(Object.hasOwn(selected.parameters, "variant_id"), false);
});

test("V2 prepared metadata projects to the exact durable adapter five-field port", () => {
  const settings = Object.freeze({ model_type: "banana-2.1", image_size: "2K", aspect_ratio: "16:9" });
  const projected = projectDurableOwnerV2PreparedRequest({
    prompt: "synthetic projection fixture",
    settings,
    ai_name: "banana",
    modality: "image",
    schema_hash: `sha256:${"a".repeat(64)}`,
    contract_metadata: {
      schema_version: "2.0.0",
      operation_id: "generate-image",
      dispatch_action: "generate-image",
      variant_id: "banana21-image-2k-medium-landscape"
    }
  });
  assert.deepEqual(projected, {
    prompt: "synthetic projection fixture",
    settings,
    ai_name: "banana",
    modality: "image",
    schema_hash: `sha256:${"a".repeat(64)}`
  });
  assert.deepEqual(Object.keys(projected).sort(), ["ai_name", "modality", "prompt", "schema_hash", "settings"]);
});
