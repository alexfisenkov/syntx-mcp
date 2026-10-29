#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  lstat,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  assertInstalledMagnificOwnerStdioSurface,
  OwnerMagnificPackageSmokeError
} from "./package-smoke/owner-magnific-stdio-smoke.mjs";
import {
  assertInstalledKontextOwnerStdioSurface,
  OwnerKontextPackageSmokeError
} from "./package-smoke/owner-kontext-stdio-smoke.mjs";
import {
  assertInstalledWanAdmission,
  assertInstalledWanNativeStdioSurface,
  WanAdmissionSmokeError
} from "./package-install-wan-admission-smoke.mjs";
import {
  assertInstalledStandardImageNativeTools,
  StandardImageNativeToolsError
} from "./check-installed-standard-image-native-tools.mjs";
import {
  assertInstalledRunwayImageNativeTools,
  RunwayImageNativeToolsError
} from "./check-installed-runway-image-native-tools.mjs";
import {
  assertInstalledSeedreamImageNativeTools,
  SeedreamImageNativeToolsError
} from "./check-installed-seedream-image-native-tools.mjs";
import {
  assertInstalledSeedreamEditorParameters,
  formatSeedreamEditorParameterSummary,
  SeedreamEditorParametersInstalledCheckError
} from "./check-installed-seedream-editor-parameters.mjs";
import {
  assertInstalledSeedreamEditorFoundation,
  formatSeedreamEditorFoundationSummary,
  SeedreamEditorFoundationInstalledCheckError
} from "./check-installed-seedream-editor-foundation.mjs";
import {
  assertInstalledGrokT2iImageTools,
  GrokT2iImageToolsInstalledCheckError
} from "./check-installed-grok-t2i-image-tools.mjs";
import {
  assertInstalledOwnerFluxImageNativeTools,
  OwnerFluxImageInstalledCheckError
} from "./check-owner-flux-image-installed.mjs";
import {
  assertInstalledIdeogramImageReference,
  IdeogramImageReferenceInstalledCheckError
} from "./check-installed-ideogram-image-reference.mjs";
import {
  assertInstalledUniImageTools,
  UniImageInstalledCheckError
} from "./check-installed-uni-image-tools.mjs";
import {
  assertInstalledWanT2iImageTools,
  WanT2iImageToolsInstalledCheckError
} from "./check-installed-wan-t2i-image-tools.mjs";
import {
  assertInstalledInpaintFoundation,
  formatInpaintPaintedCompositePackageSummary,
  InpaintFoundationInstalledCheckError
} from "./installed-inpaint-foundation-check.mjs";
import {
  assertInstalledImageFamilyAdmission,
  ImageFamilyAdmissionError
} from "./package-install-image-family-admission.mjs";
import {
  assertInstalledRemainingImageSourceAdmission,
  RemainingImageSourceAdmissionError
} from "./check-installed-remaining-image-source-admission.mjs";
import {
  assertInstalledBananaInpaintFlow,
  formatBananaInpaintInstalledSummary,
  BananaInpaintInstalledCheckError
} from "./check-installed-banana-inpaint-flow.mjs";
import {
  assertInstalledSeedreamEditorFlow,
  formatSeedreamEditorInstalledSummary,
  SeedreamEditorInstalledCheckError
} from "./check-installed-seedream-editor-flow.mjs";
import {
  assertInstalledWanT2vFlow,
  formatWanT2vInstalledSummary,
  WanT2vFlowInstalledCheckError
} from "./check-installed-wan-t2v-flow.mjs";
import {
  assertInstalledElevenLabsTtsFlow,
  formatElevenLabsTtsInstalledSummary,
  ElevenLabsTtsInstalledCheckError
} from "./check-installed-elevenlabs-tts-flow.mjs";
import {
  assertInstalledSunoGenerationFlow,
  formatSunoGenerationInstalledSummary,
  SunoGenerationInstalledCheckError
} from "./check-installed-suno-generation-flow.mjs";
import {
  assertInstalledLumaT2vFlow,
  formatLumaT2vInstalledSummary,
  LumaT2vFlowInstalledCheckError
} from "./check-installed-luma-t2v-flow.mjs";
import {
  assertInstalledHailuo01T2vFlow,
  formatHailuo01T2vInstalledSummary,
  Hailuo01T2vFlowInstalledCheckError
} from "./check-installed-hailuo01-t2v-flow.mjs";
import {
  assertInstalledHailuo01DirectorT2vFlow,
  formatHailuo01DirectorT2vInstalledSummary,
  Hailuo01DirectorT2vFlowInstalledCheckError
} from "./check-installed-hailuo01-director-t2v-flow.mjs";
import {
  assertInstalledHailuo23T2vFlow,
  formatHailuo23T2vInstalledSummary,
  Hailuo23T2vFlowInstalledCheckError
} from "./check-installed-hailuo23-t2v-flow.mjs";
import {
  assertInstalledVideo2AudioFlow,
  formatVideo2AudioInstalledSummary,
  Video2AudioFlowInstalledCheckError
} from "./check-installed-video2audio-flow.mjs";
import {
  PUBLIC_SOURCE_MANIFEST_NAME,
  assertPublicSourcePackagePaths,
  assertInstalledPublicSourceFileHashes,
  evaluateHistoricalOwnerProofGate,
  isInertPublicStaticRuntimeArtifact,
  loadAndVerifyPublicSourceManifest,
  mayTreatPublicStaticRuntimeDirectoryAsEmpty
} from "./public-source-package-manifest.mjs";

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const EXPECTED_SUMMARY =
  "Normalized settings IR canary evidence shell unchanged. " +
  "models=4 partial=4 locators=11 compilation=NOT_COMPILED " +
  "runtime_usable=false";
const EXPECTED_PARSER_SUMMARY =
  "Normalized settings parser canary unchanged. verification=OFFLINE " +
  "models=4 forms=1 proven=0 absent=0 blocked=6 candidates=2 " +
  "form_blockers=17 model_blockers=4 compilation=PARTIAL_COMPILED " +
  "runtime_usable=false";
const EXPECTED_CENSUS_SUMMARY =
  "Normalized settings parser census manifest unchanged. " +
  "verification=OFFLINE forms=42 model_bearing_forms=39 " +
  "zero_model_forms=3 models=192 current_models=182 legacy_models=10 " +
  "literal_models=97 dynamic_models=85 unbound_forms=3 sources=123 " +
  "compile_boundary=76 deferred=47 locators=351 runtime_usable=false";
const EXPECTED_SOURCE_BACKED_SUMMARY =
  "Normalized settings source-backed C1a result unchanged. " +
  "verification=OFFLINE forms=1/42 models=4/192 sources=1/123 " +
  "unscoped_sources=122 proven=0 absent=0 blocked=6 runtime_usable=false";
// DEBT-037 (docs/проект/незакрыто.md): the first real Gate C1b v4
// per-form artifact (wan-video) was published by D-045
// (docs/проект/решения.md) — this is that form's real, pinned summary,
// not a hypothetical placeholder. Unlike v1/v2/v3, this is one artifact
// among many (one per synced form); this check only proves ONE specific,
// already-published form round-trips through the installed package
// correctly, not that every form would.
const EXPECTED_GENERIC_SUMMARY =
  "Normalized settings generic form result (wan-video) unchanged. " +
  "verification=OFFLINE completeness=PARTIAL proven=0 absent=0 " +
  "blocked=6 blocked_with_candidates=2 form_blockers=75 models=11/192 " +
  "sources=1/123 runtime_usable=false";
const REQUIRED_PACKAGE_PATHS = [
  "docs/модели/WAN-image-источники-и-параметры.md",
  "dist/src/application/owner-wan-image-parameters.js",
  "dist/src/application/owner-wan-image-parameters.d.ts",
  "dist/src/application/owner-wan-image-input-validator.js",
  "dist/src/application/owner-wan-image-input-validator.d.ts",
  "dist/src/application/owner-wan-bmp-inspector.js",
  "dist/src/application/owner-wan-bmp-inspector.d.ts",
  "dist/src/application/owner-wan-image-prompt.js",
  "dist/src/application/owner-wan-image-prompt.d.ts",
  "dist/src/application/owner-wan-image-source-profile.js",
  "dist/src/application/owner-wan-image-source-profile.d.ts",
  "scripts/sync-public-catalog.mjs",
  "scripts/syntx-maintenance.mjs",
  "skills/syntx-mcp-update/SKILL.md",
  "skills/syntx-mcp-update/agents/openai.yaml",
  "skills/syntx-mcp-update/references/maintenance-cli.md",
  "skills/syntx-mcp-update/references/ui-audit-and-adaptation.md",
  "dist/src/application/syntx-maintenance-report.js",
  "dist/src/application/syntx-maintenance-report.d.ts",
  "dist/src/application/syntx-maintenance-audit-plan.js",
  "dist/src/application/syntx-maintenance-audit-plan.d.ts",
  "dist/src/mcp/maintenance-skill-resources.js",
  "dist/src/mcp/maintenance-skill-resources.d.ts",
  "dist/src/catalog/public-catalog-history.js",
  "dist/src/catalog/settings-source-history.js",
  "dist/src/catalog/mapless-settings-inventory.js",
  "dist/src/catalog/selected-discovery-catalog.js",
  "dist/src/catalog/owner-grok-image-reference-profile-history.js",
  "dist/src/catalog/owner-grok-image-reference-profiles.js",
  "dist/src/transports/stdio-owner-evidence.js",
  "dist/src/adapter/syntx/chat-http-client.js",
  "dist/src/adapter/syntx/chat-http-client.d.ts",
  "dist/src/adapter/syntx/upload-reference-bridge.js",
  "dist/src/adapter/syntx/upload-reference-bridge.d.ts",
  "dist/src/adapter/syntx/request-deadline.js",
  "dist/src/adapter/syntx/request-deadline.d.ts",
  "dist/src/application/owner-magnific-upscale-upload-service.js",
  "dist/src/application/owner-magnific-upscale-upload-service.d.ts",
  "dist/src/application/owner-magnific-upscale-request-preparer.js",
  "dist/src/application/owner-magnific-upscale-request-preparer.d.ts",
  "dist/src/application/owner-magnific-upscale-parameters.js",
  "dist/src/application/owner-magnific-upscale-parameters.d.ts",
  "dist/src/application/owner-magnific-upscale-input-validator.js",
  "dist/src/application/owner-magnific-upscale-input-validator.d.ts",
  "dist/src/application/owner-magnific-upscale-one-shot-policy.js",
  "dist/src/application/owner-magnific-upscale-one-shot-policy.d.ts",
  "dist/src/application/owner-magnific-upscale-history-binding.js",
  "dist/src/application/owner-magnific-upscale-history-binding.d.ts",
  "dist/src/application/owner-magnific-upscale-generation-service.js",
  "dist/src/application/owner-magnific-upscale-generation-service.d.ts",
  "dist/src/mcp/owner-magnific-upscale-tools.js",
  "dist/src/mcp/owner-magnific-upscale-tools.d.ts",
  "dist/src/application/owner-kontext-image-parameters.js",
  "dist/src/application/owner-kontext-image-parameters.d.ts",
  "dist/src/application/owner-kontext-image-input-validator.js",
  "dist/src/application/owner-kontext-image-input-validator.d.ts",
  "dist/src/application/owner-kontext-image-request-preparer.js",
  "dist/src/application/owner-kontext-image-request-preparer.d.ts",
  "dist/src/application/owner-kontext-image-one-shot-policy.js",
  "dist/src/application/owner-kontext-image-one-shot-policy.d.ts",
  "dist/src/application/owner-kontext-image-history-binding.js",
  "dist/src/application/owner-kontext-image-history-binding.d.ts",
  "dist/src/application/owner-kontext-image-upload-service.js",
  "dist/src/application/owner-kontext-image-upload-service.d.ts",
  "dist/src/application/owner-kontext-image-generation-service.js",
  "dist/src/application/owner-kontext-image-generation-service.d.ts",
  "dist/src/mcp/owner-kontext-image-tools.js",
  "dist/src/mcp/owner-kontext-image-tools.d.ts",
  "dist/src/application/owner-soul-generation-parameters.js",
  "dist/src/application/owner-soul-generation-parameters.d.ts",
  "dist/src/application/owner-soul-image-source-profile.js",
  "dist/src/application/owner-soul-image-source-profile.d.ts",
  "dist/src/application/owner-soul-image-generation-service.js",
  "dist/src/application/owner-soul-image-generation-service.d.ts",
  "dist/src/application/owner-soul-character-options-service.js",
  "dist/src/application/owner-soul-character-options-service.d.ts",
  "dist/src/application/owner-soul-style-options-service.js",
  "dist/src/application/owner-soul-style-options-service.d.ts",
  "dist/src/mcp/owner-soul-image-tools.js",
  "dist/src/mcp/owner-soul-image-tools.d.ts",
  "dist/src/mcp/owner-soul-style-options-tool.js",
  "dist/src/mcp/owner-soul-style-options-tool.d.ts",
  "dist/src/application/owner-wan-t2i-parameters.js",
  "dist/src/application/owner-wan-t2i-parameters.d.ts",
  "dist/src/application/owner-wan-t2i-source-profile.js",
  "dist/src/application/owner-wan-t2i-source-profile.d.ts",
  "dist/src/application/owner-wan-t2i-cost-parameters.js",
  "dist/src/application/owner-wan-t2i-cost-parameters.d.ts",
  "dist/src/application/owner-wan-t2i-request-preparer.js",
  "dist/src/application/owner-wan-t2i-request-preparer.d.ts",
  "dist/src/application/owner-wan-t2i-one-shot-policy.js",
  "dist/src/application/owner-wan-t2i-one-shot-policy.d.ts",
  "dist/src/application/owner-wan-t2i-history-binding.js",
  "dist/src/application/owner-wan-t2i-history-binding.d.ts",
  "dist/src/application/owner-wan-t2i-generation-service.js",
  "dist/src/application/owner-wan-t2i-generation-service.d.ts",
  "dist/src/adapter/syntx/owner-wan-t2i-result.js",
  "dist/src/adapter/syntx/owner-wan-t2i-result.d.ts",
  "dist/src/mcp/owner-wan-t2i-tools.js",
  "dist/src/mcp/owner-wan-t2i-tools.d.ts",
  "dist/src/mcp/server.js",
  "dist/src/mcp/server.d.ts",
  "dist/src/runtime/observed-owner-runtime.js",
  "dist/src/runtime/observed-owner-runtime.d.ts",
  "dist/src/transports/stdio-owner.js",
  "dist/src/transports/stdio-owner.d.ts",
  "catalog/public/sha256-666d92aa4baa59ae21c210f9296a23ef73a01f4a2af0ce7e4e3d9fa9c55e6293.json",
  "catalog/runtime/v8/sha256-5d16913f579e8221c252ac878cdd3669f2aebdd9e5c667cf1258ab60e8cf1441.json",
  "catalog/runtime/v10/sha256-20ae819e243d39101570b6b9a4711a7ff3da87b3ccdb64a555c05ef377bbb135.json",
  "catalog/runtime/v10/sha256-f1a2ff324aea572a4e92630caeec2f9d08902e49f0bb2b4c6a06d73885a3c110.json",
  "catalog/settings/sha256-38887915375c724b247ebe82e111b30f88c60c41f7d3e864bb43b4b38988cdec.json",
  "catalog/runtime/v1/normalized-settings-ir-canary.json",
  "catalog/runtime/v1/normalized-settings-parser-canary.json",
  "catalog/runtime/v2/normalized-settings-parser-census-manifest.json",
  "catalog/runtime/v3/normalized-settings-parser-source-backed-result.json",
  "catalog/runtime/v4/wan-video-generic-form-result.json",
  "catalog/runtime/v5/beeble-root-only-result.json",
  "catalog/generation-contracts/sha256-78c65766ddf4149de0f63dc730d86b1dc0d45ec7adef9da0bf38b89095e47216.json",
  "catalog/generation-contracts-v2/sha256-e3a109c3b52f4e1a46b37d5a6f54f311f7f12f99b36da667f85258d928dabffe.json",
  "catalog/generation-contracts-v2/sha256-075b0789c11c9fef6efd241ba51386e22eb6116f18b2870c04af5a78a0b850ac.json",
  "catalog/runtime/v17/existing-profile-terminal-evidence.json",
  "catalog/runtime/v18/owner-stdio-persistent-auth-smoke.json",
  "catalog/runtime/v18/owner-stdio-persistent-auth-smoke-v2.json",
  "dist/src/catalog/generation-contract-history.js",
  "dist/src/catalog/generation-contract-history-v2.js",
  "dist/src/domain/generation-contract-v2.js",
  "dist/src/catalog/static-form-control-history.js",
  "dist/src/catalog/runtime-coverage-registry.js",
  "dist/src/catalog/normalized-settings-ir.js",
  "dist/src/catalog/normalized-settings-parser-canary.js",
  "dist/src/catalog/normalized-settings-parser-census-manifest.js",
  "dist/src/catalog/normalized-settings-parser-source-backed-result.js",
  "dist/src/catalog/normalized-settings-parser-generic-form-result.js",
  "dist/src/catalog/settings-root-only-result-v5.js",
  "dist/src/adapter/syntx/cancellation-saga.js",
  "dist/src/domain/generation-cancel-attempt.js",
  "dist/src/storage/sqlite-generation-cancel-attempt-store.js",
  "package.json",
  "scripts/sync-settings-source-inventory.mjs",
  "scripts/check-settings-implementations.mjs",
  "scripts/settings-v5-root-only.mjs",
  "scripts/sync-normalized-settings-ir.mjs",
  "scripts/sync-normalized-settings-parser-canary.mjs",
  "scripts/sync-normalized-settings-parser-census-manifest.mjs",
  "scripts/sync-normalized-settings-parser-source-backed-result.mjs",
  "scripts/sync-normalized-settings-parser-generic-form-result.mjs",
  "scripts/lock-signal-cleanup.mjs",
  "scripts/update-mcp.mjs",
  "dist/src/application/mcp-self-update-service.js",
  "dist/src/catalog/media-coverage.js",
  "dist/src/mcp/media-coverage-tools.js",
  "dist/src/application/owner-expanded-t2v-profile.js",
  "dist/src/application/owner-reviewed-no-reference-t2v-service.js",
  "dist/src/mcp/owner-expanded-t2v-tools.js",
  "catalog/media-coverage/owner-tool-routes-v1.json",
  "catalog/media-coverage/owner-tool-routes-v2.json",
  "catalog/media-coverage/owner-expanded-t2v-controls-v2.json"
];

const SOURCE_BACKED_RESULT_MODULE_DIR = "scripts/source-backed-result";

// Discovered from disk rather than hardcoded, and checked for an exact set
// match below (assertSourceBackedResultModuleSetMatches): a module added or
// removed here must be reflected in the tarball with nothing missing and
// nothing stray, without anyone having to remember a second list.
async function expectedSourceBackedResultModulePaths() {
  const entries = await readdir(join(PROJECT_ROOT, SOURCE_BACKED_RESULT_MODULE_DIR));
  return entries
    .filter((entry) => entry.endsWith(".mjs"))
    .sort()
    .map((entry) => `${SOURCE_BACKED_RESULT_MODULE_DIR}/${entry}`);
}

async function assertSourceBackedResultModuleSetMatches(packagedPaths) {
  const expected = await expectedSourceBackedResultModulePaths();
  if (expected.length < 6) {
    throw new PackageSmokeError("PACKAGE_CONTENT_MISSING");
  }
  const packagedModulePaths = [...packagedPaths]
    .filter((path) => path.startsWith(`${SOURCE_BACKED_RESULT_MODULE_DIR}/`))
    .sort();
  const expectedSet = new Set(expected);
  const packagedSet = new Set(packagedModulePaths);
  const missing = expected.filter((path) => !packagedSet.has(path));
  const stray = packagedModulePaths.filter((path) => !expectedSet.has(path));
  if (missing.length > 0 || stray.length > 0) {
    throw new PackageSmokeError("PACKAGE_CONTENT_MISMATCH");
  }
}

const GENERIC_RESULT_DIR = "catalog/runtime/v4";

// Discovered from disk rather than only relying on REQUIRED_PACKAGE_PATHS's
// one hardcoded wan-video entry — round 1 critic-practice WARN (Gate C1b
// step 7): after a second form is synced, REQUIRED_PACKAGE_PATHS would
// still only demand wan-video's file, so a future artifact silently
// excluded from package.json's "files" would pass package:smoke green.
// Mirrors expectedSourceBackedResultModulePaths's own pattern exactly:
// every real v4 artifact on disk must appear in the packed tarball, not
// just the one this project happened to publish first.
async function expectedGenericFormResultPaths() {
  let entries;
  try {
    entries = await readdir(join(PROJECT_ROOT, GENERIC_RESULT_DIR));
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.endsWith("-generic-form-result.json"))
    .sort()
    .map((entry) => `${GENERIC_RESULT_DIR}/${entry}`);
}

async function assertGenericFormResultSetMatches(packagedPaths) {
  const expected = await expectedGenericFormResultPaths();
  if (expected.length === 0) {
    // No v4 artifact published yet is a legitimate state (a fresh
    // checkout before the first sync) — nothing to require here in that
    // case; REQUIRED_PACKAGE_PATHS's wan-video entry still enforces that
    // THIS project's own checkout has at least the one it already
    // published.
    return;
  }
  const packagedSet = new Set(packagedPaths);
  const missing = expected.filter((path) => !packagedSet.has(path));
  if (missing.length > 0) {
    throw new PackageSmokeError("PACKAGE_CONTENT_MISMATCH");
  }
}

const VERSIONED_GENERIC_RESULT_DIR = "catalog/runtime/v8/generic";

const GENERATION_CONTRACTS_DIR = "catalog/generation-contracts";
const GENERATION_CONTRACTS_V2_DIR = "catalog/generation-contracts-v2";
const OWNER_GROK_REFERENCE_PROFILE_DIR = "catalog/owner-image-reference-profiles/v1";
const OWNER_GROK_REFERENCE_PROFILE_VERSION_PATTERN = /^sha256-[a-f0-9]{64}\.json$/u;
const GENERATION_CONTRACT_VERSION_PATTERN = /^sha256-[a-f0-9]{64}\.json$/u;
const STATIC_RUNTIME_ARTIFACT_DIRS = ["catalog/runtime/v11", "catalog/runtime/v12", "catalog/runtime/v13", "catalog/runtime/v15", "catalog/runtime/v17", "catalog/runtime/v18", "catalog/runtime/v20", "catalog/runtime/v21"];
const PERSISTENT_AUTH_PROOF_PATH = "catalog/runtime/v18/owner-stdio-persistent-auth-smoke-v2.json";
const SUPERSEDED_PERSISTENT_AUTH_PROOF_PATH = "catalog/runtime/v18/owner-stdio-persistent-auth-smoke.json";

