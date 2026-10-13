#!/usr/bin/env node

// CLI for Gate C1b's per-form generic result artifact
// (catalog/runtime/v4/<form_id>-generic-form-result.json). Unlike the
// Banana canary/source-backed CLIs, this one takes --form-id: the
// artifact is one file per form, not one file for the whole catalog.
//
// No exact-checkpoint pinning here (no EXPECTED_*_SHA256 constants): the
// generic toolchain (tools/settings-ir/generic-form-result-toolchain.ts)
// already does its own full census/catalog/inventory cross-validation
// internally (D-043) — duplicating that here as a second pinned checkpoint
// would be the same untestable "defense in depth" this project has
// rejected before (see generic-form-adapter-input-from-manifest.ts's own
// header).
//
// Network modes build a temporary, isolated tsc checkout
// (source-backed-result's pattern — see scripts/source-backed-result/build.mjs)
// rather than rebuilding the shared dist/ in place: buildImplementationComponentRecords()
// hash-binds whatever .js files it reads at that moment, and rebuilding
// dist/ in place is not exclusive against a concurrent `npm test`/`npm run
// build`/second sync in another terminal — a race there could hash a
// truncated mid-write file into a create-once, never-rewritable artifact
// with no error at all (critic-code BLOCK, Gate C1b step 6 round 1). The
// temp checkout closes that: nothing outside this one process's own
// mkdtemp directory can ever be mutated by this run.
//
// Four modes, matching source-backed-result's exactly:
//   --check                                   offline, reads dist/
//   --probe-source --confirm-source-fetch      network, no write
//   --check-source --confirm-source-fetch      network, re-verify existing
//   --sync-source --confirm-source-fetch       network, create-once write
// All four require --form-id <id> in addition.

import { execFile } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, open, readFile, rm, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { createLockSignalState, installLockSignalCleanup } from "./lock-signal-cleanup.mjs";

const execFileAsync = promisify(execFile);
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const sourceBuildParent = join(projectRoot, ".черновики");
const sourceBuildPrefix = join(sourceBuildParent, "c1b-generic-build-");

// DEBT-036 resolved by D-045 (docs/проект/решения.md): the derive layer
// (generic-form-adapter-input-from-manifest.ts) is now one of the 8 names
// in GENERIC_IMPLEMENTATION_COMPONENT_NAMES and hash-bound like the rest.
// This constant stays as the mechanical gate it was added as (critic-practice
// BLOCK, Gate C1b step 6 round 1) rather than being deleted outright — it
// costs nothing to keep, and a future DEBT-036-shaped gap (a new module
// that shapes the artifact but isn't hash-bound) would have the same fix
// shape: flip this back to false until resolved.
const DEBT_036_RESOLVED = true;

// A plain regex mirror of formIdSchema (src/catalog/normalized-settings-parser-generic-form-result.ts)
// — duplicated deliberately, not imported: importing the real schema would
// require dist/ to already be built, defeating the point of validating the
// id cheaply before paying for hasSourceCheckout/build/network. Kept in
// sync manually; both sides are exercised by
// tests/normalized-settings-parser-generic-form-result-cli.test.ts against
// the real schema's own rejections.
const FORM_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

const sourceCheckoutMarkers = [
  "tsconfig.json",
  "src/catalog/normalized-settings-parser-generic-form-result.ts",
  "src/catalog/normalized-settings-parser-generic-form-vocabulary.ts",
  "src/catalog/normalized-settings-parser-census-manifest.ts",
  "src/catalog/normalized-settings-parser-canary.ts",
  "src/catalog/settings-source-inventory.ts",
  "src/catalog/syntx-public-catalog.ts",
  "tools/settings-ir/generic-form-result-toolchain.ts",
  "tools/settings-ir/generic-form-adapter-input-from-manifest.ts",
  "tools/settings-ir/build-generic-form-parser-canary.ts",
  "tools/settings-ir/pinned-settings-source-loader.ts",
  "tools/settings-ir/static-settings-compiler.ts",
  "tools/settings-ir/immutable-json-snapshot.ts",
  "node_modules/typescript/bin/tsc",
  "node_modules/typescript/lib/typescript.js"
].map((path) => join(projectRoot, path));

