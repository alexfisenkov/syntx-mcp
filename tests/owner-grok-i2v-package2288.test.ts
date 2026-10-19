import assert from "node:assert/strict";
import test from "node:test";

test("2288 compiled package root exports the owner Grok I2V composition", async () => {
  const entry = await import("../src/index.js");
  for (const name of [
    "getOwnerGrokI2vSourceProfile",
    "normalizeOwnerGrokI2vParameters",
    "OwnerGrokI2vReferenceService",
    "OwnerGrokI2vGenerationService",
    "registerSyntxOwnerGrokI2vTools",
    "createOwnerGrokI2vRuntime",
    "readOwnerGrokI2vFlag",
    "readOwnerGrokI2vOperatorConfiguration"
  ]) assert.equal(typeof Reflect.get(entry, name), "function", name);
  assert.equal(entry.readOwnerGrokI2vFlag(undefined), false);
  assert.equal(entry.readOwnerGrokI2vOperatorConfiguration(true, "hidden")?.uploadDestination, "hidden");
  assert.throws(() => entry.readOwnerGrokI2vOperatorConfiguration(true, undefined));
  assert.deepEqual(entry.OWNER_GROK_I2V_TOOL_NAMES, [
    "syntx_owner_upload_grok_i2v_image",
    "syntx_owner_generate_grok_i2v_video",
    "syntx_owner_get_grok_i2v_result",
    "syntx_owner_list_grok_i2v_recoveries"
  ]);
});
