import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const scriptPath = "scripts/live-owner-video-contract-observe.mjs";
const source = readFileSync(scriptPath, "utf8");

test("video contract observer requires the exact owner confirmation shape", () => {
  const tooManyKeys = Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`k${index}`, index]));
  const tooLarge = JSON.stringify({ prompt: "x".repeat(16 * 1024) });
  for (const args of [
    [],
    ["--confirm-live-video-contract"],
    ["--confirm-live-video-contract", "veo"],
    ["--confirm-live-video-contract", "veo", "prompt", "{}", "extra"],
    ["--confirm-live-video-contract", "veo", "prompt", "[]"],
    ["--confirm-live-video-contract", "veo", "prompt", "not-json"],
    ["--confirm-live-video-contract", "veo", "prompt", "null"],
    ["--confirm-live-video-contract", "veo", "prompt", '{"__proto__":"blocked"}'],
    ["--confirm-live-video-contract", "veo", "prompt", JSON.stringify(tooManyKeys)],
    ["--confirm-live-video-contract", "veo", "prompt", tooLarge],
    ["--confirm-live-video-contract", "veo", "prompt", '{"text":"\\u0001"}'],
    ["--confirm-live-video-contract", "veo", "prompt", '{"value":NaN}'],
    ["--confirm-live-video-contract", "veo", "prompt", "extra"],
    ["--wrong", "veo", "prompt"],
    ["--confirm-live-video-contract", "bad model", "prompt"],
    ["--confirm-live-video-contract", "veo", ""],
    ["--confirm-live-video-contract", "veo", "prompt\nwith-control"]
  ]) {
    const result = spawnSync(process.execPath, [scriptPath, ...args], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 5_000,
      env: { ...process.env, SYNTX_LIVE_VIDEO_CONTRACT: "1" }
    });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /--confirm-live-video-contract/);
    assert.equal(result.stdout, "");
  }
});

test("video observer keeps the live contract owner-only and bounded", () => {
  assert.match(source, /createObservedOwnerRuntime/);
  assert.match(source, /syntx_begin_login/);
  assert.match(source, /syntx_check_login/);
  assert.match(source, /startVideo\(/);
  assert.match(source, /JSON\.parse/);
  assert.match(source, /MAX_SETTINGS_BYTES/);
  assert.match(source, /MAX_SETTINGS_KEYS/);
  assert.match(source, /listInProgress/);
  assert.match(source, /getMessage/);
  assert.match(source, /180_000/);
  assert.match(source, /redact|redacted/i);
  assert.match(source, /video-contract-observation/);
  assert.match(source, /settings\s*:\s*settings/);
  assert.doesNotMatch(source, /settings\s*:\s*\{\}/);
  assert.match(source, /Object\.getPrototypeOf/);
  assert.match(source, /Number\.isFinite/);
  assert.match(source, /__proto__|prototype|constructor/);
  assert.doesNotMatch(source, /deleteChat\(/);
  assert.doesNotMatch(source, /fetch\(/);
  assert.doesNotMatch(source, /process\.env\.SYNTX_LIVE_VIDEO_CONTRACT/);
});

test("video observer accepts a bounded object settings argument before platform checks", () => {
  if (process.platform === "darwin") return;
  const result = spawnSync(process.execPath, [
    scriptPath,
    "--confirm-live-video-contract",
    "veo",
    "prompt",
    '{"duration":5,"nested":{"mode":"fast"}}'
  ], { cwd: process.cwd(), encoding: "utf8", timeout: 5_000 });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /safe stage platform/);
  assert.equal(result.stdout, '{"status":"FAILED","stage":"platform"}\n');
});

test("video observer normalizes failures without exposing upstream details", () => {
  assert.match(source, /safe stage/);
  assert.match(source, /without exposing upstream|safe error|normalized/i);
  assert.match(source, /credential|authorization/i);
  assert.match(source, /raw|body|prompt/i);
});

test("video observer persists bounded unknown outcome after post-chat failure", () => {
  assert.match(source, /OUTCOME_UNKNOWN/);
  assert.match(source, /chat_present/);
  assert.match(source, /dispatch_accepted/);
  assert.match(source, /chat_uuid:\s*safeObservationId\(chatUuid\)/u);
  assert.match(source, /message_id:/u);
  assert.match(source, /safeObservationId/u);
  assert.match(source, /writeUnknownObservation/);
  assert.match(source, /catch\(\(\) => undefined\)/);
  assert.doesNotMatch(source, /writeUnknownObservation\(model/u);
  assert.doesNotMatch(source, /unknown[\s\S]{0,400}requestedPrompt/);
  assert.doesNotMatch(source, /unknown[\s\S]{0,400}settings/);
  assert.doesNotMatch(source, /unknown[\s\S]{0,400}envelope/);
});
