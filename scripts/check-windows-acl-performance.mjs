#!/usr/bin/env node
// CI-only diagnostic with pinned historical R5 baseline; no production flags, arbitrary commands or ACL mutation.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { lstat, realpath, readdir } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';
import { performance } from 'node:perf_hooks';
const execute = promisify(execFile);
const PROGRAM = "\n$ErrorActionPreference = 'Stop'\n$ProgressPreference = 'SilentlyContinue'\n$script:nativePhase = 'IDENTITY'\ntry {\n$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User\n$script:nativePhase = 'INPUT_PATHS'\n$decoded = ConvertFrom-Json -InputObject $env:SYNTX_LOCAL_MEDIA_ACL_PATHS\n$paths = @($decoded | ForEach-Object { if ($_ -isnot [string]) { throw 'INPUT_PATH_KIND' }; $_ })\nif ($paths.Count -lt 1 -or $paths.Count -gt 8) { throw 'INPUT_PATH_COUNT' }\n$action = $env:SYNTX_LOCAL_MEDIA_ACL_ACTION\n$path = $paths[0]\nfunction Read-Descriptor($target) {\n  $script:nativePhase = 'DESCRIPTOR_ATTRIBUTES'\n  $attributes = [System.IO.File]::GetAttributes($target)\n  if (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'REPARSE_POINT' }\n  $script:nativePhase = 'DESCRIPTOR_ACL'\n  $acl = if (($attributes -band [System.IO.FileAttributes]::Directory) -ne 0) { [System.IO.Directory]::GetAccessControl($target) } else { [System.IO.File]::GetAccessControl($target) }\n  $raw = [System.Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorBinaryForm(), 0)\n  $rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object {\n    @{ sid=$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value;\n       allow=($_.AccessControlType -eq 'Allow'); rights=[uint32]([int64]$_.FileSystemRights -band 4294967295);\n       inherit_only=(($_.PropagationFlags -band [System.Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0) }\n  })\n  return @{ current_sid=$user.Value; owner_sid=$acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value;\n    null_dacl=($null -eq $raw.DiscretionaryAcl); protected_dacl=$acl.AreAccessRulesProtected; access=$rules }\n}\nif ($action -eq 'PREPARE_DIRECTORY') {\n  $script:nativePhase = 'DIRECTORY_ATTRIBUTES'\n  $attributes = [System.IO.File]::GetAttributes($path)\n  if (($attributes -band [System.IO.FileAttributes]::Directory) -eq 0 -or ($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'NOT_PRIVATE_DIRECTORY' }\n  $script:nativePhase = 'DIRECTORY_OWNER'\n  $acl = [System.IO.Directory]::GetAccessControl($path)\n  if (@($user.Value, 'S-1-5-18', 'S-1-5-32-544') -notcontains $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value) { throw 'NOT_DIRECTORY_OWNER' }\n  $script:nativePhase = 'DIRECTORY_PROTECTION'\n  $acl.SetAccessRuleProtection($true, $false)\n  foreach ($rule in @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))) { [void]$acl.RemoveAccessRuleSpecific($rule) }\n  foreach ($value in @($user.Value, 'S-1-5-18', 'S-1-5-32-544')) {\n    $principal = [System.Security.Principal.SecurityIdentifier]::new($value)\n    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($principal,\n      [System.Security.AccessControl.FileSystemRights]::FullControl,\n      ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit),\n      [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)\n    $acl.AddAccessRule($rule)\n  }\n  [System.IO.Directory]::SetAccessControl($path, $acl)\n} elseif ($action -ne 'READ') { throw 'INVALID_ACTION' }\n@{ descriptors=@($paths | ForEach-Object { Read-Descriptor $_ }) } | ConvertTo-Json -Depth 6 -Compress\n} catch {\n  [Console]::Error.WriteLine('LOCAL_MEDIA_NATIVE_PHASE=' + $script:nativePhase)\n  exit 1\n}\n";
const PROGRAM_SHA256 = "603722b75442b2bbf49a7bcfc7d546e20527bbe93ec9df0afd74150588dd7b9a";