async function expectedJsonArtifactPaths(directory, root = PROJECT_ROOT, filenamePattern = /^.+\.json$/u) {
  let entries;
  try {
    entries = await readdir(join(root, directory), { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") throw new PackageSmokeError("PACKAGE_CONTENT_MISSING");
    throw error;
  }
  if (entries.length === 0 || entries.some((entry) => entry.isSymbolicLink() || !entry.isFile() || !filenamePattern.test(entry.name))) {
    throw new PackageSmokeError("PACKAGE_CONTENT_FORBIDDEN");
  }
  return entries.map((entry) => `${directory}/${entry.name}`).sort();
}

async function assertJsonArtifactDirectorySetMatches(directory, packagedPaths, filenamePattern = /^.+\.json$/u) {
  const expected = await expectedJsonArtifactPaths(directory, PROJECT_ROOT, filenamePattern);
  const packaged = [...packagedPaths].filter((path) => path.startsWith(`${directory}/`)).sort();
  if (JSON.stringify(packaged) !== JSON.stringify(expected)) throw new PackageSmokeError("PACKAGE_CONTENT_MISMATCH");
  return expected;
}

async function assertInstalledJsonArtifactBytes(installedPackagePath, paths) {
  for (const path of paths) {
    if (!(await readFile(join(PROJECT_ROOT, path))).equals(await readFile(join(installedPackagePath, path)))) {
      throw new PackageSmokeError("ARCHIVED_JSON_BYTE_MISMATCH");
    }
  }
}

async function assertInstalledMediaUpdateArtifacts(installedPackagePath, consumerPath) {
  await assertInstalledJsonArtifactBytes(installedPackagePath, [
    "catalog/media-coverage/owner-tool-routes-v1.json",
    "catalog/media-coverage/owner-tool-routes-v2.json",
    "catalog/media-coverage/owner-expanded-t2v-controls-v2.json"
  ]);
  const routes = JSON.parse(await readFile(join(installedPackagePath, "catalog/media-coverage/owner-tool-routes-v1.json"), "utf8"));
  if (routes.schema_version !== "1.0.0" || !Number.isInteger(routes.owner_tool_count) ||
      routes.owner_tool_count < 1 || typeof routes.routes !== "object" || routes.routes === null || Array.isArray(routes.routes)) {
    throw new PackageSmokeError("MEDIA_COVERAGE_PACKAGE_INVALID");
  }
  const routesV2 = JSON.parse(await readFile(join(installedPackagePath, "catalog/media-coverage/owner-tool-routes-v2.json"), "utf8"));
  if (routesV2.schema_version !== "2.0.0" || routesV2.owner_tool_count !== null ||
      routesV2.owner_tool_count_status !== "UNVERIFIED_FOR_ROUTE_EXTENSION" ||
      typeof routesV2.routes !== "object" || routesV2.routes === null || Array.isArray(routesV2.routes)) {
    throw new PackageSmokeError("MEDIA_COVERAGE_PACKAGE_INVALID");
  }
  const updater = await readFile(join(installedPackagePath, "scripts/update-mcp.mjs"), "utf8");
  if (!updater.includes("../dist/src/application/mcp-self-update-service.js")) {
    throw new PackageSmokeError("UPDATER_PACKAGE_ENTRY_INVALID");
  }
  const bin = join(consumerPath, "node_modules", ".bin", process.platform === "win32" ? "syntx-mcp-update.cmd" : "syntx-mcp-update");
  try { await lstat(bin); }
  catch { throw new PackageSmokeError("UPDATER_PACKAGE_BIN_MISSING"); }
}

export function getExpectedSeedanceProFastCoverageProfile(getProfile) {
  if (typeof getProfile !== "function") return undefined;
  const profile = getProfile("seedance_pro-fast");
  if (profile?.model_id !== "seedance_pro-fast" || profile.ai_name !== "seedance" || profile.modality !== "video" ||
      profile.runtime_verified !== true || profile.one_copy_only !== true ||
      JSON.stringify(profile.settings) !== JSON.stringify({
        model_type: "seedance_pro-fast", resolution: "720p", mode: "mini", aspect_ratio: "16:9",
        video_duration: 5, generate_audio: true
      })) {
    return undefined;
  }
  return profile;
}

async function assertInstalledGenerationAndStaticRuntimeData(installedPackagePath, input) {
  await assertInstalledJsonArtifactBytes(installedPackagePath, [
    ...input.generationContractPaths,
    ...input.generationContractV2Paths,
    ...input.staticRuntimePaths
  ]);

  const catalogDirectory = join(installedPackagePath, "catalog");
  const generationContractHistoryPath = join(installedPackagePath, "dist/src/catalog/generation-contract-history.js");
  const { loadGenerationContractRegistry } = await import(pathToFileURL(generationContractHistoryPath).href);
  for (const path of input.generationContractPaths) {
    const registry = loadGenerationContractRegistry(basename(path), catalogDirectory);
    if (registry.schema_version !== "1.0.0" || !Array.isArray(registry.contracts)) {
      throw new PackageSmokeError("GENERATION_CONTRACT_LOADER_MISMATCH");
    }
  }

  const generationContractHistoryV2Path = join(installedPackagePath, "dist/src/catalog/generation-contract-history-v2.js");
  const {
    loadGenerationContractRegistryV2,
    loadSelectedGenerationContractRegistry
  } = await import(pathToFileURL(generationContractHistoryV2Path).href);
  for (const path of input.generationContractV2Paths) {
    const registry = loadGenerationContractRegistryV2(basename(path), catalogDirectory);
    if (registry.schema_version !== "2.0.0" || !Array.isArray(registry.contracts)) {
      throw new PackageSmokeError("GENERATION_CONTRACT_V2_LOADER_MISMATCH");
    }
  }
  if (input.publicSource === true) {
    const existingProfilesV2Path = "catalog/generation-contracts-v2/sha256-075b0789c11c9fef6efd241ba51386e22eb6116f18b2870c04af5a78a0b850ac.json";
    const existingProfilesV2 = input.generationContractV2Paths.includes(existingProfilesV2Path)
      ? loadGenerationContractRegistryV2(basename(existingProfilesV2Path), catalogDirectory)
      : undefined;
    if (existingProfilesV2 === undefined || !Array.isArray(existingProfilesV2.contracts) || existingProfilesV2.contracts.length === 0) {
      throw new PackageSmokeError("EXISTING_PROFILE_GENERATION_CONTRACT_V2_MISMATCH");
    }
    const staticEvidenceSchemaPath = join(installedPackagePath, "dist/src/catalog/static-generation-parameter-schema.js");
    const staticEvidenceSchemas = await import(pathToFileURL(staticEvidenceSchemaPath).href);
    for (const path of input.staticRuntimePaths) {
      let artifact;
      let serialized;
      try {
        serialized = await readFile(join(installedPackagePath, path), "utf8");
        artifact = JSON.parse(serialized);
      }
      catch { throw new PackageSmokeError("PUBLIC_STATIC_RUNTIME_ARTIFACT_INVALID"); }
      if (!isInertPublicStaticRuntimeArtifact(path, artifact)) {
        throw new PackageSmokeError("PUBLIC_STATIC_RUNTIME_ARTIFACT_SCOPE_INVALID");
      }
      if (path.startsWith("catalog/runtime/v11/")) {
        if (artifact.catalog_kind === "STATIC_GENERATION_PARAMETER_SCHEMA_PROJECTION") {
          let parsed;
          try {
            const expectedSha256 = `sha256:${createHash("sha256").update(serialized, "utf8").digest("hex")}`;
            parsed = staticEvidenceSchemas.parseStaticGenerationParameterSchemaArtifact(serialized, expectedSha256);
          } catch { throw new PackageSmokeError("PUBLIC_STATIC_RUNTIME_ARTIFACT_SCHEMA_INVALID"); }
          if (parsed.catalog.runtime_usable !== false || parsed.catalog.status !== artifact.status) {
            throw new PackageSmokeError("PUBLIC_STATIC_RUNTIME_ARTIFACT_SCOPE_INVALID");
          }
        } else if (artifact.catalog_kind === "STATIC_FORM_CONTROL_AST_EVIDENCE" && artifact.schema_version === "1.6.0" &&
                   !staticEvidenceSchemas.staticFormControlAnalysisSchema.safeParse(artifact).success) {
          throw new PackageSmokeError("PUBLIC_STATIC_RUNTIME_ARTIFACT_SCHEMA_INVALID");
        }
      }
    }
    const staticProjectionHistoryPath = join(installedPackagePath, "dist/src/catalog/static-form-control-history.js");
    const { loadPinnedStaticParameterProjection, DEFAULT_STATIC_PARAMETER_PROJECTION_VERSION } = await import(pathToFileURL(staticProjectionHistoryPath).href);
    const staticProjection = loadPinnedStaticParameterProjection(catalogDirectory);
    if (staticProjection.version !== DEFAULT_STATIC_PARAMETER_PROJECTION_VERSION ||
        staticProjection.projection === null || staticProjection.projection.runtime_usable !== false ||
        staticProjection.projection.models.length === 0) {
      throw new PackageSmokeError("PINNED_STATIC_PROJECTION_LOADER_MISMATCH");
    }
    const runtimeCoveragePath = join(installedPackagePath, "dist/src/catalog/runtime-coverage-registry.js");
    const { getRuntimeCoverageProfile, RUNTIME_COVERAGE_VERSION } = await import(pathToFileURL(runtimeCoveragePath).href);
    const seedanceProfile = getExpectedSeedanceProFastCoverageProfile(getRuntimeCoverageProfile);
    if (typeof RUNTIME_COVERAGE_VERSION !== "string" || RUNTIME_COVERAGE_VERSION.length === 0 || seedanceProfile === undefined) {
      throw new PackageSmokeError("PACKAGED_RUNTIME_COVERAGE_PROFILE_MISMATCH");
    }
    return Object.freeze({ historical_owner_proofs: "NOT_DISTRIBUTED" });
  }
  const existingProfilesV2Path = "catalog/generation-contracts-v2/sha256-075b0789c11c9fef6efd241ba51386e22eb6116f18b2870c04af5a78a0b850ac.json";
  const existingProfilesV2 = input.generationContractV2Paths.includes(existingProfilesV2Path)
    ? loadGenerationContractRegistryV2(basename(existingProfilesV2Path), catalogDirectory)
    : undefined;
  if (existingProfilesV2 === undefined || existingProfilesV2.contracts.length !== 33 ||
      existingProfilesV2.contracts.filter((contract) => contract.status === "live_verified").length !== 2 ||
      existingProfilesV2.contracts.some((contract) => contract.model_id === "sora_1" || contract.model_id === "text2video")) {
    throw new PackageSmokeError("EXISTING_PROFILE_GENERATION_CONTRACT_V2_MISMATCH");
  }
  const existingProfileEvidencePath = "catalog/runtime/v17/existing-profile-terminal-evidence.json";
  const existingProfileEvidenceBytes = await readFile(join(installedPackagePath, existingProfileEvidencePath));
  const existingProfileEvidenceSha = `sha256:${createHash("sha256").update(existingProfileEvidenceBytes).digest("hex")}`;
  for (const contract of existingProfilesV2.contracts) {
    for (const reference of contract.provenance.references.filter((entry) => entry.reference.startsWith(`${existingProfileEvidencePath}#`))) {
      if (reference.kind !== "live_owner" || reference.sha256 !== existingProfileEvidenceSha) {
        throw new PackageSmokeError("EXISTING_PROFILE_TERMINAL_EVIDENCE_LINK_MISMATCH");
      }
    }
  }
  const seedreamProofPath = "catalog/runtime/v20/owner-reviewed-seedream5-probe.json";
  const seedreamPromotedRegistryPath = "catalog/generation-contracts-v2/sha256-04e81e24494d6c5879f0fda0e6f0e406de6ea4c4af2fae41b64d76145b193c13.json";
  if (!input.staticRuntimePaths.includes(seedreamProofPath) || !input.generationContractV2Paths.includes(seedreamPromotedRegistryPath)) {
    throw new PackageSmokeError("SEEDREAM5_PROBE_PROOF_OR_PROMOTION_MISSING");
  }
  let seedreamProof;
  try { seedreamProof = JSON.parse(await readFile(join(installedPackagePath, seedreamProofPath), "utf8")); }
  catch { throw new PackageSmokeError("SEEDREAM5_PROBE_PROOF_INVALID"); }
  const seedreamProofBytes = await readFile(join(installedPackagePath, seedreamProofPath));
  const seedreamProofSha = `sha256:${createHash("sha256").update(seedreamProofBytes).digest("hex")}`;
  const oldSeedreamContract = existingProfilesV2.contracts.find((contract) => contract.variant_id === "legacy-image-seedream-5-default");
  const promotedRegistry = loadGenerationContractRegistryV2(basename(seedreamPromotedRegistryPath), catalogDirectory);
  const promotedSeedreamContract = promotedRegistry.contracts.find((contract) => contract.variant_id === "legacy-image-seedream-5-default");
  const seedreamLiveRef = promotedSeedreamContract?.provenance.references.find((reference) => reference.kind === "live_owner" && reference.reference.startsWith(`${seedreamProofPath};`));
  const promotedCounts = promotedRegistry.contracts.reduce((counts, contract) => {
    counts[contract.status] = (counts[contract.status] ?? 0) + 1;
    return counts;
  }, {});
  const samePreparedContract = oldSeedreamContract !== undefined && promotedSeedreamContract !== undefined &&
    ["model_id", "operation_id", "modality", "route", "ai_name", "model_type", "variant_id", "parameters", "wire", "output", "limits"]
      .every((key) => JSON.stringify(promotedSeedreamContract[key]) === JSON.stringify(oldSeedreamContract[key]));
  if (seedreamProof?.artifact_kind !== "OWNER_REVIEWED_EXACT_PROBE_V1" ||
      seedreamProof?.status !== "PASS_EXACT_RESULT_ONLY" || seedreamProof?.confidence_scope !== "exact_result_only" ||
      seedreamProof?.contract_status_at_probe !== "reviewed" || seedreamProof?.model_id !== "seedream-5" ||
      seedreamProof?.operation_id !== "generate-image" || seedreamProof?.variant_id !== "legacy-image-seedream-5-default" ||
      seedreamProof?.registry_version !== "sha256-075b0789c11c9fef6efd241ba51386e22eb6116f18b2870c04af5a78a0b850ac.json" ||
      seedreamProof?.schema_hash !== oldSeedreamContract?.schema_hash || seedreamProof?.artifact_count !== 1 ||
      JSON.stringify(seedreamProof?.mime_types) !== JSON.stringify(["image/jpeg"]) ||
      seedreamProof?.safe_artifact_summary_sha256 !== "sha256:41b0555b4d292a9035918d5525e48928ca5a1dce7d54453f6da3f129edb4e0e0" ||
      seedreamProof?.cleanup?.local_unlink_status !== "REVOKED_READBACK_CONFIRMED" || seedreamProof?.cleanup?.exit_code !== 0 ||
      promotedRegistry.contracts.length !== 33 || promotedCounts.live_verified !== 3 || promotedCounts.reviewed !== 30 ||
      promotedSeedreamContract?.status !== "live_verified" || !samePreparedContract ||
      promotedRegistry.source_hashes.models !== existingProfilesV2.source_hashes.models ||
      seedreamLiveRef?.sha256 !== seedreamProofSha) {
    throw new PackageSmokeError("SEEDREAM5_PROBE_PROMOTION_BINDING_MISMATCH");
  }
  const unpromotedExistingContracts = existingProfilesV2.contracts.filter((contract) => contract.variant_id !== "legacy-image-seedream-5-default");
  const unpromotedPromotedContracts = promotedRegistry.contracts.filter((contract) => contract.variant_id !== "legacy-image-seedream-5-default");
  if (JSON.stringify(unpromotedPromotedContracts) !== JSON.stringify(unpromotedExistingContracts)) {
    throw new PackageSmokeError("SEEDREAM5_PROBE_PROMOTION_SCOPE_MISMATCH");
  }
  const wanProofPath = "catalog/runtime/v21/owner-reviewed-wan27-recovery-probe.json";
  const currentPromotedRegistryPath = "catalog/generation-contracts-v2/sha256-04e81e24494d6c5879f0fda0e6f0e406de6ea4c4af2fae41b64d76145b193c13.json";
  const wanPromotedRegistryPath = "catalog/generation-contracts-v2/sha256-5b2c4b8554f99cf7735defcefb006a246d7ae602756f23d6dca309df2125b602.json";
  if (!input.staticRuntimePaths.includes(wanProofPath) ||
      !input.generationContractV2Paths.includes(currentPromotedRegistryPath) ||
      !input.generationContractV2Paths.includes(wanPromotedRegistryPath)) {
    throw new PackageSmokeError("WAN27_PROBE_PROOF_OR_PROMOTION_MISSING");
  }
  let wanProof;
  try { wanProof = JSON.parse(await readFile(join(installedPackagePath, wanProofPath), "utf8")); }
  catch { throw new PackageSmokeError("WAN27_PROBE_PROOF_INVALID"); }
  const wanProofBytes = await readFile(join(installedPackagePath, wanProofPath));
  const wanProofSha = `sha256:${createHash("sha256").update(wanProofBytes).digest("hex")}`;
  const currentPromotedRegistry = loadGenerationContractRegistryV2(basename(currentPromotedRegistryPath), catalogDirectory);
  const wanPromotedRegistry = loadGenerationContractRegistryV2(basename(wanPromotedRegistryPath), catalogDirectory);
  const oldWanContract = existingProfilesV2.contracts.find((contract) => contract.variant_id === "legacy-video-wan_27_t2v-default");
  const currentWanContract = currentPromotedRegistry.contracts.find((contract) => contract.variant_id === "legacy-video-wan_27_t2v-default");
  const promotedWanContract = wanPromotedRegistry.contracts.find((contract) => contract.variant_id === "legacy-video-wan_27_t2v-default");
  const wanLiveRef = promotedWanContract?.provenance.references.find((reference) => reference.kind === "live_owner" && reference.reference.startsWith(`${wanProofPath};`));
  const wanCounts = wanPromotedRegistry.contracts.reduce((counts, contract) => {
    counts[contract.status] = (counts[contract.status] ?? 0) + 1;
    return counts;
  }, {});
  const sameWanRequest = currentWanContract !== undefined && promotedWanContract !== undefined &&
    ["model_id", "operation_id", "modality", "route", "ai_name", "model_type", "variant_id", "parameters", "wire", "output", "limits"]
      .every((key) => JSON.stringify(promotedWanContract[key]) === JSON.stringify(currentWanContract[key]));
  if (wanProof?.artifact_kind !== "OWNER_REVIEWED_EXACT_PROBE_V1" ||
      wanProof?.status !== "PASS_EXACT_RESULT_ONLY" || wanProof?.confidence_scope !== "exact_result_only" ||
      wanProof?.contract_status_at_probe !== "reviewed" || wanProof?.initial_outcome_status !== "OUTCOME_UNKNOWN" ||
      wanProof?.model_id !== "wan_27_t2v" || wanProof?.operation_id !== "generate-video" ||
      wanProof?.variant_id !== "legacy-video-wan_27_t2v-default" ||
      wanProof?.registry_version !== "sha256-075b0789c11c9fef6efd241ba51386e22eb6116f18b2870c04af5a78a0b850ac.json" ||
      wanProof?.schema_hash !== oldWanContract?.schema_hash || wanProof?.probe_call_count !== 1 ||
      wanProof?.public_catalog_version !== "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json" ||
      wanProof?.catalog_version !== currentPromotedRegistry.catalog_version ||
      JSON.stringify(wanProof?.source_hashes) !== JSON.stringify(currentPromotedRegistry.source_hashes) ||
      wanProof?.settings_source_sha256 !== oldWanContract?.provenance.settings_source_sha256 ||
      wanProof?.code_snapshot_sha256 !== "sha256:b70749e1559011f6a7b5319c32c2d09d78f22e83de7223abc53b5bc9b8baae65" ||
      wanProof?.dispatch_count !== 1 || wanProof?.retry_count !== 0 || wanProof?.reconciliation_transport !== "GET_ONLY" ||
      wanProof?.reconciliation_tool_call_count !== 3 || wanProof?.recovery_call_count !== 1 ||
      wanProof?.recovery_paid_dispatch_count !== 0 || wanProof?.reauth_count !== 0 || wanProof?.restart_safe !== false ||
      wanProof?.artifact_count !== 1 || JSON.stringify(wanProof?.mime_types) !== JSON.stringify(["video/mp4"]) ||
      wanProof?.safe_artifact_summary_sha256 !== "sha256:825e67121ff9c7b0db15103bd3db5b154f62853e1bbecce708177e5c4623ba8a" ||
      wanProof?.cleanup?.local_unlink_status !== "REVOKED_READBACK_CONFIRMED" || wanProof?.cleanup?.exit_code !== 0 ||
      wanPromotedRegistry.contracts.length !== 33 || wanCounts.live_verified !== 4 || wanCounts.reviewed !== 29 ||
      currentWanContract?.status !== "reviewed" || promotedWanContract?.status !== "live_verified" || !sameWanRequest ||
      wanLiveRef?.sha256 !== wanProofSha ||
      JSON.stringify(wanPromotedRegistry.source_hashes) !== JSON.stringify(currentPromotedRegistry.source_hashes)) {
    throw new PackageSmokeError("WAN27_PROBE_PROMOTION_BINDING_MISMATCH");
  }
  const oldWanSettings = { ...oldWanContract?.wire.fixed_settings, model_type: "wan_27_t2v" };
  const proofWanSettings = wanProof?.fixed_settings;
  if (proofWanSettings === null || typeof proofWanSettings !== "object" || Array.isArray(proofWanSettings) ||
      Object.keys(proofWanSettings).length !== Object.keys(oldWanSettings).length ||
      Object.entries(oldWanSettings).some(([key, value]) => JSON.stringify(proofWanSettings[key]) !== JSON.stringify(value))) {
    throw new PackageSmokeError("WAN27_PROBE_SETTINGS_MISMATCH");
  }
  const unpromotedCurrentWanContracts = currentPromotedRegistry.contracts.filter((contract) => contract.variant_id !== "legacy-video-wan_27_t2v-default");
  const unpromotedNewWanContracts = wanPromotedRegistry.contracts.filter((contract) => contract.variant_id !== "legacy-video-wan_27_t2v-default");
  if (JSON.stringify(unpromotedNewWanContracts) !== JSON.stringify(unpromotedCurrentWanContracts)) {
    throw new PackageSmokeError("WAN27_PROBE_PROMOTION_SCOPE_MISMATCH");
  }
  const selectedV2Path = input.generationContractV2Paths.find((path) =>
    path.endsWith("sha256-e3a109c3b52f4e1a46b37d5a6f54f311f7f12f99b36da667f85258d928dabffe.json"));
  if (selectedV2Path === undefined) throw new PackageSmokeError("GENERATION_CONTRACT_V2_ARCHIVE_MISSING");
  const selectedV2 = loadSelectedGenerationContractRegistry(basename(selectedV2Path), "2.0.0", catalogDirectory);
  const banana = selectedV2.contracts.find((contract) => contract.variant_id === "banana21-image-1k-minimal-square");
  const seedance = selectedV2.contracts.find((contract) => contract.variant_id === "seedance-pro-fast-video-720p-mini-16x9-5s-audio");
  if (selectedV2.schema_version !== "2.0.0" || selectedV2.contracts.length !== 2 ||
      banana?.model_id !== "banana-2.1" || banana.status !== "live_verified" ||
      banana.wire.fixed_settings.image_size !== "1K" || banana.wire.fixed_settings.thinking_level !== "minimal" ||
      seedance?.model_id !== "seedance_pro-fast" || seedance.status !== "live_verified" ||
      seedance.wire.fixed_settings.video_duration !== 5 || seedance.wire.fixed_settings.generate_audio !== true) {
    throw new PackageSmokeError("GENERATION_CONTRACT_V2_SELECTION_MISMATCH");
  }
  for (const [contract, evidencePath] of [
    [banana, "catalog/runtime/v13/owner-stdio-contract-banana21-smoke.json"],
    [seedance, "catalog/runtime/v13/owner-stdio-contract-seedance-pro-fast-smoke.json"]
  ]) {
    if (contract === undefined || !input.v13Paths.includes(evidencePath)) {
      throw new PackageSmokeError("GENERATION_CONTRACT_V2_EVIDENCE_MISSING");
    }
    const evidenceBytes = await readFile(join(installedPackagePath, evidencePath));
    const evidenceSha = `sha256:${createHash("sha256").update(evidenceBytes).digest("hex")}`;
    if (!contract.provenance.references.some((reference) =>
      reference.kind === "live_owner" && reference.reference.includes(evidencePath) && reference.sha256 === evidenceSha)) {
      throw new PackageSmokeError("GENERATION_CONTRACT_V2_EVIDENCE_LINK_MISMATCH");
    }
  }

  const staticProjectionHistoryPath = join(installedPackagePath, "dist/src/catalog/static-form-control-history.js");
  const { loadPinnedStaticParameterProjection, DEFAULT_STATIC_PARAMETER_PROJECTION_VERSION } = await import(pathToFileURL(staticProjectionHistoryPath).href);
  const staticProjection = loadPinnedStaticParameterProjection(catalogDirectory);
  if (staticProjection.version !== DEFAULT_STATIC_PARAMETER_PROJECTION_VERSION ||
      staticProjection.projection === null || staticProjection.projection.runtime_usable !== false ||
      staticProjection.projection.models.length === 0) {
    throw new PackageSmokeError("PINNED_STATIC_PROJECTION_LOADER_MISMATCH");
  }

  const runtimeCoveragePath = join(installedPackagePath, "dist/src/catalog/runtime-coverage-registry.js");
  const { getRuntimeCoverageProfile, RUNTIME_COVERAGE_VERSION } = await import(pathToFileURL(runtimeCoveragePath).href);
  const seedanceProfile = getRuntimeCoverageProfile("seedance_pro-fast");
  if (typeof RUNTIME_COVERAGE_VERSION !== "string" || RUNTIME_COVERAGE_VERSION.length === 0 ||
      seedanceProfile?.modality !== "video" || seedanceProfile.ai_name !== "seedance" ||
      seedanceProfile.runtime_verified !== true || seedanceProfile.one_copy_only !== true ||
      JSON.stringify(seedanceProfile.settings) !== JSON.stringify({
        model_type: "seedance_pro-fast", resolution: "720p", mode: "mini", aspect_ratio: "16:9",
        video_duration: 5, generate_audio: true
      })) {
    throw new PackageSmokeError("PACKAGED_RUNTIME_COVERAGE_PROFILE_MISMATCH");
  }

  for (const version of ["v12", "v13", "v15"]) {
    const versionPaths = input.staticRuntimePaths.filter((path) => path.startsWith(`catalog/runtime/${version}/`));
    const versionArtifacts = new Map();
    for (const path of versionPaths) {
      let artifact;
      try { artifact = JSON.parse(await readFile(join(installedPackagePath, path), "utf8")); }
      catch { throw new PackageSmokeError(`RUNTIME_${version.toUpperCase()}_OBSERVATION_INVALID`); }
      if ((artifact?.runtime_usable !== undefined && artifact.runtime_usable !== false) || typeof artifact?.artifact_kind !== "string") {
        throw new PackageSmokeError(`RUNTIME_${version.toUpperCase()}_OBSERVATION_SCOPE_INVALID`);
      }
      versionArtifacts.set(path, artifact);
    }
    for (const artifact of versionArtifacts.values()) {
      for (const reference of collectCatalogArtifactReferences(artifact)) {
        if (!input.packagedPaths.has(reference.path) || !/^sha256:[a-f0-9]{64}$/u.test(reference.sha256)) {
          throw new PackageSmokeError(`RUNTIME_${version.toUpperCase()}_LINK_TARGET_INVALID`);
        }
        const linkedBytes = await readFile(join(installedPackagePath, reference.path));
        const linkedSha = `sha256:${createHash("sha256").update(linkedBytes).digest("hex")}`;
        if (linkedSha !== reference.sha256) throw new PackageSmokeError(`RUNTIME_${version.toUpperCase()}_LINK_HASH_MISMATCH`);
      }
    }
    if (version === "v15") {
      const expectedNames = [
        "catalog/runtime/v15/owner-stdio-v2-banana21-smoke.json",
        "catalog/runtime/v15/owner-stdio-v2-seedance-pro-fast-smoke.json"
      ];
      if (JSON.stringify([...versionArtifacts.keys()].sort()) !== JSON.stringify(expectedNames)) {
        throw new PackageSmokeError("RUNTIME_V15_PROFILE_SET_MISMATCH");
      }
      const image = versionArtifacts.get(expectedNames[0]);
      const video = versionArtifacts.get(expectedNames[1]);
      if (image?.artifact_kind !== "OWNER_STDIO_V2_CONTRACT_MEDIA_SMOKE" ||
          image?.observation?.status !== "PASS" || image?.observation?.process_exit_code !== 0 ||
          image?.observation?.local_cleanup_status !== "REVOKED" ||
          image?.exact_profile?.contract_schema_version !== "2.0.0" ||
          image?.exact_profile?.variant_id !== "banana21-image-1k-minimal-square" ||
          image?.exact_profile?.model_id !== "banana-2.1" ||
          image?.result?.artifact_count !== 1 || JSON.stringify(image?.result?.mime_types) !== JSON.stringify(["image/jpeg"]) ||
          video?.artifact_kind !== "OWNER_STDIO_V2_CONTRACT_MEDIA_SMOKE" ||
          video?.observation?.status !== "PASS" || video?.observation?.process_exit_code !== 0 ||
          video?.observation?.local_cleanup_status !== "REVOKED" ||
          video?.exact_profile?.contract_schema_version !== "2.0.0" ||
          video?.exact_profile?.variant_id !== "seedance-pro-fast-video-720p-mini-16x9-5s-audio" ||
          video?.exact_profile?.model_id !== "seedance_pro-fast" ||
          video?.result?.artifact_count !== 1 || JSON.stringify(video?.result?.mime_types) !== JSON.stringify(["video/mp4"])) {
        throw new PackageSmokeError("RUNTIME_V15_PROFILE_EVIDENCE_MISMATCH");
      }
    }
  }
  await assertPathsMissing([
    join(installedPackagePath, "dist/tools"),
    join(installedPackagePath, "node_modules/typescript")
  ]);
}

async function assertOwnerAuthPersistenceProof(installedPackagePath, staticRuntimePaths) {
  if (!staticRuntimePaths.includes(PERSISTENT_AUTH_PROOF_PATH) || !staticRuntimePaths.includes(SUPERSEDED_PERSISTENT_AUTH_PROOF_PATH)) {
    throw new PackageSmokeError("OWNER_AUTH_PERSISTENCE_PROOF_MISSING");
  }
  let proof;
  try { proof = JSON.parse(await readFile(join(installedPackagePath, PERSISTENT_AUTH_PROOF_PATH), "utf8")); }
  catch { throw new PackageSmokeError("OWNER_AUTH_PERSISTENCE_PROOF_INVALID"); }
  const supersededBytes = await readFile(join(installedPackagePath, SUPERSEDED_PERSISTENT_AUTH_PROOF_PATH));
  const supersededSha = `sha256:${createHash("sha256").update(supersededBytes).digest("hex")}`;
  const expectedSourceIds = ["auth_secret_vault", "owner_stdio_entrypoint", "per_user_link_service", "private_auth_profile", "sqlite_auth_store"];
  const actualSourceIds = (proof?.source_bindings?.sources ?? []).map((source) => source.source_id).sort();
  const eventTime = proof?.manual_reconciliation?.completed_at_utc;
  const snapshotTime = proof?.source_bindings?.snapshot_captured_at_utc;
  const hashPattern = /^sha256:[a-f0-9]{64}$/u;
  if (proof?.schema_version !== "1.0.0" || proof?.artifact_kind !== "OWNER_STDIO_PERSISTENT_AUTH_RECONCILIATION" ||
      proof?.runtime_usable !== false || proof?.outcome !== "MANUAL_SAME_INTENT_SDK_RECONCILIATION_PASS" ||
      eventTime !== "2026-10-08T20:51:58Z" || !Number.isFinite(Date.parse(eventTime)) || Date.parse(eventTime) > Date.now() ||
      snapshotTime !== "2026-10-08T20:59:41Z" || Date.parse(eventTime) >= Date.parse(snapshotTime) ||
      proof?.supersedes_artifact_sha256 !== supersededSha ||
      JSON.stringify(proof?.correction_reasons) !== JSON.stringify([
        "RECONCILIATION_TIME_IS_UTC_OCTOBER_8_NOT_LOCAL_OCTOBER_9",
        "TASK_25_IDENTIFIER_IS_NOT_A_SOURCE_CHANGE_COUNT",
        "WORKTREE_HASHES_ARE_DOCUMENTARY_SNAPSHOT_NOT_EVENT_TIME_EVIDENCE",
        "ARCHIVED_SOURCE_HASHES_MUST_NOT_BE_COMPARED_TO_FUTURE_WORKTREE"
      ]) ||
      proof?.source_bindings?.event_time_source_freshness_claimed !== false ||
      proof?.source_bindings?.commit_attribution !== null ||
      JSON.stringify(proof?.source_bindings?.source_change_task_ids) !== JSON.stringify(["25"]) ||
      Object.hasOwn(proof?.source_bindings ?? {}, "uncommitted_source_changes_in_checkout") ||
      JSON.stringify(actualSourceIds) !== JSON.stringify(expectedSourceIds) ||
      (proof.source_bindings.sources ?? []).some((source) => !hashPattern.test(source.sha256)) ||
      !hashPattern.test(proof?.local_harness_validation?.post_repair_harness_source_sha256 ?? "") ||
      !hashPattern.test(proof?.local_harness_validation?.test_source_sha256 ?? "") ||
      proof?.manual_reconciliation?.new_begin_login_calls_during_reconciliation !== 0 ||
      proof?.manual_reconciliation?.new_personal_handoffs_during_reconciliation !== 0 ||
      proof?.manual_reconciliation?.same_private_profile_reused !== true || proof?.manual_reconciliation?.same_attempt_reused !== true ||
      JSON.stringify(proof?.manual_reconciliation?.sdk_lifecycle) !== JSON.stringify([
        "LINKED", "STDIO_EOF", "NEW_SDK_CHILD", "LINKED_SAME_ATTEMPT", "ACCOUNT_READ_SUCCESS",
        "UNLINK_REVOKED", "REVOCATION_READBACK_CONFIRMED", "PROFILE_LEASES_ABSENT"
      ]) ||
      proof?.manual_reconciliation?.pre_resume_local_auth_state?.status !== "POLLING" ||
      proof?.manual_reconciliation?.pre_resume_local_auth_state?.expired !== false ||
      proof?.manual_reconciliation?.pre_resume_local_auth_state?.inflight !== false ||
      proof?.manual_reconciliation?.pre_resume_local_auth_state?.profile_lease_present !== false ||
      proof?.manual_reconciliation?.pre_resume_local_auth_state?.upstream_poll_outcome_unknown !== false ||
      proof?.initial_real_harness_observation?.status !== "FAIL" ||
      proof?.initial_real_harness_observation?.classification !== "LOCAL_POLLING_MISCLASSIFIED_AS_UNKNOWN_BEFORE_LINK" ||
      proof?.initial_real_harness_observation?.initial_harness_sha256 !== null ||
      proof?.latest_real_harness_rerun?.performed !== false ||
      proof?.latest_real_harness_rerun?.full_harness_pass_claimed !== false ||
      proof?.local_harness_validation?.status !== "PASS" || proof?.local_harness_validation?.test_count !== 12 ||
      proof?.local_harness_validation?.scope !== "LOCAL_TESTS_ONLY" ||
      proof?.external_actions?.payment_calls !== 0 || proof?.external_actions?.upload_calls !== 0 ||
      proof?.external_actions?.cancellation_calls !== 0 || proof?.external_actions?.paid_generation_calls !== 0 ||
      proof?.external_actions?.initial_auth_start_count !== 1 || proof?.external_actions?.initial_personal_handoff_count !== 1 ||
      proof?.manual_reconciliation?.fixture_state_after_revocation !== "RETAINED_AFTER_REVOKED" ||
      proof?.profile_metadata?.profile_directory_mode_octal !== "0700" || proof?.profile_metadata?.key_file_mode_octal !== "0600" ||
      proof?.profile_metadata?.master_key_length_bytes !== 32 ||
      Object.values(proof?.privacy ?? {}).some((value) => value !== false)) {
    throw new PackageSmokeError("OWNER_AUTH_PERSISTENCE_PROOF_SCOPE_MISMATCH");
  }
}

async function assertInstalledOwnerContractMediaStdio(installedPackagePath, consumerPath) {
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"),
    import("@modelcontextprotocol/sdk/client/stdio.js")
  ]);
  const registryVersion = "sha256-0a82b91685746f4aeec1b0ba4e24fccdc21532d4e3feac85969e55302b463d45.json";
  const client = new Client({ name: "syntx-packaged-owner-contract-media-smoke", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(installedPackagePath, "dist/src/transports/stdio-owner.js")],
    cwd: consumerPath,
    env: {
      SYNTX_OWNER_ACCOUNT_STATUS: "1",
      SYNTX_OWNER_GENERATE_CONTRACT_MEDIA: "1",
      SYNTX_GENERATION_CONTRACT_VERSION: registryVersion
    },
    stderr: "pipe"
  });
  const requestOptions = { timeout: 5_500, maxTotalTimeout: 5_500 };
  const promptMarker = "package-smoke-local-validation-private-fixture";
  try {
    await client.connect(transport);
    const tools = await client.listTools({}, requestOptions);
    const names = new Set((tools.tools ?? []).map((tool) => tool.name));
    for (const name of ["syntx_owner_generate_media", "syntx_get_generation_schema", "syntx_validate_generation"]) {
      if (!names.has(name)) throw new PackageSmokeError("INSTALLED_OWNER_CONTRACT_MEDIA_TOOL_MISSING");
    }
    const schema = await client.callTool({
      name: "syntx_get_generation_schema",
      arguments: { model_id: "banana-2.1", operation_id: "generate-image" }
    }, undefined, requestOptions);
    if (schema.isError === true || schema.structuredContent?.schema_status !== "live_verified" ||
        schema.structuredContent?.model_id !== "banana-2.1" ||
        schema.structuredContent?.contract_schema_version !== undefined ||
        schema.structuredContent?.variant_id !== undefined) {
      throw new PackageSmokeError("INSTALLED_OWNER_CONTRACT_MEDIA_REGISTRY_UNAVAILABLE");
    }
    const validation = await client.callTool({
      name: "syntx_validate_generation",
      arguments: {
        model_id: "banana-2.1",
        operation_id: "generate-image",
        parameters: { prompt: promptMarker, file_urls: [] }
      }
    }, undefined, requestOptions);
    if (validation.isError === true || validation.structuredContent?.validation_status !== "VALID" ||
        validation.structuredContent?.parameters_redacted !== true || JSON.stringify(validation).includes(promptMarker)) {
      throw new PackageSmokeError("INSTALLED_OWNER_CONTRACT_MEDIA_VALIDATION_FAILED");
    }
    const noAuthGeneration = await client.callTool({
      name: "syntx_owner_generate_media",
      arguments: {
        link_attempt_id: "link_package_smoke_unlinked_attempt_000001",
        model_id: "banana-2.1",
        operation_id: "generate-image",
        parameters: { prompt: promptMarker, file_urls: [] }
      }
    }, undefined, requestOptions);
    const serialized = JSON.stringify(noAuthGeneration);
    if (noAuthGeneration.isError !== true || !serialized.includes("AUTH_REQUIRED") || serialized.includes(promptMarker)) {
      throw new PackageSmokeError("INSTALLED_OWNER_CONTRACT_MEDIA_NOAUTH_GUARD_FAILED");
    }
  } finally {
    await client.close().catch(() => undefined);
  }

  const v2Client = new Client({ name: "syntx-packaged-owner-contract-media-v2-smoke", version: "1.0.0" });
  const v2Transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(installedPackagePath, "dist/src/transports/stdio-owner.js")],
    cwd: consumerPath,
    env: {
      SYNTX_OWNER_ACCOUNT_STATUS: "1",
      SYNTX_OWNER_GENERATE_CONTRACT_MEDIA: "1",
      SYNTX_GENERATION_CONTRACT_SCHEMA_VERSION: "2.0.0",
      SYNTX_GENERATION_CONTRACT_VERSION: "sha256-e3a109c3b52f4e1a46b37d5a6f54f311f7f12f99b36da667f85258d928dabffe.json"
    },
    stderr: "pipe"
  });
  const videoVariantId = "seedance-pro-fast-video-720p-mini-16x9-5s-audio";
  try {
    await v2Client.connect(v2Transport);
    const tools = await v2Client.listTools({}, requestOptions);
    const names = new Set((tools.tools ?? []).map((tool) => tool.name));
    for (const name of ["syntx_owner_generate_media", "syntx_get_generation_schema", "syntx_validate_generation"]) {
      if (!names.has(name)) throw new PackageSmokeError("INSTALLED_OWNER_CONTRACT_MEDIA_V2_TOOL_MISSING");
    }
    const schema = await v2Client.callTool({
      name: "syntx_get_generation_schema",
      arguments: { model_id: "seedance_pro-fast", operation_id: "generate-video", variant_id: videoVariantId }
    }, undefined, requestOptions);
    if (schema.isError === true || schema.structuredContent?.schema_status !== "live_verified" ||
        schema.structuredContent?.contract_schema_version !== "2.0.0" ||
        schema.structuredContent?.variant_id !== videoVariantId ||
        schema.structuredContent?.model_id !== "seedance_pro-fast" ||
        schema.structuredContent?.parameter_schema_v2 === null ||
        typeof schema.structuredContent?.parameter_schema_v2 !== "object") {
      throw new PackageSmokeError("INSTALLED_OWNER_CONTRACT_MEDIA_V2_REGISTRY_UNAVAILABLE");
    }
    const validation = await v2Client.callTool({
      name: "syntx_validate_generation",
      arguments: {
        model_id: "seedance_pro-fast",
        operation_id: "generate-video",
        variant_id: videoVariantId,
        parameters: { prompt: promptMarker }
      }
    }, undefined, requestOptions);
    if (validation.isError === true || validation.structuredContent?.validation_status !== "VALID" ||
        validation.structuredContent?.contract_schema_version !== "2.0.0" ||
        validation.structuredContent?.variant_id !== videoVariantId ||
        validation.structuredContent?.parameters_redacted !== true || JSON.stringify(validation).includes(promptMarker)) {
      throw new PackageSmokeError("INSTALLED_OWNER_CONTRACT_MEDIA_V2_VALIDATION_FAILED");
    }
    const noAuthGeneration = await v2Client.callTool({
      name: "syntx_owner_generate_media",
      arguments: {
        link_attempt_id: "link_package_smoke_unlinked_attempt_v2_000001",
        model_id: "seedance_pro-fast",
        operation_id: "generate-video",
        variant_id: videoVariantId,
        parameters: { prompt: promptMarker }
      }
    }, undefined, requestOptions);
    const serialized = JSON.stringify(noAuthGeneration);
    if (noAuthGeneration.isError !== true || !serialized.includes("AUTH_REQUIRED") || serialized.includes(promptMarker)) {
      throw new PackageSmokeError("INSTALLED_OWNER_CONTRACT_MEDIA_V2_NOAUTH_GUARD_FAILED");
    }
  } finally {
    await v2Client.close().catch(() => undefined);
  }
}

