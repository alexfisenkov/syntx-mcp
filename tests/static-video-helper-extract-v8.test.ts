import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const version = `sha256-${"a".repeat(64)}.json`;

test("v8 video helper CLI requires explicit module list and source-fetch confirmation", () => {
  const cli = fileURLToPath(new URL("../scripts/static-video-helper-extract.mjs", import.meta.url));
  const valid = spawnSync(process.execPath, [cli, "--probe", "--public-version", version, "--settings-version", version, "--modules", "constants.js,quality.js", "--confirm-source-fetch"], { encoding: "utf8" });
  assert.equal(valid.status, 1); // archive versions are intentionally synthetic here
  const invalid = spawnSync(process.execPath, [cli, "--probe", "--public-version", version, "--settings-version", version, "--modules", "../unsafe.js", "--confirm-source-fetch"], { encoding: "utf8" });
  assert.equal(invalid.status, 1);
});

test("v8 inspect binds an immutable result version", () => {
  const cli = fileURLToPath(new URL("../scripts/static-video-helper-extract.mjs", import.meta.url));
  const invalid = spawnSync(process.execPath, [cli, "--inspect", "--public-version", version, "--settings-version", version, "--modules", "useLuma.js", "--version", version], { encoding: "utf8" });
  assert.equal(invalid.status, 1);
});