const UTILITY_IMPORT = "$script:nativePhase = 'BUILTIN_UTILITY_IMPORT'\nImport-Module -Name ([System.IO.Path]::Combine($PSHOME, 'Modules\\Microsoft.PowerShell.Utility\\Microsoft.PowerShell.Utility.psd1')) -ErrorAction Stop\n$script:nativePhase = 'INPUT_PATHS'\n";
const SID = /^S-1-(?:[0-9]+-)*[0-9]+$/u;
const WRITE = 2|4|16|64|256|65536|262144|524288|0x10000000|0x40000000;
function validateReadResult(stdout) {
  const parsed = JSON.parse(stdout);
  if (!parsed || !Array.isArray(parsed.descriptors) || parsed.descriptors.length !== 1) throw Error('BOUND_ARRAY');
  const item = parsed.descriptors[0];
  if (!item || !SID.test(item.current_sid) || !SID.test(item.owner_sid) || item.null_dacl !== false ||
    typeof item.protected_dacl !== 'boolean' || !Array.isArray(item.access) || item.access.length > 128) throw Error('DESCRIPTOR_SHAPE');
  const allowed = new Set([item.current_sid, 'S-1-5-18', 'S-1-5-32-544']);
  if (!allowed.has(item.owner_sid)) throw Error('ACL_OWNER');
  for (const rule of item.access) {
    if (!rule || !SID.test(rule.sid) || typeof rule.allow !== 'boolean' || typeof rule.inherit_only !== 'boolean' ||
      !Number.isSafeInteger(rule.rights) || rule.rights < 0 || rule.rights > 0xffffffff) throw Error('ACL_RULE');
    if (rule.allow && !rule.inherit_only && !allowed.has(rule.sid) && (rule.rights & WRITE) !== 0) throw Error('ACL_FOREIGN_WRITE');
  }
  return item.current_sid; // transient comparison only; never output identity.
}
function nativePhase(error) {
  const stderr = typeof error?.stderr === 'string' ? error.stderr : '';
  return /^LOCAL_MEDIA_NATIVE_PHASE=([A-Z_]{1,64})\s*$/mu.exec(stderr)?.[1] ?? null;
}
function progressBytes(stderr) {
  return [...stderr.matchAll(/<Obj\b[^>]*S="progress"[^>]*>[\s\S]*?<\/Obj>/gu)]
    .reduce((sum, match) => sum + Buffer.byteLength(match[0]), 0);
}
function safeCode(error) {
  const internal = ['BOUND_ARRAY','DESCRIPTOR_SHAPE','ACL_OWNER','ACL_RULE','ACL_FOREIGN_WRITE','IDENTITY_CHANGED','CODEC_IDENTITY_CHANGED'];
  if (typeof error?.message === 'string' && internal.includes(error.message)) return error.message;
  if (Number.isInteger(error?.code) && Math.abs(error.code) <= 255) return `EXIT_${Math.abs(error.code)}`;
  return ['ENOENT','EACCES','EPERM','ABORT_ERR','ETIMEDOUT','ERR_CHILD_PROCESS_STDIO_MAXBUFFER'].includes(error?.code) ? error.code : 'FAILED';
}
async function directory(value) {
  if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0')) return null;
  try { const path = await realpath(value); return (await lstat(path)).isDirectory() ? path : null; } catch { return null; }
}
async function standardCacheSnapshot(localAppData) {
  if (!localAppData) return { available: false, exists: false };
  try {
    const entries = await readdir(join(localAppData, 'Microsoft', 'Windows', 'PowerShell'));
    return { available: true, exists: entries.some(name => /^ModuleAnalysisCache(?:-|$)/u.test(name)) };
  } catch (error) { return { available: error?.code === 'ENOENT', exists: false }; }
}
async function main() {
  const actualProgramHash = createHash('sha256').update(PROGRAM).digest('hex');
  if (actualProgramHash !== PROGRAM_SHA256) throw Error('PROGRAM_HASH_MISMATCH');
  if (process.platform !== 'win32') { console.log(JSON.stringify({ status: 'NOT_EXECUTED_NON_WINDOWS', probes: [] })); return; }
  if (process.argv.length !== 2) throw Error('NO_ARGUMENTS_ALLOWED');
  const systemRoot = await directory(process.env.SystemRoot);
  if (!systemRoot) throw Error('SYSTEMROOT_UNAVAILABLE');
  const supplied = process.env.SYNTX_MEDIA_FFPROBE_PATH;
  if (!supplied || !isAbsolute(supplied) || supplied.includes('\0')) throw Error('KNOWN_FFPROBE_REQUIRED');
  const exe = await realpath(supplied), info = await lstat(exe, { bigint: true });
  if (!info.isFile() || info.isSymbolicLink() || !/^ffprobe\.exe$/iu.test(basename(exe))) throw Error('KNOWN_FFPROBE_REQUIRED');
  const powershell = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const baseEnv = { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH ?? '',
    SYNTX_LOCAL_MEDIA_ACL_PATHS: JSON.stringify([exe]), SYNTX_LOCAL_MEDIA_ACL_ACTION: 'READ' };
  const profiles = {};
  for (const key of ['LOCALAPPDATA','APPDATA','USERPROFILE','TEMP','TMP']) profiles[key] = await directory(process.env[key]);
  const profileAvailable = Object.values(profiles).every(value => value !== null);
  const builtinModules = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules');
  const imported = PROGRAM.replace('$decoded = ConvertFrom-Json', UTILITY_IMPORT + '$decoded = ConvertFrom-Json');
  if (imported === PROGRAM || !PROGRAM.includes("$action -eq 'PREPARE_DIRECTORY'")) throw Error('PROGRAM_SNAPSHOT_MISMATCH');
  const variants = [
    { name: 'R5_BASELINE_CLOSED_ENV', program: PROGRAM, env: baseEnv, available: true },
    { name: 'ABSOLUTE_BUILTIN_UTILITY_IMPORT', program: imported, env: baseEnv, available: true },
    { name: 'STANDARD_PROFILE_CACHE_BUILTIN_MODULES', program: PROGRAM,
      env: { ...baseEnv, ...profiles, PSModulePath: builtinModules }, available: profileAvailable }
  ];
  const probes = []; let identity;
  for (const variant of variants) {
    if (!variant.available) { probes.push({ variant: variant.name, status: 'STANDARD_ENV_UNAVAILABLE', elapsed_ms: 0 }); continue; }
    const before = await standardCacheSnapshot(profiles.LOCALAPPDATA);
    const start = performance.now(); let stdout = '', stderr = '', result;
    try {
      // Action is statically READ for all variants. Directory/exe ACL is never changed.
      const output = await execute(powershell, ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',
        Buffer.from(variant.program, 'utf16le').toString('base64')], {
          encoding: 'utf8', timeout: 30000, maxBuffer: 64 * 1024, windowsHide: true, shell: false, env: variant.env
        });
      stdout = output.stdout; stderr = output.stderr;
      const current = validateReadResult(stdout);
      if (identity !== undefined && identity !== current) throw Error('IDENTITY_CHANGED');
      identity = current;
      const after = await lstat(exe, { bigint: true });
      if (after.dev !== info.dev || after.ino !== info.ino || await realpath(exe) !== exe) throw Error('CODEC_IDENTITY_CHANGED');
      result = { status: 'PASS_BOUND_READ_ACL', bound_descriptor_count: 1, same_current_user: true };
    } catch (error) {
      stderr = typeof error?.stderr === 'string' ? error.stderr : stderr;
      result = { status: 'FAILED', safe_code: safeCode(error), timed_out: error?.killed === true && error?.signal === 'SIGTERM', native_phase: nativePhase(error) };
    }
    const elapsed = performance.now() - start;
    const afterCache = await standardCacheSnapshot(profiles.LOCALAPPDATA);
    probes.push({ variant: variant.name, ...result, elapsed_ms: Math.round(elapsed), stderr_bytes: Buffer.byteLength(stderr),
      progress_bytes: progressBytes(stderr), cache_check_available: before.available && afterCache.available,
      standard_cache_exists_before: before.exists, standard_cache_exists_after: afterCache.exists });
    stdout = ''; stderr = '';
  }
  console.log(JSON.stringify({ status: probes.every(probe => probe.status === 'PASS_BOUND_READ_ACL') ? 'PASS_DIAGNOSTIC' : 'DIAGNOSTIC_INCOMPLETE_OR_FAILED',
    platform: 'win32', readonly_acl: true, fixed_program_sha256: actualProgramHash, probe_timeout_ms: 30000, maximum_probe_count: 3,
    cache_check: 'STANDARD_HOST_CACHE_IMMEDIATE_PROCESS_CLOSE_ONLY_NOT_PROOF_OF_CHILD_CACHE_USE', probes }));
  if (probes.some(probe => probe.status !== 'PASS_BOUND_READ_ACL')) process.exitCode = 1;
}
main().catch(() => { console.log(JSON.stringify({ status: 'DIAGNOSTIC_HOST_PRECONDITION_FAILED', probes: [] })); process.exitCode = 1; });
