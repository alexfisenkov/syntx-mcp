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
    typeof snapshot.protected_dacl !== "boolean" || !Array.isArray(snapshot.access) || snapshot.access.length > 128) rejected("ACL_DESCRIPTOR_SHAPE");
  const allowed = new Set([snapshot.current_sid, SYSTEM, ADMIN]);
  if (!allowed.has(snapshot.owner_sid)) rejected("ACL_OWNER");
  if (kind === "directory" && !snapshot.protected_dacl) rejected("ACL_DIRECTORY_NOT_PROTECTED");
  let currentReadWrite = false;
  for (const rule of snapshot.access) {
    if (!rule || typeof rule.sid !== "string" || !sid.test(rule.sid) || typeof rule.allow !== "boolean" ||
      typeof rule.inherit_only !== "boolean" || !Number.isSafeInteger(rule.rights) || rule.rights < 0 || rule.rights > 0xffffffff) rejected("ACL_RULE_SHAPE");
    if (!rule.allow || rule.inherit_only) continue;
    if (!allowed.has(rule.sid) && (kind === "executable" ? (rule.rights & WRITE_RIGHTS) !== 0 : (rule.rights & ~SYNCHRONIZE) !== 0)) rejected(kind === "executable" ? "ACL_FOREIGN_BINARY_WRITE" : "ACL_FOREIGN_PRIVATE_ACCESS");
    if (rule.sid === snapshot.current_sid && ((rule.rights & 3) === 3 || (rule.rights & 0x10000000) !== 0 ||
      (rule.rights & 0x80000000) !== 0 && (rule.rights & 0x40000000) !== 0)) currentReadWrite = true;
  }
  if (kind !== "executable" && !currentReadWrite) rejected("ACL_CURRENT_READ_WRITE_MISSING");
}