// Relative to a build output root — dist/ for the offline --check path,
// or a temporary tsc --outDir for network modes (see buildTemporaryCheckout
// below). Kept as one list of pure relative paths, not two independently
// hand-maintained absolute lists, so the two build outputs are always
// checked for the exact same files.
const compiledSourceModeRelativePaths = [
  "src/catalog/normalized-settings-parser-generic-form-result.js",
  "src/catalog/normalized-settings-parser-generic-form-vocabulary.js",
  "src/catalog/normalized-settings-parser-census-manifest.js",
  "src/catalog/normalized-settings-parser-canary.js",
  "src/catalog/settings-source-inventory.js",
  "src/catalog/syntx-public-catalog.js",
  "tools/settings-ir/generic-form-result-toolchain.js",
  "tools/settings-ir/generic-form-adapter-input-from-manifest.js",
  "tools/settings-ir/build-generic-form-parser-canary.js",
  "tools/settings-ir/pinned-settings-source-loader.js",
  "tools/settings-ir/static-settings-compiler.js",
  "tools/settings-ir/immutable-json-snapshot.js"
];
const compiledSourceModePaths = compiledSourceModeRelativePaths.map((path) =>
  join(projectRoot, "dist", path)
);

const SAFE_RESULT_ERROR_CODES = new Set([
  "GENERIC_FORM_RESULT_DRIFT_DETECTED",
  "GENERIC_FORM_RESULT_INVALID",
  "GENERIC_FORM_RESULT_NOT_FOUND",
  "GENERIC_FORM_ID_INVALID"
]);
const SAFE_TOOLCHAIN_ERROR_CODES = new Set([
  "GENERIC_TOOLCHAIN_INVALID_INPUT_SHAPE",
  "GENERIC_TOOLCHAIN_SOURCE_FETCH_NOT_CONFIRMED",
  "GENERIC_TOOLCHAIN_AUXILIARY_REFS_NOT_SUPPORTED",
  "GENERIC_TOOLCHAIN_CENSUS_MANIFEST_MISMATCH",
  "GENERIC_TOOLCHAIN_FETCHED_SOURCE_MISMATCH",
  "GENERIC_TOOLCHAIN_RESULT_INVALID",
  "GENERIC_TOOLCHAIN_READ_FAILED"
]);
const SAFE_IMMUTABLE_ERROR_CODES = new Set([
  "IMMUTABLE_SNAPSHOT_REQUEST_INVALID",
  "IMMUTABLE_SNAPSHOT_CONTENT_TOO_LARGE",
  "IMMUTABLE_SNAPSHOT_TEMPORARY_COLLISION",
  "IMMUTABLE_SNAPSHOT_TARGET_EXISTS",
  "IMMUTABLE_SNAPSHOT_CLEANUP_FAILED",
  "IMMUTABLE_SNAPSHOT_WRITE_FAILED"
]);
// The derive layer's own error codes (generic-form-adapter-input-from-manifest.ts)
// reported verbatim instead of falling through to the generic
// PINNED_SOURCE_VERIFICATION_FAILED class-name mapping below — round 1
// critic-practice found that fallback misleading specifically for
// FORM_NOT_FOUND: it reads as "the pinned source disagreed", not "this
// form_id is not in the census at all", and could send an operator
// investigating vendor drift that was never there over a plain typo.
const SAFE_DERIVE_ERROR_CODES = new Set([
  "CENSUS_MANIFEST_INVALID",
  "FORM_NOT_FOUND",
  "FORM_HAS_NO_MODELS",
  "ROOT_SOURCE_IDENTITY_MISSING"
]);

export class GenericFormResultCliError extends Error {
  // detail is optional and, today, only ever set to a fixed, public,
  // in-repo lock path (GENERIC_RESULT_LOCKED) — not a general free-text
  // channel that could leak more than a safe code was meant to (DEBT-015).
  constructor(code, detail) {
    super("SYNTX generic form result CLI request was rejected.");
    this.name = "GenericFormResultCliError";
    this.code = code;
    this.detail = detail;
  }
}

const CONFIRM_SOURCE_FETCH_FLAG = "--confirm-source-fetch";
const FORM_ID_FLAG = "--form-id";
const NETWORK_MODE_FLAGS = new Map([
  ["--probe-source", "probe-source"],
  ["--check-source", "check-source"],
  ["--sync-source", "sync-source"]
]);

