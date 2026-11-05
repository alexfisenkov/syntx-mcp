import { execFile } from "node:child_process";
import { lstat, readdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const ADMIN = "S-1-5-32-544", SYSTEM = "S-1-5-18";
const WRITE_RIGHTS = 2 | 4 | 16 | 64 | 256 | 65536 | 262144 | 524288 | 0x10000000 | 0x40000000;
const SYNCHRONIZE = 1048576;
export interface LocalMediaNativeAclSnapshot {
  readonly current_sid: string;
  readonly owner_sid: string;
  readonly null_dacl: boolean;
  readonly protected_dacl: boolean;
  readonly access: readonly { readonly sid: string; readonly allow: boolean; readonly inherit_only: boolean; readonly rights: number }[];
}

/** Pure interpretation of a native descriptor, not an authority/permission receipt. */
export function assertLocalMediaWindowsAcl(snapshot: LocalMediaNativeAclSnapshot, kind: "executable" | "directory" | "file"): void {
  const sid = /^S-1-(?:[0-9]+-)*[0-9]+$/u;
  if (!snapshot || typeof snapshot.current_sid !== "string" || !sid.test(snapshot.current_sid) ||
    typeof snapshot.owner_sid !== "string" || !sid.test(snapshot.owner_sid) || snapshot.null_dacl !== false ||
    typeof snapshot.protected_dacl !== "boolean" || !Array.isArray(snapshot.access) || snapshot.access.length > 128) rejected();
  const allowed = new Set([snapshot.current_sid, SYSTEM, ADMIN]);
  if (!allowed.has(snapshot.owner_sid) || kind === "directory" && !snapshot.protected_dacl) rejected();
  let currentReadWrite = false;
  for (const rule of snapshot.access) {
    if (!rule || typeof rule.sid !== "string" || !sid.test(rule.sid) || typeof rule.allow !== "boolean" ||
      typeof rule.inherit_only !== "boolean" || !Number.isSafeInteger(rule.rights) || rule.rights < 0 || rule.rights > 0xffffffff) rejected();
    if (!rule.allow || rule.inherit_only) continue;
    if (!allowed.has(rule.sid) && (kind === "executable" ? (rule.rights & WRITE_RIGHTS) !== 0 : (rule.rights & ~SYNCHRONIZE) !== 0)) rejected();
    if (rule.sid === snapshot.current_sid && ((rule.rights & 3) === 3 || (rule.rights & 0x10000000) !== 0 ||
      (rule.rights & 0x80000000) !== 0 && (rule.rights & 0x40000000) !== 0)) currentReadWrite = true;
  }
  if (kind !== "executable" && !currentReadWrite) rejected();
}

// Fixed program, no interpolated paths/commands. Only the newly minted probe
// directory is changed; codec permissions are inspected, never modified.
const PROGRAM = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$paths = @($env:SYNTX_LOCAL_MEDIA_ACL_PATHS | ConvertFrom-Json)
$action = $env:SYNTX_LOCAL_MEDIA_ACL_ACTION
$path = $paths[0]
function Read-Descriptor($target) {
  $attributes = [System.IO.File]::GetAttributes($target)
  if (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'REPARSE_POINT' }
  $acl = if (($attributes -band [System.IO.FileAttributes]::Directory) -ne 0) { [System.IO.Directory]::GetAccessControl($target) } else { [System.IO.File]::GetAccessControl($target) }
  $raw = [System.Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorBinaryForm(), 0)
  $rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object {
    @{ sid=$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value;
       allow=($_.AccessControlType -eq 'Allow'); rights=[uint32]([int64]$_.FileSystemRights -band 4294967295);
       inherit_only=(($_.PropagationFlags -band [System.Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0) }
  })
  return @{ current_sid=$user.Value; owner_sid=$acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value;
    null_dacl=($null -eq $raw.DiscretionaryAcl); protected_dacl=$acl.AreAccessRulesProtected; access=$rules }
}
if ($action -eq 'PREPARE_DIRECTORY') {
  $attributes = [System.IO.File]::GetAttributes($path)
  if (($attributes -band [System.IO.FileAttributes]::Directory) -eq 0 -or ($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'NOT_PRIVATE_DIRECTORY' }
  $acl = [System.IO.Directory]::GetAccessControl($path)
  if (@($user.Value, 'S-1-5-18', 'S-1-5-32-544') -notcontains $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value) { throw 'NOT_DIRECTORY_OWNER' }
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($rule in @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))) { [void]$acl.RemoveAccessRuleSpecific($rule) }
  foreach ($value in @($user.Value, 'S-1-5-18', 'S-1-5-32-544')) {
    $principal = [System.Security.Principal.SecurityIdentifier]::new($value)
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($principal,
      [System.Security.AccessControl.FileSystemRights]::FullControl,
      ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit),
      [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
    $acl.AddAccessRule($rule)
  }
  [System.IO.Directory]::SetAccessControl($path, $acl)
} elseif ($action -ne 'READ') { throw 'INVALID_ACTION' }
@{ descriptors=@($paths | ForEach-Object { Read-Descriptor $_ }) } | ConvertTo-Json -Depth 6 -Compress
`;

async function readDescriptors(paths: readonly string[], action: "READ" | "PREPARE_DIRECTORY", signal?: AbortSignal): Promise<readonly LocalMediaNativeAclSnapshot[]> {
  if (process.platform !== "win32" || paths.length < 1 || paths.length > 8 || paths.some(path => !isAbsolute(path) || path.includes("\0"))) rejected();
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot || !isAbsolute(systemRoot) || systemRoot.includes("\0")) rejected();
  try {
    const identities = await Promise.all(paths.map(async (path, index) => {
      const stat = await lstat(path, { bigint: true });
      if (resolve(path) !== path || await realpath(path) !== path || stat.isSymbolicLink() ||
        (action === "PREPARE_DIRECTORY" && index === 0 ? !stat.isDirectory() : !stat.isFile() || action === "READ" && stat.nlink !== 1n)) rejected();
      return { dev: stat.dev, ino: stat.ino };
    }));
    const { stdout } = await execute(join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(PROGRAM, "utf16le").toString("base64")], {
        encoding: "utf8", timeout: 30000, maxBuffer: 64 * 1024, windowsHide: true, shell: false,
        ...(signal === undefined ? {} : { signal }),
        env: { SystemRoot: systemRoot, PATH: process.env.PATH ?? "", SYNTX_LOCAL_MEDIA_ACL_PATHS: JSON.stringify(paths), SYNTX_LOCAL_MEDIA_ACL_ACTION: action }
      });
    const parsed = JSON.parse(stdout) as { descriptors?: LocalMediaNativeAclSnapshot[] };
    if (!Array.isArray(parsed.descriptors) || parsed.descriptors.length !== paths.length) rejected();
    for (let index = 0; index < paths.length; index++) {
      const stat = await lstat(paths[index]!, { bigint: true });
      if (stat.isSymbolicLink() || stat.dev !== identities[index]!.dev || stat.ino !== identities[index]!.ino ||
        await realpath(paths[index]!) !== paths[index]) rejected();
    }
    return parsed.descriptors;
  } catch { return rejected(); }
}

/** Only for a newly minted empty media directory. POSIX callers retain their existing chmod/stat contract. */
export async function prepareLocalMediaWindowsDirectory(directory: string, executables: readonly string[], signal?: AbortSignal): Promise<void> {
  if (process.platform !== "win32") return;
  const binaries = [...new Set(executables)];
  if (binaries.length === 0 || binaries.some(binary => !/\.exe$/iu.test(binary))) rejected();
  if (!basename(directory).startsWith("syntx-") || await realpath(dirname(directory)) !== await realpath(tmpdir()) ||
    (await readdir(directory)).length !== 0) rejected();
  const descriptors = await readDescriptors([directory, ...binaries], "PREPARE_DIRECTORY", signal);
  assertLocalMediaWindowsAcl(descriptors[0]!, "directory");
  for (const descriptor of descriptors.slice(1)) assertLocalMediaWindowsAcl(descriptor, "executable");
}

/** Each child must have native private data/write permissions, not merely POSIX-looking mode bits. */
export async function assertLocalMediaWindowsFiles(paths: readonly string[], signal?: AbortSignal): Promise<void> {
  if (process.platform !== "win32") return;
  for (const descriptor of await readDescriptors([...new Set(paths)], "READ", signal)) assertLocalMediaWindowsAcl(descriptor, "file");
}
function rejected(): never { throw new Error("LOCAL_MEDIA_NATIVE_PERMISSIONS_UNVERIFIED"); }
