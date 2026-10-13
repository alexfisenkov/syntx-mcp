// Two different execution paths share this file today (DEBT-025 tracks
// splitting them further):
//   - runOfflineCheck(): reads dist/ only, no network. This is the path
//     that ships in the installed npm package and is covered by
//     package:smoke.
//   - withTemporarySourceRuntime()/buildSourceCheckout(): builds a temporary
//     tsc checkout and reaches the network (via buildBananaSourceBackedResultFromPinnedSource).
//     Untestable in this project's normal CI — only exercised by an explicit
//     --confirm-source-fetch intent run. withTemporarySourceRuntime is
//     exported for composability, but do not call it without going through
//     main()'s CLI gate: it carries its own confirmedSourceFetch check
//     precisely because export makes direct misuse possible.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { SourceBackedResultCliError } from "./errors.mjs";
import {
  buildDiagnosticsPath,
  compiledSourceModePaths,
  projectRoot,
  sourceBuildParent,
  sourceBuildPrefix,
  targetPath,
} from "./paths.mjs";
import { printSafeSummary } from "./cli-support.mjs";
import {
  loadExactInputs,
  loadRuntimeModules,
  loadSourceModules,
} from "./runtime-loader.mjs";

const execFileAsync = promisify(execFile);

export async function runOfflineCheck() {
  const runtime = await loadRuntimeModules(
    new URL("../../dist/", import.meta.url),
  );
  const inputs = await loadExactInputs(runtime);
  const result = runtime.loadResult({
    path: targetPath,
    ...inputs.validationSources,
  });
  const recordedText = await readFile(targetPath, "utf8");
  const canonicalText = runtime.serializeResult(
    result,
    inputs.validationSources,
  );
  if (recordedText !== canonicalText) {
    throw new SourceBackedResultCliError("SOURCE_BACKED_RESULT_DRIFT_DETECTED");
  }
  printSafeSummary("unchanged", "OFFLINE", result);
}

const NETWORK_MODES = new Set(["probe-source", "check-source", "sync-source"]);