function collectCatalogArtifactReferences(value) {
  const references = [];
  const visit = (node) => {
    if (Array.isArray(node)) { for (const item of node) visit(item); return; }
  if (node === null || typeof node !== "object") return;
  const sourceHash = typeof node.sha256 === "string" ? node.sha256 : node.artifact_sha256;
  if (typeof node.path === "string" && node.path.startsWith("catalog/") &&
      !node.path.split("/").includes("..") && typeof sourceHash === "string") {
      references.push({ path: node.path, sha256: sourceHash });
    }
    for (const child of Object.values(node)) visit(child);
  };
  visit(value);
  return references;
}

async function expectedVersionedGenericResultPaths(root = PROJECT_ROOT) {
  let entries;
  try {
    entries = await readdir(join(root, VERSIONED_GENERIC_RESULT_DIR));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  if (entries.some((entry) => !entry.endsWith(".json"))) {
    throw new PackageSmokeError("PACKAGE_CONTENT_FORBIDDEN");
  }
  return entries.sort().map((entry) => `${VERSIONED_GENERIC_RESULT_DIR}/${entry}`);
}

async function assertVersionedGenericFormResultSetMatches(packagedPaths) {
  const expected = await expectedVersionedGenericResultPaths();
  const packaged = [...packagedPaths]
    .filter((path) => path.startsWith(`${VERSIONED_GENERIC_RESULT_DIR}/`))
    .sort();
  if (JSON.stringify(packaged) !== JSON.stringify(expected)) {
    throw new PackageSmokeError("PACKAGE_CONTENT_MISMATCH");
  }
}

async function assertInstalledVersionedGenericResults(installedPackagePath) {
  const directory = join(installedPackagePath, VERSIONED_GENERIC_RESULT_DIR);
  let entries;
  try {
    entries = await readdir(directory);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.endsWith(".json")) throw new PackageSmokeError("PACKAGE_CONTENT_FORBIDDEN");
    let value;
    try { value = JSON.parse(await readFile(join(directory, entry), "utf8")); } catch { throw new PackageSmokeError("PACKAGE_CONTENT_MISMATCH"); }
    if (value?.runtime_usable !== false || value?.catalog_kind !== "OBSERVED_NORMALIZED_SETTINGS_IR_GENERIC_FORM_RESULT" || value?.scope?.kind !== "SINGLE_FORM_NO_AUXILIARIES_V1" || typeof value?.scope?.form_id !== "string" || value?.result?.verification_status !== "EXACT_RECOMPILED_ADAPTER_OUTPUT_MATCH") {
      throw new PackageSmokeError("PACKAGE_CONTENT_MISMATCH");
    }
  }
}

async function assertInstalledOwnerGrokReferenceProfiles(installedPackagePath, consumerPath, packagedPaths) {
  const versions = await assertJsonArtifactDirectorySetMatches(
    OWNER_GROK_REFERENCE_PROFILE_DIR,
    packagedPaths,
    OWNER_GROK_REFERENCE_PROFILE_VERSION_PATTERN
  );
  await assertInstalledJsonArtifactBytes(installedPackagePath, versions);
  const profileHistoryUrl = pathToFileURL(join(
    installedPackagePath,
    "dist/src/catalog/owner-grok-image-reference-profile-history.js"
  )).href;
  const profileModuleUrl = pathToFileURL(join(
    installedPackagePath,
    "dist/src/catalog/owner-grok-image-reference-profiles.js"
  )).href;
  const selectedCatalogUrl = pathToFileURL(join(
    installedPackagePath,
    "dist/src/catalog/selected-discovery-catalog.js"
  )).href;
  const catalogDirectory = join(installedPackagePath, "catalog");
  const versionsByName = versions.map((path) => basename(path));
  await run(process.execPath, ["--input-type=module", "--eval", [
    "import assert from 'node:assert/strict';",
    "import { readFile } from 'node:fs/promises';",
    "import { join } from 'node:path';",
    `const { loadOwnerGrokImageReferenceProfileSetV1 } = await import(${JSON.stringify(profileHistoryUrl)});`,
    `const { getOwnerGrokImageReferenceProfile, validateOwnerGrokImageReferenceParameters } = await import(${JSON.stringify(profileModuleUrl)});`,
    `const { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } = await import(${JSON.stringify(selectedCatalogUrl)});`,
    `const catalogDirectory = ${JSON.stringify(catalogDirectory)};`,
    `const versions = ${JSON.stringify(versionsByName)};`,
    "assert.ok(versions.length > 0);",
    "const selected = loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, catalogDirectory);",
    "for (const version of versions) {",
    "const artifactBytes = await readFile(join(catalogDirectory, 'owner-image-reference-profiles', 'v1', version));",
    "const artifact = JSON.parse(artifactBytes.toString('utf8'));",
    "const set = loadOwnerGrokImageReferenceProfileSetV1(version, selected.discoveryCatalog, catalogDirectory);",
    "assert.equal(set.profile_set_sha256, artifact.profile_set_sha256);",
    "assert.equal(set.catalog_version, selected.discoveryCatalog.fetched_at + '.' + selected.discoveryCatalog.source_hashes.models.slice(7, 19));",
    "assert.equal(set.defaults_claimed, false); assert.equal(set.backend_acceptance, 'unproven');",
    "assert.equal(set.profile_ids.length, 3);",
    "const one = getOwnerGrokImageReferenceProfile(set, 'grok-i2i-reference-one-source-reviewed');",
    "const multi = getOwnerGrokImageReferenceProfile(set, 'grok-i2i-reference-multi-source-reviewed');",
    "const pro = getOwnerGrokImageReferenceProfile(set, 'grok-i2i-pro-reference-one-source-reviewed');",
    "for (const profile of [one, multi, pro]) { assert.equal(profile.backend_acceptance, 'unproven'); assert.equal(profile.output_policy.batch_result_count_relation, 'unproven'); }",
    "assert.deepEqual(validateOwnerGrokImageReferenceParameters(one, {prompt:'Installed package profile check',resolution:'1k',batch_size:1}, 1).settings, {n:1,model_type:'grok_i2i',resolution:'1k',batch_size:1});",
    "const multiRequest = validateOwnerGrokImageReferenceParameters(multi, {prompt:'Installed package profile check',resolution:'2k',batch_size:5,aspect_ratio:'16:9'}, 2);",
    "assert.deepEqual(multiRequest.settings, {n:1,model_type:'grok_i2i',resolution:'2k',batch_size:5,aspect_ratio:'16:9'});",
    "assert.equal(Object.hasOwn(multiRequest.settings, 'file_urls'), false);",
    "assert.deepEqual(validateOwnerGrokImageReferenceParameters(pro, {prompt:'Installed package profile check',resolution:'1k',batch_size:5}, 1).settings, {n:1,model_type:'grok_i2i_pro',resolution:'1k',batch_size:5});",
    "assert.throws(() => validateOwnerGrokImageReferenceParameters(multi, {prompt:'Installed package profile check',resolution:'2k',batch_size:5,aspect_ratio:'CUSTOM'}, 2), (error) => error?.code === 'GROK_REFERENCE_PARAMETERS_INVALID');",
    "assert.throws(() => validateOwnerGrokImageReferenceParameters(multi, {prompt:'Installed package profile check',resolution:'2k',batch_size:5,aspect_ratio:'16:9',file_urls:['https://example.invalid/x.png']}, 2), (error) => error?.code === 'GROK_REFERENCE_PARAMETERS_INVALID');",
    "assert.throws(() => getOwnerGrokImageReferenceProfile({...set}, 'grok-i2i-reference-one-source-reviewed'), (error) => error?.code === 'GROK_REFERENCE_PROFILE_SET_FORGED');",
    "assert.throws(() => validateOwnerGrokImageReferenceParameters({...multi}, {prompt:'Installed package profile check',resolution:'2k',batch_size:5,aspect_ratio:'16:9'}, 2), (error) => error?.code === 'GROK_REFERENCE_PROFILE_FORGED');",
    "}"
  ].join("\n")], consumerPath);
  return versions;
}

const SETTINGS_SOURCE_HISTORY_DIR = "catalog/settings";
const SETTINGS_SOURCE_VERSION_PATTERN = /^sha256-[a-f0-9]{64}\.json$/u;
const MAPLESS_SETTINGS_HISTORY_DIR = "catalog/settings/v2";
const MAPLESS_SETTINGS_VERSION_PATTERN = /^sha256-[a-f0-9]{64}\.json$/u;