export function parseArguments(argumentList) {
  const formIdIndex = argumentList.indexOf(FORM_ID_FLAG);
  if (formIdIndex === -1 || formIdIndex + 1 >= argumentList.length) {
    throw new GenericFormResultCliError("INVALID_ARGUMENT");
  }
  const formId = argumentList[formIdIndex + 1];
  if (typeof formId !== "string" || formId.length === 0) {
    throw new GenericFormResultCliError("INVALID_ARGUMENT");
  }
  const rest = [
    ...argumentList.slice(0, formIdIndex),
    ...argumentList.slice(formIdIndex + 2)
  ];
  if (rest.length === 1 && rest[0] === "--check") {
    return { mode: "check", formId };
  }
  if (rest.length === 2 && rest[1] === CONFIRM_SOURCE_FETCH_FLAG) {
    const mode = NETWORK_MODE_FLAGS.get(rest[0]);
    if (mode !== undefined) return { mode, formId };
  }
  throw new GenericFormResultCliError("INVALID_ARGUMENT");
}

export function hasSourceCheckout() {
  return sourceCheckoutMarkers.every((path) => existsSync(path));
}

// The real per-form target path, computed directly from projectRoot rather
// than via findGenericFormResultPath() (src/catalog/normalized-settings-parser-generic-form-result.ts).
// That resolver works out its own module's directory relative to
// import.meta.url — correct when loaded from dist/ (offline --check) or
// from src/ directly, but WRONG when loaded from this script's temporary
// tsc checkout (a differently-shaped tree under .черновики/): it would
// resolve one or two levels into the wrong place. Network modes below
// always use this function for existence checks and the lock/target path,
// and pass it explicitly as `path` to loadNormalizedSettingsParserGenericFormResult
// rather than letting that function re-derive it from a temp-checkout
// module instance.
function computeTargetPath(formId) {
  return join(projectRoot, "catalog/runtime/v4", `${formId}-generic-form-result.json`);
}

async function buildTemporaryCheckout(temporaryDirectory) {
  try {
    await execFileAsync(
      process.execPath,
      [
        join(projectRoot, "node_modules/typescript/bin/tsc"),
        "-p",
        join(projectRoot, "tsconfig.json"),
        "--outDir",
        temporaryDirectory
      ],
      {
        cwd: projectRoot,
        encoding: "utf8",
        maxBuffer: 2 * 1024 * 1024,
        timeout: 120_000
      }
    );
  } catch {
    throw new GenericFormResultCliError("SOURCE_BUILD_FAILED");
  }
  if (
    !compiledSourceModeRelativePaths.every((path) =>
      existsSync(join(temporaryDirectory, path))
    )
  ) {
    throw new GenericFormResultCliError("SOURCE_BUILD_FAILED");
  }
}

async function loadResultModule() {
  return import("../dist/src/catalog/normalized-settings-parser-generic-form-result.js");
}

// Fixed, well-known paths — same ones scripts/source-backed-result/paths.mjs
// uses for the same three inputs. Needed because the DEFAULT loaders
// (loadSyntxPublicCatalogSnapshot() with no path,
// loadSettingsSourceInventory() with no path,
// loadNormalizedSettingsParserCensusManifest() with no path) each resolve
// their own file relative to their OWN module's import.meta.url, assuming
// a fixed depth (either dist/<name>/ or plain src/<name>/) — a depth this
// script's isolated temp checkout does not match (it sits one level deeper,
// under .черновики/c1b-generic-build-<id>/). Confirmed by running this code,
// not by reading it: the first version of this fix (no explicit paths)
// failed every network mode with GENERIC_TOOLCHAIN_READ_FAILED before ever
// reaching the derive layer, because the toolchain's own default loaders
// threw inside its try/catch. Passing explicit paths — mirroring
// source-backed-result-toolchain's own established pattern — bypasses
// those fragile defaults entirely rather than trying to make the temp
// checkout coincidentally match their assumed depth.
const publicCatalogPath = join(projectRoot, "catalog/v1/official-public-api.json");
const inventoryPath = join(projectRoot, "catalog/runtime/v1/settings-source-inventory.json");
const censusPath = join(
  projectRoot,
  "catalog/runtime/v2/normalized-settings-parser-census-manifest.json"
);