// This function reaches the network (via buildBananaSourceBackedResultFromPinnedSource
// -> fetchPinnedSettingsFormSourceMaterial). It is exported so build steps can
// be composed and tested, but exporting it also means any future code in
// this project could import and call it directly, bypassing main()'s
// --confirm-source-fetch CLI gate (DEBT-014/D-034). confirmedSourceFetch is
// a second, function-level gate so that danger travels with the call site,
// not only with the CLI argument parser three files away.
export async function withTemporarySourceRuntime(mode, options) {
  if (!NETWORK_MODES.has(mode)) {
    throw new SourceBackedResultCliError("INVALID_ARGUMENT");
  }
  if (options?.confirmedSourceFetch !== true) {
    throw new SourceBackedResultCliError("SOURCE_FETCH_NOT_CONFIRMED");
  }
  let temporaryDirectory;
  let operationError;
  let output;
  try {
    await mkdir(sourceBuildParent, { recursive: true });
    temporaryDirectory = await mkdtemp(sourceBuildPrefix);
    // Optional: lets the caller's SIGINT/SIGTERM handler act on exactly
    // this run's own checkout directory if interrupted mid-build, instead
    // of guessing or sweeping a shared name prefix (round-2 critic review —
    // see lock-signal-cleanup.mjs's header for why a prefix sweep is unsafe
    // here specifically, since two different forms/runs can legitimately
    // have their own checkouts under the same parent at once).
    if (options.signalState !== undefined) {
      options.signalState.temporaryDirectory = temporaryDirectory;
    }
    await buildSourceCheckout(temporaryDirectory);
    const runtime = await loadRuntimeModules(
      pathToFileURL(`${temporaryDirectory}/`),
    );
    const sourceRuntime = await loadSourceModules(temporaryDirectory);
    const inputs = await loadExactInputs(runtime);
    sourceRuntime.assertSourceBackedLocalPreflight({
      ...inputs.validationSources,
    });

    let sourceObservedAt;
    let generatedAt;
    let recorded;
    let recordedText;
    if (mode === "check-source") {
      recorded = runtime.loadResult({
        path: targetPath,
        ...inputs.validationSources,
      });
      recordedText = await readFile(targetPath, "utf8");
      sourceObservedAt = recorded.source_observed_at;
      generatedAt = recorded.generated_at;
      runtime.assertImplementations(
        recorded,
        sourceRuntime.collectSourceBackedImplementationComponents(),
      );
    }

    const candidate =
      await sourceRuntime.buildBananaSourceBackedResultFromPinnedSource({
        publicCatalog: inputs.validationSources.publicCatalog,
        inventory: inputs.validationSources.inventory,
        censusManifest: inputs.validationSources.censusManifest,
        censusArtifactText: inputs.validationSources.censusArtifactText,
        parserArtifactText: inputs.validationSources.parserArtifactText,
        ...(sourceObservedAt === undefined ? {} : { sourceObservedAt }),
        ...(generatedAt === undefined ? {} : { generatedAt }),
        absoluteTimeoutMs: 30_000,
        maxJavaScriptBytes: 16 * 1024 * 1024,
        maxSourceMapBytes: 32 * 1024 * 1024,
      });
    const candidateText = runtime.serializeResult(
      candidate,
      inputs.validationSources,
    );

    if (mode === "check-source") {
      runtime.assertUnchanged(recorded, candidate);
      if (recordedText !== candidateText) {
        throw new SourceBackedResultCliError(
          "SOURCE_BACKED_RESULT_DRIFT_DETECTED",
        );
      }
    }
    output = {
      candidate,
      candidateText,
      createImmutableJsonSnapshot: sourceRuntime.createImmutableJsonSnapshot,
    };
  } catch (error) {
    operationError = error;
  }

  if (temporaryDirectory !== undefined) {
    try {
      await rm(temporaryDirectory, { recursive: true, force: true });
      // Cleaned up normally — a signal arriving after this point has
      // nothing left here to (redundantly, harmlessly, but misleadingly)
      // report as removed.
      if (options.signalState !== undefined) {
        options.signalState.temporaryDirectory = undefined;
      }
    } catch {
      throw new SourceBackedResultCliError("SOURCE_BUILD_CLEANUP_FAILED");
    }
  }
  if (operationError !== undefined) throw operationError;
  if (output === undefined) {
    throw new SourceBackedResultCliError("SOURCE_BUILD_FAILED");
  }
  return output;
}

async function buildSourceCheckout(temporaryDirectory) {
  try {
    await execFileAsync(
      process.execPath,
      [
        join(projectRoot, "node_modules/typescript/bin/tsc"),
        "-p",
        // DEBT-018: a narrower project (src/+tools/ only, no tests/) compiles
        // fewer files and leaves less to clean up if this run is interrupted.
        // compiledSourceModePaths below only ever needs src/+tools/ output.
        join(projectRoot, "tsconfig.source-backed-build.json"),
        "--outDir",
        temporaryDirectory,
      ],
      {
        cwd: projectRoot,
        encoding: "utf8",
        maxBuffer: 2 * 1024 * 1024,
        timeout: 120_000,
      },
    );
  } catch (error) {
    // DEBT-017: these three subprocess-level causes used to collapse into
    // one indistinguishable code with no diagnostics at all. A real
    // compile error's tsc output is worth saving (to one fixed, always-
    // overwritten path, not a growing set of files — no directory-sweep
    // risk), but only for that case: timeout/overflow carry no useful
    // tsc output (the process was still building or already too noisy).
    if (error?.killed === true) {
      throw new SourceBackedResultCliError("SOURCE_BUILD_TIMEOUT");
    }
    if (error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
      throw new SourceBackedResultCliError("SOURCE_BUILD_OUTPUT_TOO_LARGE");
    }
    try {
      await writeFile(
        buildDiagnosticsPath,
        `${error?.stdout ?? ""}${error?.stderr ?? ""}`,
        "utf8",
      );
    } catch {
      // Saving the diagnostic is best-effort; the original compile failure
      // is the fact worth reporting, not a secondary write failure.
    }
    throw new SourceBackedResultCliError("SOURCE_BUILD_FAILED");
  }
  if (
    !compiledSourceModePaths.every((path) =>
      existsSync(join(temporaryDirectory, path)),
    )
  ) {
    throw new SourceBackedResultCliError("SOURCE_BUILD_FAILED");
  }
}