// Fixed program, no interpolated paths/commands. Only the newly minted probe
// directory is changed; codec permissions are inspected, never modified.
const PROGRAM = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$script:nativePhase = 'IDENTITY'
try {
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$script:nativePhase = 'INPUT_PATHS'
$script:nativePhase = 'BUILTIN_UTILITY_IMPORT'
Import-Module -Name ([System.IO.Path]::Combine($PSHOME, 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1')) -ErrorAction Stop
$script:nativePhase = 'INPUT_PATHS'
$decoded = ConvertFrom-Json -InputObject $env:SYNTX_LOCAL_MEDIA_ACL_PATHS
$paths = @($decoded | ForEach-Object { if ($_ -isnot [string]) { throw 'INPUT_PATH_KIND' }; $_ })
if ($paths.Count -lt 1 -or $paths.Count -gt 8) { throw 'INPUT_PATH_COUNT' }
$action = $env:SYNTX_LOCAL_MEDIA_ACL_ACTION
$path = $paths[0]
function Read-Descriptor($target) {
  $script:nativePhase = 'DESCRIPTOR_ATTRIBUTES'
  $attributes = [System.IO.File]::GetAttributes($target)
  if (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'REPARSE_POINT' }
  $script:nativePhase = 'DESCRIPTOR_ACL'
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
  $script:nativePhase = 'DIRECTORY_ATTRIBUTES'
  $attributes = [System.IO.File]::GetAttributes($path)
  if (($attributes -band [System.IO.FileAttributes]::Directory) -eq 0 -or ($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'NOT_PRIVATE_DIRECTORY' }
  $script:nativePhase = 'DIRECTORY_OWNER'
  $acl = [System.IO.Directory]::GetAccessControl($path)
  if (@($user.Value, 'S-1-5-18', 'S-1-5-32-544') -notcontains $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value) { throw 'NOT_DIRECTORY_OWNER' }
  $script:nativePhase = 'DIRECTORY_PROTECTION'
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
} catch {
  [Console]::Error.WriteLine('LOCAL_MEDIA_NATIVE_PHASE=' + $script:nativePhase)
  exit 1
}
`;

async function readDescriptors(paths: readonly string[], action: "READ" | "PREPARE_DIRECTORY", signal?: AbortSignal): Promise<readonly LocalMediaNativeAclSnapshot[]> {
  if (process.platform !== "win32" || paths.length < 1 || paths.length > 8 || paths.some(path => !isAbsolute(path) || path.includes("\0"))) rejected("PATH_ARGUMENTS");
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot || !isAbsolute(systemRoot) || systemRoot.includes("\0")) rejected("SYSTEMROOT");
  let phase = "PATHS";
  try {
    const identities = await Promise.all(paths.map(async (path, index) => {
      try {
        const stat = await lstat(path, { bigint: true });
        if (resolve(path) !== path) rejected(`PATH_RESOLVE_${index}`);
        const canonical = await realpath(path);
        if (canonical !== path) rejected(`PATH_REALPATH_${index}_${pathDifference(path, canonical)}`);
        if (stat.isSymbolicLink()) rejected(`PATH_SYMLINK_${index}`);
        if (action === "PREPARE_DIRECTORY" && index === 0 ? !stat.isDirectory() : !stat.isFile()) rejected(`PATH_KIND_${index}`);
        if (action === "READ" && stat.nlink !== 1n) rejected(`PATH_LINK_COUNT_${index}`);
        return { dev: stat.dev, ino: stat.ino };
      } catch (error) { if (error instanceof LocalMediaPermissionError) throw error; return rejected(`PATH_IO_${index}_${safeIoCode(error)}`); }
    }));
    phase = "NATIVE_ACL_PROCESS";
    const { stdout } = await execute(join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(PROGRAM, "utf16le").toString("base64")], {
        encoding: "utf8", timeout: 30000, maxBuffer: 64 * 1024, windowsHide: true, shell: false,
        ...(signal === undefined ? {} : { signal }),
        env: { SystemRoot: systemRoot, PATH: process.env.PATH ?? "", SYNTX_LOCAL_MEDIA_ACL_PATHS: JSON.stringify(paths), SYNTX_LOCAL_MEDIA_ACL_ACTION: action }
      });
    phase = "NATIVE_ACL_JSON";
    const parsed = JSON.parse(stdout) as { descriptors?: LocalMediaNativeAclSnapshot[] };
    if (!Array.isArray(parsed.descriptors) || parsed.descriptors.length !== paths.length) rejected("NATIVE_ACL_DESCRIPTOR_COUNT");
    phase = "PATH_AFTER_ACL";
    for (let index = 0; index < paths.length; index++) {
      const stat = await lstat(paths[index]!, { bigint: true });
      if (stat.isSymbolicLink() || stat.dev !== identities[index]!.dev || stat.ino !== identities[index]!.ino ||
        await realpath(paths[index]!) !== paths[index]) rejected(`PATH_IDENTITY_AFTER_ACL_${index}`);
    }
    return parsed.descriptors;
  } catch (error) { if (error instanceof LocalMediaPermissionError) throw error; return rejected(`${phase}_${safeIoCode(error)}${safeNativePhase(error)}`); }
}

/** Normalize only our own creation root. Caller-selected files still face strict canonical checks. */
export async function localMediaTempRoot(): Promise<string> { return realpath(tmpdir()); }

/** Only for a newly minted empty media directory. POSIX callers retain their existing chmod/stat contract. */
export async function prepareLocalMediaWindowsDirectory(directory: string, executables: readonly string[], signal?: AbortSignal): Promise<void> {
  if (process.platform !== "win32") return;
  const binaries = [...new Set(executables)];
  if (binaries.length === 0 || binaries.some(binary => !/\.exe$/iu.test(binary))) rejected("CODEC_EXTENSION");
  if (!basename(directory).startsWith("syntx-")) rejected("DIRECTORY_PREFIX");
  if (await realpath(dirname(directory)) !== await localMediaTempRoot()) rejected("DIRECTORY_PARENT");
  if ((await readdir(directory)).length !== 0) rejected("DIRECTORY_NOT_EMPTY");
  const descriptors = await readDescriptors([directory, ...binaries], "PREPARE_DIRECTORY", signal);
  assertLocalMediaWindowsAcl(descriptors[0]!, "directory");
  for (const descriptor of descriptors.slice(1)) assertLocalMediaWindowsAcl(descriptor, "executable");
}

/** Each child must have native private data/write permissions, not merely POSIX-looking mode bits. */
export async function assertLocalMediaWindowsFiles(paths: readonly string[], signal?: AbortSignal): Promise<void> {
  if (process.platform !== "win32") return;
  for (const descriptor of await readDescriptors([...new Set(paths)], "READ", signal)) assertLocalMediaWindowsAcl(descriptor, "file");
}
class LocalMediaPermissionError extends Error {
  constructor(phase: string) { super(`LOCAL_MEDIA_NATIVE_PERMISSIONS_UNVERIFIED:${phase}`); }
}
function rejected(phase: string): never { throw new LocalMediaPermissionError(phase); }
function safeIoCode(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  if (typeof code === "number" && Number.isSafeInteger(code) && Math.abs(code) <= 255) return `EXIT_${Math.abs(code)}`;
  return typeof code === "string" && ["ENOENT", "EACCES", "EPERM", "ABORT_ERR", "ETIMEDOUT", "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"].includes(code) ? code : "UNKNOWN";
}
function safeNativePhase(error: unknown): string {
  const stderr = error && typeof error === "object" && "stderr" in error ? error.stderr : undefined;
  const match = typeof stderr === "string" ? /^LOCAL_MEDIA_NATIVE_PHASE=([A-Z_]{1,64})\s*$/mu.exec(stderr) : null;
  return match ? `_${match[1]}` : "";
}
function pathDifference(input: string, canonical: string): string {
  if (input.toLowerCase() === canonical.toLowerCase()) return "CASE_ONLY";
  if (/(?:^|[\\/])[^\\/]*~[0-9]+(?:[\\/]|$)/u.test(input)) return "SHORT_NAME_INPUT";
  return "OTHER_ALIAS";
}
