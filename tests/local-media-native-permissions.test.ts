import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, open, readFile, rm, chmod, stat, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertLocalMediaWindowsAcl, assertLocalMediaWindowsFiles, prepareLocalMediaWindowsDirectory, localMediaTempRoot,
  type LocalMediaNativeAclSnapshot } from "../src/application/local-media-native-permissions.js";

const USER = "S-1-5-21-111-222-333-1001", ADMIN = "S-1-5-32-544", SYSTEM = "S-1-5-18", FOREIGN = "S-1-1-0";
const rule = (sid = USER, rights = 2032127, inherit_only = false) => ({ sid, rights, allow: true, inherit_only });
const descriptor = (changes: Partial<LocalMediaNativeAclSnapshot> = {}): LocalMediaNativeAclSnapshot => ({ current_sid: USER,
  owner_sid: USER, protected_dacl: true, null_dacl: false, access: [rule(), rule(ADMIN), rule(SYSTEM)], ...changes });

test("native media DACL policy accepts current user System Admin and Windows default admin ownership", () => {
  for (const owner_sid of [USER, ADMIN, SYSTEM]) for (const kind of ["directory", "file", "executable"] as const)
    assert.doesNotThrow(() => assertLocalMediaWindowsAcl(descriptor({ owner_sid }), kind));
  assert.doesNotThrow(() => assertLocalMediaWindowsAcl(descriptor({ access: [rule(), rule(FOREIGN, 131209)] }), "executable"));
  assert.doesNotThrow(() => assertLocalMediaWindowsAcl(descriptor({ access: [rule(), rule(FOREIGN, 0x80000000)] }), "executable"));
  assert.doesNotThrow(() => assertLocalMediaWindowsAcl(descriptor({ access: [rule(), rule(FOREIGN, 2032127, true)] }), "directory"));
});

test("native media DACL policy rejects null permissions foreign writes private readers and missing current rights", () => {
  for (const kind of ["directory", "file", "executable"] as const) {
    assert.throws(() => assertLocalMediaWindowsAcl(descriptor({ null_dacl: true }), kind), /LOCAL_MEDIA_NATIVE_PERMISSIONS_UNVERIFIED/u);
    assert.throws(() => assertLocalMediaWindowsAcl(descriptor({ owner_sid: FOREIGN }), kind));
    for (const rights of [2, 4, 16, 64, 256, 65536, 262144, 524288, 0x10000000, 0x40000000])
      assert.throws(() => assertLocalMediaWindowsAcl(descriptor({ access: [rule(), rule(FOREIGN, rights)] }), kind));
  }
  for (const kind of ["directory", "file"] as const) {
    assert.throws(() => assertLocalMediaWindowsAcl(descriptor({ access: [rule(), rule(FOREIGN, 1)] }), kind));
    assert.throws(() => assertLocalMediaWindowsAcl(descriptor({ access: [rule(ADMIN)] }), kind));
  }
  assert.throws(() => assertLocalMediaWindowsAcl(descriptor({ protected_dacl: false }), "directory"));
  assert.throws(() => assertLocalMediaWindowsAcl(descriptor({ access: [rule(USER, NaN)] }), "file"));
});

test("native media permissions protect only a new Unicode temp directory and validate its child with actual OS semantics", async t => {
  const root = await localMediaTempRoot();
  t.diagnostic(JSON.stringify({ platform: process.platform, inputTmpAlreadyCanonical: tmpdir() === await realpath(tmpdir()), creationRootCanonical: root === await realpath(root) }));
  const directory = await mkdtemp(join(root, "syntx-native-permissions проба 🎞 "));
  const path = join(directory, "private media данные.bin"), bytes = Buffer.from("synthetic private local media");
  try {
    await chmod(directory, 0o700);
    await prepareLocalMediaWindowsDirectory(directory, [process.env.SYNTX_MEDIA_FFPROBE_PATH ?? process.execPath]);
    const file = await open(path, "wx", 0o600);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    await assertLocalMediaWindowsFiles([path]);
    assert.deepEqual(await readFile(path), bytes);
    if (process.platform === "win32") {
      // Deliberately weaken only this synthetic child, never a user file or codec.
      const program = `$ErrorActionPreference='Stop';$p=$env:SYNTX_PERMISSION_FIXTURE;$acl=[System.IO.File]::GetAccessControl($p);` +
        `$sid=[System.Security.Principal.SecurityIdentifier]::new('S-1-1-0');` +
        `$acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($sid,[System.Security.AccessControl.FileSystemRights]::ReadData,[System.Security.AccessControl.AccessControlType]::Allow));` +
        `[System.IO.File]::SetAccessControl($p,$acl)`;
      await promisify(execFile)(join(process.env.SystemRoot!, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
        ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(program, "utf16le").toString("base64")], {
          timeout: 30000, maxBuffer: 8192, windowsHide: true, shell: false,
          env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH ?? "", SYNTX_PERMISSION_FIXTURE: path }
        });
      await assert.rejects(assertLocalMediaWindowsFiles([path]), /LOCAL_MEDIA_NATIVE_PERMISSIONS_UNVERIFIED/u);
    }
    if (process.platform !== "win32") { assert.equal((await stat(directory)).mode & 0o777, 0o700); assert.equal((await stat(path)).mode & 0o777, 0o600); }
  } finally { bytes.fill(0); await rm(directory, { recursive: true, force: true }); }
});