async function loadNetworkModules(temporaryDirectory) {
  const moduleUrl = (path) => pathToFileURL(join(temporaryDirectory, path)).href;
  const [resultModule, toolchain, immutableSnapshot, publicCatalogModule, inventoryModule, censusModule] =
    await Promise.all([
      import(moduleUrl("src/catalog/normalized-settings-parser-generic-form-result.js")),
      import(moduleUrl("tools/settings-ir/generic-form-result-toolchain.js")),
      import(moduleUrl("tools/settings-ir/immutable-json-snapshot.js")),
      import(moduleUrl("src/catalog/syntx-public-catalog.js")),
      import(moduleUrl("src/catalog/settings-source-inventory.js")),
      import(moduleUrl("src/catalog/normalized-settings-parser-census-manifest.js"))
    ]);

  const publicCatalog = publicCatalogModule.loadSyntxPublicCatalogSnapshot(publicCatalogPath);
  const inventory = inventoryModule.loadSettingsSourceInventory(inventoryPath, publicCatalog);
  const censusManifest = censusModule.loadNormalizedSettingsParserCensusManifest({
    path: censusPath,
    publicCatalog,
    inventory
  });
  const censusArtifactText = await readFile(censusPath, "utf8");

  return {
    resultModule,
    toolchain,
    immutableSnapshot,
    publicCatalog,
    inventory,
    censusManifest,
    censusArtifactText
  };
}

function printSafeSummary(formId, status, verification, result) {
  process.stdout.write(
    [
      `Normalized settings generic form result (${formId}) ${status}.`,
      `verification=${verification}`,
      `completeness=${result.form.completeness}`,
      `proven=${result.result.summary.proven_projections}`,
      `absent=${result.result.summary.absent_proven_projections}`,
      `blocked=${result.result.summary.blocked_projections}`,
      `blocked_with_candidates=${result.result.summary.blocked_projections_with_static_candidates}`,
      `form_blockers=${result.result.summary.form_blockers}`,
      `models=${result.coverage.declared_models}/${result.coverage.c0_models}`,
      `sources=${result.coverage.verified_source_refs}/${result.coverage.c0_source_refs}`,
      `runtime_usable=${String(result.runtime_usable)}`
    ].join(" ") + "\n"
  );
}

function hasErrorCode(error, expectedCode) {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === expectedCode
  );
}

export function safeErrorCode(error) {
  if (error instanceof GenericFormResultCliError) return error.code;
  if (
    error !== null &&
    typeof error === "object" &&
    typeof error.code === "string"
  ) {
    if (SAFE_RESULT_ERROR_CODES.has(error.code)) return error.code;
    if (SAFE_TOOLCHAIN_ERROR_CODES.has(error.code)) return error.code;
    if (SAFE_IMMUTABLE_ERROR_CODES.has(error.code)) return error.code;
    if (
      error.name === "GenericFormAdapterManifestDeriveError" &&
      SAFE_DERIVE_ERROR_CODES.has(error.code)
    ) {
      return error.code;
    }
    if (
      error.name === "SettingsSourceInventoryError" ||
      error.name === "GenericFormParserCanaryCompilerError" ||
      error.name === "StaticSettingsCompilerError" ||
      error.name === "GenericFormAdapterManifestDeriveError" ||
      error.name === "NormalizedSettingsParserCensusManifestError"
    ) {
      return "PINNED_SOURCE_VERIFICATION_FAILED";
    }
  }
  return "UNEXPECTED_ERROR";
}

// Cooperative filesystem lock for --sync-source, parameterized by form_id
// (unlike source-backed-result.mjs's single fixed lockPath — this artifact
// is one file per form, so concurrent syncs for two different forms don't
// contend on the lock; each still builds its own isolated temp checkout,
// so they don't contend on dist/ either — see header). Mirrors
// scripts/source-backed-result/lock.mjs's acquire/release/cleanup-
// classification exactly, minus its __testOnly seam re-exports (this file
// is not split across modules, so tests import these directly).
export async function acquireSyncLock(lockPath, io = {}) {
  const pid = io.pid ?? process.pid;
  const now = io.now ?? (() => new Date());
  let handle;
  try {
    await mkdir(dirname(lockPath), { recursive: true });
    handle = await open(lockPath, "wx", 0o600);
    await handle.chmod(0o600);
    // DEBT-015: mirrors source-backed-result/lock.mjs's fix — an empty lock
    // file gives a stuck GENERIC_RESULT_LOCKED no way to tell a live run
    // from a crash leftover.
    await handle.writeFile(`${pid}\n${now().toISOString()}\n`, "utf8");
    return handle;
  } catch (error) {
    if (handle !== undefined) {
      let cleanupFailed = false;
      try {
        await handle.close();
      } catch {
        cleanupFailed = true;
      }
      try {
        await unlink(lockPath);
      } catch {
        cleanupFailed = true;
      }
      if (cleanupFailed) {
        throw new GenericFormResultCliError("GENERIC_RESULT_LOCK_CLEANUP_FAILED");
      }
    }
    if (hasErrorCode(error, "EEXIST")) {
      throw new GenericFormResultCliError("GENERIC_RESULT_LOCKED", lockPath);
    }
    throw new GenericFormResultCliError("GENERIC_RESULT_LOCK_FAILED");
  }
}

