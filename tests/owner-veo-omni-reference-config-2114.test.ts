import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { readOwnerVeoOmniReferenceFlag, readOwnerVeoOmniReferenceOperatorConfiguration } from "../src/runtime/owner-veo-omni-reference-stdio-config.js";

test("Omni reference configuration is exact default-off and does not inspect disabled operator values", () => {
  for (const value of [undefined, "", "0"]) assert.equal(readOwnerVeoOmniReferenceFlag(value), false);
  assert.equal(readOwnerVeoOmniReferenceFlag("1"), true);
  for (const value of [true, 1, "true", "yes", " 1", "1\n", null]) assert.throws(() => readOwnerVeoOmniReferenceFlag(value));
  assert.equal(readOwnerVeoOmniReferenceOperatorConfiguration(false, new Proxy({}, {}), "invalid"), undefined);
});

test("Omni reference operator cap and absolute probe path cannot be coerced or exceed public limits", () => {
  const binary = resolve(process.cwd(), "ffprobe");
  assert.deepEqual(readOwnerVeoOmniReferenceOperatorConfiguration(true, binary, undefined), { ffprobePath: binary, maxFileBytes: 67_108_864 });
  for (const cap of ["1", "1048576000"]) assert.deepEqual(readOwnerVeoOmniReferenceOperatorConfiguration(true, binary, cap),
    { ffprobePath: binary, maxFileBytes: Number(cap) });
  for (const cap of ["", "0", "-1", "01", "1.0", "1e6", " 1", "1\n", "1048576001", 64, null]) {
    assert.throws(() => readOwnerVeoOmniReferenceOperatorConfiguration(true, binary, cap));
  }
  for (const path of [undefined, "", "ffprobe", `${binary} `, `${binary}\0`, `${binary}/../ffprobe`, true]) {
    assert.throws(() => readOwnerVeoOmniReferenceOperatorConfiguration(true, path, "64"));
  }
});
