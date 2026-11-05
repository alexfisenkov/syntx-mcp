import assert from "node:assert/strict";
import { isAbsolute, join } from "node:path";
import test from "node:test";
import { readOwnerSwitchxVideoOperatorConfiguration } from "../src/runtime/owner-switchx-video-stdio-config.js";

test("Switchx optional ffmpeg is an operator-configured absolute path", () => {
  const probe = join(process.cwd(), "ffprobe"), ffmpeg = join(process.cwd(), "ffmpeg");
  assert.equal(isAbsolute(ffmpeg), true);
  assert.deepEqual(readOwnerSwitchxVideoOperatorConfiguration(true, "uploaded", probe), {uploadDestination:"uploaded",ffprobePath:probe});
  assert.deepEqual(readOwnerSwitchxVideoOperatorConfiguration(true, "hidden", probe, ffmpeg), {uploadDestination:"hidden",ffprobePath:probe,ffmpegPath:ffmpeg});
  assert.throws(() => readOwnerSwitchxVideoOperatorConfiguration(true, "uploaded", probe, "relative-ffmpeg"));
  assert.equal(readOwnerSwitchxVideoOperatorConfiguration(false, null, null, "invalid"), undefined);
});