async function expectedSettingsSourceInventoryVersionPaths(root = PROJECT_ROOT) {
  let entries;
  try {
    entries = await readdir(join(root, SETTINGS_SOURCE_HISTORY_DIR), {
      withFileTypes: true
    });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  // v2 is a separate additive generation with its own validator below.
  if (entries.some((entry) => entry.isSymbolicLink() || (entry.isDirectory() ? entry.name !== "v2" : !entry.isFile() || !SETTINGS_SOURCE_VERSION_PATTERN.test(entry.name)))) {
    throw new PackageSmokeError("PACKAGE_CONTENT_FORBIDDEN");
  }
  return entries.filter((entry) => entry.isFile()).map((entry) => `${SETTINGS_SOURCE_HISTORY_DIR}/${entry.name}`).sort();
}

async function assertSettingsSourceInventoryVersionSetMatches(packagedPaths) {
  const versions = [...packagedPaths]
    .filter((path) => path.startsWith(`${SETTINGS_SOURCE_HISTORY_DIR}/`) && !path.startsWith(`${MAPLESS_SETTINGS_HISTORY_DIR}/`))
    .sort();
  if (versions.some((path) => path !== `${SETTINGS_SOURCE_HISTORY_DIR}/${basename(path)}` || !SETTINGS_SOURCE_VERSION_PATTERN.test(basename(path)))) {
    throw new PackageSmokeError("PACKAGE_CONTENT_FORBIDDEN");
  }
  const expected = await expectedSettingsSourceInventoryVersionPaths();
  if (JSON.stringify(versions) !== JSON.stringify(expected)) {
    throw new PackageSmokeError("PACKAGE_CONTENT_MISMATCH");
  }
  return versions;
}

async function expectedMaplessSettingsInventoryVersionPaths(root = PROJECT_ROOT) {
  let entries;
  try {
    entries = await readdir(join(root, MAPLESS_SETTINGS_HISTORY_DIR), { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  if (entries.some((entry) => entry.isSymbolicLink() || !entry.isFile() || !MAPLESS_SETTINGS_VERSION_PATTERN.test(entry.name))) {
    throw new PackageSmokeError("PACKAGE_CONTENT_FORBIDDEN");
  }
  return entries.map((entry) => `${MAPLESS_SETTINGS_HISTORY_DIR}/${entry.name}`).sort();
}

async function assertMaplessSettingsInventoryVersionSetMatches(packagedPaths) {
  const versions = [...packagedPaths].filter((path) => path.startsWith(`${MAPLESS_SETTINGS_HISTORY_DIR}/`)).sort();
  if (versions.some((path) => path !== `${MAPLESS_SETTINGS_HISTORY_DIR}/${basename(path)}` || !MAPLESS_SETTINGS_VERSION_PATTERN.test(basename(path)))) {
    throw new PackageSmokeError("PACKAGE_CONTENT_FORBIDDEN");
  }
  const expected = await expectedMaplessSettingsInventoryVersionPaths();
  if (JSON.stringify(versions) !== JSON.stringify(expected) || versions.length === 0) {
    throw new PackageSmokeError("PACKAGE_CONTENT_MISMATCH");
  }
  return versions;
}

const SOUL_IMAGE_TOOL_NAMES = Object.freeze([
  "syntx_owner_generate_soul_image",
  "syntx_owner_reconcile_soul_image",
  "syntx_owner_list_soul_image_recoveries",
  "syntx_list_owner_soul_character_options",
  "syntx_list_owner_soul_style_options"
]);
const SOUL_QUALITY_RESOLUTION_PAIRS = Object.freeze({
  "720p": Object.freeze(["2048x1152", "1680x1120", "1536x1152", "1536x1536", "1152x1536", "1120x1680", "1152x2048"]),
  "1080p": Object.freeze(["2048x1152", "2016x1344", "2048x1536", "1536x1536", "1536x2048", "1344x2016", "1152x2048"])
});
const SOUL_MODEL_ID = "higgsfield-soul";
const SOUL_CATALOG_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const SOUL_SOURCE_MAPPING_SHA256 = "sha256:a11bcb0b533f7f3f9f1668e5bab290ef5d0ba85410df5b78f18e361db96b9391";

class SoulImageInstalledCheckError extends Error {
  constructor(code) { super(code); this.name = "SoulImageInstalledCheckError"; this.code = code; }
}

export function assertSoulImagePublicExports(api, modules) {
  const pairs = [
    ["OwnerSoulImageGenerationService", "generation"], ["OwnerSoulImageGenerationServiceError", "generation"],
    ["OWNER_SOUL_IMAGE_GENERATION_PHASES", "generation"], ["OWNER_SOUL_IMAGE_GENERATION_ERROR_CODES", "generation"],
    ["OWNER_SOUL_IMAGE_GENERATION_HISTORY_REASONS", "generation"], ["OWNER_SOUL_IMAGE_GENERATION_RESULT_REASONS", "generation"],
    ["getOwnerSoulGenerationSourceParameters", "parameters"], ["normalizeOwnerSoulGenerationParameters", "parameters"],
    ["OwnerSoulGenerationParametersError", "parameters"], ["getOwnerSoulImageSourceProfile", "sourceProfile"],
    ["OwnerSoulImageSourceProfileError", "sourceProfile"], ["OWNER_SOUL_IMAGE_TOOL_NAMES", "tools"],
    ["OWNER_SOUL_IMAGE_TOOL_INPUT_SCHEMAS", "tools"], ["OWNER_SOUL_IMAGE_TOOL_OUTPUT_SCHEMAS", "tools"],
    ["registerSyntxOwnerSoulImageTools", "tools"], ["SYNTX_OWNER_GENERATE_SOUL_IMAGE_TOOL_NAME", "tools"],
    ["SYNTX_OWNER_RECONCILE_SOUL_IMAGE_TOOL_NAME", "tools"], ["SYNTX_OWNER_LIST_SOUL_IMAGE_RECOVERIES_TOOL_NAME", "tools"],
    ["SYNTX_LIST_OWNER_SOUL_CHARACTER_OPTIONS_TOOL_NAME", "tools"],
    ["SYNTX_LIST_OWNER_SOUL_STYLE_OPTIONS_TOOL_NAME", "styleTools"], ["registerSyntxOwnerSoulStyleOptionsTool", "styleTools"]
  ];
  if (api === null || typeof api !== "object" || pairs.some(([name, moduleName]) =>
    modules?.[moduleName] === null || typeof modules?.[moduleName] !== "object" || api[name] !== modules[moduleName][name])) {
    throw new SoulImageInstalledCheckError("INSTALLED_SOUL_IMAGE_PUBLIC_EXPORT_MISMATCH");
  }
  for (const name of ["OwnerSoulImagePreparedCandidate", "OwnerSoulImageOneShotPermit", "createOwnerSoulImageOneShotPermit",
    "consumeOwnerSoulImageOneShotPermit", "getOwnerSoulCharacterReferenceId", "readOwnerSoulCharacterRevalidationProvenance",
    "readOwnerSoulStyleRevalidationProvenance", "InternalOwnerSoulImageResultArtifact", "OwnerSoulCharacterHandleResolution"]) {
    if (Object.hasOwn(api, name)) throw new SoulImageInstalledCheckError("INSTALLED_SOUL_IMAGE_PRIVATE_EXPORT_LEAK");
  }
  return true;
}

export function assertSoulImageToolSurface(tools, enabled) {
  if (!Array.isArray(tools) || typeof enabled !== "boolean") throw new SoulImageInstalledCheckError("INSTALLED_SOUL_IMAGE_TOOLS_LIST_INVALID");
  const selected = tools.filter((tool) => SOUL_IMAGE_TOOL_NAMES.includes(tool?.name));
  if (!enabled) {
    if (selected.length !== 0) throw new SoulImageInstalledCheckError("INSTALLED_SOUL_IMAGE_DEFAULT_OFF_FAILED");
    return Object.freeze({ soul_image_tool_count: 0 });
  }
  const byName = new Map(selected.map((tool) => [tool.name, tool]));
  if (selected.length !== SOUL_IMAGE_TOOL_NAMES.length || SOUL_IMAGE_TOOL_NAMES.some((name) => !byName.has(name)) ||
      new Set(selected.map((tool) => tool.name)).size !== SOUL_IMAGE_TOOL_NAMES.length) {
    throw new SoulImageInstalledCheckError("INSTALLED_SOUL_IMAGE_TOOL_SET_MISMATCH");
  }
  const generate = byName.get(SOUL_IMAGE_TOOL_NAMES[0]);
  const reconcile = byName.get(SOUL_IMAGE_TOOL_NAMES[1]);
  const recoveries = byName.get(SOUL_IMAGE_TOOL_NAMES[2]);
  const character = byName.get(SOUL_IMAGE_TOOL_NAMES[3]);
  const style = byName.get(SOUL_IMAGE_TOOL_NAMES[4]);
  assertSoulStrictSchema(generate.inputSchema, "INSTALLED_SOUL_IMAGE_GENERATE_SCHEMA_INVALID");
  assertSoulStrictSchema(generate.outputSchema, "INSTALLED_SOUL_IMAGE_GENERATE_SCHEMA_INVALID");
  assertSoulStrictSchema(reconcile.inputSchema, "INSTALLED_SOUL_IMAGE_RECONCILE_SCHEMA_INVALID");
  assertSoulStrictSchema(reconcile.outputSchema, "INSTALLED_SOUL_IMAGE_RECONCILE_SCHEMA_INVALID");
  assertSoulStrictSchema(recoveries.inputSchema, "INSTALLED_SOUL_IMAGE_RECOVERIES_SCHEMA_INVALID");
  assertSoulStrictSchema(recoveries.outputSchema, "INSTALLED_SOUL_IMAGE_RECOVERIES_SCHEMA_INVALID");
  assertSoulStrictSchema(character.inputSchema, "INSTALLED_SOUL_CHARACTER_SCHEMA_INVALID");
  assertSoulStrictSchema(character.outputSchema, "INSTALLED_SOUL_CHARACTER_SCHEMA_INVALID");
  assertSoulStrictSchema(style.inputSchema, "INSTALLED_SOUL_STYLE_SCHEMA_INVALID");
  assertSoulStrictSchema(style.outputSchema, "INSTALLED_SOUL_STYLE_SCHEMA_INVALID");
  assertSoulExactSchemaKeys(generate.inputSchema, ["link_attempt_id", "prompt", "quality", "resolution", "batch_size", "enhance_prompt", "seed", "style", "character"], "INSTALLED_SOUL_IMAGE_GENERATE_SCHEMA_INVALID");
  assertSoulExactSchemaKeys(reconcile.inputSchema, ["link_attempt_id", "recovery_id"], "INSTALLED_SOUL_IMAGE_RECONCILE_SCHEMA_INVALID");
  assertSoulExactSchemaKeys(recoveries.inputSchema, ["link_attempt_id", "limit"], "INSTALLED_SOUL_IMAGE_RECOVERIES_SCHEMA_INVALID");
  assertSoulExactSchemaKeys(character.inputSchema, ["link_attempt_id"], "INSTALLED_SOUL_CHARACTER_SCHEMA_INVALID");
  assertSoulExactSchemaKeys(style.inputSchema, ["link_attempt_id"], "INSTALLED_SOUL_STYLE_SCHEMA_INVALID");
  assertSoulExactSchemaKeys(generate.outputSchema, ["status", "dispatch_allowed", "backend_acceptance", "provider_execution", "model_id",
    "profile_id", "profile_schema_hash", "catalog_version", "request_fingerprint", "intent_fingerprint", "parameters", "selection",
    "cost_routing", "cost_inputs", "source_projection_confidence", "reference_strength", "requested_batch_size", "actual_result_count",
    "count_confidence", "artifacts", "recovery_id"], "INSTALLED_SOUL_IMAGE_OUTPUT_SCHEMA_INVALID");
  assertSoulExactSchemaKeys(character.outputSchema, ["status", "model_id", "catalog_version", "source_mapping_sha256", "confidence_scope",
    "reference_id_type_confidence", "generation_allowed", "expires_in_seconds", "options", "summary"], "INSTALLED_SOUL_CHARACTER_SCHEMA_INVALID");
  assertSoulExactSchemaKeys(style.outputSchema, ["status", "model_id", "catalog_version", "confidence_scope", "source_reviewed",
    "source_mapping_sha256", "generation_allowed", "expires_in_seconds", "options", "summary"], "INSTALLED_SOUL_STYLE_SCHEMA_INVALID");
  const generateProperties = generate.inputSchema.properties ?? {};
  if (generateProperties.quality?.enum?.join(",") !== "720p,1080p" ||
      JSON.stringify(generateProperties.resolution?.enum) !== JSON.stringify(Object.values(SOUL_QUALITY_RESOLUTION_PAIRS).flat().filter((value, index, all) => all.indexOf(value) === index)) ||
      JSON.stringify(generateProperties.batch_size?.anyOf?.map((schema) => schema.const).sort()) !== JSON.stringify([1, 4]) ||
      generateProperties.prompt?.maxLength !== 131_072 || generateProperties.enhance_prompt?.type !== "boolean" ||
      !soulNullableIntegerRange(generateProperties.seed, 0, 2_147_483_647) ||
      hasSoulForbiddenProperty(generate.inputSchema) || hasSoulForbiddenProperty(generate.outputSchema)) {
    throw new SoulImageInstalledCheckError("INSTALLED_SOUL_IMAGE_GENERATE_SCHEMA_INVALID");
  }
  const output = generate.outputSchema.properties ?? {};
  if (output.dispatch_allowed?.const !== false || output.backend_acceptance?.const !== "UNPROVEN" ||
      output.provider_execution?.const !== false || output.model_id?.const !== SOUL_MODEL_ID ||
      output.profile_id?.const !== "owner-soul-image-source-profile-v1" ||
      output.catalog_version?.const !== SOUL_CATALOG_VERSION || output.profile_schema_hash?.pattern !== "^sha256:[a-f0-9]{64}$" ||
      output.source_projection_confidence?.const !== "EXPLICIT_SOURCE_UI_CONTROL_PROJECTION_NOT_CURRENT_CACHED_UI_REQUEST_REPLAY" ||
      output.reference_strength?.const !== "UNRESOLVED_UNCONTROLLED_WIRE_FIELD" ||
      output.requested_batch_size?.anyOf?.map((schema) => schema.const).sort().join(",") !== "1,4" ||
      !["CURRENT_VERIFIED_MESSAGE_MATCHES_EXPLICIT_BATCH_SIZE", "OBSERVED_CURRENT_MESSAGE_NOT_REQUESTED_TOTAL"].every((value) =>
        output.count_confidence?.enum?.includes(value)) ||
      output.artifacts?.maxItems !== 4 || output.cost_routing?.properties?.model_type?.const !== SOUL_MODEL_ID ||
      JSON.stringify(Object.keys(output.cost_routing?.properties ?? {}).sort()) !== JSON.stringify(["ai_name", "model_type"]) ||
      output.cost_routing?.properties?.ai_name?.const !== SOUL_MODEL_ID ||
      JSON.stringify(Object.keys(output.cost_inputs?.properties ?? {}).sort()) !== JSON.stringify(["batch_size", "quality", "resolution"])) {
    throw new SoulImageInstalledCheckError("INSTALLED_SOUL_IMAGE_OUTPUT_SCHEMA_INVALID");
  }
  const artifactSchema = output.artifacts?.items;
  assertSoulExactSchemaKeys(artifactSchema, ["message_object_id", "message_id", "object_type", "model_type", "completed", "url", "mime_type",
    "mime_source", "width", "height", "geometry_verified"], "INSTALLED_SOUL_IMAGE_ARTIFACT_SCHEMA_INVALID");
  if (artifactSchema.properties?.geometry_verified?.const !== false || artifactSchema.properties?.model_type?.const !== SOUL_MODEL_ID ||
      artifactSchema.properties?.completed?.const !== true || artifactSchema.properties?.width?.type !== "null" ||
      artifactSchema.properties?.height?.type !== "null" ||
      !["URL_EXTENSION", "UNKNOWN"].every((value) => artifactSchema.properties?.mime_source?.enum?.includes(value))) {
    throw new SoulImageInstalledCheckError("INSTALLED_SOUL_IMAGE_ARTIFACT_SCHEMA_INVALID");
  }
  if (generate.annotations?.destructiveHint !== true || reconcile.annotations?.readOnlyHint !== true ||
      recoveries.annotations?.readOnlyHint !== true || character.annotations?.readOnlyHint !== true || style.annotations?.readOnlyHint !== true) {
    throw new SoulImageInstalledCheckError("INSTALLED_SOUL_IMAGE_TOOL_ANNOTATIONS_INVALID");
  }
  return Object.freeze({ soul_image_tool_count: selected.length });
}

export function assertSoulImageSourceContract(parameters, sourceProfile, catalog, catalogVersion) {
  if (catalogVersion !== SOUL_CATALOG_VERSION || typeof parameters?.getOwnerSoulGenerationSourceParameters !== "function" ||
      typeof parameters?.normalizeOwnerSoulGenerationParameters !== "function" ||
      typeof sourceProfile?.getOwnerSoulImageSourceProfile !== "function") {
    throw new SoulImageInstalledCheckError("INSTALLED_SOUL_IMAGE_SOURCE_PROFILE_INVALID");
  }
  const source = parameters.getOwnerSoulGenerationSourceParameters();
  const profile = sourceProfile.getOwnerSoulImageSourceProfile(SOUL_MODEL_ID, catalog, catalogVersion);
  if (source.model?.model_id !== SOUL_MODEL_ID || source.model?.pinned_default_model_type !== SOUL_MODEL_ID ||
      source.model?.catalog_version !== SOUL_CATALOG_VERSION || source.fixed_settings?.n !== 1 ||
      source.reference_strength !== "UNRESOLVED_UNCONTROLLED_WIRE_FIELD" || source.dispatch_allowed !== false ||
      source.generation_readiness !== "BLOCKED_SOURCE_OR_BACKEND_GATES" ||
      source.source_pins?.build_id !== "1791467421" || source.source_pins?.form_sha256 !== SOUL_SOURCE_MAPPING_SHA256 ||
      source.source_pins?.random_seed_helper_sha256 !== "sha256:c95fc355e29e33f6c3998cb62cc2da4d0879cc1ff4fb524e826e74bb24cd792b" ||
      source.source_pins?.cost_helper_sha256 !== "sha256:c343afcc3f7a63dcfe479d4407a75dea0791309d0414d1f82e5aca1abdc4cfb9" ||
      source.source_pins?.app_store_sha256 !== "sha256:0b12fd2028bf81fd8c8482adb807fd8f14d092a3c26d2e60e718418147f8d0cf" ||
      source.source_pins?.settings_helper_sha256 !== "sha256:cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe" ||
      profile.model_type_source !== "ACTIVE_SELECTED_E551_UPSTREAM_ID_NOT_RUNTIME_SELECTION" ||
      profile.source_binding?.full_public_record_verified !== true ||
      profile.source_binding?.full_public_record_sha256 !== "sha256:16da8ea2298f05143e9992197536d63830a9359428312e2c635287d8f152fa22" ||
      profile.source_binding?.selected_public_catalog_version !== SOUL_CATALOG_VERSION ||
      profile.source_confidence !== "PINNED_STATIC_SOURCE_AND_E551_ROW_NOT_RENDERED_UI_OR_PROVIDER_PROOF" ||
      profile.source_binding?.files?.form?.sha256 !== SOUL_SOURCE_MAPPING_SHA256 ||
      profile.source_binding?.files?.form?.build_id !== "1791467421" ||
      profile.generation_readiness !== "SOURCE_PROFILE_ONLY_NOT_GENERATION_ADMISSION" || profile.runtime_activation !== false ||
      profile.backend_acceptance !== "UNPROVEN" || profile.source_binding?.sender?.source_execution !== false ||
      profile.source_binding?.sender?.backend_acceptance !== "UNPROVEN" ||
      profile.cost_policy?.generation_cost_inputs !== null || profile.cost_policy?.quote_or_unit !== "UNPROVEN" ||
      profile.cost_policy?.cost_inputs_confidence !== "SOURCE_JOINED_COST2_QUERY_FIELDS_NOT_QUOTE_BILLING_OR_HARDCAP" ||
      profile.cost_policy?.selector !== "settings.model_type_OR_settings.model" ||
      profile.cost_policy?.query_is_generation_wire !== false || profile.cost_policy?.version_value !== "UNRESOLVED_NOT_UI_CONTROL" ||
      profile.cost_policy?.projection_status !== "JOINED_PARAMETER_DEFINITION_ONLY_NO_INTENT_VALUES" ||
      profile.style_selection?.owner_style_handles !== "READ_ONLY_PROCESS_LOCAL_NOT_GENERATION_PERMISSION" ||
      profile.character_selection?.owned_reference_permission !== "UNPROVEN_NO_CHARACTER_UPLOAD_HANDLE" ||
      profile.reference_strength?.effective_value !== "UNPROVEN" ||
      JSON.stringify(profile.cost_policy?.declared_model_info_keys) !== JSON.stringify(["quality", "resolution", "batch_size", "version"]) ||
      JSON.stringify(profile.cost_policy?.cost_input_keys) !== JSON.stringify(["quality", "resolution", "batch_size"])) {
    throw new SoulImageInstalledCheckError("INSTALLED_SOUL_IMAGE_SOURCE_PROFILE_INVALID");
  }
  let pairCount = 0;
  let batchCases = 0;
  let seedCases = 0;
  let styleStrengths = 0;
  for (const [quality, resolutions] of Object.entries(SOUL_QUALITY_RESOLUTION_PAIRS)) {
    for (const resolution of resolutions) {
      pairCount += 1;
      for (const batch_size of [1, 4]) {
        batchCases += 1;
        const normalized = parameters.normalizeOwnerSoulGenerationParameters(soulTestInput({ quality, resolution, batch_size }));
        if (normalized.intent.quality !== quality || normalized.intent.resolution !== resolution ||
            normalized.intent.batch_size !== batch_size || normalized.fixed_settings?.n !== 1 ||
            normalized.dispatch_allowed !== false || normalized.generation_readiness !== "BLOCKED_SOURCE_OR_BACKEND_GATES" ||
            normalized.reference_strength !== "UNRESOLVED_UNCONTROLLED_WIRE_FIELD") {
          throw new SoulImageInstalledCheckError("INSTALLED_SOUL_IMAGE_PARAMETER_MATRIX_INVALID");
        }
      }
    }
  }
  for (const seed of [null, 0, 2_147_483_647]) {
    seedCases += 1;
    const normalized = parameters.normalizeOwnerSoulGenerationParameters(soulTestInput({ seed }));
    if (normalized.intent.seed !== seed) throw new SoulImageInstalledCheckError("INSTALLED_SOUL_IMAGE_SEED_MATRIX_INVALID");
  }
  for (let step = 0; step <= 10; step += 1) {
    styleStrengths += 1;
    const strength = step / 10;
    const normalized = parameters.normalizeOwnerSoulGenerationParameters(soulTestInput({ style: {
      kind: "selected", style_handle: `soul_style_00000000-0000-4000-8000-${String(step).padStart(12, "0")}`, strength
    } }));
    if (normalized.intent.style.kind !== "selected" || normalized.intent.style.strength !== strength) {
      throw new SoulImageInstalledCheckError("INSTALLED_SOUL_IMAGE_STYLE_STRENGTH_MATRIX_INVALID");
    }
  }
  const character = parameters.normalizeOwnerSoulGenerationParameters(soulTestInput({ character: {
    kind: "selected", character_handle: "soul_character_00000000-0000-4000-8000-000000000001"
  } }));
  if (character.intent.character.kind !== "selected" || character.model.model_type !== SOUL_MODEL_ID ||
      pairCount !== 14 || batchCases !== 28 || seedCases !== 3 || styleStrengths !== 11) {
    throw new SoulImageInstalledCheckError("INSTALLED_SOUL_IMAGE_PARAMETER_MATRIX_INVALID");
  }
  return Object.freeze({ quality_resolution_pairs_checked: pairCount, batch_cases_checked: batchCases,
    seed_cases_checked: seedCases, style_strengths_checked: styleStrengths,
    source_cost_keys: Object.freeze([...profile.cost_policy.cost_input_keys].sort()) });
}

export function soulChildFailureCode(enabled, phase, error, stderrBytes, stderrClass = "EMPTY") {
  const phases = new Set(["initialize", "tools-list", "close"]);
  const stderrClasses = new Set(["EMPTY", "NODE_REFERENCE_ERROR", "NODE_TYPE_ERROR", "NODE_SYNTAX_ERROR", "NODE_RANGE_ERROR",
    "MISSING_SDK_PACKAGE", "MISSING_ZOD_PACKAGE", "MISSING_OTHER_PACKAGE", "MODULE_NOT_FOUND", "PACKAGE_NOT_FOUND",
    "INVALID_RUNTIME_CONFIG", "NODE_ERROR", "NONEMPTY_UNCLASSIFIED"]);
  if (typeof enabled !== "boolean" || !phases.has(phase) || !Number.isSafeInteger(stderrBytes) || stderrBytes < 0 || stderrBytes > 1_048_576 ||
      !stderrClasses.has(stderrClass)) {
    throw new SoulImageInstalledCheckError("INSTALLED_SOUL_IMAGE_DIAGNOSTIC_PHASE_INVALID");
  }
  let errorClass = "NonError";
  let errorKind = "UNEXPECTED";
  if (error instanceof SoulImageInstalledCheckError) {
    errorClass = "CheckerError";
    errorKind = typeof error.code === "string" && /^[A-Z][A-Z0-9_]{0,95}$/u.test(error.code) ? error.code : "CHECKER_CODE_INVALID";
  } else if (error instanceof TypeError) errorClass = "TypeError";
  else if (error instanceof ReferenceError) errorClass = "ReferenceError";
  else if (error instanceof SyntaxError) errorClass = "SyntaxError";
  else if (error instanceof RangeError) errorClass = "RangeError";
  else if (error instanceof AggregateError) errorClass = "AggregateError";
  else if (error instanceof Error) errorClass = "Error";
  return `INSTALLED_SOUL_IMAGE_STDIO_${enabled ? "OPT_IN" : "DEFAULT"}_${phase.replace("-", "_").toUpperCase()}_${errorClass}_${errorKind}_STDERR_${stderrBytes}_${stderrClass}`;
}

export function soulStderrMissingTarget(sample) {
  if (typeof sample !== "string") return "NONE";
  const packageName = /Cannot find package ['"]([^'"]{1,160})['"]/u.exec(sample)?.[1];
  const moduleName = /Cannot find module ['"]([^'"]{1,512})['"]/u.exec(sample)?.[1];
  const missing = packageName ?? moduleName;
  if (!missing) return "NONE";
  const leaf = missing.startsWith("/") || missing.startsWith("file:")
    ? basename(missing.replace(/^file:\/\//u, ""))
    : missing;
  const token = leaf.replace(/[^A-Za-z0-9._-]+/gu, "_").replace(/^[_\.]+|[_\.]+$/gu, "").slice(0, 80);
  return token ? `MISSING_${token.toUpperCase()}` : "MISSING_UNKNOWN_TARGET";
}

function classifySoulStderr(sample) {
  if (!sample) return "EMPTY";
  if (/\bReferenceError\b/u.test(sample)) return "NODE_REFERENCE_ERROR";
  if (/\bTypeError\b/u.test(sample)) return "NODE_TYPE_ERROR";
  if (/\bSyntaxError\b/u.test(sample)) return "NODE_SYNTAX_ERROR";
  if (/\bRangeError\b/u.test(sample)) return "NODE_RANGE_ERROR";
  if (/Cannot find package ['"]@modelcontextprotocol\/sdk['"]/u.test(sample)) return "MISSING_SDK_PACKAGE";
  if (/Cannot find package ['"]zod['"]/u.test(sample)) return "MISSING_ZOD_PACKAGE";
  if (/Cannot find package /u.test(sample)) return "MISSING_OTHER_PACKAGE";
  if (/Cannot find module /u.test(sample)) return "MODULE_NOT_FOUND";
  if (/ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND/u.test(sample)) return "MODULE_NOT_FOUND";
  if (/ERR_PACKAGE_PATH_NOT_EXPORTED|ERR_PACKAGE_IMPORT_NOT_DEFINED/u.test(sample)) return "PACKAGE_NOT_FOUND";
  if (/Invalid SYNTX_OWNER_|configuration/u.test(sample)) return "INVALID_RUNTIME_CONFIG";
  if (/\bError\b/u.test(sample)) return "NODE_ERROR";
  return "NONEMPTY_UNCLASSIFIED";
}

export function soulWithDeadline(promise, milliseconds, code) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new SoulImageInstalledCheckError(code)), milliseconds);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function soulTestInput(overrides = {}) {
  return { prompt: "installed-package explicit source-shaped test", quality: "720p", resolution: "2048x1152", batch_size: 1,
    enhance_prompt: false, seed: null, style: { kind: "none" }, character: { kind: "none" }, ...overrides };
}

function assertSoulStrictSchema(schema, code) {
  if (schema === null || typeof schema !== "object") throw new SoulImageInstalledCheckError(code);
  if (schema.type === "object" && schema.additionalProperties !== false) throw new SoulImageInstalledCheckError(code);
  for (const nested of Object.values(schema.properties ?? {})) assertSoulStrictSchema(nested, code);
  for (const branch of [...(schema.anyOf ?? []), ...(schema.oneOf ?? []), ...(schema.allOf ?? [])]) assertSoulStrictSchema(branch, code);
  if (schema.items) assertSoulStrictSchema(schema.items, code);
}

function assertSoulExactSchemaKeys(schema, expected, code) {
  if (schema?.type !== "object" || schema.additionalProperties !== false ||
      JSON.stringify(Object.keys(schema.properties ?? {}).sort()) !== JSON.stringify([...expected].sort())) {
    throw new SoulImageInstalledCheckError(code);
  }
}

function soulNullableIntegerRange(schema, minimum, maximum) {
  const number = schema?.anyOf?.find((branch) => branch.type === "number");
  const integer = schema?.anyOf?.find((branch) => branch.type === "integer");
  return schema?.anyOf?.some((branch) => branch.type === "null") === true &&
    (number?.minimum ?? integer?.minimum) === minimum && (number?.maximum ?? integer?.maximum) === maximum &&
    (number?.multipleOf === 1 || integer?.type === "integer");
}

function hasSoulForbiddenProperty(schema) {
  const forbidden = new Set(["style_id", "character_id", "reference_id", "file_urls", "reference_strength_value"]);
  return Object.keys(schema?.properties ?? {}).some((key) => forbidden.has(key) || hasSoulForbiddenProperty(schema.properties[key])) ||
    [...(schema?.anyOf ?? []), ...(schema?.oneOf ?? []), ...(schema?.allOf ?? [])].some(hasSoulForbiddenProperty) ||
    (schema?.items ? hasSoulForbiddenProperty(schema.items) : false);
}

async function assertInstalledSoulImageTools(installedPackagePath, consumerPath, packagedPaths) {
  const requiredPaths = ["dist/src/index.js", "dist/src/index.d.ts", "dist/src/application/owner-soul-generation-parameters.js",
    "dist/src/application/owner-soul-image-source-profile.js", "dist/src/application/owner-soul-image-generation-service.js",
    "dist/src/application/owner-soul-character-options-service.js", "dist/src/application/owner-soul-style-options-service.js",
    "dist/src/mcp/owner-soul-image-tools.js", "dist/src/mcp/owner-soul-style-options-tool.js", "dist/src/transports/stdio-owner.js"];
  if (!(packagedPaths instanceof Set) || requiredPaths.some((path) => !packagedPaths.has(path))) {
    throw new SoulImageInstalledCheckError("INSTALLED_SOUL_IMAGE_PACKAGE_CONTENT_MISSING");
  }
  if (process.versions.node !== "24.21.0") throw new SoulImageInstalledCheckError("INSTALLED_SOUL_IMAGE_NODE24_21_REQUIRED");
  const importPacked = (path) => import(pathToFileURL(join(installedPackagePath, path)).href);
  const [api, parameters, sourceProfile, generation, characterOptions, styleOptions, toolsModule, styleTools, catalogModule] = await Promise.all([
    importPacked("dist/src/index.js"), importPacked("dist/src/application/owner-soul-generation-parameters.js"),
    importPacked("dist/src/application/owner-soul-image-source-profile.js"), importPacked("dist/src/application/owner-soul-image-generation-service.js"),
    importPacked("dist/src/application/owner-soul-character-options-service.js"), importPacked("dist/src/application/owner-soul-style-options-service.js"),
    importPacked("dist/src/mcp/owner-soul-image-tools.js"), importPacked("dist/src/mcp/owner-soul-style-options-tool.js"),
    importPacked("dist/src/catalog/selected-discovery-catalog.js")
  ]);
  const modules = { parameters, sourceProfile, generation, characterOptions, styleOptions, tools: toolsModule, styleTools };
  assertSoulImagePublicExports(api, modules);
  const version = catalogModule.DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
  const selected = catalogModule.loadSelectedDiscoveryCatalog(version, join(installedPackagePath, "catalog"));
  const source = assertSoulImageSourceContract(parameters, sourceProfile, selected.discoveryCatalog, version);
  const declaration = await readFile(join(installedPackagePath, "dist/src/index.d.ts"), "utf8");
  for (const publicName of ["OwnerSoulImageGenerationServiceOptions", "OwnerSoulImageGenerateInput", "OwnerSoulImageGenerationResult",
    "OwnerSoulImageRecoveryListItem", "OwnerSoulImageGenerationDiagnostic", "OwnerSoulGenerationParametersInput",
    "OwnerSoulImageServiceComposition", "RegisterSyntxOwnerSoulImageToolsOptions"]) {
    if (!declaration.includes(publicName)) throw new SoulImageInstalledCheckError("INSTALLED_SOUL_IMAGE_PUBLIC_DECLARATION_MISSING");
  }
  for (const privateName of ["OwnerSoulImagePreparedCandidate", "OwnerSoulImageOneShotPermit", "readOwnerSoulCharacterRevalidationProvenance",
    "readOwnerSoulStyleRevalidationProvenance", "getOwnerSoulCharacterReferenceId", "InternalOwnerSoulImageResultArtifact"]) {
    if (new RegExp(`export\\s+(?:type\\s+)?\\{[^}]*\\b${privateName}\\b[^}]*\\}`, "su").test(declaration)) {
      throw new SoulImageInstalledCheckError("INSTALLED_SOUL_IMAGE_PRIVATE_DECLARATION_LEAK");
    }
  }
  const runtimeSynthetic = await assertInstalledSoulImageRuntimeCallTool(api, consumerPath);
  const results = await Promise.all([false, true].map((enabled) => listInstalledSoulImageTools(installedPackagePath, consumerPath, enabled)));
  const [defaultSurface, optInSurface] = results;
  return Object.freeze({ ...source, default_tools: defaultSurface.soul_image_tool_count,
    opt_in_tools: optInSurface.soul_image_tool_count, sdk_version: defaultSurface.sdk_version,
    node_path: process.execPath, default_child_close: defaultSurface.child_close, opt_in_child_close: optInSurface.child_close,
    default_child_pid_null: defaultSurface.child_pid_null, opt_in_child_pid_null: optInSurface.child_pid_null,
    default_stderr_bytes: defaultSurface.stderr_bytes, opt_in_stderr_bytes: optInSurface.stderr_bytes,
    default_network_calls: defaultSurface.network_calls, opt_in_network_calls: optInSurface.network_calls,
    runtime_call_tool: runtimeSynthetic.call_tool, synthetic_generation_posts: runtimeSynthetic.generation_posts,
    synthetic_preflight_instances: runtimeSynthetic.preflight_instances, runtime_provider_acceptance: "UNPROVEN",
    sdk_operations: Object.freeze(["initialize", "tools/list", "close"]) });
}

export async function assertInstalledSoulImageRuntimeCallTool(api, consumerPath) {
  const require = createRequire(join(consumerPath, "package.json"));
  const serverSdk = await import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/server/mcp.js")).href);
  const clientSdk = await import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/index.js")).href);
  const memorySdk = await import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/inMemory.js")).href);
  const routes = [];
  let generationPosts = 0;
  const fetchImpl = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    routes.push({ method, pathname: url.pathname, queryKeys: [...url.searchParams.keys()].sort(), query: Object.fromEntries(url.searchParams) });
    if (url.pathname === "/api/v1/user/balance") return Response.json({ balance: "1000" });
    if (url.pathname === "/api/v1/user/subscription") return Response.json({ active: true, type: "PRO", end_date: "2099-01-01T00:00:00.000Z" });
    if (url.pathname === "/api/v1/hf/lora/styles") return Response.json({ items: [
      { style_id: "synthetic-private-soul-style-id", name: "Installed synthetic style", image: "https://images.invalid/style.png" }
    ], total: 1 });
    if (url.pathname === "/api/v1/hf/lora/list") return Response.json({ items: [
      { id: "synthetic-private-soul-record-id", reference_id: "synthetic-private-reference-id", title: "Installed synthetic character", status: "completed" }
    ], total: 1 });
    if (url.pathname === "/api/v2/get_model_info") return Response.json({ access: true, cost: 2, discount_cost: null,
      free_remaining_generations: null, limit: null, show_warning: false });
    if (url.pathname === "/api/v1/chats" && method === "POST") return Response.json({ uuid: "soul-installed-synthetic-chat" });
    if (url.pathname === "/api/v1/design/generate" && method === "POST") {
      generationPosts += 1;
      return Response.json({ id: "soul-installed-synthetic-owner-ack" });
    }
    if (url.pathname === "/api/v1/chats/soul-installed-synthetic-chat/messages" && method === "GET") {
      return Response.json({ messages: [
        { id: "soul-installed-synthetic-owner-ack", chat_id: 9001, author_id: 42, message_object: [] },
        { id: "soul-installed-synthetic-result", chat_id: 9001, author_id: -1,
          message_object: [{ id: 2001, message_id: "soul-installed-synthetic-result", object_type: "image", model_type: SOUL_MODEL_ID }] }
      ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    }
    if (url.pathname === "/api/v1/chats/soul-installed-synthetic-chat/soul-installed-synthetic-result" && method === "GET") {
      return Response.json({ id: "soul-installed-synthetic-result", chat_id: 9001, author_id: -1,
        message_object: [{ id: 2001, message_id: "soul-installed-synthetic-result", object_type: "image",
          model_type: SOUL_MODEL_ID, completed: true, object_url: "https://r2.syntx.ai/soul/installed-synthetic.png" }] });
    }
    throw new SoulImageInstalledCheckError("INSTALLED_SOUL_IMAGE_SYNTHETIC_ROUTE_UNEXPECTED");
  };
  const runtime = api.createObservedOwnerRuntime({ ownerSoulImageReferencesEnabled: true, fetchImpl });
  const server = api.createMcpServer(runtime.application, runtime.serverOptions);
  const [clientTransport, serverTransport] = memorySdk.InMemoryTransport.createLinkedPair();
  const client = new clientSdk.Client({ name: "syntx-soul-installed-runtime-test", version: "1.0.0" }, { capabilities: {} });
  const attemptId = "link_soul_pkg_827_runtime_synthetic_000001";
  let connected = false;
  try {
    const binding = runtime.authBinding;
    await runtime.authStore.createAttempt({ attempt_id: attemptId, binding, expires_at_ms: Date.now() + 60_000 });
    await runtime.authStore.beginHandoff(binding, attemptId);
    await runtime.authStore.attachChallenge(binding, attemptId, "synthetic-installed-soul-handoff");
    await runtime.authStore.beginPoll(binding, attemptId);
    await runtime.authStore.markLinked(binding, attemptId, { scheme: "Bearer", value: "synthetic-installed-soul-credential" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    connected = true;
    const toolNames = [];
    let cursor;
    for (let page = 0; page < 32; page += 1) {
      const listed = await client.listTools(cursor === undefined ? {} : { cursor });
      toolNames.push(...listed.tools.map(({ name }) => name));
      cursor = listed.nextCursor;
      if (cursor === undefined) break;
      if (page === 31) throw new SoulImageInstalledCheckError("INSTALLED_SOUL_IMAGE_SYNTHETIC_TOOLS_PAGINATION_LIMIT");
    }
    if (!toolNames.includes("syntx_list_owner_soul_style_options") || !toolNames.includes("syntx_list_owner_soul_character_options") ||
        !toolNames.includes("syntx_owner_generate_soul_image")) {
      throw new SoulImageInstalledCheckError("INSTALLED_SOUL_IMAGE_SYNTHETIC_TOOLS_NOT_REGISTERED");
    }
    const styleResponse = await client.callTool({ name: "syntx_list_owner_soul_style_options", arguments: { link_attempt_id: attemptId } });
    const characterResponse = await client.callTool({ name: "syntx_list_owner_soul_character_options", arguments: { link_attempt_id: attemptId } });
    if (styleResponse.isError === true) throw new SoulImageInstalledCheckError("INSTALLED_SOUL_IMAGE_SYNTHETIC_STYLE_READ_FAILED");
    if (characterResponse.isError === true) throw new SoulImageInstalledCheckError("INSTALLED_SOUL_IMAGE_SYNTHETIC_CHARACTER_READ_FAILED");
    if (!styleResponse.structuredContent || !characterResponse.structuredContent)
      throw new SoulImageInstalledCheckError("INSTALLED_SOUL_IMAGE_SYNTHETIC_SELECTOR_SHAPE_FAILED");
    const styleHandle = styleResponse.structuredContent.options?.[0]?.style_handle;
    const characterHandle = characterResponse.structuredContent.options?.[0]?.character_handle;
    if (typeof styleHandle !== "string" || typeof characterHandle !== "string") {
      throw new SoulImageInstalledCheckError("INSTALLED_SOUL_IMAGE_SYNTHETIC_SELECTOR_HANDLE_MISSING");
    }
    const result = await client.callTool({ name: "syntx_owner_generate_soul_image", arguments: {
      link_attempt_id: attemptId, prompt: "A quiet winter garden in soft morning light", quality: "720p", resolution: "2048x1152",
      batch_size: 1, enhance_prompt: false, seed: null,
      style: { kind: "selected", style_handle: styleHandle, strength: 0.7 },
      character: { kind: "selected", character_handle: characterHandle }
    } });
    if (result.isError === true || result.structuredContent?.status !== "result_observed" ||
        result.structuredContent?.dispatch_allowed !== false || result.structuredContent?.backend_acceptance !== "UNPROVEN" ||
        result.structuredContent?.source_projection_confidence !== "EXPLICIT_SOURCE_UI_CONTROL_PROJECTION_NOT_CURRENT_CACHED_UI_REQUEST_REPLAY" ||
        result.structuredContent?.reference_strength !== "UNRESOLVED_UNCONTROLLED_WIRE_FIELD" ||
        result.structuredContent?.cost_routing?.ai_name !== SOUL_MODEL_ID || result.structuredContent?.cost_routing?.model_type !== SOUL_MODEL_ID ||
        JSON.stringify(Object.keys(result.structuredContent?.cost_inputs ?? {}).sort()) !== JSON.stringify(["batch_size", "quality", "resolution"]) ||
        result.structuredContent?.actual_result_count !== 1 || generationPosts !== 1 ||
        routes.some((route) => !["GET", "POST"].includes(route.method))) {
      throw new SoulImageInstalledCheckError("INSTALLED_SOUL_IMAGE_SYNTHETIC_GENERATE_FAILED");
    }
    const modelReads = routes.filter(({ pathname }) => pathname === "/api/v2/get_model_info");
    const accountReads = routes.filter(({ pathname }) => pathname === "/api/v1/user/balance" || pathname === "/api/v1/user/subscription");
    if (modelReads.length !== 2 || accountReads.length !== 4 ||
        modelReads.some(({ query, queryKeys }) => query.ai_name !== SOUL_MODEL_ID || query.model_type !== SOUL_MODEL_ID ||
          JSON.stringify(queryKeys) !== JSON.stringify(["ai_name", "batch_size", "model_type", "quality", "resolution"])) ||
        routes.filter(({ pathname }) => pathname === "/api/v1/design/generate").length !== 1) {
      throw new SoulImageInstalledCheckError("INSTALLED_SOUL_IMAGE_SYNTHETIC_PREFLIGHT_COUNT_INVALID");
    }
    return Object.freeze({ call_tool: "PASS_SYNTHETIC_INSTALLED_RUNTIME", generation_posts: generationPosts, preflight_instances: 2 });
  } catch (error) {
    if (error instanceof SoulImageInstalledCheckError) throw error;
    throw new SoulImageInstalledCheckError("INSTALLED_SOUL_IMAGE_SYNTHETIC_RUNTIME_FAILED");
  } finally {
    if (connected) { await client.close().catch(() => undefined); }
    await server.close().catch(() => undefined);
    await runtime.serverOptions.ownerSoulImageReferences?.generationService.close().catch(() => undefined);
    await runtime.serverOptions.ownerSoulImageReferences?.characterOptionsService.close().catch(() => undefined);
    await runtime.serverOptions.ownerSoulStyleOptions?.close().catch(() => undefined);
    await runtime.authStore.close?.();
  }
}

export async function listInstalledSoulImageTools(installedPackagePath, consumerPath, enabled) {
  const require = createRequire(join(consumerPath, "package.json"));
  let clientPath; let stdioPath;
  try { clientPath = require.resolve("@modelcontextprotocol/sdk/client/index.js"); stdioPath = require.resolve("@modelcontextprotocol/sdk/client/stdio.js"); }
  catch { throw new SoulImageInstalledCheckError("INSTALLED_SOUL_IMAGE_SDK_RESOLUTION_FAILED"); }
  const manifest = JSON.parse(await readFile(join(consumerPath, "node_modules/@modelcontextprotocol/sdk/package.json"), "utf8"));
  if (manifest?.name !== "@modelcontextprotocol/sdk" || manifest?.version !== "1.32.1") {
    throw new SoulImageInstalledCheckError("INSTALLED_SOUL_IMAGE_SDK_VERSION_MISMATCH");
  }
  const [{ Client }, { StdioClientTransport }] = await Promise.all([import(pathToFileURL(clientPath).href), import(pathToFileURL(stdioPath).href)]);
  const auditDirectory = await mkdtemp(join(tmpdir(), "soul-image-installed-audit-"));
  const auditFile = join(auditDirectory, "network-count");
  const preload = join(auditDirectory, "network-guard.mjs");
  await writeFile(preload, "import { writeFileSync } from 'node:fs'; let n=0; globalThis.fetch=(...args)=>{ n++; return Promise.reject(new Error('NETWORK_DISABLED')); }; process.on('exit',()=>{ try { writeFileSync(process.env.SYNTX_SOUL_NETWORK_AUDIT, String(n)); } catch {} });\n", { mode: 0o600 });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [join(installedPackagePath, "dist/src/transports/stdio-owner.js")], cwd: consumerPath,
    env: { PATH: process.env.PATH ?? "", XDG_CONFIG_HOME: auditDirectory, XDG_DATA_HOME: auditDirectory,
      SYNTX_PUBLIC_CATALOG_VERSION: SOUL_CATALOG_VERSION,
      NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`, SYNTX_SOUL_NETWORK_AUDIT: auditFile,
      ...(enabled ? { SYNTX_OWNER_SOUL_IMAGE_REFERENCES: "1" } : {}) }, stderr: "pipe" });
  const client = new Client({ name: enabled ? "syntx-soul-opt-in-smoke" : "syntx-soul-default-smoke", version: "1.0.0" }, { capabilities: {} });
  let stderrBytes = 0; let stderrSample = "";
  transport.stderr?.on("data", (chunk) => {
    const bytes = Buffer.from(chunk);
    stderrBytes += bytes.length;
    if (stderrSample.length < 16_384) stderrSample += bytes.subarray(0, 16_384 - stderrSample.length).toString("utf8");
  });
  let closeObserved = false; let resolveClose;
  const closed = new Promise((resolvePromise) => { resolveClose = resolvePromise; });
  transport.onclose = () => { closeObserved = true; resolveClose(); };
  let connected = false; let failure; let surface; let phase = "initialize";
  try {
    await soulWithDeadline(client.connect(transport), 5_500, "INSTALLED_SOUL_IMAGE_STDIO_INITIALIZE_TIMEOUT");
    connected = true;
    if (!Number.isSafeInteger(transport.pid) || transport.pid <= 0) throw new SoulImageInstalledCheckError("INSTALLED_SOUL_IMAGE_STDIO_PID_INVALID");
    phase = "tools-list";
    const listed = await soulWithDeadline(client.listTools({}, { timeout: 5_500, maxTotalTimeout: 5_500 }), 5_500,
      "INSTALLED_SOUL_IMAGE_TOOLS_LIST_TIMEOUT");
    surface = assertSoulImageToolSurface(listed.tools, enabled);
  } catch (error) {
    failure = error;
  } finally {
    phase = failure === undefined ? "close" : phase;
    try { await soulWithDeadline(connected ? client.close() : transport.close(), 2_000, "INSTALLED_SOUL_IMAGE_STDIO_CLOSE_FAILED"); }
    catch (error) { failure ??= error; }
    try { await soulWithDeadline(closed, 2_000, "INSTALLED_SOUL_IMAGE_STDIO_CLOSE_FAILED"); }
    catch (error) { failure ??= error; }
    if (!closeObserved || transport.pid !== null) failure ??= new SoulImageInstalledCheckError("INSTALLED_SOUL_IMAGE_STDIO_CLOSE_FAILED");
  }
  try {
    if (failure) throw new SoulImageInstalledCheckError(`${soulChildFailureCode(enabled, phase, failure, stderrBytes, classifySoulStderr(stderrSample))}_${soulStderrMissingTarget(stderrSample)}`);
    if (stderrBytes !== 0) throw new SoulImageInstalledCheckError("INSTALLED_SOUL_IMAGE_STDIO_STDERR_NOT_EMPTY");
    const networkCalls = Number(await readFile(auditFile, "utf8"));
    if (networkCalls !== 0) throw new SoulImageInstalledCheckError("INSTALLED_SOUL_IMAGE_NETWORK_CALLS_DETECTED");
    return Object.freeze({ ...surface, child_close: "CLOSED", child_pid_null: true,
      stderr_bytes: stderrBytes, network_calls: networkCalls, sdk_version: manifest.version });
  } finally { await rm(auditDirectory, { recursive: true, force: true }); }
}

async function main() {
  const argumentsValue = process.argv.slice(2);
  if (argumentsValue.some((argument) => argument !== "--public-source") || argumentsValue.length > 1) {
    throw new PackageSmokeError("INVALID_ARGUMENT");
  }
  const publicSource = argumentsValue[0] === "--public-source";
  let publicManifest;
  if (publicSource) {
    try { publicManifest = await loadAndVerifyPublicSourceManifest(PROJECT_ROOT); }
    catch (error) {
      if (typeof error?.message === "string" && error.message.startsWith("PUBLIC_MANIFEST_")) {
        throw new PackageSmokeError(error.message);
      }
      throw error;
    }
  }
  const sourceManifest = await loadSourceManifest();
  const npmCliPath = await resolveNpmCliPath();
  const temporaryRoot = await mkdtemp(join(tmpdir(), "syntx-package-smoke-"));
  try {
    const packOutput = await runNodeScript(
      npmCliPath,
      [
        "pack",
        "--json",
        "--ignore-scripts",
        "--offline",
        "--pack-destination",
        temporaryRoot
      ],
      PROJECT_ROOT
    );
    const pack = parsePackResult(
      packOutput.stdout,
      temporaryRoot,
      sourceManifest.version
    );
    const packagedPaths = new Set(pack.files.map((entry) => entry.path));
    if (publicSource) {
      let result;
      try { result = assertPublicSourcePackagePaths(publicManifest, packagedPaths); }
      catch (error) {
        if (typeof error?.message === "string" && error.message.startsWith("PUBLIC_PACKAGE_")) {
          throw new PackageSmokeError(error.message);
        }
        throw error;
      }
      if (result.historical_owner_proofs !== "NOT_DISTRIBUTED") throw new PackageSmokeError("PUBLIC_HISTORICAL_PROOF_STATE_INVALID");
      if (!packagedPaths.has(PUBLIC_SOURCE_MANIFEST_NAME)) throw new PackageSmokeError("PUBLIC_MANIFEST_NOT_PACKAGED");
    }
    for (const requiredPath of REQUIRED_PACKAGE_PATHS) {
      if (publicSource && publicManifest.excluded_paths.includes(requiredPath)) continue;
      if (!packagedPaths.has(requiredPath)) {
        throw new PackageSmokeError("PACKAGE_CONTENT_MISSING");
      }
    }
    await assertSourceBackedResultModuleSetMatches(packagedPaths);
    await assertGenericFormResultSetMatches(packagedPaths);
    await assertVersionedGenericFormResultSetMatches(packagedPaths);
    const settingsVersions = await assertSettingsSourceInventoryVersionSetMatches(packagedPaths);
    const maplessSettingsVersions = await assertMaplessSettingsInventoryVersionSetMatches(packagedPaths);
    const generationContractPaths = await assertJsonArtifactDirectorySetMatches(
      GENERATION_CONTRACTS_DIR,
      packagedPaths,
      GENERATION_CONTRACT_VERSION_PATTERN
    );
    const generationContractV2Paths = await assertJsonArtifactDirectorySetMatches(
      GENERATION_CONTRACTS_V2_DIR,
      packagedPaths,
      GENERATION_CONTRACT_VERSION_PATTERN
    );
    const staticRuntimePaths = [];
    for (const directory of STATIC_RUNTIME_ARTIFACT_DIRS) {
      if (!publicSource) {
        staticRuntimePaths.push(...await assertJsonArtifactDirectorySetMatches(directory, packagedPaths));
      } else {
        let sourcePaths;
        try {
          sourcePaths = await expectedJsonArtifactPaths(directory);
        } catch (error) {
          if (!(error instanceof PackageSmokeError && error.code === "PACKAGE_CONTENT_MISSING" &&
                mayTreatPublicStaticRuntimeDirectoryAsEmpty(directory, publicSource, publicManifest))) {
            throw error;
          }
          sourcePaths = [];
        }
        const expected = sourcePaths.filter((path) => !publicManifest.excluded_paths.includes(path));
        const packaged = [...packagedPaths].filter((path) => path.startsWith(`${directory}/`)).sort();
        if (JSON.stringify(packaged) !== JSON.stringify(expected)) throw new PackageSmokeError("PACKAGE_CONTENT_MISMATCH");
        staticRuntimePaths.push(...expected);
      }
    }
    const v11Paths = staticRuntimePaths.filter((path) => path.startsWith("catalog/runtime/v11/"));
    const v12Paths = staticRuntimePaths.filter((path) => path.startsWith("catalog/runtime/v12/"));
    const v13Paths = staticRuntimePaths.filter((path) => path.startsWith("catalog/runtime/v13/"));
    const v15Paths = staticRuntimePaths.filter((path) => path.startsWith("catalog/runtime/v15/"));
    const publicVersions = [...packagedPaths].filter((path) => path.startsWith("catalog/public/"));
    if (publicVersions.some((path) => !/^catalog\/public\/sha256-[a-f0-9]{64}\.json$/.test(path))) {
      throw new PackageSmokeError("PACKAGE_CONTENT_FORBIDDEN");
    }
    if (
      [...packagedPaths].some(
        (path) =>
          path === "dist/tools" ||
          path.startsWith("dist/tools/") ||
          path === "tools" ||
          path.startsWith("tools/") ||
          path === "scripts/settings-source-history.mjs" ||
          path === "tsconfig.json" ||
          path === "src" ||
          path.startsWith("src/")
      )
    ) {
      throw new PackageSmokeError("PACKAGE_CONTENT_FORBIDDEN");
    }

    const consumerPath = join(temporaryRoot, "consumer");
    await mkdir(consumerPath);
    await writeFile(
      join(consumerPath, "package.json"),
      `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`,
      "utf8"
    );
    await runNodeScript(
      npmCliPath,
      [
        "install",
        "--ignore-scripts",
        "--offline",
        "--no-audit",
        "--no-fund",
        pack.tarballPath
      ],
      consumerPath
    );

    const installedPackagePath = join(
      consumerPath,
      "node_modules",
      "syntx-mcp"
    );
    if (publicSource) {
      const installedManifestBytes = await readFile(join(installedPackagePath, PUBLIC_SOURCE_MANIFEST_NAME));
      if (!installedManifestBytes.equals(publicManifest.bytes)) throw new PackageSmokeError("PUBLIC_MANIFEST_PACKAGE_BYTES_MISMATCH");
      try { await assertInstalledPublicSourceFileHashes(installedPackagePath, publicManifest, packagedPaths); }
      catch (error) {
        if (typeof error?.message === "string" && error.message.startsWith("PUBLIC_PACKAGE_")) {
          throw new PackageSmokeError(error.message);
        }
        throw new PackageSmokeError("PUBLIC_PACKAGE_SOURCE_HASH_MISMATCH");
      }
    }
    await assertInstalledManifest(installedPackagePath, sourceManifest.version);
    await assertInstalledMediaUpdateArtifacts(installedPackagePath, consumerPath);
    await assertInstalledPublicCatalogVersions(installedPackagePath, consumerPath, publicVersions);
    await assertInstalledSettingsSourceInventoryVersions(
      installedPackagePath,
      consumerPath,
      settingsVersions,
      publicVersions
    );
    await assertInstalledMaplessSettingsInventoryVersions(installedPackagePath, consumerPath, maplessSettingsVersions);
    await assertInstalledSyntxMaintenance(installedPackagePath, consumerPath, publicVersions, maplessSettingsVersions);
    await assertInstalledGenerationAndStaticRuntimeData(installedPackagePath, {
      generationContractPaths,
      generationContractV2Paths,
      staticRuntimePaths,
      packagedPaths,
      v12Paths,
      v13Paths,
      publicSource
    });
    const ownerAuthProofDisposition = await evaluateHistoricalOwnerProofGate(publicSource, async () => {
      await assertOwnerAuthPersistenceProof(installedPackagePath, staticRuntimePaths);
    });
    process.stdout.write(`historical_owner_proofs=${ownerAuthProofDisposition} `);
    await assertInstalledOwnerContractMediaStdio(installedPackagePath, consumerPath);
    try {
      await assertInstalledWanAdmission(installedPackagePath, consumerPath, packagedPaths);
    } catch (error) {
      if (error instanceof WanAdmissionSmokeError) throw new PackageSmokeError(error.code);
      throw error;
    }
    let installedImageFamilyAdmission;
    try {
      installedImageFamilyAdmission = await assertInstalledImageFamilyAdmission(installedPackagePath, packagedPaths);
    } catch (error) {
      if (error instanceof ImageFamilyAdmissionError) throw new PackageSmokeError(error.code);
      throw error;
    }
    let installedRemainingImageSourceAdmission;
    try {
      installedRemainingImageSourceAdmission = await assertInstalledRemainingImageSourceAdmission(installedPackagePath, packagedPaths);
    } catch (error) {
      if (error instanceof RemainingImageSourceAdmissionError) throw new PackageSmokeError(error.code);
      throw error;
    }
    let installedWanNativeStdio;
    try {
      installedWanNativeStdio = await assertInstalledWanNativeStdioSurface(installedPackagePath, consumerPath, packagedPaths);
    } catch (error) {
      if (error instanceof WanAdmissionSmokeError) throw new PackageSmokeError(error.code);
      throw error;
    }
    let installedStandardImageNative;
    try {
      installedStandardImageNative = await assertInstalledStandardImageNativeTools(installedPackagePath, consumerPath, packagedPaths);
    } catch (error) {
      if (error instanceof StandardImageNativeToolsError) throw new PackageSmokeError(error.code);
      throw error;
    }
    let installedRunwayImageNative;
    try {
      installedRunwayImageNative = await assertInstalledRunwayImageNativeTools(installedPackagePath, consumerPath, packagedPaths);
    } catch (error) {
      if (error instanceof RunwayImageNativeToolsError) throw new PackageSmokeError(error.code);
      throw error;
    }
    let installedSeedreamImageNative;
    try {
      installedSeedreamImageNative = await assertInstalledSeedreamImageNativeTools(installedPackagePath, consumerPath, packagedPaths);
    } catch (error) {
      if (error instanceof SeedreamImageNativeToolsError) throw new PackageSmokeError(error.code);
      throw error;
    }
    let installedSeedreamEditorParameters;
    try {
      installedSeedreamEditorParameters = formatSeedreamEditorParameterSummary(
        await assertInstalledSeedreamEditorParameters(installedPackagePath, packagedPaths)
      );
    } catch (error) {
      if (error instanceof SeedreamEditorParametersInstalledCheckError) throw new PackageSmokeError(error.code);
      throw error;
    }
    let installedSeedreamEditorFoundation;
    try {
      installedSeedreamEditorFoundation = formatSeedreamEditorFoundationSummary(
        await assertInstalledSeedreamEditorFoundation(installedPackagePath, packagedPaths)
      );
    } catch (error) {
      if (error instanceof SeedreamEditorFoundationInstalledCheckError) throw new PackageSmokeError(error.code);
      throw error;
    }
    let installedGrokT2iImageTools;
    try {
      installedGrokT2iImageTools = await assertInstalledGrokT2iImageTools(installedPackagePath, consumerPath, packagedPaths);
    } catch (error) {
      if (error instanceof GrokT2iImageToolsInstalledCheckError) throw new PackageSmokeError(error.code);
      throw error;
    }
    let installedFluxImageNative;
    try {
      installedFluxImageNative = await assertInstalledOwnerFluxImageNativeTools(installedPackagePath, consumerPath, packagedPaths);
    } catch (error) {
      if (error instanceof OwnerFluxImageInstalledCheckError) throw new PackageSmokeError(error.code);
      throw error;
    }
    let installedIdeogramImageNative;
    try {
      installedIdeogramImageNative = await assertInstalledIdeogramImageReference(installedPackagePath, consumerPath, packagedPaths);
    } catch (error) {
      if (error instanceof IdeogramImageReferenceInstalledCheckError) throw new PackageSmokeError(error.code);
      throw error;
    }
    let installedUniImageNative;
    try {
      installedUniImageNative = await assertInstalledUniImageTools(installedPackagePath, consumerPath, packagedPaths);
    } catch (error) {
      if (error instanceof UniImageInstalledCheckError) throw new PackageSmokeError(error.code);
      throw error;
    }
    let installedSoulImageNative;
    try {
      installedSoulImageNative = await assertInstalledSoulImageTools(installedPackagePath, consumerPath, packagedPaths);
    } catch (error) {
      if (error instanceof SoulImageInstalledCheckError) throw new PackageSmokeError(error.code);
      throw error;
    }
    let installedWanT2iImageTools;
    try {
      installedWanT2iImageTools = await assertInstalledWanT2iImageTools(installedPackagePath, consumerPath, packagedPaths);
    } catch (error) {
      if (error instanceof WanT2iImageToolsInstalledCheckError) throw new PackageSmokeError(error.code);
      throw error;
    }
    let installedInpaintFoundation;
    try {
      installedInpaintFoundation = await assertInstalledInpaintFoundation(installedPackagePath, packagedPaths);
    } catch (error) {
      if (error instanceof InpaintFoundationInstalledCheckError) throw new PackageSmokeError(error.code);
      throw error;
    }
    let installedBananaInpaintFlow;
    try {
      const proof = await assertInstalledBananaInpaintFlow(installedPackagePath, consumerPath, packagedPaths);
      installedBananaInpaintFlow = formatBananaInpaintInstalledSummary(proof);
    } catch (error) {
      if (error instanceof BananaInpaintInstalledCheckError) throw new PackageSmokeError(error.code);
      throw error;
    }
    let installedSeedreamEditorFlow;
    try {
      const proof = await assertInstalledSeedreamEditorFlow(installedPackagePath, consumerPath, packagedPaths);
      installedSeedreamEditorFlow = formatSeedreamEditorInstalledSummary(proof);
    } catch (error) {
      if (error instanceof SeedreamEditorInstalledCheckError) throw new PackageSmokeError(error.code);
      throw error;
    }
    let installedWanT2vFlow;
    try {
      const proof = await assertInstalledWanT2vFlow(installedPackagePath, consumerPath, packagedPaths);
      installedWanT2vFlow = formatWanT2vInstalledSummary(proof);
    } catch (error) {
      if (error instanceof WanT2vFlowInstalledCheckError) throw new PackageSmokeError(error.code);
      throw error;
    }
    let installedElevenLabsTtsFlow;
    try {
      const proof = await assertInstalledElevenLabsTtsFlow(installedPackagePath, consumerPath, packagedPaths);
      installedElevenLabsTtsFlow = formatElevenLabsTtsInstalledSummary(proof);
    } catch (error) {
      if (error instanceof ElevenLabsTtsInstalledCheckError) throw new PackageSmokeError(error.code);
      throw error;
    }
    let installedSunoGenerationFlow;
    try {
      const proof = await assertInstalledSunoGenerationFlow(installedPackagePath, consumerPath, packagedPaths);
      installedSunoGenerationFlow = formatSunoGenerationInstalledSummary(proof);
    } catch (error) {
      if (error instanceof SunoGenerationInstalledCheckError) throw new PackageSmokeError(error.code);
      throw error;
    }
    let installedLumaT2vFlow;
    try {
      const proof = await assertInstalledLumaT2vFlow(installedPackagePath, consumerPath, packagedPaths);
      installedLumaT2vFlow = formatLumaT2vInstalledSummary(proof);
    } catch (error) {
      if (error instanceof LumaT2vFlowInstalledCheckError) throw new PackageSmokeError(error.code);
      throw error;
    }
    let installedHailuo01T2vFlow;
    try {
      const proof = await assertInstalledHailuo01T2vFlow(installedPackagePath, consumerPath, packagedPaths);
      installedHailuo01T2vFlow = formatHailuo01T2vInstalledSummary(proof);
    } catch (error) {
      if (error instanceof Hailuo01T2vFlowInstalledCheckError) throw new PackageSmokeError(error.code);
      throw error;
    }
    let installedHailuo01DirectorT2vFlow;
    try {
      const proof = await assertInstalledHailuo01DirectorT2vFlow(installedPackagePath, consumerPath, packagedPaths);
      installedHailuo01DirectorT2vFlow = formatHailuo01DirectorT2vInstalledSummary(proof);
    } catch (error) {
      if (error instanceof Hailuo01DirectorT2vFlowInstalledCheckError) throw new PackageSmokeError(error.code);
      throw error;
    }
    let installedHailuo23T2vFlow;
    try {
      const proof = await assertInstalledHailuo23T2vFlow(installedPackagePath, consumerPath, packagedPaths);
      installedHailuo23T2vFlow = formatHailuo23T2vInstalledSummary(proof);
    } catch (error) {
      if (error instanceof Hailuo23T2vFlowInstalledCheckError) throw new PackageSmokeError(error.code);
      throw error;
    }
    let installedVideo2AudioFlow;
    try {
      const proof = await assertInstalledVideo2AudioFlow(installedPackagePath, consumerPath, packagedPaths);
      installedVideo2AudioFlow = formatVideo2AudioInstalledSummary(proof);
    } catch (error) {
      if (error instanceof Video2AudioFlowInstalledCheckError) throw new PackageSmokeError(error.code);
      throw error;
    }
    const installedMediaMcpConfig = await assertInstalledMediaMcpConfig(installedPackagePath, consumerPath);
    let installedInpaintPaintedCompositeSummary;
    try {
      installedInpaintPaintedCompositeSummary = formatInpaintPaintedCompositePackageSummary(installedInpaintFoundation);
    } catch (error) {
      if (error instanceof InpaintFoundationInstalledCheckError) throw new PackageSmokeError(error.code);
      throw error;
    }
    let installedMagnificStdio;
    try {
      installedMagnificStdio = await assertInstalledMagnificOwnerStdioSurface(installedPackagePath, consumerPath);
    } catch (error) {
      if (error instanceof OwnerMagnificPackageSmokeError) throw new PackageSmokeError(error.code);
      throw error;
    }
    let installedKontextStdio;
    try {
      installedKontextStdio = await assertInstalledKontextOwnerStdioSurface(installedPackagePath, consumerPath);
    } catch (error) {
      if (error instanceof OwnerKontextPackageSmokeError) throw new PackageSmokeError(error.code);
      throw error;
    }
    await assertInstalledVersionedGenericResults(installedPackagePath);
    const ownerReferenceProfileVersions = await assertInstalledOwnerGrokReferenceProfiles(
      installedPackagePath,
      consumerPath,
      packagedPaths
    );
    await runNodeScriptExpectedFailure(
      join(installedPackagePath, "scripts/sync-public-catalog.mjs"),
      ["--archive", "--confirm-source-fetch"],
      consumerPath,
      "Public catalog sync failed: PUBLIC_CATALOG_ARCHIVE_REQUIRES_SOURCE_CHECKOUT.\n"
    );
    await assertInstalledInventoryBoundary(installedPackagePath);
    const installedCanaryPath = join(
      installedPackagePath,
      "catalog",
      "runtime",
      "v1",
      "normalized-settings-ir-canary.json"
    );
    const installedCanaryBefore = await readFile(installedCanaryPath, "utf8");
    const installedParserCanaryPath = join(
      installedPackagePath,
      "catalog",
      "runtime",
      "v1",
      "normalized-settings-parser-canary.json"
    );
    const installedParserCanaryBefore = await readFile(
      installedParserCanaryPath,
      "utf8"
    );
    const installedCensusManifestPath = join(
      installedPackagePath,
      "catalog",
      "runtime",
      "v2",
      "normalized-settings-parser-census-manifest.json"
    );
    const installedCensusManifestBefore = await readFile(
      installedCensusManifestPath,
      "utf8"
    );
    const installedSourceBackedResultPath = join(
      installedPackagePath,
      "catalog",
      "runtime",
      "v3",
      "normalized-settings-parser-source-backed-result.json"
    );
    const installedSourceBackedResultBefore = await readFile(
      installedSourceBackedResultPath,
      "utf8"
    );
    const installedSourceBackedLockPath =
      `${installedSourceBackedResultPath}.lock`;
    const installedSourceBuildParent = join(
      installedPackagePath,
      ".черновики"
    );
    const installedGenericResultPath = join(
      installedPackagePath,
      "catalog",
      "runtime",
      "v4",
      "wan-video-generic-form-result.json"
    );
    const installedGenericResultBefore = await readFile(
      installedGenericResultPath,
      "utf8"
    );
    const installedGenericLockPath = `${installedGenericResultPath}.lock`;
    // DEBT-020: one canonical list, checked through one helper at every phase below,
    // instead of retyping the same three paths at each network-mode call site.
    const coreSideEffectPaths = [
      installedSourceBackedLockPath,
      installedSourceBuildParent,
      installedGenericLockPath
    ];
    await assertNoInstalledSideEffects(installedPackagePath, "BASELINE", coreSideEffectPaths);
    const binPath = join(
      installedPackagePath,
      "scripts",
      "sync-normalized-settings-ir.mjs"
    );
    await runNodeScriptExpectedFailure(
      binPath,
      [],
      consumerPath,
      "Normalized settings IR canary failed: INVALID_ARGUMENT.\n"
    );
    await runNodeScriptExpectedFailure(
      binPath,
      ["--sync"],
      consumerPath,
      "Normalized settings IR canary failed: SYNC_REQUIRES_SOURCE_CHECKOUT.\n"
    );
    if ((await readFile(installedCanaryPath, "utf8")) !== installedCanaryBefore) {
      throw new PackageSmokeError("INSTALLED_CANARY_CHANGED");
    }
    const binResult = await runNodeScript(
      binPath,
      ["--check"],
      consumerPath
    );
    assertSummary(binResult.stdout);

    const scriptResult = await runNodeScript(
      npmCliPath,
      [
        "--prefix",
        installedPackagePath,
        "--ignore-scripts",
        "run",
        "settings:ir:check"
      ],
      consumerPath
    );
    assertSummary(scriptResult.stdout);

    const parserBinPath = join(
      installedPackagePath,
      "scripts",
      "sync-normalized-settings-parser-canary.mjs"
    );
    await runNodeScriptExpectedFailure(
      parserBinPath,
      [],
      consumerPath,
      "Normalized settings parser canary failed: INVALID_ARGUMENT.\n"
    );
    for (const sourceMode of ["--check-source", "--sync-source"]) {
      await runNodeScriptExpectedFailure(
        parserBinPath,
        [sourceMode],
        consumerPath,
        "Normalized settings parser canary failed: INVALID_ARGUMENT.\n"
      );
      await runNodeScriptExpectedFailure(
        parserBinPath,
        [sourceMode, "--confirm-source-fetch"],
        consumerPath,
        "Normalized settings parser canary failed: SOURCE_MODE_REQUIRES_SOURCE_CHECKOUT.\n"
      );
    }
    if (
      (await readFile(installedParserCanaryPath, "utf8")) !==
      installedParserCanaryBefore
    ) {
      throw new PackageSmokeError("INSTALLED_PARSER_CANARY_CHANGED");
    }

    const censusBinPath = join(
      installedPackagePath,
      "scripts",
      "sync-normalized-settings-parser-census-manifest.mjs"
    );
    await runNodeScriptExpectedFailure(
      censusBinPath,
      [],
      consumerPath,
      "Normalized settings parser census failed: INVALID_ARGUMENT.\n"
    );
    await runNodeScriptExpectedFailure(
      censusBinPath,
      ["--check-source"],
      consumerPath,
      "Normalized settings parser census failed: INVALID_ARGUMENT.\n"
    );
    await runNodeScriptExpectedFailure(
      censusBinPath,
      ["--sync-source"],
      consumerPath,
      "Normalized settings parser census failed: INVALID_ARGUMENT.\n"
    );
    await runNodeScriptExpectedFailure(
      censusBinPath,
      ["--check-local"],
      consumerPath,
      "Normalized settings parser census failed: LOCAL_MODE_REQUIRES_SOURCE_CHECKOUT.\n"
    );
    await runNodeScriptExpectedFailure(
      censusBinPath,
      ["--sync-local"],
      consumerPath,
      "Normalized settings parser census failed: LOCAL_MODE_REQUIRES_SOURCE_CHECKOUT.\n"
    );
    if (
      (await readFile(installedCensusManifestPath, "utf8")) !==
      installedCensusManifestBefore
    ) {
      throw new PackageSmokeError("INSTALLED_CENSUS_MANIFEST_CHANGED");
    }
    const censusDirectResult = await runNodeScript(
      censusBinPath,
      ["--check"],
      consumerPath
    );
    assertCensusSummary(censusDirectResult.stdout);

    const censusBinResult = await runNodeScript(
      npmCliPath,
      [
        "--prefix",
        consumerPath,
        "--offline",
        "--ignore-scripts",
        "exec",
        "--",
        "syntx-settings-census",
        "--check"
      ],
      consumerPath
    );
    assertCensusSummary(censusBinResult.stdout);

    const censusScriptResult = await runNodeScript(
      npmCliPath,
      [
        "--prefix",
        installedPackagePath,
        "--ignore-scripts",
        "run",
        "settings:census:check"
      ],
      consumerPath
    );
    assertCensusSummary(censusScriptResult.stdout);
    if (
      (await readFile(installedCensusManifestPath, "utf8")) !==
      installedCensusManifestBefore
    ) {
      throw new PackageSmokeError("INSTALLED_CENSUS_MANIFEST_CHANGED");
    }
    const parserBinResult = await runNodeScript(
      parserBinPath,
      ["--check"],
      consumerPath
    );
    assertParserSummary(parserBinResult.stdout);

    const parserScriptResult = await runNodeScript(
      npmCliPath,
      [
        "--prefix",
        installedPackagePath,
        "--ignore-scripts",
        "run",
        "settings:parser:check"
      ],
      consumerPath
    );
    assertParserSummary(parserScriptResult.stdout);
    if (
      (await readFile(installedParserCanaryPath, "utf8")) !==
      installedParserCanaryBefore
    ) {
      throw new PackageSmokeError("INSTALLED_PARSER_CANARY_CHANGED");
    }

    const sourceBackedBinPath = join(
      installedPackagePath,
      "scripts",
      "sync-normalized-settings-parser-source-backed-result.mjs"
    );
    await runNodeScriptExpectedFailure(
      sourceBackedBinPath,
      [],
      consumerPath,
      "Normalized settings source-backed C1a failed: INVALID_ARGUMENT.\n"
    );
    for (const sourceMode of [
      "--probe-source",
      "--check-source",
      "--sync-source"
    ]) {
      await runNodeScriptExpectedFailure(
        sourceBackedBinPath,
        [sourceMode, "--confirm-source-fetch"],
        consumerPath,
        "Normalized settings source-backed C1a failed: " +
          "SOURCE_MODE_REQUIRES_SOURCE_CHECKOUT.\n"
      );
    }
    await runNodeScriptExpectedFailure(
      sourceBackedBinPath,
      ["--probe-source"],
      consumerPath,
      "Normalized settings source-backed C1a failed: INVALID_ARGUMENT.\n"
    );
    await assertSourceBackedResultUnchanged(
      installedSourceBackedResultPath,
      installedSourceBackedResultBefore
    );
    await assertNoInstalledSideEffects(installedPackagePath, "SOURCE_BACKED_BIN", coreSideEffectPaths);

    const sourceBackedDirectResult = await runNodeScript(
      sourceBackedBinPath,
      ["--check"],
      consumerPath
    );
    assertSourceBackedSummary(sourceBackedDirectResult.stdout);

    const sourceBackedBinResult = await runNodeScript(
      npmCliPath,
      [
        "--prefix",
        consumerPath,
        "--offline",
        "--ignore-scripts",
        "exec",
        "--",
        "syntx-settings-source-backed",
        "--check"
      ],
      consumerPath
    );
    assertSourceBackedSummary(sourceBackedBinResult.stdout);

    const sourceBackedScriptResult = await runNodeScript(
      npmCliPath,
      [
        "--prefix",
        installedPackagePath,
        "--offline",
        "--ignore-scripts",
        "run",
        "settings:source-backed:check"
      ],
      consumerPath
    );
    assertSourceBackedSummary(sourceBackedScriptResult.stdout);
    await assertSourceBackedResultUnchanged(
      installedSourceBackedResultPath,
      installedSourceBackedResultBefore
    );
    await assertNoInstalledSideEffects(installedPackagePath, "SOURCE_BACKED_SCRIPT", coreSideEffectPaths);

    const genericBinPath = join(
      installedPackagePath,
      "scripts",
      "sync-normalized-settings-parser-generic-form-result.mjs"
    );
    await runNodeScriptExpectedFailure(
      genericBinPath,
      [],
      consumerPath,
      "Normalized settings generic form result failed: INVALID_ARGUMENT.\n"
    );
    for (const sourceMode of [
      "--probe-source",
      "--check-source",
      "--sync-source"
    ]) {
      await runNodeScriptExpectedFailure(
        genericBinPath,
        [sourceMode, "--confirm-source-fetch", "--form-id", "wan-video"],
        consumerPath,
        "Normalized settings generic form result failed: " +
          "SOURCE_MODE_REQUIRES_SOURCE_CHECKOUT.\n"
      );
    }
    await runNodeScriptExpectedFailure(
      genericBinPath,
      ["--probe-source", "--form-id", "wan-video"],
      consumerPath,
      "Normalized settings generic form result failed: INVALID_ARGUMENT.\n"
    );
    await assertGenericResultUnchanged(
      installedGenericResultPath,
      installedGenericResultBefore
    );
    await assertNoInstalledSideEffects(installedPackagePath, "GENERIC_BIN", coreSideEffectPaths);

    const genericDirectResult = await runNodeScript(
      genericBinPath,
      ["--check", "--form-id", "wan-video"],
      consumerPath
    );
    assertGenericSummary(genericDirectResult.stdout);

    const genericBinResult = await runNodeScript(
      npmCliPath,
      [
        "--prefix",
        consumerPath,
        "--offline",
        "--ignore-scripts",
        "exec",
        "--",
        "syntx-settings-generic",
        "--check",
        "--form-id",
        "wan-video"
      ],
      consumerPath
    );
    assertGenericSummary(genericBinResult.stdout);

    const genericScriptResult = await runNodeScript(
      npmCliPath,
      [
        "--prefix",
        installedPackagePath,
        "--offline",
        "--ignore-scripts",
        "run",
        "settings:generic:check",
        "--",
        "--form-id",
        "wan-video"
      ],
      consumerPath
    );
    assertGenericSummary(genericScriptResult.stdout);
    await assertGenericResultUnchanged(
      installedGenericResultPath,
      installedGenericResultBefore
    );
    await assertNoInstalledSideEffects(installedPackagePath, "GENERIC_SCRIPT", coreSideEffectPaths);

    await runNodeScriptExpectedFailure(
      join(installedPackagePath, "scripts/check-settings-implementations.mjs"),
      [],
      consumerPath,
      "Settings implementation audit failed: IMPLEMENTATION_AUDIT_REQUIRES_SOURCE_CHECKOUT.\n"
    );
    await assertNoInstalledSideEffects(installedPackagePath, "IMPLEMENTATION_AUDIT", [installedSourceBuildParent]);

    const v5ResultRelative = "catalog/runtime/v5/beeble-root-only-result.json";
    const v5InstalledPath = join(installedPackagePath, v5ResultRelative);
    const v5SourceBytes = await readFile(join(PROJECT_ROOT, v5ResultRelative));
    if (!(await readFile(v5InstalledPath)).equals(v5SourceBytes)) throw new PackageSmokeError("PACKAGE_CONTENT_MISMATCH");
    await run(process.execPath, ["--input-type=module", "--eval", [
      "import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs';",
      "import { loadRootOnlyResultV5, serializeRootOnlyResultV5 } from 'syntx-mcp';",
      `const text = readFileSync(${JSON.stringify(v5InstalledPath)}, 'utf8');`,
      "const result = loadRootOnlyResultV5(text);",
      "assert.equal(serializeRootOnlyResultV5(result), text);",
      "assert.equal(result.runtime_usable, false); assert.equal(result.closure.status, 'OPEN');",
      "assert.equal(result.scope.form_id, 'beeble'); assert.equal(result.scope.model_ids[0], 'switchx');",
      "assert.equal(result.coverage.verified_source_refs, 2); assert.equal(result.coverage.compiled_source_units, 1);",
      "assert.equal(result.closure.blockers[0].compilation_status, 'NOT_COMPILED');"
    ].join('\n')], consumerPath);
    for (const mode of ["--check", "--probe-source", "--sync-source"]) {
      await runNodeScriptExpectedFailure(
        join(installedPackagePath, "scripts/settings-v5-root-only.mjs"),
        [mode, "--form-id", "beeble", ...(mode === "--check" ? [] : ["--confirm-source-fetch"])],
        consumerPath,
        "Settings v5 failed: SETTINGS_V5_REQUIRES_SOURCE_CHECKOUT. Reconcile any target before retrying a sync.\n"
      );
    }
    await assertNoInstalledSideEffects(installedPackagePath, "V5", [installedSourceBuildParent]);

    await run(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        "await import('syntx-mcp'); await import('syntx-mcp/sqlite');"
      ],
      consumerPath
    );

    process.stdout.write(
      `Installed package offline smoke passed. entries=${pack.files.length} ` +
        "ir_bin=PASS ir_script=PASS ir_write_guard=PASS " +
        "parser_bin=PASS parser_script=PASS parser_write_guard=PASS " +
        "census_bin=PASS census_direct=PASS census_script=PASS " +
        "census_write_guard=PASS " +
        "source_backed_bin=PASS source_backed_direct=PASS " +
        "source_backed_script=PASS source_backed_write_guard=PASS " +
        "generic_bin=PASS generic_direct=PASS generic_script=PASS " +
        "generic_write_guard=PASS implementation_audit_installed_guard=PASS v5_installed_guard=PASS v5_roundtrip=PASS " +
        "compiler_excluded=PASS source_loader_excluded=PASS " +
        `inventory_maintenance_present=PASS imports=PASS public_catalog_versions=${publicVersions.length} public_catalog_selection=PASS public_catalog_archive_installed_guard=PASS ` +
        `settings_source_versions=${settingsVersions.length} settings_source_roundtrip=PASS settings_source_cli_excluded=PASS ` +
        `mapless_settings_versions=${maplessSettingsVersions.length} mapless_settings_loader=PASS ` +
        `generation_contract_versions=${generationContractPaths.length} generation_contract_loader=PASS ` +
        `generation_contract_v2_versions=${generationContractV2Paths.length} generation_contract_v2_loader=PASS ` +
        `v11_history_artifacts=${v11Paths.length} selected_projection_loader=PASS runtime_v12_observations=${v12Paths.length} v12_hash_links=${publicSource ? "NOT_DISTRIBUTED" : "PASS"} ` +
        `owner_stdio_v13_observations=${v13Paths.length} v13_hash_links=${publicSource ? "NOT_DISTRIBUTED" : "PASS"} ` +
        `owner_stdio_v15_observations=${v15Paths.length} v15_exact_profiles_hash_links=${publicSource ? "NOT_DISTRIBUTED" : "PASS"} generic_media_bin=PASS ` +
        `owner_reference_profile_versions=${ownerReferenceProfileVersions.length} owner_reference_profile_loader=PASS owner_reference_schema_validation=PASS ` +
        `magnific_owner_stdio_default_tools=${installedMagnificStdio.default_tools} opt_in_tools=${installedMagnificStdio.opt_in_tools} schemas=PASS child_close=PASS pid_null=PASS traffic=NONE ` +
        `kontext_owner_stdio_default_tools=${installedKontextStdio.default_tools} opt_in_tools=${installedKontextStdio.opt_in_tools} schemas=PASS child_close=PASS pid_null=PASS traffic=NONE ` +
        `wan_owner_stdio_default_tools=${installedWanNativeStdio.default_tools} opt_in_tools=${installedWanNativeStdio.opt_in_tools} schemas=${installedWanNativeStdio.schemas} default_child_close=${installedWanNativeStdio.default_child_close} opt_in_child_close=${installedWanNativeStdio.opt_in_child_close} default_pid_null=${installedWanNativeStdio.default_child_pid_null} opt_in_pid_null=${installedWanNativeStdio.opt_in_child_pid_null} default_stderr_bytes=${installedWanNativeStdio.default_stderr_bytes} opt_in_stderr_bytes=${installedWanNativeStdio.opt_in_stderr_bytes} provider_calls=${installedWanNativeStdio.provider_calls} auth_calls=${installedWanNativeStdio.auth_calls} traffic=NONE ` +
        `standard_image_owner_stdio_default_tools=${installedStandardImageNative.default_tools} opt_in_tools=${installedStandardImageNative.opt_in_tools} node=${installedStandardImageNative.node_path} sdk=${installedStandardImageNative.sdk_version} variants=${installedStandardImageNative.variants} normalizer_cases=${installedStandardImageNative.normalizer_cases} source_metadata=${installedStandardImageNative.source_metadata} ` +
        `default_child_close=${installedStandardImageNative.default_child_close} opt_in_child_close=${installedStandardImageNative.opt_in_child_close} default_pid_null=${installedStandardImageNative.default_child_pid_null} opt_in_pid_null=${installedStandardImageNative.opt_in_child_pid_null} ` +
        `default_stderr_bytes=${installedStandardImageNative.default_stderr_bytes} opt_in_stderr_bytes=${installedStandardImageNative.opt_in_stderr_bytes} sdk_operations=${installedStandardImageNative.sdk_operations.join(",")} tool_calls=${installedStandardImageNative.tool_calls} network_calls=${installedStandardImageNative.network_calls} ` +
        `runway_image_owner_stdio_default_tools=${installedRunwayImageNative.default_tools} opt_in_tools=${installedRunwayImageNative.opt_in_tools} node=${installedRunwayImageNative.node_path} sdk=${installedRunwayImageNative.sdk_version} source_metadata=${installedRunwayImageNative.source_metadata} ` +
        `default_child_close=${installedRunwayImageNative.default_child_close} opt_in_child_close=${installedRunwayImageNative.opt_in_child_close} default_pid_null=${installedRunwayImageNative.default_child_pid_null} opt_in_pid_null=${installedRunwayImageNative.opt_in_child_pid_null} ` +
        `default_stderr_bytes=${installedRunwayImageNative.default_stderr_bytes} opt_in_stderr_bytes=${installedRunwayImageNative.opt_in_stderr_bytes} sdk_operations=${installedRunwayImageNative.sdk_operations.join(",")} tool_calls=${installedRunwayImageNative.tool_calls} network_calls=${installedRunwayImageNative.network_calls} ` +
        `seedream_image_owner_stdio_default_tools=${installedSeedreamImageNative.default_tools} opt_in_tools=${installedSeedreamImageNative.opt_in_tools} node=${installedSeedreamImageNative.node_path} sdk=${installedSeedreamImageNative.sdk_version} variants=5 parameter_combinations=${installedSeedreamImageNative.parameter_combinations_checked} source_metadata=${installedSeedreamImageNative.source_metadata} ` +
        `default_child_close=${installedSeedreamImageNative.default_child_close} opt_in_child_close=${installedSeedreamImageNative.opt_in_child_close} default_pid_null=${installedSeedreamImageNative.default_child_pid_null} opt_in_pid_null=${installedSeedreamImageNative.opt_in_child_pid_null} ` +
        `default_stderr_bytes=${installedSeedreamImageNative.default_stderr_bytes} opt_in_stderr_bytes=${installedSeedreamImageNative.opt_in_stderr_bytes} sdk_operations=${installedSeedreamImageNative.sdk_operations.join(",")} tool_calls=${installedSeedreamImageNative.tool_calls} network_calls=${installedSeedreamImageNative.network_calls} ` +
        `${installedSeedreamEditorParameters} ` +
        `${installedSeedreamEditorFoundation} ` +
        `grok_t2i_owner_stdio_default_tools=${installedGrokT2iImageTools.default_tools} opt_in_tools=${installedGrokT2iImageTools.opt_in_tools} node=${installedGrokT2iImageTools.node_path} sdk=${installedGrokT2iImageTools.sdk_version} models=${installedGrokT2iImageTools.grok_t2i_models_checked} parameter_cost_combinations=${installedGrokT2iImageTools.parameter_cost_combinations_checked} ` +
        `prompt_budgets=${installedGrokT2iImageTools.prompt_budgets_checked} source_execution=${installedGrokT2iImageTools.source_execution_claimed} provider_acceptance=${installedGrokT2iImageTools.provider_acceptance_claimed} ` +
        `default_child_close=${installedGrokT2iImageTools.default_child_close} opt_in_child_close=${installedGrokT2iImageTools.opt_in_child_close} default_pid_null=${installedGrokT2iImageTools.default_child_pid_null} opt_in_pid_null=${installedGrokT2iImageTools.opt_in_child_pid_null} ` +
        `default_stderr_bytes=${installedGrokT2iImageTools.default_stderr_bytes} opt_in_stderr_bytes=${installedGrokT2iImageTools.opt_in_stderr_bytes} default_network_calls=${installedGrokT2iImageTools.default_network_calls} opt_in_network_calls=${installedGrokT2iImageTools.opt_in_network_calls} auth_calls=${installedGrokT2iImageTools.auth_calls} tool_calls=${installedGrokT2iImageTools.tool_calls} ` +
        `flux_image_owner_stdio_default_tools=${installedFluxImageNative.default_tools} opt_in_tools=${installedFluxImageNative.opt_in_tools} node=${installedFluxImageNative.node_path} sdk=${installedFluxImageNative.sdk_version} variants=${installedFluxImageNative.flux_models_checked} resolutions=${installedFluxImageNative.flux_resolution_cases_checked} lora_counts=${installedFluxImageNative.flux_lora_counts_checked} lora_pins=${installedFluxImageNative.lora_pin_consistency} ` +
        `default_child_close=${installedFluxImageNative.default_child_close} opt_in_child_close=${installedFluxImageNative.opt_in_child_close} default_pid_null=${installedFluxImageNative.default_child_pid_null} opt_in_pid_null=${installedFluxImageNative.opt_in_child_pid_null} ` +
        `default_stderr_bytes=${installedFluxImageNative.default_stderr_bytes} opt_in_stderr_bytes=${installedFluxImageNative.opt_in_stderr_bytes} sdk_operations=${installedFluxImageNative.sdk_operations.join(",")} tool_calls=${installedFluxImageNative.tool_calls} network_calls=${installedFluxImageNative.network_calls} ` +
        `ideogram_image_owner_stdio_default_tools=${installedIdeogramImageNative.default_tools} opt_in_tools=${installedIdeogramImageNative.opt_in_tools} node=${installedIdeogramImageNative.node_path} sdk=${installedIdeogramImageNative.sdk_version} contexts=${installedIdeogramImageNative.ideogram_contexts_checked} parameter_combinations=${installedIdeogramImageNative.ideogram_parameter_combinations_checked} mode_batches=${installedIdeogramImageNative.ideogram_mode_batch_checks} resolutions=${installedIdeogramImageNative.ideogram_resolutions_checked} ` +
        `default_child_close=${installedIdeogramImageNative.default_child_close} opt_in_child_close=${installedIdeogramImageNative.opt_in_child_close} default_pid_null=${installedIdeogramImageNative.default_child_pid_null} opt_in_pid_null=${installedIdeogramImageNative.opt_in_child_pid_null} ` +
        `default_stderr_bytes=${installedIdeogramImageNative.default_stderr_bytes} opt_in_stderr_bytes=${installedIdeogramImageNative.opt_in_stderr_bytes} sdk_operations=${installedIdeogramImageNative.sdk_operations.join(",")} tool_calls=${installedIdeogramImageNative.tool_calls} network_calls=${installedIdeogramImageNative.network_calls} ` +
        `uni_image_owner_stdio_default_tools=${installedUniImageNative.default_tools} opt_in_tools=${installedUniImageNative.opt_in_tools} node=${installedUniImageNative.node_path} sdk=${installedUniImageNative.sdk_version} models=${installedUniImageNative.uni_models_checked} ratio_mode_pairs=${installedUniImageNative.uni1_ratio_mode_pairs_checked} parameter_cases=${installedUniImageNative.parameter_cases_checked} reference_counts=${installedUniImageNative.reference_count_cases_checked} ` +
        `upload_mime_types=${installedUniImageNative.upload_mime_types_checked} local_upload_bytes=${installedUniImageNative.local_upload_bytes} source_execution=${installedUniImageNative.source_execution_claimed} provider_acceptance=${installedUniImageNative.provider_acceptance_claimed} ` +
        `default_child_close=${installedUniImageNative.default_child_close} opt_in_child_close=${installedUniImageNative.opt_in_child_close} default_pid_null=${installedUniImageNative.default_child_pid_null} opt_in_pid_null=${installedUniImageNative.opt_in_child_pid_null} ` +
        `default_stderr_bytes=${installedUniImageNative.default_stderr_bytes} opt_in_stderr_bytes=${installedUniImageNative.opt_in_stderr_bytes} default_network_calls=${installedUniImageNative.default_network_calls} opt_in_network_calls=${installedUniImageNative.opt_in_network_calls} sdk_operations=${installedUniImageNative.sdk_operations.join(",")} auth_calls=${installedUniImageNative.auth_calls} tool_calls=${installedUniImageNative.tool_calls} ` +
        `soul_image_owner_stdio_default_tools=${installedSoulImageNative.default_tools} opt_in_tools=${installedSoulImageNative.opt_in_tools} node=${installedSoulImageNative.node_path} sdk=${installedSoulImageNative.sdk_version} quality_resolution_pairs=${installedSoulImageNative.quality_resolution_pairs_checked} batches=${installedSoulImageNative.batch_cases_checked} seed_cases=${installedSoulImageNative.seed_cases_checked} style_strengths=${installedSoulImageNative.style_strengths_checked} ` +
        `source_cost_keys=${installedSoulImageNative.source_cost_keys.join(",")} source_profile=PASS default_child_close=${installedSoulImageNative.default_child_close} opt_in_child_close=${installedSoulImageNative.opt_in_child_close} default_pid_null=${installedSoulImageNative.default_child_pid_null} opt_in_pid_null=${installedSoulImageNative.opt_in_child_pid_null} ` +
        `default_stderr_bytes=${installedSoulImageNative.default_stderr_bytes} opt_in_stderr_bytes=${installedSoulImageNative.opt_in_stderr_bytes} default_network_calls=${installedSoulImageNative.default_network_calls} opt_in_network_calls=${installedSoulImageNative.opt_in_network_calls} sdk_operations=${installedSoulImageNative.sdk_operations.join(",")} auth_calls=0 tool_calls=0 ` +
        `wan_t2i_owner_stdio_default_tools=${installedWanT2iImageTools.default_tools} opt_in_tools=${installedWanT2iImageTools.opt_in_tools} models=${installedWanT2iImageTools.models_checked} ` +
        `parameter_cases=${installedWanT2iImageTools.parameter_cases_checked} cost_inputs=${installedWanT2iImageTools.cost_inputs_checked} prompt_boundaries=${installedWanT2iImageTools.prompt_boundaries_checked} ` +
        `default_child_close=${installedWanT2iImageTools.default_child_close} opt_in_child_close=${installedWanT2iImageTools.opt_in_child_close} default_pid_null=${installedWanT2iImageTools.default_child_pid_null} opt_in_pid_null=${installedWanT2iImageTools.opt_in_child_pid_null} ` +
        `default_stderr_bytes=${installedWanT2iImageTools.default_stderr_bytes} opt_in_stderr_bytes=${installedWanT2iImageTools.opt_in_stderr_bytes} default_network_calls=${installedWanT2iImageTools.default_network_calls} opt_in_network_calls=${installedWanT2iImageTools.opt_in_network_calls} ` +
        `synthetic_account_reads=${installedWanT2iImageTools.synthetic_preflight_reads} synthetic_model_access_reads=${installedWanT2iImageTools.synthetic_model_access_reads} ` +
        `synthetic_generation_posts=${installedWanT2iImageTools.synthetic_generation_posts} provider_acceptance=${installedWanT2iImageTools.provider_acceptance_claimed} ` +
        `${installedInpaintPaintedCompositeSummary} ` +
        `${installedBananaInpaintFlow} ` +
        `${installedSeedreamEditorFlow} ` +
        `${installedWanT2vFlow} ` +
        `${installedElevenLabsTtsFlow} ` +
        `${installedSunoGenerationFlow} ` +
        `${installedLumaT2vFlow} ` +
        `${installedHailuo01T2vFlow} ` +
        `${installedHailuo01DirectorT2vFlow} ` +
        `${installedHailuo23T2vFlow} ` +
        `${installedVideo2AudioFlow} ` +
        `${installedMediaMcpConfig} ` +
        `banana_inpaint_native_foundation=${installedInpaintFoundation.runtime} inpaint_chat_posts=${installedInpaintFoundation.chat_posts} inpaint_hidden_upload_posts=${installedInpaintFoundation.hidden_upload_posts} inpaint_variants=${installedInpaintFoundation.variants_checked} ` +
        `owner_generation=${installedInpaintFoundation.owner_generation} inpaint_provider_acceptance=${installedInpaintFoundation.provider_acceptance} ` +
        `banana_inpaint_owned_source_pair=${installedInpaintFoundation.source_profile_pair} variant_uploads=${installedInpaintFoundation.variant_uploads} ` +
        `variant_resolutions=${installedInpaintFoundation.variant_resolutions} successful_resolutions=${installedInpaintFoundation.successful_resolutions} ` +
        `foreign_principal=${installedInpaintFoundation.foreign_principal} invalidation=${installedInpaintFoundation.invalidation} ` +
        `close=${installedInpaintFoundation.close} lifecycle_close_probe_uploads=${installedInpaintFoundation.lifecycle_close_probe_uploads} ` +
        `owned_mcp=${installedInpaintFoundation.mcp_tools} owned_generation=${installedInpaintFoundation.generation} ` +
        `owned_provider_acceptance=${installedInpaintFoundation.provider_acceptance} ` +
        `image_family_source_admission=PASS banana_variants=${installedImageFamilyAdmission.banana_variants} banana_matrix=${installedImageFamilyAdmission.banana_parameter_cases} banana_reference_counts=${installedImageFamilyAdmission.banana_reference_counts} gpt_variants=${installedImageFamilyAdmission.gpt_variants} gpt_matrix=${installedImageFamilyAdmission.gpt_parameter_cases} gpt_reference_counts=${installedImageFamilyAdmission.gpt_reference_counts} selected_catalog=${installedImageFamilyAdmission.selected_catalog} image_family_native_tool_surface=NOT_CHECKED ` +
        `remaining_image_source_admission=PASS profiles=${installedRemainingImageSourceAdmission.profile_count} normalizer_cases=${installedRemainingImageSourceAdmission.normalizer_cases} selected_catalog=${installedRemainingImageSourceAdmission.selected_catalog} native_tool_surface=NOT_CHECKED ` +
        "maintenance_cli=PASS installed_offline_compare=PASS maintenance_audit_plan=PASS checkpoint_resume=PASS skill_links=PASS fixed_mcp_resources=PASS archive_writes=NONE " +
        "generic_media_v1_default=PASS generic_media_v2_selector=PASS generic_media_noauth_guard=PASS " +
        "runtime_coverage_profile=PASS typescript_runtime_excluded=PASS\n"
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function assertInstalledPublicCatalogVersions(installedPackagePath, consumerPath, versions) {
  const sourceDirectory = join(PROJECT_ROOT, "catalog/public");
  let sourceVersions = [];
  try {
    sourceVersions = (await readdir(sourceDirectory)).filter((name) => /^sha256-[a-f0-9]{64}\.json$/.test(name));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (JSON.stringify(versions.slice().sort()) !== JSON.stringify(sourceVersions.map((name) => `catalog/public/${name}`).sort())) {
    throw new PackageSmokeError("PACKAGE_CONTENT_MISSING");
  }
  for (const relative of versions) {
    if (!(await readFile(join(PROJECT_ROOT, relative))).equals(await readFile(join(installedPackagePath, relative)))) {
      throw new PackageSmokeError("PACKAGE_CONTENT_MISMATCH");
    }
    const inspected = await runNodeScript(
      join(installedPackagePath, "scripts/sync-public-catalog.mjs"),
      ["--inspect", "--version", basename(relative)],
      consumerPath
    );
    if (!inspected.stdout.includes("verified-offline") || !inspected.stdout.includes(`version=${basename(relative)}\n`)) {
      throw new PackageSmokeError("PACKAGE_CONTENT_MISMATCH");
    }
  }
  const selectorUrl = pathToFileURL(join(installedPackagePath, "dist/src/catalog/selected-discovery-catalog.js")).href;
  const factoryUrl = pathToFileURL(join(installedPackagePath, "dist/src/application/factory.js")).href;
  const installedCatalogDirectory = join(installedPackagePath, "catalog");
  await run(process.execPath, ["--input-type=module", "--eval", [
    "import assert from 'node:assert/strict';",
    `const { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } = await import(${JSON.stringify(selectorUrl)});`,
    `const { createDefaultApplication } = await import(${JSON.stringify(factoryUrl)});`,
    `for (const version of ${JSON.stringify(sourceVersions)}) {`,
    "process.env.SYNTX_PUBLIC_CATALOG_VERSION = version;",
    "const selected = loadSelectedDiscoveryCatalog(); assert.equal(selected.runtimeCapabilities, null);",
    "const core = createDefaultApplication(); const page = core.searchModels({include_inactive:true,limit:1});",
    "assert.equal(page.total, selected.discoveryCatalog.search({include_inactive:true,limit:1}).total);",
    "assert.ok(page.models.length); assert.equal(core.getModel(page.models[0].id).model.runtime_capability, undefined);",
    "}",
    "delete process.env.SYNTX_PUBLIC_CATALOG_VERSION;",
    "const defaultSelection = loadSelectedDiscoveryCatalog(); assert.equal(defaultSelection.runtimeCapabilities, null);",
    "const defaultPage = defaultSelection.discoveryCatalog.search({include_inactive:true,limit:1}); assert.ok(defaultPage.items.length);",
    "assert.equal(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, 'sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json');",
    `const legacySelection = loadSelectedDiscoveryCatalog(undefined, ${JSON.stringify(installedCatalogDirectory)}); assert.ok(legacySelection.runtimeCapabilities);`
  ].join("\n")], consumerPath);
}

async function assertInstalledSettingsSourceInventoryVersions(
  installedPackagePath,
  consumerPath,
  versions,
  publicVersions
) {
  const installedVersions = await expectedSettingsSourceInventoryVersionPaths(installedPackagePath);
  if (JSON.stringify(installedVersions) !== JSON.stringify(versions)) {
    throw new PackageSmokeError("PACKAGE_CONTENT_MISMATCH");
  }
  await assertPathsMissing([join(installedPackagePath, "scripts/settings-source-history.mjs")]);
  for (const relative of versions) {
    if (!(await readFile(join(PROJECT_ROOT, relative))).equals(await readFile(join(installedPackagePath, relative)))) {
      throw new PackageSmokeError("PACKAGE_CONTENT_MISMATCH");
    }
  }
  const historyUrl = pathToFileURL(join(installedPackagePath, "dist/src/catalog/settings-source-history.js")).href;
  const publicHistoryUrl = pathToFileURL(join(installedPackagePath, "dist/src/catalog/public-catalog-history.js")).href;
  const inventoryUrl = pathToFileURL(join(installedPackagePath, "dist/src/catalog/settings-source-inventory.js")).href;
  await run(process.execPath, ["--input-type=module", "--eval", [
    "import assert from 'node:assert/strict';",
    "import { readFile } from 'node:fs/promises';",
    "import { join } from 'node:path';",
    `const { loadSettingsSourceInventoryVersion } = await import(${JSON.stringify(historyUrl)});`,
    `const { loadPublicCatalogVersion } = await import(${JSON.stringify(publicHistoryUrl)});`,
    `const { serializeSettingsSourceInventory } = await import(${JSON.stringify(inventoryUrl)});`,
    `const catalogDirectory = ${JSON.stringify(join(installedPackagePath, "catalog"))};`,
    // Only immutable public archives are candidates. Never use the default v1
    // catalog or a runtime selector when an inventory's binding cannot match.
    `const publicCatalogs = ${JSON.stringify(publicVersions.map((relative) => basename(relative)))}.map((version) => loadPublicCatalogVersion(version, catalogDirectory));`,
    `for (const version of ${JSON.stringify(versions.map((relative) => basename(relative)))}) {`,
    "const bytes = await readFile(join(catalogDirectory, 'settings', version));",
    "const raw = JSON.parse(bytes.toString('utf8')); const binding = raw.public_catalog;",
    "const matching = publicCatalogs.filter((catalog) => binding.fetched_at === catalog.fetched_at && binding.ai_sha256 === catalog.sources.ai.canonical_sha256 && binding.models_sha256 === catalog.sources.models.canonical_sha256 && binding.llm_models_sha256 === catalog.sources.llm_models.canonical_sha256);",
    "assert.equal(matching.length, 1, 'Settings inventory must match exactly one packaged public archive');",
    "const inventory = loadSettingsSourceInventoryVersion(version, matching[0], catalogDirectory);",
    "assert.ok(Buffer.from(serializeSettingsSourceInventory(inventory), 'utf8').equals(bytes));",
    "assert.equal(inventory.runtime_usable, false);",
    "assert.deepEqual(await readFile(join(catalogDirectory, 'settings', version)), bytes);",
    "}"
  ].join("\n")], consumerPath);
}

async function assertInstalledMaplessSettingsInventoryVersions(installedPackagePath, consumerPath, versions) {
  const installedVersions = await expectedMaplessSettingsInventoryVersionPaths(installedPackagePath);
  if (JSON.stringify(installedVersions) !== JSON.stringify(versions)) throw new PackageSmokeError("PACKAGE_CONTENT_MISMATCH");
  const loaderPath = join(installedPackagePath, "dist/src/catalog/mapless-settings-inventory.js");
  for (const relative of versions) {
    if (!(await readFile(join(PROJECT_ROOT, relative))).equals(await readFile(join(installedPackagePath, relative)))) {
      throw new PackageSmokeError("PACKAGE_CONTENT_MISMATCH");
    }
  }
  try {
    await run(process.execPath, ["--input-type=module", "--eval", [
    "import assert from 'node:assert/strict';",
    "import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';",
    "import { tmpdir } from 'node:os';",
    "import { join } from 'node:path';",
    `const { loadMaplessSettingsInventoryVersion } = await import(${JSON.stringify(pathToFileURL(loaderPath).href)});`,
    `const catalogDirectory = ${JSON.stringify(join(installedPackagePath, "catalog"))};`,
    `const versions = ${JSON.stringify(versions.map((relative) => basename(relative)))};`,
    "for (const version of versions) {",
    "const inventory = loadMaplessSettingsInventoryVersion(version, catalogDirectory);",
    "assert.equal(inventory.runtime_usable, false); assert.equal(inventory.summary.total_models, 200);",
    "assert.equal(inventory.summary.structurally_mapped_models + inventory.summary.unknown_form_models, 200);",
    "}",
    "let currentVersion; for (const version of versions) if (JSON.parse(await readFile(join(catalogDirectory, 'settings', 'v2', version), 'utf8')).schema_version === '2.1.0') currentVersion = version;",
    "assert.ok(currentVersion);",
    "const scratch = await mkdtemp(join(tmpdir(), 'syntx-mapless-package-loader-'));",
    "try {",
    "const target = join(scratch, 'settings', 'v2', currentVersion); await mkdir(join(scratch, 'settings', 'v2'), {recursive:true});",
    "const original = await readFile(join(catalogDirectory, 'settings', 'v2', currentVersion)); await writeFile(target, Buffer.concat([original, Buffer.from(' ')]));",
    "assert.throws(() => loadMaplessSettingsInventoryVersion(currentVersion, scratch), /MAPLESS_SETTINGS_VERSION_HASH_MISMATCH/);",
    "assert.throws(() => loadMaplessSettingsInventoryVersion('../invalid.json', scratch), /MAPLESS_SETTINGS_VERSION_INVALID/);",
    "} finally { await rm(scratch, {recursive:true, force:true}); }"
    ].join("\n")], consumerPath);
  } catch (error) {
    const diagnostic = error instanceof Error ? error.message.replace(/[^A-Za-z0-9 _.:/-]/gu, "_").slice(0, 300) : "UNKNOWN";
    throw new PackageSmokeError(`MAPLESS_SETTINGS_INSTALLED_LOADER_FAILED:${diagnostic}`);
  }
  await assertPathsMissing([
    join(installedPackagePath, "dist/tools/mapless-settings-ast.js"),
    join(installedPackagePath, "node_modules/typescript")
  ]);
}

async function assertInstalledSyntxMaintenance(installedPackagePath, consumerPath, publicVersions, settingsVersions) {
  const cliPath = join(consumerPath, "node_modules", ".bin", "syntx-mcp-maintenance");
  const enginePath = join(installedPackagePath, "dist/src/application/syntx-maintenance-report.js");
  const skillRoot = join(installedPackagePath, "skills", "syntx-mcp-update");
  const skillPath = join(skillRoot, "SKILL.md");
  const skill = await readFile(skillPath, "utf8");
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(skill)?.[1];
  const skillName = frontmatter?.match(/^name:\s*([^\r\n]+)\s*$/mu)?.[1];
  const skillDescription = frontmatter?.match(/^description:\s*(.+)\s*$/mu)?.[1]?.trim();
  if (skillName !== "syntx-mcp-update" || !skillDescription) {
    throw new PackageSmokeError("SYNTX_MAINTENANCE_SKILL_INVALID");
  }
  const localLinks = [...skill.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)].map((match) => match[1]);
  if (localLinks.length === 0) throw new PackageSmokeError("SYNTX_MAINTENANCE_SKILL_LINKS_INVALID");
  const resolvedLocalLinks = new Set();
  for (const href of localLinks) {
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(href) || href.startsWith("#")) continue;
    const target = resolve(dirname(skillPath), href);
    if (!target.startsWith(`${installedPackagePath}/`) || isAbsolute(href)) {
      throw new PackageSmokeError("SYNTX_MAINTENANCE_SKILL_LINKS_INVALID");
    }
    const targetStats = await stat(target).catch(() => null);
    if (targetStats === null || !targetStats.isFile()) {
      throw new PackageSmokeError("SYNTX_MAINTENANCE_SKILL_LINKS_INVALID");
    }
    resolvedLocalLinks.add(target);
  }
  const requiredSkillReferences = [
    join(skillRoot, "references", "maintenance-cli.md"),
    join(skillRoot, "references", "ui-audit-and-adaptation.md")
  ];
  const agentMetadataPath = join(skillRoot, "agents", "openai.yaml");
  for (const assetPath of [...requiredSkillReferences, agentMetadataPath]) {
    const assetStats = await stat(assetPath).catch(() => null);
    if (assetStats === null || !assetStats.isFile()) {
      throw new PackageSmokeError("SYNTX_MAINTENANCE_SKILL_ASSET_MISSING");
    }
  }
  if (requiredSkillReferences.some((referencePath) => !resolvedLocalLinks.has(referencePath))) {
    throw new PackageSmokeError("SYNTX_MAINTENANCE_SKILL_LINKS_INVALID");
  }

  const help = await run(cliPath, ["--help"], consumerPath);
  if (!help.stdout.includes("Offline compare never fetches") || help.stderr !== "") {
    throw new PackageSmokeError("SYNTX_MAINTENANCE_INSTALLED_HELP_INVALID");
  }
  const defaultRun = await run(cliPath, [], consumerPath);
  if (!defaultRun.stdout.includes("Usage:") || defaultRun.stderr !== "") {
    throw new PackageSmokeError("SYNTX_MAINTENANCE_INSTALLED_DEFAULT_INVALID");
  }

  const matchingSettings = [];
  for (const relative of settingsVersions) {
    const raw = JSON.parse(await readFile(join(installedPackagePath, relative), "utf8"));
    const publicVersion = raw?.public_catalog?.version;
    if (typeof publicVersion === "string" && publicVersions.includes(`catalog/public/${publicVersion}`)) {
      matchingSettings.push({ settingsVersion: basename(relative), publicVersion });
    }
  }
  if (matchingSettings.length === 0) throw new PackageSmokeError("SYNTX_MAINTENANCE_FIXTURE_PAIR_MISSING");
  const { settingsVersion, publicVersion } = matchingSettings[0];
  const archiveStateBefore = await captureMaintenanceArchiveState(installedPackagePath);
  const compare = await run(cliPath, [
    "--compare",
    "--baseline-public", publicVersion,
    "--candidate-public", publicVersion,
    "--baseline-settings", settingsVersion,
    "--candidate-settings", settingsVersion
  ], consumerPath);
  let payload;
  try {
    payload = JSON.parse(compare.stdout);
  } catch {
    throw new PackageSmokeError("SYNTX_MAINTENANCE_INSTALLED_REPORT_INVALID");
  }
  if (
    payload?.operation !== "OFFLINE_COMPARE" ||
    payload?.report?.status !== "COMPARED" ||
    payload?.report?.coverage?.settings_inventory !== "COMPARED" ||
    payload?.report?.coverage?.account_availability !== "NOT_CHECKED" ||
    payload?.report?.coverage?.rendered_ui !== "NOT_CHECKED" ||
    payload?.report?.automatic_runtime_promotion !== false ||
    payload?.report?.paid_operations !== false ||
    !compare.stdout.endsWith("\n")
  ) {
    throw new PackageSmokeError("SYNTX_MAINTENANCE_INSTALLED_REPORT_INVALID");
  }
  if (JSON.stringify(await captureMaintenanceArchiveState(installedPackagePath)) !== JSON.stringify(archiveStateBefore)) {
    throw new PackageSmokeError("SYNTX_MAINTENANCE_INSTALLED_WRITE_DETECTED");
  }
  await assertInstalledSyntxMaintenanceAuditPlan(installedPackagePath, consumerPath, cliPath, publicVersions);
  await run(process.execPath, ["--input-type=module", "--eval", [
    "import assert from 'node:assert/strict';",
    `const module = await import(${JSON.stringify(pathToFileURL(enginePath).href)});`,
    "assert.equal(typeof module.compareSyntxMaintenanceSnapshots, 'function');",
    "assert.equal(typeof module.SyntxMaintenanceReportError, 'function');"
  ].join("\n")], consumerPath);
  await assertInstalledSyntxMaintenanceResources(installedPackagePath, consumerPath);
}

async function assertInstalledSyntxMaintenanceAuditPlan(installedPackagePath, consumerPath, cliPath, publicVersions) {
  const e551Version = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
  const c6fdVersion = "sha256-c6fdcc522def8f6f4ef2c172d23822164f0124b29bb5fe86e2b5dce5c54b9fbc.json";
  if (!publicVersions.includes(`catalog/public/${e551Version}`) || !publicVersions.includes(`catalog/public/${c6fdVersion}`)) {
    throw new PackageSmokeError("SYNTX_MAINTENANCE_AUDIT_PLAN_FIXTURES_MISSING");
  }
  const archiveStateBefore = await captureMaintenanceArchiveState(installedPackagePath);
  const sameSource = await run(cliPath, [
    "--plan-audit", "--baseline-public", e551Version, "--candidate-public", e551Version
  ], consumerPath);
  if (sameSource.stderr !== "" || !sameSource.stdout.endsWith("\n") || sameSource.stdout.includes(consumerPath)) {
    throw new PackageSmokeError("SYNTX_MAINTENANCE_AUDIT_PLAN_INSTALLED_OUTPUT_INVALID");
  }
  let samePayload;
  try { samePayload = JSON.parse(sameSource.stdout); }
  catch { throw new PackageSmokeError("SYNTX_MAINTENANCE_AUDIT_PLAN_INSTALLED_OUTPUT_INVALID"); }
  const samePlan = samePayload?.plan;
  if (samePayload?.operation !== "INCREMENTAL_AUDIT_PLAN" ||
      samePayload?.baseline_public_version !== e551Version || samePayload?.candidate_public_version !== e551Version ||
      samePayload?.baseline_settings_version !== null || samePayload?.candidate_settings_version !== null ||
      samePlan?.source_identity?.public_version !== e551Version ||
      !/^sha256:[a-f0-9]{64}$/u.test(samePlan?.source_identity?.public_hash ?? "") ||
      samePlan?.source_identity?.settings_version !== null || samePlan?.source_identity?.settings_hash !== null ||
      samePlan?.census?.total_models !== 200 || samePlan?.census?.models?.length !== 200 ||
      samePlan?.affected_queue?.model_ids?.length !== 0 || samePlan?.checkpoint_resume?.status !== "NONE" ||
      samePlan?.checkpoint_template?.schema_version !== "1.0.0" ||
      samePlan?.checkpoint_template?.observations?.length !== 0 ||
      samePlan?.coverage?.account_access !== "NOT_CHECKED" || samePlan?.automatic_runtime_promotion !== false ||
      samePlan?.paid_operations !== false) {
    throw new PackageSmokeError("SYNTX_MAINTENANCE_AUDIT_PLAN_INSTALLED_OUTPUT_INVALID");
  }
  const modalityById = new Map(samePlan.census.models.map((model) => [model.model_id, model.modality]));
  for (const [modelId, expectedModality] of [
    ["banana3", "image"], ["gpt-image-2", "image"], ["wan_27_image", "image"],
    ["seedance_pro", "video"], ["eleven_v3", "audio"]
  ]) {
    if (modalityById.get(modelId) !== expectedModality) {
      throw new PackageSmokeError("SYNTX_MAINTENANCE_AUDIT_PLAN_MODALITY_INVALID");
    }
  }

  const checkpointPath = join(consumerPath, ".maintenance-audit-checkpoint.json");
  const checkpoint = {
    ...samePlan.checkpoint_template,
    observations: [{ model_id: "banana3", obligation: "controls", status: "OBSERVED" }]
  };
  if (checkpoint.schema_version !== "1.0.0" || checkpoint.source_identity.public_version !== e551Version ||
      !/^sha256:[a-f0-9]{64}$/u.test(checkpoint.source_identity.public_hash) ||
      checkpoint.source_identity.settings_version !== null || checkpoint.source_identity.settings_hash !== null ||
      checkpoint.observations.some((observation) => observation.obligation === "account_access")) {
    throw new PackageSmokeError("SYNTX_MAINTENANCE_AUDIT_CHECKPOINT_TEMPLATE_INVALID");
  }
  const checkpointBytes = `${JSON.stringify(checkpoint, null, 2)}\n`;
  await writeFile(checkpointPath, checkpointBytes, "utf8");
  const checkpointStats = await lstat(checkpointPath).catch(() => null);
  if (checkpointStats === null || !checkpointStats.isFile() || checkpointStats.isSymbolicLink()) {
    throw new PackageSmokeError("SYNTX_MAINTENANCE_AUDIT_CHECKPOINT_TEMP_INVALID");
  }
  const exactResume = await run(cliPath, [
    "--plan-audit", "--baseline-public", e551Version, "--candidate-public", e551Version,
    "--checkpoint", checkpointPath
  ], consumerPath);
  const exactPayload = parseInstalledAuditPlanOutput(exactResume, consumerPath);
  const exactPlan = exactPayload.plan;
  const exactBanana = exactPlan.census.models.find((model) => model.model_id === "banana3");
  const exactControls = exactBanana?.obligations.find((item) => item.id === "controls");
  if (exactPlan.checkpoint_resume.status !== "EXACT_SOURCE" ||
      exactPlan.checkpoint_resume.carried_observation_count !== 1 || exactControls?.status !== "OBSERVED" ||
      exactPlan.checkpoint_template.observations.some((item) => item.obligation === "account_access")) {
    throw new PackageSmokeError("SYNTX_MAINTENANCE_AUDIT_CHECKPOINT_RESUME_INVALID");
  }

  const driftResume = await run(cliPath, [
    "--plan-audit", "--baseline-public", e551Version, "--candidate-public", c6fdVersion,
    "--checkpoint", checkpointPath
  ], consumerPath);
  const driftPayload = parseInstalledAuditPlanOutput(driftResume, consumerPath);
  const driftPlan = driftPayload.plan;
  const driftBanana = driftPlan.census.models.find((model) => model.model_id === "banana3");
  const driftControls = driftBanana?.obligations.find((item) => item.id === "controls");
  if (driftPayload.candidate_public_version !== c6fdVersion || driftPlan.census.total_models !== 200 ||
      driftPlan.affected_queue.model_ids.length !== 200 ||
      !driftPlan.checkpoint_resume.stale_model_ids.includes("banana3") ||
      driftPlan.checkpoint_resume.carried_observation_count !== 0 || driftControls?.status !== "NOT_VISITED" ||
      driftPlan.coverage.account_access !== "NOT_CHECKED") {
    throw new PackageSmokeError("SYNTX_MAINTENANCE_AUDIT_CHECKPOINT_STALE_RESET_INVALID");
  }
  if ((await readFile(checkpointPath, "utf8")) !== checkpointBytes) {
    throw new PackageSmokeError("SYNTX_MAINTENANCE_AUDIT_CHECKPOINT_WRITE_DETECTED");
  }

  const symlinkPath = join(consumerPath, ".maintenance-audit-checkpoint-link.json");
  await symlink(checkpointPath, symlinkPath);
  await assertInstalledMaintenanceAuditPlanFailure(cliPath, [
    "--plan-audit", "--baseline-public", e551Version, "--candidate-public", e551Version,
    "--checkpoint", symlinkPath
  ], consumerPath, "MAINTENANCE_CHECKPOINT_INVALID\n");

  const oversizedPath = join(consumerPath, ".maintenance-audit-checkpoint-oversized.json");
  await writeFile(oversizedPath, Buffer.alloc(1024 * 1024 + 1, 0x20));
  await assertInstalledMaintenanceAuditPlanFailure(cliPath, [
    "--plan-audit", "--baseline-public", e551Version, "--candidate-public", e551Version,
    "--checkpoint", oversizedPath
  ], consumerPath, "MAINTENANCE_CHECKPOINT_INVALID\n");
  await assertInstalledMaintenanceAuditPlanFailure(cliPath, [
    "--plan-audit", "--baseline-public", e551Version, "--candidate-public", e551Version,
    "--checkpoint", "../outside-checkpoint.json"
  ], consumerPath, "MAINTENANCE_ARGUMENTS_INVALID\n");

  if (JSON.stringify(await captureMaintenanceArchiveState(installedPackagePath)) !== JSON.stringify(archiveStateBefore)) {
    throw new PackageSmokeError("SYNTX_MAINTENANCE_AUDIT_PLAN_ARCHIVE_WRITE_DETECTED");
  }
}

function parseInstalledAuditPlanOutput(result, consumerPath) {
  if (result.stderr !== "" || !result.stdout.endsWith("\n") || result.stdout.includes(consumerPath)) {
    throw new PackageSmokeError("SYNTX_MAINTENANCE_AUDIT_PLAN_INSTALLED_OUTPUT_INVALID");
  }
  try {
    const payload = JSON.parse(result.stdout);
    if (payload?.operation !== "INCREMENTAL_AUDIT_PLAN" || !payload.plan) {
      throw new Error("invalid installed audit plan result");
    }
    return payload;
  } catch {
    throw new PackageSmokeError("SYNTX_MAINTENANCE_AUDIT_PLAN_INSTALLED_OUTPUT_INVALID");
  }
}

async function assertInstalledMaintenanceAuditPlanFailure(cliPath, argumentsValue, cwd, expectedStderr) {
  let failure;
  try {
    await execFileAsync(cliPath, argumentsValue, { cwd, encoding: "utf8", maxBuffer: 2 * 1024 * 1024, timeout: 120_000 });
  } catch (error) { failure = error; }
  if (failure === undefined || failure.code !== 1 || failure.stdout !== "" || failure.stderr !== expectedStderr) {
    throw new PackageSmokeError("SYNTX_MAINTENANCE_AUDIT_PLAN_INVALID_CHECKPOINT_GUARD_FAILED");
  }
}

async function assertInstalledMediaMcpConfig(installedPackagePath, consumerPath) {
  const cliPath = join(installedPackagePath, "scripts/print-media-mcp-config.mjs");
  const help = await run(process.execPath, [cliPath], consumerPath);
  if (!help.stdout.includes("Without the exact confirmation flag") || help.stderr !== "") {
    throw new PackageSmokeError("INSTALLED_MEDIA_CONFIG_HELP_FAILED");
  }
  const emitted = await run(process.execPath, [cliPath, "--confirm-enable-paid-tools"], consumerPath);
  const kling4Selected = await run(process.execPath, [cliPath, "--confirm-enable-paid-tools", "--include-kling4"], consumerPath);
  let config;
  let kling4Config;
  try { config = JSON.parse(emitted.stdout)?.mcpServers?.syntx; } catch { /* rejected below */ }
  try { kling4Config = JSON.parse(kling4Selected.stdout)?.mcpServers?.syntx; } catch { /* rejected below */ }
  if (emitted.stderr !== "" || config?.command !== process.execPath ||
      config.args?.length !== 1 || config.args[0] !== await realpath(join(installedPackagePath, "dist/src/transports/stdio-owner.js")) ||
      Object.values(config.env ?? {}).filter((value) => value === "1").length !== 50 ||
      config.env.SYNTX_OWNER_LUMA_T2V !== "1" || config.env.SYNTX_OWNER_HAILUO01_T2V !== "1" ||
      config.env.SYNTX_OWNER_HAILUO01_DIRECTOR_T2V !== "1" ||
      config.env.SYNTX_OWNER_HAILUO23_T2V !== "1" ||
      config.env.SYNTX_OWNER_HAILUO02_T2V !== "1" ||
      config.env.SYNTX_OWNER_SEEDANCE20_T2V !== "1" ||
      config.env.SYNTX_OWNER_ELEVENLABS_DIALOGUE !== "1" ||
      config.env.SYNTX_OWNER_VIDEO2AUDIO !== "1" ||
      config.env.SYNTX_OWNER_KLING_T2V !== "1" ||
      config.env.SYNTX_OWNER_VEO_T2V !== "1" ||
      config.env.SYNTX_OWNER_VEO_OMNI_T2V !== "1" ||
      config.env.SYNTX_OWNER_VEO_OMNI_REFERENCES !== "1" ||
      config.env.SYNTX_OWNER_VEO_OMNI_REFERENCES_FFPROBE_PATH !== "<absolute path to trusted ffprobe executable>" ||
      config.env.SYNTX_OWNER_VEO_OMNI_REFERENCES_MAX_FILE_BYTES !== "67108864" ||
      Object.hasOwn(config.env, "SYNTX_OWNER_KLING4") ||
      Object.hasOwn(config.env, "SYNTX_OWNER_KLING4_FFPROBE_PATH") ||
      Object.hasOwn(config.env, "SYNTX_OWNER_KLING4_MAX_VIDEO_FILE_BYTES") ||
      config.env.SYNTX_OWNER_GROK_T2V !== "1" ||
      config.env.SYNTX_OWNER_HAILUO_LIVE_T2V !== "1" ||
      config.env.SYNTX_OWNER_DURABLE_GENERATION !== "0" ||
      config.env.SYNTX_OWNER_GENERATE_CONTRACT_MEDIA !== "0") {
    throw new PackageSmokeError("INSTALLED_MEDIA_CONFIG_JSON_FAILED");
  }
  if (kling4Selected.stderr !== "" || kling4Config?.command !== process.execPath ||
      kling4Config.args?.length !== 1 || kling4Config.args[0] !== config.args[0] ||
      kling4Config.env.SYNTX_OWNER_KLING4 !== "1" ||
      kling4Config.env.SYNTX_OWNER_KLING4_FFPROBE_PATH !== "<absolute path to trusted ffprobe executable>" ||
      kling4Config.env.SYNTX_OWNER_KLING4_MAX_VIDEO_FILE_BYTES !== "67108864" ||
      Object.values(kling4Config.env ?? {}).filter((value) => value === "1").length !== 51) {
    throw new PackageSmokeError("INSTALLED_MEDIA_CONFIG_KLING4_OPT_IN_FAILED");
  }
  const lumaToolNames = ["syntx_owner_generate_luma_t2v", "syntx_owner_reconcile_luma_t2v", "syntx_owner_list_luma_t2v_recoveries"];
  const hailuoToolNames = ["syntx_owner_get_hailuo01_t2v_source", "syntx_owner_generate_hailuo01_t2v",
    "syntx_owner_reconcile_hailuo01_t2v", "syntx_owner_list_hailuo01_t2v_recoveries"];
  const hailuoDirectorToolNames = ["syntx_owner_get_hailuo01_director_t2v_source", "syntx_owner_generate_hailuo01_director_t2v",
    "syntx_owner_reconcile_hailuo01_director_t2v", "syntx_owner_list_hailuo01_director_t2v_recoveries"];
  const hailuo23ToolNames = ["syntx_owner_get_hailuo23_t2v_source", "syntx_owner_generate_hailuo23_t2v",
    "syntx_owner_reconcile_hailuo23_t2v", "syntx_owner_list_hailuo23_t2v_recoveries"];
  const video2AudioToolNames = ["syntx_owner_get_video2audio_source", "syntx_upload_video2audio_original",
    "syntx_owner_generate_video2audio", "syntx_owner_reconcile_video2audio", "syntx_owner_list_video2audio_recoveries",
    "syntx_owner_get_video2audio_result_page"];
  const klingToolNames = ["syntx_owner_get_kling_t2v_source", "syntx_owner_generate_kling_t2v",
    "syntx_owner_reconcile_kling_t2v", "syntx_owner_list_kling_t2v_recoveries"];
  const kling4ToolNames = ["syntx_owner_get_kling4_source", "syntx_owner_upload_kling4_reference",
    "syntx_owner_generate_kling4_video", "syntx_owner_reconcile_kling4_video",
    "syntx_owner_list_kling4_recoveries", "syntx_owner_get_kling4_result_page"];
  const veoToolNames = ["syntx_owner_get_veo_t2v_source", "syntx_owner_generate_veo_t2v",
    "syntx_owner_reconcile_veo_t2v", "syntx_owner_list_veo_t2v_recoveries"];
  const veoOmniToolNames = ["syntx_owner_get_veo_omni_t2v_source", "syntx_owner_generate_veo_omni_t2v",
    "syntx_owner_reconcile_veo_omni_t2v", "syntx_owner_list_veo_omni_t2v_recoveries"];
  const veoOmniReferenceToolNames = ["syntx_owner_get_veo_omni_reference_source", "syntx_owner_upload_veo_omni_reference",
    "syntx_owner_generate_veo_omni_references", "syntx_owner_reconcile_veo_omni_references",
    "syntx_owner_list_veo_omni_reference_recoveries", "syntx_owner_get_veo_omni_reference_result_page"];
  const grokToolNames = ["syntx_owner_get_grok_t2v_source", "syntx_owner_generate_grok_t2v",
    "syntx_owner_reconcile_grok_t2v", "syntx_owner_list_grok_t2v_recoveries"];
  const hailuoLiveToolNames = ["syntx_owner_get_hailuo_live_t2v_source", "syntx_owner_generate_hailuo_live_t2v",
    "syntx_owner_reconcile_hailuo_live_t2v", "syntx_owner_list_hailuo_live_t2v_recoveries"];
  const videoRecoveryDiagnosticToolName = "syntx_owner_get_video_recovery_diagnostic";
  const result = await run(process.execPath, ["--input-type=module", "--eval", [
    "import assert from 'node:assert/strict'; import {mkdtemp,writeFile,readFile,realpath} from 'node:fs/promises'; import {rmSync} from 'node:fs';",
    "import {tmpdir} from 'node:os'; import {join} from 'node:path'; import {createRequire} from 'node:module'; import {pathToFileURL} from 'node:url';",
    `const consumer=${JSON.stringify(consumerPath)}; const cfg=${JSON.stringify(config)};`,
    "const req=createRequire(join(consumer,'package.json'));",
    "const cp=await realpath(req.resolve('@modelcontextprotocol/sdk/client/index.js')); const tp=await realpath(req.resolve('@modelcontextprotocol/sdk/client/stdio.js'));",
    "assert.ok(cp.startsWith(await realpath(consumer)+'/')); assert.ok(tp.startsWith(await realpath(consumer)+'/'));",
    "const {Client}=await import(pathToFileURL(cp).href); const {StdioClientTransport}=await import(pathToFileURL(tp).href);",
    `const k4cfg=${JSON.stringify(kling4Config)};`,
    "const temp=await mkdtemp(join(tmpdir(),'syntx-installed-media-config-'));process.on('exit',()=>{try{rmSync(temp,{recursive:true,force:true});}catch{}});const auditOn=join(temp,'audit-on.json'), auditOff=join(temp,'audit-off.json'), auditSunoOff=join(temp,'audit-suno-off.json'), auditHailuoOff=join(temp,'audit-hailuo-off.json'), auditHailuoDirectorOff=join(temp,'audit-hailuo-director-off.json'), auditHailuo23Off=join(temp,'audit-hailuo23-off.json'), auditVideo2AudioOff=join(temp,'audit-video2audio-off.json'), auditKlingOff=join(temp,'audit-kling-off.json'), auditKling4On=join(temp,'audit-kling4-on.json'), auditVeoOff=join(temp,'audit-veo-off.json'), auditVeoOmniOff=join(temp,'audit-veo-omni-off.json'), auditVeoOmniReferencesOff=join(temp,'audit-veo-omni-references-off.json'), auditGrokOff=join(temp,'audit-grok-off.json'), auditHailuoLiveOff=join(temp,'audit-hailuo-live-off.json'), auditReviewedVideoDiagnosticsOff=join(temp,'audit-reviewed-video-diagnostics-off.json'), preload=join(temp,'preload.mjs'), probeMarker=join(temp,'probe-was-called'), probeFixture=process.platform==='win32'?process.execPath:join(temp,'trusted-local-ffprobe-fixture.mjs');const installedCfg={...cfg,env:{...cfg.env,SYNTX_OWNER_VEO_OMNI_REFERENCES_FFPROBE_PATH:probeFixture}};",
    "if(process.platform!=='win32'){const probeSource=`#!${process.execPath}\\nimport{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(probeMarker)},'called');\\n`;await writeFile(probeFixture,probeSource,{mode:0o700});}",
    "await writeFile(preload,'import {writeFileSync} from \"node:fs\";let n=0;globalThis.fetch=()=>{n++;return Promise.reject(Error(\"NETWORK_DISABLED\"));};process.on(\"exit\",()=>writeFileSync(process.env.SYNTX_CONFIG_TEST_AUDIT,JSON.stringify({network_calls:n})));\\n',{mode:0o600});",
    "const runList=async(env,audit)=>{const t=new StdioClientTransport({command:cfg.command,args:cfg.args,cwd:consumer,env:{...env,NODE_OPTIONS:'--import '+pathToFileURL(preload).href,SYNTX_CONFIG_TEST_AUDIT:audit},stderr:'pipe'});const c=new Client({name:'syntx-installed-media-config',version:'1'},{capabilities:{}});let bytes=0,names=[],closed=false,signalClose;const closePromise=new Promise(resolve=>{signalClose=resolve;});t.onclose=()=>{closed=true;signalClose();};t.stderr?.on('data',x=>{bytes+=x.length;});try{await c.connect(t,{timeout:10000,maxTotalTimeout:10000});const listed=await c.listTools({}, {timeout:10000,maxTotalTimeout:10000});names=listed.tools.map(x=>x.name);}finally{await c.close();await t.close();}await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('CLOSE_TIMEOUT')),3000);closePromise.then(()=>{clearTimeout(timer);resolve();});});assert.equal(closed,true);assert.equal(t.pid,null);assert.equal(bytes,0);assert.equal(JSON.parse(await readFile(audit,'utf8')).network_calls,0);return {names,count:names.length};};",
    "const optIn=await runList(installedCfg.env,auditOn);const defaultOff=await runList({...installedCfg.env,SYNTX_OWNER_LUMA_T2V:'0'},auditOff);const sunoOff=await runList({...installedCfg.env,SYNTX_OWNER_SUNO_GENERATION:'0'},auditSunoOff);const hailuoOff=await runList({...installedCfg.env,SYNTX_OWNER_HAILUO01_T2V:'0'},auditHailuoOff);const hailuoDirectorOff=await runList({...installedCfg.env,SYNTX_OWNER_HAILUO01_DIRECTOR_T2V:'0'},auditHailuoDirectorOff);const hailuo23Off=await runList({...installedCfg.env,SYNTX_OWNER_HAILUO23_T2V:'0'},auditHailuo23Off);const video2AudioOff=await runList({...installedCfg.env,SYNTX_OWNER_VIDEO2AUDIO:'0'},auditVideo2AudioOff);const klingOff=await runList({...installedCfg.env,SYNTX_OWNER_KLING_T2V:'0'},auditKlingOff);const kling4On=await runList({...installedCfg.env,SYNTX_OWNER_KLING4:k4cfg.env.SYNTX_OWNER_KLING4,SYNTX_OWNER_KLING4_FFPROBE_PATH:process.execPath,SYNTX_OWNER_KLING4_MAX_VIDEO_FILE_BYTES:k4cfg.env.SYNTX_OWNER_KLING4_MAX_VIDEO_FILE_BYTES},auditKling4On);const veoOff=await runList({...installedCfg.env,SYNTX_OWNER_VEO_T2V:'0'},auditVeoOff);const veoOmniOff=await runList({...installedCfg.env,SYNTX_OWNER_VEO_OMNI_T2V:'0'},auditVeoOmniOff);const veoOmniReferencesOff=await runList({...installedCfg.env,SYNTX_OWNER_VEO_OMNI_REFERENCES:'0'},auditVeoOmniReferencesOff);const grokOff=await runList({...installedCfg.env,SYNTX_OWNER_GROK_T2V:'0'},auditGrokOff);const hailuoLiveOff=await runList({...installedCfg.env,SYNTX_OWNER_HAILUO_LIVE_T2V:'0'},auditHailuoLiveOff);const reviewedVideoDiagnosticsOff=await runList({...installedCfg.env,SYNTX_OWNER_HAILUO01_T2V:'0',SYNTX_OWNER_HAILUO01_DIRECTOR_T2V:'0',SYNTX_OWNER_HAILUO02_T2V:'0',SYNTX_OWNER_HAILUO23_T2V:'0',SYNTX_OWNER_HAILUO_LIVE_T2V:'0',SYNTX_OWNER_SEEDANCE20_T2V:'0',SYNTX_OWNER_KLING_T2V:'0',SYNTX_OWNER_VEO_T2V:'0',SYNTX_OWNER_VEO_OMNI_T2V:'0',SYNTX_OWNER_GROK_T2V:'0'},auditReviewedVideoDiagnosticsOff);",
    "for(const n of ['syntx_owner_generate_seedream_editor_image','syntx_owner_generate_suno_audio','syntx_owner_generate_elevenlabs_tts','syntx_owner_generate_wan_t2v_video'])assert.ok(optIn.names.includes(n));",
    "const sunoTrackOperationNames=['syntx_get_suno_track_operation_parameters','syntx_owner_cover_suno_audio','syntx_owner_extend_suno_audio','syntx_owner_reconcile_suno_track_operation','syntx_owner_list_suno_track_operation_recoveries','syntx_owner_get_suno_track_operation_result_page'];for(const n of sunoTrackOperationNames){assert.equal(optIn.names.filter(x=>x===n).length,1);assert.equal(sunoOff.names.includes(n),false);}assert.equal(optIn.names.filter(n=>n==='syntx_owner_list_suno_track_inputs').length,1);assert.equal(sunoOff.names.includes('syntx_owner_list_suno_track_inputs'),false);assert.equal(optIn.names.filter(n=>n==='syntx_owner_list_existing_suno_tracks').length,1);assert.equal(sunoOff.names.includes('syntx_owner_list_existing_suno_tracks'),false);",
    "for(const n of ['syntx_owner_get_seedance20_t2v_source','syntx_owner_generate_seedance20_t2v','syntx_owner_reconcile_seedance20_t2v','syntx_owner_list_seedance20_t2v_recoveries'])assert.ok(optIn.names.includes(n));",
    "for(const n of ['syntx_owner_get_hailuo02_t2v_source','syntx_owner_generate_hailuo02_t2v','syntx_owner_reconcile_hailuo02_t2v','syntx_owner_list_hailuo02_t2v_recoveries','syntx_get_elevenlabs_dialogue_parameters','syntx_owner_generate_elevenlabs_dialogue','syntx_owner_reconcile_elevenlabs_dialogue','syntx_owner_list_elevenlabs_dialogue_recoveries','syntx_owner_get_elevenlabs_dialogue_result_page'])assert.ok(optIn.names.includes(n));",
    `for(const n of ${JSON.stringify(lumaToolNames)})assert.ok(optIn.names.includes(n));`,
    `for(const n of ${JSON.stringify(hailuoToolNames)})assert.ok(optIn.names.includes(n));`,
    `for(const n of ${JSON.stringify(hailuoDirectorToolNames)})assert.ok(optIn.names.includes(n));`,
    `for(const n of ${JSON.stringify(hailuo23ToolNames)})assert.ok(optIn.names.includes(n));`,
    `for(const n of ${JSON.stringify(video2AudioToolNames)})assert.ok(optIn.names.includes(n));`,
    `for(const n of ${JSON.stringify(klingToolNames)})assert.ok(optIn.names.includes(n));`,
    `for(const n of ${JSON.stringify(kling4ToolNames)})assert.ok(!optIn.names.includes(n));`,
    `for(const n of ${JSON.stringify(kling4ToolNames)})assert.ok(kling4On.names.includes(n));`,
    `assert.deepEqual([...kling4On.names].sort(),[...optIn.names,...${JSON.stringify(kling4ToolNames)}].sort());`,
    `for(const n of ${JSON.stringify(veoToolNames)})assert.ok(optIn.names.includes(n));`,
    `for(const n of ${JSON.stringify(veoOmniToolNames)})assert.ok(optIn.names.includes(n));`,
    `for(const n of ${JSON.stringify(veoOmniReferenceToolNames)})assert.ok(optIn.names.includes(n));`,
    `for(const n of ${JSON.stringify(grokToolNames)})assert.ok(optIn.names.includes(n));`,
    `for(const n of ${JSON.stringify(hailuoLiveToolNames)})assert.ok(optIn.names.includes(n));`,
    `assert.equal(optIn.names.filter(n=>n===${JSON.stringify(videoRecoveryDiagnosticToolName)}).length,1);`,
    `assert.equal(reviewedVideoDiagnosticsOff.names.includes(${JSON.stringify(videoRecoveryDiagnosticToolName)}),false);`,
    `for(const n of ${JSON.stringify(veoOmniToolNames)})assert.ok(!reviewedVideoDiagnosticsOff.names.includes(n));`,
    `for(const n of ${JSON.stringify(veoOmniReferenceToolNames)})assert.ok(reviewedVideoDiagnosticsOff.names.includes(n));`,
    `for(const n of ${JSON.stringify(lumaToolNames)})assert.ok(hailuoDirectorOff.names.includes(n));`,
    `for(const n of ${JSON.stringify(hailuoToolNames)})assert.ok(hailuoDirectorOff.names.includes(n));`,
    `for(const n of ${JSON.stringify(hailuo23ToolNames)})assert.ok(hailuoDirectorOff.names.includes(n));`,
    `for(const n of ${JSON.stringify(hailuoDirectorToolNames)})assert.ok(defaultOff.names.includes(n));`,
    `for(const n of ${JSON.stringify(hailuo23ToolNames)})assert.ok(defaultOff.names.includes(n));`,
    `for(const n of ${JSON.stringify(hailuo23ToolNames)})assert.ok(hailuoDirectorOff.names.includes(n));`,
    `for(const n of ${JSON.stringify(hailuo23ToolNames)})assert.ok(hailuoOff.names.includes(n));`,
    `for(const n of ${JSON.stringify(lumaToolNames)})assert.ok(hailuo23Off.names.includes(n));`,
    `for(const n of ${JSON.stringify(hailuoToolNames)})assert.ok(hailuo23Off.names.includes(n));`,
    `for(const n of ${JSON.stringify(hailuoDirectorToolNames)})assert.ok(hailuo23Off.names.includes(n));`,
    `for(const n of ${JSON.stringify(hailuo23ToolNames)})assert.ok(!hailuo23Off.names.includes(n));`,
    `for(const n of ${JSON.stringify(video2AudioToolNames)})assert.ok(!video2AudioOff.names.includes(n));`,
    `for(const n of ${JSON.stringify(lumaToolNames)})assert.ok(video2AudioOff.names.includes(n));`,
    `for(const n of ${JSON.stringify(hailuoToolNames)})assert.ok(video2AudioOff.names.includes(n));`,
    `for(const n of ${JSON.stringify(hailuoDirectorToolNames)})assert.ok(video2AudioOff.names.includes(n));`,
    `for(const n of ${JSON.stringify(hailuo23ToolNames)})assert.ok(video2AudioOff.names.includes(n));`,
    `for(const n of ${JSON.stringify(lumaToolNames)})assert.ok(klingOff.names.includes(n));`,
    `for(const n of ${JSON.stringify(hailuoToolNames)})assert.ok(klingOff.names.includes(n));`,
    `for(const n of ${JSON.stringify(klingToolNames)})assert.ok(!klingOff.names.includes(n));`,
    `for(const n of ${JSON.stringify(veoToolNames)})assert.ok(!veoOff.names.includes(n));`,
    `for(const n of ${JSON.stringify(veoOmniToolNames)})assert.ok(!veoOmniOff.names.includes(n));`,
    `for(const n of ${JSON.stringify(veoOmniReferenceToolNames)})assert.ok(!veoOmniReferencesOff.names.includes(n));`,
    `for(const n of ${JSON.stringify(klingToolNames)})assert.ok(veoOff.names.includes(n));`,
    `for(const n of ${JSON.stringify(klingToolNames)})assert.ok(grokOff.names.includes(n));`,
    `for(const n of ${JSON.stringify(veoToolNames)})assert.ok(grokOff.names.includes(n));`,
    `for(const n of ${JSON.stringify(grokToolNames)})assert.ok(!grokOff.names.includes(n));`,
    `for(const n of ${JSON.stringify(hailuoLiveToolNames)})assert.ok(!hailuoLiveOff.names.includes(n));`,
    `for(const n of ${JSON.stringify(hailuoToolNames)})assert.ok(hailuoLiveOff.names.includes(n));`,
    `for(const n of ${JSON.stringify(hailuoDirectorToolNames)})assert.ok(hailuoLiveOff.names.includes(n));`,
    `for(const n of ${JSON.stringify(hailuo23ToolNames)})assert.ok(hailuoLiveOff.names.includes(n));`,
    `for(const n of ${JSON.stringify(klingToolNames)})assert.ok(hailuoLiveOff.names.includes(n));`,
    `for(const n of ${JSON.stringify(veoToolNames)})assert.ok(hailuoLiveOff.names.includes(n));`,
    `for(const n of ${JSON.stringify(grokToolNames)})assert.ok(hailuoLiveOff.names.includes(n));`,
    `assert.deepEqual([...hailuoLiveOff.names].sort(),optIn.names.filter(n=>!hailuoLiveToolNames.includes(n)).sort());`,
    `for(const n of ${JSON.stringify(hailuoDirectorToolNames)})assert.ok(hailuoOff.names.includes(n));`,
    `for(const n of ${JSON.stringify(lumaToolNames)})assert.ok(!defaultOff.names.includes(n));`,
    `for(const n of ${JSON.stringify(hailuoToolNames)})assert.ok(!hailuoOff.names.includes(n));`,
    `for(const n of ${JSON.stringify(hailuoDirectorToolNames)})assert.ok(!hailuoDirectorOff.names.includes(n));`,
    `const jointToolCount=optIn.count;assert.equal(jointToolCount-defaultOff.count,${lumaToolNames.length});assert.equal(jointToolCount-hailuoOff.count,${hailuoToolNames.length});assert.equal(jointToolCount-hailuoDirectorOff.count,${hailuoDirectorToolNames.length});assert.equal(jointToolCount-hailuo23Off.count,${hailuo23ToolNames.length});assert.equal(jointToolCount-video2AudioOff.count,${video2AudioToolNames.length});assert.equal(jointToolCount-klingOff.count,${klingToolNames.length});assert.equal(jointToolCount-veoOff.count,${veoToolNames.length});assert.equal(jointToolCount-veoOmniOff.count,${veoOmniToolNames.length});assert.equal(jointToolCount-veoOmniReferencesOff.count,${veoOmniReferenceToolNames.length});assert.deepEqual([...veoOmniReferencesOff.names].sort(),optIn.names.filter(n=>!veoOmniReferenceToolNames.includes(n)).sort());assert.equal(jointToolCount-grokOff.count,${grokToolNames.length});assert.equal(jointToolCount-hailuoLiveOff.count,${hailuoLiveToolNames.length});`,
    "if(process.platform!=='win32')assert.equal(await readFile(probeMarker,'utf8').catch(()=>''),'');const probeCalls=process.platform==='win32'?'NOT_INSTRUMENTED':'0';process.stdout.write('media_config_cli=PASS enabled_flags=50 joint_tools='+jointToolCount+' veo_omni_off_joint_tools='+veoOmniOff.count+' veo_omni_references_off_joint_tools='+veoOmniReferencesOff.count+' hailuo23_off_joint_tools='+hailuo23Off.count+' video2audio_off_joint_tools='+video2AudioOff.count+' hailuo_live_off_joint_tools='+hailuoLiveOff.count+' default_off_luma_tools=0 default_off_hailuo01_tools=0 default_off_hailuo01_director_tools=0 default_off_hailuo23_tools=0 default_off_video2audio_tools=0 default_off_kling_tools=0 default_off_veo_tools=0 default_off_veo_omni_t2v_tools=0 default_off_veo_omni_reference_tools=0 default_off_grok_t2v_tools=0 network=0 auth_calls=0 probe_calls='+probeCalls+' tool_calls=0 generation_posts=0 close=CLOSED pid_null=true stderr=0\\n');"
  ].join("\n")], consumerPath);
  if (!result.stdout.startsWith("media_config_cli=PASS enabled_flags=50 joint_tools=") ||
      !result.stdout.endsWith(` default_off_luma_tools=0 default_off_hailuo01_tools=0 default_off_hailuo01_director_tools=0 default_off_hailuo23_tools=0 default_off_video2audio_tools=0 default_off_kling_tools=0 default_off_veo_tools=0 default_off_veo_omni_t2v_tools=0 default_off_veo_omni_reference_tools=0 default_off_grok_t2v_tools=0 network=0 auth_calls=0 probe_calls=${process.platform === "win32" ? "NOT_INSTRUMENTED" : "0"} tool_calls=0 generation_posts=0 close=CLOSED pid_null=true stderr=0\n`) ||
      result.stderr !== "") throw new PackageSmokeError("INSTALLED_MEDIA_CONFIG_COMBINED_STARTUP_FAILED");
  return result.stdout.trim();
}

async function assertInstalledSyntxMaintenanceResources(installedPackagePath, consumerPath) {
  const serverPath = pathToFileURL(join(installedPackagePath, "dist/src/mcp/server.js")).href;
  const factoryPath = pathToFileURL(join(installedPackagePath, "dist/src/application/factory.js")).href;
  const resourcesPath = pathToFileURL(join(installedPackagePath, "dist/src/mcp/maintenance-skill-resources.js")).href;
  const result = await run(process.execPath, ["--input-type=module", "--eval", [
    "import assert from 'node:assert/strict';",
    "import { readFile } from 'node:fs/promises';",
    "import { join } from 'node:path';",
    "import { Client } from '@modelcontextprotocol/sdk/client/index.js';",
    "import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';",
    `const { createMcpServer } = await import(${JSON.stringify(serverPath)});`,
    `const { createDefaultApplication } = await import(${JSON.stringify(factoryPath)});`,
    `const { SYNTX_MAINTENANCE_RESOURCE_URIS } = await import(${JSON.stringify(resourcesPath)});`,
    `const packageRoot = ${JSON.stringify(installedPackagePath)};`,
    "const expected = [",
    "{uri: SYNTX_MAINTENANCE_RESOURCE_URIS.skill, path: 'skills/syntx-mcp-update/SKILL.md'},",
    "{uri: SYNTX_MAINTENANCE_RESOURCE_URIS.cliGuide, path: 'skills/syntx-mcp-update/references/maintenance-cli.md'},",
    "{uri: SYNTX_MAINTENANCE_RESOURCE_URIS.uiGuide, path: 'skills/syntx-mcp-update/references/ui-audit-and-adaptation.md'}",
    "];",
    "const expectedUris = ['syntx://maintenance/cli-guide', 'syntx://maintenance/skill', 'syntx://maintenance/ui-guide'];",
    "assert.deepEqual(expected.map((item) => item.uri).sort(), expectedUris);",
    "assert.deepEqual(Object.values(SYNTX_MAINTENANCE_RESOURCE_URIS).sort(), expectedUris);",
    "const server = createMcpServer(createDefaultApplication());",
    "const client = new Client({ name: 'syntx-installed-maintenance-resources-smoke', version: '1.0.0' });",
    "const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();",
    "try {",
    "await server.connect(serverTransport); await client.connect(clientTransport);",
    "const listed = await client.listResources();",
    "assert.equal(listed.nextCursor, undefined);",
    "assert.deepEqual((listed.resources ?? []).map((resource) => resource.uri).sort(), expectedUris);",
    "assert.deepEqual((listed.resources ?? []).map((resource) => resource.name).sort(), ['syntx-maintenance-cli-guide', 'syntx-maintenance-skill', 'syntx-maintenance-ui-guide']);",
    "assert.ok((listed.resources ?? []).every((resource) => resource.mimeType === 'text/markdown'));",
    "const templates = await client.listResourceTemplates();",
    "assert.equal(templates.nextCursor, undefined); assert.deepEqual(templates.resourceTemplates ?? [], []);",
    "for (const uri of expectedUris) {",
    "const response = await client.readResource({ uri });",
    "assert.equal(response.contents.length, 1);",
    "const item = response.contents[0];",
    "assert.equal(item.uri, uri); assert.equal(item.mimeType, 'text/markdown');",
    "assert.equal(typeof item.text, 'string'); assert.ok(item.text.length > 0);",
    "assert.ok(Buffer.byteLength(item.text, 'utf8') <= 64 * 1024);",
    "assert.match(item.text, /^\\s*(?:---|#)/u);",
    "assert.doesNotMatch(item.text, /(?:\\/Users\\/|\\/home\\/|file:\\/\\/|<script\\b|javascript:|Bearer\\s+\\S+)/iu);",
    "const expectedResource = expected.find((entry) => entry.uri === uri);",
    "assert.ok(expectedResource);",
    "assert.equal(item.text, await readFile(join(packageRoot, expectedResource.path), 'utf8'));",
    "}",
    "await assert.rejects(client.readResource({ uri: 'syntx://maintenance/../../package.json' }));",
    "await assert.rejects(client.readResource({ uri: 'file:///etc/passwd' }));",
    "} finally { await client.close().catch(() => undefined); await server.close().catch(() => undefined); }",
    "process.stdout.write('maintenance_resources=PASS fixed_uris=3 markdown=PASS no_arbitrary_files=PASS\\n');"
  ].join("\n")], consumerPath);
  if (result.stdout !== "maintenance_resources=PASS fixed_uris=3 markdown=PASS no_arbitrary_files=PASS\n" || result.stderr !== "") {
    throw new PackageSmokeError("SYNTX_MAINTENANCE_INSTALLED_RESOURCES_INVALID");
  }
}

async function captureMaintenanceArchiveState(installedPackagePath) {
  const archiveDirectories = [
    join(installedPackagePath, "catalog", "public"),
    join(installedPackagePath, "catalog", "settings", "v2")
  ];
  const records = [];
  for (const directory of archiveDirectories) {
    for (const name of (await readdir(directory)).sort()) {
      const bytes = await readFile(join(directory, name));
      records.push(`${directory}/${name}:${createHash("sha256").update(bytes).digest("hex")}`);
    }
  }
  return records;
}

async function loadSourceManifest() {
  let manifest;
  try {
    manifest = JSON.parse(
      await readFile(join(PROJECT_ROOT, "package.json"), "utf8")
    );
  } catch {
    throw new PackageSmokeError("SOURCE_MANIFEST_INVALID");
  }
  if (
    manifest?.name !== "syntx-mcp" ||
    typeof manifest.version !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/u.test(manifest.version)
  ) {
    throw new PackageSmokeError("SOURCE_MANIFEST_INVALID");
  }
  return manifest;
}

async function resolveNpmCliPath() {
  const configuredPath = process.env.npm_execpath;
  if (
    typeof configuredPath !== "string" ||
    configuredPath.length < 1 ||
    configuredPath.length > 4_096 ||
    configuredPath.includes("\0") ||
    !isAbsolute(configuredPath) ||
    basename(configuredPath).toLowerCase() !== "npm-cli.js"
  ) {
    throw new PackageSmokeError("NPM_CLI_INVALID");
  }

  try {
    const canonicalCliPath = await realpath(configuredPath);
    const cliStats = await stat(canonicalCliPath);
    const npmRoot = resolve(dirname(canonicalCliPath), "..");
    const npmManifest = JSON.parse(
      await readFile(join(npmRoot, "package.json"), "utf8")
    );
    if (
      !cliStats.isFile() ||
      npmManifest?.name !== "npm" ||
      typeof npmManifest.version !== "string" ||
      !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/u.test(npmManifest.version) ||
      npmManifest.bin?.npm !== "bin/npm-cli.js"
    ) {
      throw new PackageSmokeError("NPM_CLI_INVALID");
    }
    const declaredCliPath = await realpath(
      resolve(npmRoot, npmManifest.bin.npm)
    );
    if (canonicalCliPath !== declaredCliPath) {
      throw new PackageSmokeError("NPM_CLI_INVALID");
    }
    return canonicalCliPath;
  } catch (error) {
    if (error instanceof PackageSmokeError) throw error;
    throw new PackageSmokeError("NPM_CLI_INVALID");
  }
}

async function assertInstalledManifest(installedPackagePath, version) {
  let manifest;
  try {
    manifest = JSON.parse(
      await readFile(join(installedPackagePath, "package.json"), "utf8")
    );
  } catch {
    throw new PackageSmokeError("INSTALLED_MANIFEST_INVALID");
  }
  if (
    manifest?.name !== "syntx-mcp" ||
    manifest.version !== version ||
    manifest.main !== "./dist/src/index.js" ||
    manifest.bin?.["syntx-settings-ir"] !==
      "scripts/sync-normalized-settings-ir.mjs" ||
    manifest.bin?.["syntx-settings-parser"] !==
      "scripts/sync-normalized-settings-parser-canary.mjs" ||
    manifest.bin?.["syntx-settings-census"] !==
      "scripts/sync-normalized-settings-parser-census-manifest.mjs" ||
    manifest.bin?.["syntx-settings-source-backed"] !==
      "scripts/sync-normalized-settings-parser-source-backed-result.mjs" ||
    manifest.bin?.["syntx-settings-generic"] !==
      "scripts/sync-normalized-settings-parser-generic-form-result.mjs" ||
    manifest.bin?.["syntx-mcp-maintenance"] !==
      "scripts/syntx-maintenance.mjs" ||
    manifest.bin?.["syntx-mcp-media-config"] !==
      "scripts/print-media-mcp-config.mjs" ||
    manifest.bin?.["syntx-mcp-update"] !==
      "scripts/update-mcp.mjs" ||
    manifest.scripts?.test !==
      "npm run build && node --test dist/tests/*.test.js tests/syntx-maintenance-cli.test.mjs tests/print-media-mcp-config.test.mjs tests/print-media-omni-reference-config-2117.test.mjs tests/print-media-mcp-config-kling4-2149.test.mjs tests/print-media-grok-i2v-config2288.test.mjs tests/upload-form-view2287.test.mjs tests/public-source-package-manifest.test.mjs tests/export-public-snapshot.test.mjs tests/public-secret-scan.test.mjs tests/prime-package-test-cache.test.mjs tests/public-source-line-endings.test.mjs" ||
    manifest.scripts?.["test:media:update"] !==
      "node --test --test-concurrency=1 dist/tests/syntx-public-catalog-schema-20261028.test.js dist/tests/public-catalog-selection.test.js dist/tests/public-catalog-sync.test.js dist/tests/owner-kling-i2v-input-policy.test.js dist/tests/owner-kling-i2v-parameters.test.js dist/tests/owner-kling-media-sdk2350.test.js dist/tests/owner-kling-motion-control-image-policy-1607.test.js dist/tests/owner-kling-motion-control-reference-service-1616.test.js dist/tests/owner-wan25-i2v-image-policy-1677.test.js dist/tests/owner-wan26-i2v-image-policy-1649.test.js dist/tests/owner-wan26-r2v-image-policy-1725.test.js dist/tests/owner-wan26-r2v-original-probe-1726.test.js dist/tests/owner-wan27-r2v-generation-parameters-1546.test.js dist/tests/owner-wan27-r2v-request-preparer-1555.test.js dist/tests/owner-wan27-r2v-generation-mcp-runtime-1565.test.js dist/tests/media-coverage.test.js dist/tests/reviewed-media-profile.test.js dist/tests/expanded-t2v-profile.test.js dist/tests/owner-expanded-t2v-tools.test.js dist/tests/owner-existing-kling4-recovery.test.js dist/tests/owner-existing-video-recovery2361.test.js tests/mcp-self-update-service.test.mjs tests/print-media-all-supported-media.test.mjs tests/public-media-update-package.test.mjs && node --test --test-name-pattern=\"all-supported config pins the updateable reviewed media profile\" tests/print-media-mcp-config.test.mjs && node --test --test-name-pattern=\"exports only the exact committed|exports only the allowlisted media guides|manifest rejects owner receipts and private documentation|public package paths must contain manifest\" tests/export-public-snapshot.test.mjs tests/public-source-package-manifest.test.mjs" ||
    manifest.scripts?.["settings:ir:check"] !==
      "node scripts/sync-normalized-settings-ir.mjs --check" ||
    manifest.scripts?.["settings:parser:check"] !==
      "node scripts/sync-normalized-settings-parser-canary.mjs --check" ||
    manifest.scripts?.["settings:parser:check:source"] !==
      "node scripts/sync-normalized-settings-parser-canary.mjs --check-source --confirm-source-fetch" ||
    manifest.scripts?.["settings:parser:sync"] !==
      "node scripts/sync-normalized-settings-parser-canary.mjs --sync-source --confirm-source-fetch" ||
    manifest.scripts?.["settings:census:check"] !==
      "node scripts/sync-normalized-settings-parser-census-manifest.mjs --check" ||
    manifest.scripts?.["settings:census:check:local"] !==
      "node scripts/sync-normalized-settings-parser-census-manifest.mjs --check-local" ||
    manifest.scripts?.["settings:census:sync:local"] !==
      "node scripts/sync-normalized-settings-parser-census-manifest.mjs --sync-local" ||
    manifest.scripts?.["settings:source-backed:check"] !==
      "node scripts/sync-normalized-settings-parser-source-backed-result.mjs --check" ||
    manifest.scripts?.["settings:source-backed:probe"] !==
      "node scripts/sync-normalized-settings-parser-source-backed-result.mjs --probe-source --confirm-source-fetch" ||
    manifest.scripts?.["settings:source-backed:check:source"] !==
      "node scripts/sync-normalized-settings-parser-source-backed-result.mjs --check-source --confirm-source-fetch" ||
    manifest.scripts?.["settings:source-backed:sync"] !==
      "node scripts/sync-normalized-settings-parser-source-backed-result.mjs --sync-source --confirm-source-fetch" ||
    manifest.scripts?.["settings:generic:check"] !==
      "node scripts/sync-normalized-settings-parser-generic-form-result.mjs --check" ||
    manifest.scripts?.["settings:generic:probe"] !==
      "node scripts/sync-normalized-settings-parser-generic-form-result.mjs --probe-source --confirm-source-fetch" ||
    manifest.scripts?.["settings:generic:check:source"] !==
      "node scripts/sync-normalized-settings-parser-generic-form-result.mjs --check-source --confirm-source-fetch" ||
    manifest.scripts?.["settings:generic:sync"] !==
      "node scripts/sync-normalized-settings-parser-generic-form-result.mjs --sync-source --confirm-source-fetch" ||
    manifest.scripts?.["presettings:ir:check"] !== undefined ||
    manifest.scripts?.["postsettings:ir:check"] !== undefined ||
    manifest.scripts?.["presettings:parser:check"] !== undefined ||
    manifest.scripts?.["postsettings:parser:check"] !== undefined ||
    manifest.scripts?.["presettings:parser:check:source"] !== undefined ||
    manifest.scripts?.["postsettings:parser:check:source"] !== undefined ||
    manifest.scripts?.["presettings:parser:sync"] !== undefined ||
    manifest.scripts?.["postsettings:parser:sync"] !== undefined ||
    manifest.scripts?.["presettings:census:check"] !== undefined ||
    manifest.scripts?.["postsettings:census:check"] !== undefined ||
    manifest.scripts?.["presettings:census:check:local"] !== undefined ||
    manifest.scripts?.["postsettings:census:check:local"] !== undefined ||
    manifest.scripts?.["presettings:census:sync:local"] !== undefined ||
    manifest.scripts?.["postsettings:census:sync:local"] !== undefined ||
    manifest.scripts?.["presettings:source-backed:check"] !== undefined ||
    manifest.scripts?.["postsettings:source-backed:check"] !== undefined ||
    manifest.scripts?.["presettings:source-backed:probe"] !== undefined ||
    manifest.scripts?.["postsettings:source-backed:probe"] !== undefined ||
    manifest.scripts?.["presettings:source-backed:check:source"] !== undefined ||
    manifest.scripts?.["postsettings:source-backed:check:source"] !== undefined ||
    manifest.scripts?.["presettings:source-backed:sync"] !== undefined ||
    manifest.scripts?.["postsettings:source-backed:sync"] !== undefined ||
    manifest.scripts?.["presettings:generic:check"] !== undefined ||
    manifest.scripts?.["postsettings:generic:check"] !== undefined ||
    manifest.scripts?.["presettings:generic:probe"] !== undefined ||
    manifest.scripts?.["postsettings:generic:probe"] !== undefined ||
    manifest.scripts?.["presettings:generic:check:source"] !== undefined ||
    manifest.scripts?.["postsettings:generic:check:source"] !== undefined ||
    manifest.scripts?.["presettings:generic:sync"] !== undefined ||
    manifest.scripts?.["postsettings:generic:sync"] !== undefined
  ) {
    throw new PackageSmokeError("INSTALLED_MANIFEST_INVALID");
  }
}

async function assertInstalledInventoryBoundary(installedPackagePath) {
  let inventoryModule;
  try {
    inventoryModule = await import(
      pathToFileURL(
        join(
          installedPackagePath,
          "dist",
          "src",
          "catalog",
          "settings-source-inventory.js"
        )
      ).href
    );
  } catch {
    throw new PackageSmokeError("INSTALLED_INVENTORY_MODULE_INVALID");
  }
  if (
    Object.hasOwn(
      inventoryModule,
      "fetchPinnedSettingsFormSourceMaterial"
    )
  ) {
    throw new PackageSmokeError("INSTALLED_SOURCE_LOADER_EXPOSED");
  }
  if (typeof inventoryModule.refreshSettingsSourceInventory !== "function") {
    throw new PackageSmokeError("INSTALLED_INVENTORY_MAINTENANCE_MISSING");
  }
}

function parsePackResult(output, temporaryRoot, version) {
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new PackageSmokeError("PACKAGE_MANIFEST_INVALID");
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 1 ||
    parsed[0]?.name !== "syntx-mcp" ||
    parsed[0]?.version !== version ||
    typeof parsed[0]?.filename !== "string" ||
    !/^[A-Za-z0-9._-]+\.tgz$/u.test(parsed[0].filename) ||
    !Array.isArray(parsed[0]?.files) ||
    parsed[0].files.some(
      (entry) =>
        entry === null ||
        typeof entry !== "object" ||
        typeof entry.path !== "string"
    )
  ) {
    throw new PackageSmokeError("PACKAGE_MANIFEST_INVALID");
  }
  const tarballPath = resolve(temporaryRoot, parsed[0].filename);
  if (
    basename(tarballPath) !== parsed[0].filename ||
    resolve(tarballPath) !== join(resolve(temporaryRoot), parsed[0].filename)
  ) {
    throw new PackageSmokeError("PACKAGE_MANIFEST_INVALID");
  }
  return { ...parsed[0], tarballPath };
}

async function run(command, argumentsValue, cwd = PROJECT_ROOT) {
  try {
    return await execFileAsync(command, argumentsValue, {
      cwd,
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
      timeout: 120_000
    });
  } catch {
    throw new PackageSmokeError("SUBPROCESS_FAILED");
  }
}

async function runNodeScript(scriptPath, argumentsValue, cwd = PROJECT_ROOT) {
  return run(process.execPath, [scriptPath, ...argumentsValue], cwd);
}

async function runNodeScriptExpectedFailure(
  scriptPath,
  argumentsValue,
  cwd,
  stderrValue
) {
  await new Promise((resolvePromise, rejectPromise) => {
    execFile(
      process.execPath,
      [scriptPath, ...argumentsValue],
      {
        cwd,
        encoding: "utf8",
        maxBuffer: 2 * 1024 * 1024,
        timeout: 120_000
      },
      (error, stdout, stderr) => {
        if (
          error === null ||
          error.code !== 1 ||
          stdout !== "" ||
          stderr !== stderrValue
        ) {
          rejectPromise(new PackageSmokeError("FAILURE_CONTRACT_INVALID"));
          return;
        }
        resolvePromise();
      }
    );
  });
}

function assertSummary(output) {
  if (!output.includes(EXPECTED_SUMMARY)) {
    throw new PackageSmokeError("IR_CHECK_OUTPUT_INVALID");
  }
}

function assertParserSummary(output) {
  if (!output.includes(EXPECTED_PARSER_SUMMARY)) {
    throw new PackageSmokeError("PARSER_CHECK_OUTPUT_INVALID");
  }
}

function assertCensusSummary(output) {
  if (!output.includes(EXPECTED_CENSUS_SUMMARY)) {
    throw new PackageSmokeError("CENSUS_CHECK_OUTPUT_INVALID");
  }
}

function assertSourceBackedSummary(output) {
  if (!output.includes(EXPECTED_SOURCE_BACKED_SUMMARY)) {
    throw new PackageSmokeError("SOURCE_BACKED_CHECK_OUTPUT_INVALID");
  }
}

async function assertSourceBackedResultUnchanged(path, expected) {
  if ((await readFile(path, "utf8")) !== expected) {
    throw new PackageSmokeError("INSTALLED_SOURCE_BACKED_RESULT_CHANGED");
  }
}

function assertGenericSummary(output) {
  if (!output.includes(EXPECTED_GENERIC_SUMMARY)) {
    throw new PackageSmokeError("GENERIC_CHECK_OUTPUT_INVALID");
  }
}

async function assertGenericResultUnchanged(path, expected) {
  if ((await readFile(path, "utf8")) !== expected) {
    throw new PackageSmokeError("INSTALLED_GENERIC_RESULT_CHANGED");
  }
}

// DEBT-020: one entry point for the "did this phase leave anything behind"
// check, so the ~7 network-mode call sites don't each hand-pair the same two
// calls. The thrown code is suffixed by phase so a failure names which phase
// left something behind, instead of every phase sharing one indistinguishable
// code. This does not cover scripts/settings-source-history.mjs's own
// unrelated packaging-exclusion check (still calls assertPathsMissing directly).
async function assertNoInstalledSideEffects(installedPackagePath, phase, missingPaths) {
  try {
    await assertPathsMissing(missingPaths);
    await assertNoStrayTempSnapshotsInRuntimeDirectories(installedPackagePath);
  } catch (error) {
    if (error instanceof PackageSmokeError && error.message === "INSTALLED_SOURCE_MODE_SIDE_EFFECT_FOUND") {
      throw new PackageSmokeError(`INSTALLED_SOURCE_MODE_SIDE_EFFECT_FOUND_${phase}`);
    }
    throw error;
  }
}

async function assertPathsMissing(paths) {
  for (const path of paths) {
    try {
      await stat(path);
    } catch (error) {
      if (
        error !== null &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        continue;
      }
      throw new PackageSmokeError("PACKAGE_SIDE_EFFECT_CHECK_FAILED");
    }
    throw new PackageSmokeError("INSTALLED_SOURCE_MODE_SIDE_EFFECT_FOUND");
  }
}

// Three independent writers leave differently-named orphaned temp files if
// killed mid-write (immutable-json-snapshot.ts, atomic-json-snapshot.ts, and
// the three v1 sync-*.mjs scripts). DEBT-020 tracks unifying this into one
// writer with one naming scheme; until then this checks all known shapes
// across every catalog/runtime directory with immutable/source history checks
// currently exercised by package smoke (v1-v5, plus evidence-only v11-v13).
const STRAY_TEMP_PATTERNS = [
  /^\.syntx-immutable-json-snapshot-.+\.tmp$/u,
  /^\.syntx-json-snapshot-.+\.tmp$/u,
  /^\..+\.\d+\.[0-9a-f-]+\.tmp$/u
];

async function assertNoStrayTempSnapshots(directoryPath) {
  let entries;
  try {
    entries = await readdir(directoryPath);
  } catch (error) {
    if (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return;
    }
    throw new PackageSmokeError("PACKAGE_SIDE_EFFECT_CHECK_FAILED");
  }
  if (
    entries.some((entry) =>
      STRAY_TEMP_PATTERNS.some((pattern) => pattern.test(entry))
    )
  ) {
    throw new PackageSmokeError("INSTALLED_SOURCE_MODE_SIDE_EFFECT_FOUND");
  }
}

async function assertNoStrayTempSnapshotsInRuntimeDirectories(
  installedPackagePath
) {
  const runtimeRoot = join(installedPackagePath, "catalog", "runtime");
  for (const version of ["v1", "v2", "v3", "v4", "v5", "v11", "v12", "v13"]) {
    await assertNoStrayTempSnapshots(join(runtimeRoot, version));
  }
}

class PackageSmokeError extends Error {
  constructor(readonlyCode) {
    super(readonlyCode);
    this.name = "PackageSmokeError";
    this.code = readonlyCode;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runPackageSmokeCli();
}

export async function runPackageSmokeCli(mainRunner = main) {
  try {
    await mainRunner();
  } catch (error) {
    const code = error instanceof PackageSmokeError || error instanceof SoulImageInstalledCheckError
      ? error.code
      : "UNEXPECTED_ERROR";
    process.stderr.write(`Installed package smoke failed: ${code}.\n`);
    process.exitCode = 1;
  }
}
