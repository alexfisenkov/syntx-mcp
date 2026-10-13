import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const scriptPath = "scripts/live-owner-wan-i2v-smoke.mjs";
const source = readFileSync(scriptPath, "utf8");

test("Wan i2v smoke requires exact owner confirmation", () => {
  for (const args of [[], ["--confirm-live-wan-i2v-smoke", "extra"], ["--wrong"]]) {
    const result = spawnSync(process.execPath, [scriptPath, ...args], { cwd: process.cwd(), encoding: "utf8", timeout: 5_000 });
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /--confirm-live-wan-i2v-smoke/);
  }
});

test("Wan i2v smoke is exact, bounded, and leaves post-upload chats alive", () => {
  assert.match(source, /uploadFileReferences/);
  assert.match(source, /startVideoWithInternalReferences/);
  assert.match(source, /model_type: "wan_26_i2v"/);
  assert.match(source, /aspect_ratio: "1:1"/);
  assert.match(source, /resolution: "720P"/);
  assert.match(source, /video_duration: 5/);
  assert.match(source, /prompt_extend: true/);
  assert.match(source, /shot_type: "single"/);
  assert.match(source, /audio_setting: "auto"/);
  assert.match(source, /native_audio: false/);
  assert.match(source, /POLL_WINDOW_MS = 180_000/);
  assert.match(source, /video\/mp4/);
  assert.match(source, /OUTCOME_UNKNOWN/);
  assert.doesNotMatch(source, /deleteChat\(/);
  assert.doesNotMatch(source, /console\.(log|error)/);
  assert.match(source, /syntx_unlink/);
});

test("Wan i2v smoke refuses non-darwin before any network work", () => {
  if (process.platform === "darwin") return;
  const result = spawnSync(process.execPath, [scriptPath, "--confirm-live-wan-i2v-smoke"], { cwd: process.cwd(), encoding: "utf8", timeout: 5_000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /safe stage platform/);
  assert.match(result.stdout, /"stage":"platform"/);
});
