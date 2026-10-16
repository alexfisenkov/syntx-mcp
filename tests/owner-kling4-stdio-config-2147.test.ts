import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { readOwnerKling4Flag, readOwnerKling4OperatorConfiguration } from "../src/runtime/owner-kling4-stdio-config.js";

test("K4 runtime is default-off and enabling it requires an absolute trusted operator probe path", () => {
  for (const value of [undefined, "", "0"]) assert.equal(readOwnerKling4Flag(value), false);
  assert.equal(readOwnerKling4Flag("1"), true);
  for (const value of [true, 1, "true", " 1", "yes"]) assert.throws(() => readOwnerKling4Flag(value));
  assert.equal(readOwnerKling4OperatorConfiguration(false, "/ignored", "invalid"), undefined);
  for (const value of [undefined, "ffprobe", "../ffprobe", " /ffprobe", "/ffprobe\0", {}]) {
    assert.throws(() => readOwnerKling4OperatorConfiguration(true, value, undefined));
  }
  assert.deepEqual(readOwnerKling4OperatorConfiguration(true, resolve("ffprobe-fixture"), undefined),
    { ffprobePath: resolve("ffprobe-fixture"), maxVideoFileBytes: 64 * 1024 * 1024 });
});

test("K4 operator video cap is a canonical byte integer bounded by its 300 MiB public source limit", () => {
  const path = resolve("ffprobe-fixture");
  assert.equal(readOwnerKling4OperatorConfiguration(true, path, "1")?.maxVideoFileBytes, 1);
  assert.equal(readOwnerKling4OperatorConfiguration(true, path, "314572800")?.maxVideoFileBytes, 300 * 1024 * 1024);
  for (const value of ["0", "01", "1.5", " 64", "314572801", "1e6", "", 64, "999999999999999999"]) {
    assert.throws(() => readOwnerKling4OperatorConfiguration(true, path, value));
  }
});
