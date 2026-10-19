import assert from "node:assert/strict";
import test from "node:test";
import { readOwnerKlingMediaFlag, readOwnerKlingMediaOperatorConfiguration } from "../src/runtime/owner-kling-media-stdio-config.js";

test("Kling media is default-off unless the exact opt-in flag is 1", () => {
  assert.equal(readOwnerKlingMediaFlag(undefined), false);
  assert.equal(readOwnerKlingMediaFlag("true"), false);
  assert.equal(readOwnerKlingMediaFlag("1"), true);
});

test("operator upload destination and absolute ffprobe path are required only when enabled", () => {
  assert.equal(readOwnerKlingMediaOperatorConfiguration(false, undefined, undefined), undefined);
  assert.throws(() => readOwnerKlingMediaOperatorConfiguration(true, "uploaded", "opt/ffprobe"));
  assert.deepEqual(readOwnerKlingMediaOperatorConfiguration(true, "hidden", "/opt/homebrew/bin/ffprobe"), {
    uploadDestination: "hidden", ffprobePath: "/opt/homebrew/bin/ffprobe"
  });
});