export async function releaseSyncLock(handle, lockPath, onReleased) {
  let closeFailed = false;
  try {
    await handle.close();
  } catch {
    closeFailed = true;
  }
  try {
    await unlink(lockPath);
    // Fired the instant the lock file is actually gone, not after this
    // function (or its caller finalizeSyncOperation) fully returns — round-2
    // critic-code found that clearing a signalState.lockPath reference only
    // after the whole finalize call returned left it dangling (pointing at
    // an already-removed file) on the code path where finalize succeeds at
    // releasing but then still rethrows the original operationError. A
    // signal landing in that window would either report a false cleanup
    // failure or, worse, unlink whatever a different, faster concurrent
    // process had since created at the same path.
    onReleased?.();
  } catch {
    throw new GenericFormResultCliError("GENERIC_RESULT_LOCK_CLEANUP_FAILED", lockPath);
  }
  if (closeFailed) {
    throw new GenericFormResultCliError("GENERIC_RESULT_LOCK_CLEANUP_FAILED", lockPath);
  }
}

export async function finalizeSyncOperation(
  lock,
  lockPath,
  operationError,
  targetCreated,
  release = releaseSyncLock,
  onReleased
) {
  let releaseFailed = false;
  try {
    await release(lock, lockPath, onReleased);
  } catch {
    releaseFailed = true;
  }
  if (hasErrorCode(operationError, "IMMUTABLE_SNAPSHOT_CLEANUP_FAILED")) {
    throw new GenericFormResultCliError(
      "GENERIC_RESULT_OUTCOME_UNKNOWN_RECONCILE_TARGET_AND_LOCK",
      lockPath
    );
  }
  if (releaseFailed) {
    throw new GenericFormResultCliError(
      targetCreated
        ? "GENERIC_RESULT_OUTCOME_UNKNOWN_RECONCILE_TARGET_AND_LOCK"
        : "GENERIC_RESULT_LOCK_CLEANUP_FAILED",
      lockPath
    );
  }
  if (operationError !== undefined) throw operationError;
}

async function runOfflineCheck(formId) {
  const resultModule = await loadResultModule();
  // Loaded BEFORE the raw readFile below (not after, unlike the
  // canary/source-backed CLIs' check mode) so a missing artifact surfaces
  // as the typed GENERIC_FORM_RESULT_NOT_FOUND this project added
  // specifically for this case (step 4, D-042), not a raw ENOENT that
  // safeErrorCode above cannot recognize.
  const recorded = resultModule.loadNormalizedSettingsParserGenericFormResult(formId);
  const targetPath = resultModule.findGenericFormResultPath(formId);
  const recordedText = await readFile(targetPath, "utf8");
  const canonicalText =
    resultModule.serializeNormalizedSettingsParserGenericFormResult(recorded);
  if (recordedText !== canonicalText) {
    throw new GenericFormResultCliError("GENERIC_FORM_RESULT_DRIFT_DETECTED");
  }
  printSafeSummary(formId, "unchanged", "OFFLINE", recorded);
}

