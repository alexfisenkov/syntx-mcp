import test from "node:test";
import assert from "node:assert/strict";
import { join, win32, posix } from "node:path";
import { createOwnerHeygen4AudioProbe } from "../src/application/owner-heygen4-media-policy.js";
import { OwnerHeygen4ReferenceService } from "../src/application/owner-heygen4-reference-service.js";
import { createOwnerHeygen4Runtime } from "../src/runtime/owner-heygen4-runtime.js";

const binary = process.env.SYNTX_HEYGEN4_TEST_FFPROBE ?? (process.platform === "win32" ? "C:\\Program Files\\FFmpeg\\ffprobe.exe" : "/trusted tools/ffprobe");
const binding = { tenant_id: "path-fixture", subject: "path-owner" };
const noCall = () => { throw new Error("NO_AUTH_OR_PROVIDER_CALL_ALLOWED"); };
test("HeyGen binary constructors accept the native OS absolute path with spaces without running ffprobe or provider calls", async () => {
  assert.equal(win32.isAbsolute("C:\\Program Files\\FFmpeg\\ffprobe.exe"), true);
  assert.equal(posix.isAbsolute("/trusted tools/ffprobe"), true);
  assert.ok(createOwnerHeygen4AudioProbe(binary));
  const references = new OwnerHeygen4ReferenceService({ binding, linkService: { getStatus: noCall }, resolveClient: noCall, ffprobePath: binary });
  const runtime = createOwnerHeygen4Runtime({ binding, linkService: { getStatus: noCall }, createReadClient: noCall, createChatClient: noCall,
    ffprobePath: binary, now: () => 1000, catalogDirectory: join(process.cwd(), "catalog") });
  await references.close(); await runtime.lifecycle.close();
});
test("HeyGen native binary guards reject relative paths, surrounding whitespace and NUL before any work", () => {
  for (const ffprobePath of ["ffprobe", "", ` ${binary}`, `${binary} `, `${binary}\0`]) {
    assert.throws(() => createOwnerHeygen4AudioProbe(ffprobePath));
    assert.throws(() => new OwnerHeygen4ReferenceService({ binding, linkService: { getStatus: noCall }, resolveClient: noCall, ffprobePath }));
    assert.throws(() => createOwnerHeygen4Runtime({ binding, linkService: { getStatus: noCall }, createReadClient: noCall, createChatClient: noCall, ffprobePath, now: () => 1000 }));
  }
});
