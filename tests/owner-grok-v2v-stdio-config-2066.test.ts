import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join, resolve, isAbsolute } from "node:path";
import test from "node:test";
import {
  readOwnerGrokV2vFlag,
  readOwnerGrokV2vOperatorConfiguration
} from "../src/runtime/owner-grok-v2v-stdio-config.js";

test("Grok V2V is default-off and accepts only the exact opt-in value", () => {
  for (const value of [undefined, "", "0"]) assert.equal(readOwnerGrokV2vFlag(value), false);
  assert.equal(readOwnerGrokV2vFlag("1"), true);
  for (const value of ["true", "yes", "01", " 1", "1 ", "2", null, 1, {}]) {
    assert.throws(() => readOwnerGrokV2vFlag(value));
  }
});

test("disabled Grok V2V ignores operator values; enabled config is explicit and immutable", () => {
  assert.equal(readOwnerGrokV2vOperatorConfiguration(false, "relative", "public"), undefined);
  const ffprobePath = resolve(join(tmpdir(), "syntx-grok-v2v-ffprobe"));
  assert.equal(isAbsolute(ffprobePath), true);
  const uploaded = readOwnerGrokV2vOperatorConfiguration(true, ffprobePath, "uploaded");
  assert.deepEqual(uploaded, { ffprobePath, destination: "uploaded" });
  assert.equal(Object.isFrozen(uploaded), true);
  assert.deepEqual(readOwnerGrokV2vOperatorConfiguration(true, ffprobePath, "hidden"),
    { ffprobePath, destination: "hidden" });
});

test("enabled Grok V2V rejects missing, noncanonical ffprobe paths and any implicit destination", () => {
  const ffprobePath = resolve(join(tmpdir(), "syntx-grok-v2v-ffprobe"));
  const noncanonical = `${tmpdir()}${process.platform === "win32" ? "\\" : "/"}x${process.platform === "win32" ? "\\" : "/"}..${process.platform === "win32" ? "\\" : "/"}ffprobe`;
  for (const value of [undefined, "", "relative/ffprobe", ` ${ffprobePath}`, `${ffprobePath}\0`, noncanonical]) {
    assert.throws(() => readOwnerGrokV2vOperatorConfiguration(true, value, "uploaded"));
  }
  for (const destination of [undefined, "", "public", "Uploaded", "uploaded "]) {
    assert.throws(() => readOwnerGrokV2vOperatorConfiguration(true, ffprobePath, destination));
  }
});