async function runNetworkMode(mode, formId) {
  const targetPath = computeTargetPath(formId);

  // Every cheap, offline gate runs BEFORE the temporary checkout is built
  // (round 1 critic-code WARN: the first version paid for a full ~2-minute
  // tsc build before even checking these — a typo'd --form-id or a
  // probe/sync against an already-published artifact wasted a full rebuild
  // for nothing).
  if (mode === "probe-source" && existsSync(targetPath)) {
    throw new GenericFormResultCliError("GENERIC_RESULT_ALREADY_EXISTS");
  }
  if (mode === "check-source" && !existsSync(targetPath)) {
    throw new GenericFormResultCliError("GENERIC_RESULT_MISSING");
  }
  if (mode === "sync-source") {
    if (existsSync(targetPath)) {
      throw new GenericFormResultCliError("GENERIC_RESULT_ALREADY_EXISTS");
    }
    if (DEBT_036_RESOLVED !== true) {
      throw new GenericFormResultCliError("GENERIC_RESULT_DEBT_036_UNRESOLVED");
    }
  }

  // Installed before any lock/temp-directory work, for every network mode
  // (not just sync-source — probe-source and check-source also build a
  // temporary checkout below): a SIGINT/SIGTERM any time from here on now
  // cleans up exactly what THIS run itself created, tracked via signalState
  // as it happens, rather than leaving it behind for a human to find and
  // remove by hand (DEBT-015). Round-2 critic review (4 independent
  // critics converged) found the earlier prefix-sweep design unsafe here
  // specifically: this CLI's lock is per-form, so two different --form-id
  // syncs legitimately run at once, each with its own temp checkout — a
  // shared-prefix sweep would destroy a concurrent sync's live directory,
  // not just this run's own leftovers. signalState.lockPath is set below
  // only once this run's own acquireSyncLock() call actually succeeds —
  // never unconditionally (critic-risk: an earlier version could unlink a
  // DIFFERENT, live process's lock).
  const signalState = createLockSignalState();
  installLockSignalCleanup(signalState);

  let lock;
  let lockPath;
  if (mode === "sync-source") {
    lockPath = `${targetPath}.lock`;
    // Acquired before the temporary checkout build, not after: a second
    // concurrent sync for the SAME form now fails fast on the lock instead
    // of first paying for its own full build (round 1 critic-code WARN).
    lock = await acquireSyncLock(lockPath);
    signalState.lockPath = lockPath;
  }

  let temporaryDirectory;
  let operationError;
  let targetCreated = false;
  try {
    // Re-checked inside the try (not right after acquireSyncLock above):
    // round-2 critic-code found that a throw here, outside try, would skip
    // finalizeSyncOperation entirely and leak the lock on disk forever —
    // this mirrors source-backed-result's equivalent recheck, which was
    // already correctly placed inside its own try.
    if (mode === "sync-source" && existsSync(targetPath)) {
      throw new GenericFormResultCliError("GENERIC_RESULT_ALREADY_EXISTS");
    }
    await mkdir(sourceBuildParent, { recursive: true });
    temporaryDirectory = await mkdtemp(sourceBuildPrefix);
    signalState.temporaryDirectory = temporaryDirectory;
    await buildTemporaryCheckout(temporaryDirectory);
    const {
      resultModule,
      toolchain,
      immutableSnapshot,
      publicCatalog,
      inventory,
      censusManifest,
      censusArtifactText
    } = await loadNetworkModules(temporaryDirectory);

    let sourceObservedAt;
    let generatedAt;
    let recorded;
    let recordedText;
    if (mode === "check-source") {
      recorded = resultModule.loadNormalizedSettingsParserGenericFormResult(formId, {
        path: targetPath
      });
      recordedText = await readFile(targetPath, "utf8");
      sourceObservedAt = recorded.source_observed_at;
      generatedAt = recorded.generated_at;
    }

    // parseArguments() above already required --confirm-source-fetch for
    // every mode reaching this line; confirmedSourceFetch here is a second,
    // function-level gate inside the toolchain itself, not a redundant
    // duplicate (DEBT-019a precedent: an exported network-capable function
    // must not rely solely on a caller's argv gating to stay closed).
    // publicCatalog/inventory/censusManifest/censusArtifactText are passed
    // explicitly (see loadNetworkModules) rather than left for the
    // toolchain's own defaults to resolve — the toolchain's internal
    // cross-validation (D-043) still runs identically either way, this
    // only changes where the raw inputs come from.
    const candidate = await toolchain.buildGenericFormResultFromPinnedSource({
      formId,
      confirmedSourceFetch: true,
      publicCatalog,
      inventory,
      censusManifest,
      censusArtifactText,
      ...(sourceObservedAt === undefined ? {} : { sourceObservedAt }),
      ...(generatedAt === undefined ? {} : { generatedAt })
    });
    const candidateText =
      resultModule.serializeNormalizedSettingsParserGenericFormResult(candidate);

    if (mode === "check-source") {
      resultModule.assertNormalizedSettingsParserGenericFormResultUnchanged(
        recorded,
        candidate
      );
      if (recordedText !== candidateText) {
        throw new GenericFormResultCliError("GENERIC_FORM_RESULT_DRIFT_DETECTED");
      }
      printSafeSummary(formId, "unchanged", "PINNED_SOURCE", candidate);
    } else if (mode === "probe-source") {
      printSafeSummary(formId, "verified", "PINNED_SOURCE_PROBE", candidate);
    } else {
      if (existsSync(targetPath)) {
        throw new GenericFormResultCliError("GENERIC_RESULT_ALREADY_EXISTS");
      }
      await immutableSnapshot.createImmutableJsonSnapshot(targetPath, candidateText, {
        maxBytes: 4 * 1024 * 1024
      });
      targetCreated = true;
      const readBackText = await readFile(targetPath, "utf8");
      if (readBackText !== candidateText) {
        throw new GenericFormResultCliError("GENERIC_RESULT_READBACK_FAILED");
      }
      printSafeSummary(formId, "created", "PINNED_SOURCE", candidate);
    }
  } catch (error) {
    operationError = error;
  }

  if (temporaryDirectory !== undefined) {
    try {
      await rm(temporaryDirectory, { recursive: true, force: true });
      // Cleaned up normally — a signal arriving after this point has
      // nothing left here to (redundantly, harmlessly, but misleadingly)
      // report as removed.
      signalState.temporaryDirectory = undefined;
    } catch {
      operationError ??= new GenericFormResultCliError("SOURCE_BUILD_CLEANUP_FAILED");
    }
  }

  if (lock !== undefined) {
    await finalizeSyncOperation(
      lock,
      lockPath,
      operationError,
      targetCreated,
      releaseSyncLock,
      () => {
        signalState.lockPath = undefined;
      }
    );
  } else if (operationError !== undefined) {
    throw operationError;
  }
}

