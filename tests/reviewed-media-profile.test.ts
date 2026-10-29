import assert from "node:assert/strict";
import test from "node:test";
import {
  getReviewedMediaProfile,
  isReviewedMediaFlagEnabled,
  resolveReviewedMediaBinaryPath,
  REVIEWED_MEDIA_PROFILE_ENV
} from "../src/runtime/reviewed-media-profile.js";

test("all-supported profile enables curated media flags when unset", () => {
  const environment = { [REVIEWED_MEDIA_PROFILE_ENV]: "all-supported" };
  assert.equal(isReviewedMediaFlagEnabled("SYNTX_OWNER_GENERATE_VIDEO", undefined, environment), true);
  assert.equal(isReviewedMediaFlagEnabled("SYNTX_OWNER_KLING4", undefined, environment), true);
  assert.equal(isReviewedMediaFlagEnabled("SYNTX_OWNER_ACCOUNT_STATUS", undefined, environment), false);
});

test("explicit per-group 0 or 1 overrides the all-supported profile", () => {
  const environment = { [REVIEWED_MEDIA_PROFILE_ENV]: "all-supported" };
  assert.equal(isReviewedMediaFlagEnabled("SYNTX_OWNER_KLING4", "0", environment), false);
  assert.equal(isReviewedMediaFlagEnabled("SYNTX_OWNER_RUNWAY_I2V", "1", environment), true);
});

test("profile parsing is default-off and rejects unknown values", () => {
  assert.equal(getReviewedMediaProfile({}), "default");
  assert.equal(getReviewedMediaProfile({ [REVIEWED_MEDIA_PROFILE_ENV]: "all-supported" }), "all-supported");
  assert.throws(() => getReviewedMediaProfile({ [REVIEWED_MEDIA_PROFILE_ENV]: "future" }), /Invalid SYNTX_OWNER_MEDIA_PROFILE/u);
});

test("shared binary paths are fallbacks and preserve explicit family paths", () => {
  assert.equal(resolveReviewedMediaBinaryPath(undefined, "/tools/ffprobe"), "/tools/ffprobe");
  assert.equal(resolveReviewedMediaBinaryPath("/family/ffprobe", "/tools/ffprobe"), "/family/ffprobe");
  assert.equal(resolveReviewedMediaBinaryPath(undefined, undefined), undefined);
});
