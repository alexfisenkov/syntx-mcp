import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { readOwnerElevenLabsStsOperatorConfiguration } from "../src/transports/stdio-owner.js";

test("STS optional ffmpeg path is an absolute operator configuration", () => {
  const ffprobePath=join(process.cwd(),"ffprobe"), ffmpegPath=join(process.cwd(),"ffmpeg");
  assert.deepEqual(readOwnerElevenLabsStsOperatorConfiguration(true,ffprobePath,"uploaded"),{ffprobePath,destination:"uploaded"});
  assert.deepEqual(readOwnerElevenLabsStsOperatorConfiguration(true,ffprobePath,"hidden",ffmpegPath),{ffprobePath,destination:"hidden",ffmpegPath});
  assert.throws(()=>readOwnerElevenLabsStsOperatorConfiguration(true,ffprobePath,"uploaded","relative-ffmpeg"));
  assert.equal(readOwnerElevenLabsStsOperatorConfiguration(false,undefined,undefined,"relative-ffmpeg"),undefined);
});
