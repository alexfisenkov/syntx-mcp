import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  readOwnerFlux3VideoFlag,
  readOwnerFlux3VideoOperatorConfiguration
} from "../src/runtime/owner-flux3-video-stdio-config.js";

test("Flux3 video tools stay disabled unless the opt-in is exactly one", () => {
  for (const value of [undefined, "", "0"]) assert.equal(readOwnerFlux3VideoFlag(value), false);
  assert.equal(readOwnerFlux3VideoFlag("1"), true);
  for (const value of ["true", "yes", "01", " 1", "1 ", "2"]) {
    assert.throws(() => readOwnerFlux3VideoFlag(value));
  }
});

test("disabled Flux3 ignores operator settings, while enabled configuration is explicit and immutable", () => {
  assert.equal(readOwnerFlux3VideoOperatorConfiguration(false, "relative", "public"), undefined);
  const ffprobePath = join(tmpdir(), "syntx-flux3-ffprobe");
  const configured = readOwnerFlux3VideoOperatorConfiguration(true, ffprobePath, "uploaded");
  assert.deepEqual(configured, { ffprobePath, destination: "uploaded" });
  assert.equal(Object.isFrozen(configured), true);
  assert.equal(readOwnerFlux3VideoOperatorConfiguration(true, ffprobePath, "hidden")?.destination, "hidden");
});

test("enabled Flux3 rejects missing, noncanonical ffprobe paths and unknown upload destinations", () => {
  const ffprobePath = join(tmpdir(), "syntx-flux3-ffprobe");
  for (const value of [undefined, "", "relative/ffprobe", ` ${ffprobePath}`, `${ffprobePath}\0`, `${tmpdir()}/x/../ffprobe`]) {
    assert.throws(() => readOwnerFlux3VideoOperatorConfiguration(true, value, "uploaded"));
  }
  for (const destination of [undefined, "", "public", "Uploaded", "uploaded "]) {
    assert.throws(() => readOwnerFlux3VideoOperatorConfiguration(true, ffprobePath, destination));
  }
});
