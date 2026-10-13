import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HELPER_VERSION = "sha256-c579821472e481f2c1050f3ce2340e0b6d8c8fe8d499685ae03bc337101ed31a.json";
const PUBLIC_VERSION = "sha256-75fa89113113cd83447e36064aa871f91dda43d9c3c16fc5c1e96364f974d7b8.json";
const SETTINGS_VERSION = "sha256-89e53b19ffe9af02c902e59be481b8c7245555c6f45aeaa3d56222e2ed539f62.json";
const REAL_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const cli = await import(
  new URL("../../scripts/settings-alternate-identity.mjs", import.meta.url).href
);

test("parseArguments accepts a well-formed --archive invocation", () => {
  const mode = cli.parseArguments([
    "--archive", "--helper-version", HELPER_VERSION,
    "--public-version", PUBLIC_VERSION, "--settings-version", SETTINGS_VERSION,
    "--confirm-archive"
  ]);
  assert.deepEqual(mode, {
    mode: "archive", helperVersion: HELPER_VERSION, publicVersion: PUBLIC_VERSION,
    settingsVersion: SETTINGS_VERSION, resultVersion: null
  });
});

test("parseArguments accepts a well-formed --inspect invocation", () => {
  const mode = cli.parseArguments([
    "--inspect", "--helper-version", HELPER_VERSION,
    "--public-version", PUBLIC_VERSION, "--settings-version", SETTINGS_VERSION,
    "--version", HELPER_VERSION
  ]);
  assert.equal(mode.mode, "inspect");
  assert.equal(mode.resultVersion, HELPER_VERSION);
});

test("parseArguments refuses a missing trailing argument (the off-by-one this file's length checks must catch)", () => {
  assert.throws(() =>
    cli.parseArguments([
      "--archive", "--helper-version", HELPER_VERSION,
      "--public-version", PUBLIC_VERSION, "--settings-version"
    ]), /Usage:/
  );
  assert.throws(() =>
    cli.parseArguments([
      "--inspect", "--helper-version", HELPER_VERSION,
      "--public-version", PUBLIC_VERSION, "--settings-version", SETTINGS_VERSION,
      "--version"
    ]), /Usage:/
  );
});

test("parseArguments refuses an unrecognized mode and a malformed version string", () => {
  assert.throws(() => cli.parseArguments(["--probe"]), /Usage:/);
  assert.throws(() =>
    cli.parseArguments([
      "--archive", "--helper-version", "not-a-version",
      "--public-version", PUBLIC_VERSION, "--settings-version", SETTINGS_VERSION,
      "--confirm-archive"
    ]), /Usage:/
  );
});

test("parseArguments refuses --archive without --confirm-archive (round-2 critic-risk: the one write mode had no explicit-intent flag)", () => {
  assert.throws(() =>
    cli.parseArguments([
      "--archive", "--helper-version", HELPER_VERSION,
      "--public-version", PUBLIC_VERSION, "--settings-version", SETTINGS_VERSION
    ]), /Usage:/
  );
});

test("--inspect against the real committed archive succeeds offline against the real project root", async () => {
  const result = await cli.main(
    [
      "--inspect", "--helper-version", HELPER_VERSION,
      "--public-version", PUBLIC_VERSION, "--settings-version", SETTINGS_VERSION,
      "--version", "sha256-4a12301d6eb11d23f4242c6929b82b02c50c28c5c144c6a03ff64687305a139c.json"
    ],
    { projectRoot: REAL_ROOT }
  );
  assert.equal(result.entries.length, 2);
});

// Runs --archive against an isolated tmpdir copy of the three fixture
// files, never against REAL_ROOT (round-1 critic-code/risk/skeptic BLOCK:
// an earlier version called --archive against the real project root and
// relied on the committed artifact already being there to make the SECOND
// call refuse — if that gate ever failed to match (a census resync, the
// artifact missing), the FIRST call would actually write a new immutable
// file into the live catalog/runtime/v7/, which the test only asserts
// against afterward).
test("--archive is create-once per (helper_result_version, census_manifest_sha256) pair — refuses a repeat, never accumulates a near-duplicate with a different observed_at", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "syntx-v7-alt-identity-cli-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "catalog", "public"), { recursive: true });
  await mkdir(join(directory, "catalog", "settings"), { recursive: true });
  await mkdir(join(directory, "catalog", "runtime", "v6"), { recursive: true });
  await copyFile(
    join(REAL_ROOT, "catalog", "public", PUBLIC_VERSION),
    join(directory, "catalog", "public", PUBLIC_VERSION)
  );
  await copyFile(
    join(REAL_ROOT, "catalog", "settings", SETTINGS_VERSION),
    join(directory, "catalog", "settings", SETTINGS_VERSION)
  );
  await copyFile(
    join(REAL_ROOT, "catalog", "runtime", "v6", HELPER_VERSION),
    join(directory, "catalog", "runtime", "v6", HELPER_VERSION)
  );

  const archiveArgs = [
    "--archive", "--helper-version", HELPER_VERSION,
    "--public-version", PUBLIC_VERSION, "--settings-version", SETTINGS_VERSION,
    "--confirm-archive"
  ];
  const first = await cli.main(archiveArgs, { projectRoot: directory });
  assert.equal(first.status, "created");

  await assert.rejects(
    cli.main(archiveArgs, { projectRoot: directory }),
    /ALTERNATE_IDENTITY_RESULT_ALREADY_EXISTS/
  );
});
