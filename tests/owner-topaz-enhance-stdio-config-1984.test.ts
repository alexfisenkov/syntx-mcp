import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readOwnerTopazEnhanceFlag, readOwnerTopazEnhanceOperatorConfiguration } from "../src/runtime/owner-topaz-enhance-stdio-config.js";

test("Enhance configuration stays disabled unless the flag is exactly one", () => {
  for (const value of [undefined, "", "0"]) assert.equal(readOwnerTopazEnhanceFlag(value), false);
  assert.equal(readOwnerTopazEnhanceFlag("1"), true);
  for (const value of ["true", "yes", "01", " 1", "1 ", "2"]) assert.throws(() => readOwnerTopazEnhanceFlag(value));
});

test("disabled Enhance ignores operator settings while enabled configuration is explicit and immutable", () => {
  assert.equal(readOwnerTopazEnhanceOperatorConfiguration(false, "relative", "public"), undefined);
  const path = join(tmpdir(), "syntx-operator-ffprobe");
  assert.deepEqual(readOwnerTopazEnhanceOperatorConfiguration(true, path, "uploaded"), { ffprobePath: path, destination: "uploaded" });
  assert.equal(Object.isFrozen(readOwnerTopazEnhanceOperatorConfiguration(true, path, "hidden")), true);
});

test("enabled Enhance rejects missing, noncanonical or caller-selected external upload destinations", () => {
  const path = join(tmpdir(), "syntx-operator-ffprobe");
  for (const value of [undefined, "", "relative/ffprobe", ` ${path}`, `${path}\0`, join(tmpdir(), "nested") + "/../ffprobe"]) {
    assert.throws(() => readOwnerTopazEnhanceOperatorConfiguration(true, value, "uploaded"));
  }
  for (const destination of [undefined, "", "public", "Uploaded", "uploaded "]) {
    assert.throws(() => readOwnerTopazEnhanceOperatorConfiguration(true, path, destination));
  }
});