async function main() {
  const { mode, formId } = parseArguments(process.argv.slice(2));
  if (!FORM_ID_PATTERN.test(formId)) {
    throw new GenericFormResultCliError("GENERIC_FORM_ID_INVALID");
  }

  // Precedes every project-module dynamic import and every possible network
  // call. Installed packages can validate a recorded artifact offline, but
  // cannot rebuild or reach the network (mirrors every other settings CLI
  // in this project).
  if (mode !== "check" && !hasSourceCheckout()) {
    throw new GenericFormResultCliError("SOURCE_MODE_REQUIRES_SOURCE_CHECKOUT");
  }

  if (mode === "check") {
    await runOfflineCheck(formId);
    return;
  }
  await runNetworkMode(mode, formId);
}

// Compares real paths, not just "is argv[1] defined" (which is true in
// every Node process, including a test runner that merely imports this
// module) — mirrors source-backed-result's __testOnlyIsDirectExecution
// exactly. Getting this wrong means importing this file for its exported
// functions (parseArguments, acquireSyncLock, …) would also silently run
// main() with the importing process's own argv.
function isDirectExecution(argvPath, moduleUrl) {
  if (
    typeof argvPath !== "string" ||
    argvPath.length === 0 ||
    moduleUrl.includes("?test-only")
  )
    return false;
  try {
    return (
      realpathSync(resolve(argvPath)) === realpathSync(fileURLToPath(moduleUrl))
    );
  } catch {
    return false;
  }
}

const LOCK_RELATED_CODES = new Set([
  "GENERIC_RESULT_LOCKED",
  "GENERIC_RESULT_LOCK_CLEANUP_FAILED",
  "GENERIC_RESULT_OUTCOME_UNKNOWN_RECONCILE_TARGET_AND_LOCK"
]);

if (isDirectExecution(process.argv[1], import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      `Normalized settings generic form result failed: ${safeErrorCode(error)}.\n`
    );
    // The lock path is a fixed-per-form, public, in-repo path — naming it
    // for every code where a lock might be the thing to go look at, not
    // only the simple "already locked" case, without adding a general
    // free-text error-detail channel that could leak more than a safe code
    // was meant to (DEBT-015). The lock file's first two lines are PID and
    // ISO start time — if that PID is no longer running, the lock is stale
    // and safe to remove by hand.
    if (
      error instanceof GenericFormResultCliError &&
      LOCK_RELATED_CODES.has(error.code) &&
      error.detail
    ) {
      process.stderr.write(
        `Lock path: ${error.detail}\n` +
          "The lock file's first line is the PID that created it, the second its ISO start time. " +
          "If that PID is no longer running, the lock is stale and safe to remove by hand.\n"
      );
    }
    process.exitCode = 1;
  });
}
