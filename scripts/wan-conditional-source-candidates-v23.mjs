#!/usr/bin/env node

import { createInterface } from "node:readline";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PUBLIC_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const SETTINGS_VERSION = "sha256-00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61.json";

export async function main(args = process.argv.slice(2), deps = {}) {
  if (args.length !== 6 || !["--probe", "--archive", "--review"].includes(args[0]) || args[1] !== "--public-version" || args[2] !== PUBLIC_VERSION || args[3] !== "--settings-version" || args[4] !== SETTINGS_VERSION || args[5] !== "--confirm-source-fetch") throw new Error("Usage: wan-conditional-source-candidates-v23.mjs --probe|--archive|--review --public-version <pinned> --settings-version <pinned> --confirm-source-fetch");
  const projectRoot = deps.projectRoot ?? process.cwd();
  const buildRoot = process.env.SYNTX_TASK39_BUILD_DIR ?? join(projectRoot, "dist");
  const load = async path => import(pathToFileURL(join(buildRoot, path)).href);
  const [publicHistory, settingsInventoryModule, candidateModule] = await Promise.all([
    load("src/catalog/public-catalog-history.js"), load("src/catalog/mapless-settings-inventory.js"), load("tools/wan-conditional-source-candidates-v23.js")
  ]);
  errorClasses = [candidateModule.WanSourceHashMismatch, candidateModule.WanSourceIdentityMismatch];
  const publicCatalog = deps.publicCatalog ?? publicHistory.loadPublicCatalogVersion(PUBLIC_VERSION, join(projectRoot, "catalog"));
  const settingsInventory = deps.settingsInventory ?? settingsInventoryModule.loadMaplessSettingsInventoryVersion(SETTINGS_VERSION, join(projectRoot, "catalog"));
  if (args[0] === "--review") {
    const sources = await candidateModule.fetchPinnedWanCandidateSources(settingsInventory, PUBLIC_VERSION, SETTINGS_VERSION, deps.fetchImpl ?? fetch);
    const artifact = candidateModule.analyzeWanConditionalSourceCandidates({ publicCatalog, publicVersion: PUBLIC_VERSION, settingsInventory, settingsVersion: SETTINGS_VERSION, sources });
    process.stdout.write(`${JSON.stringify({ status: "awaiting_root_review", model_ids: artifact.models.map(model => model.model_id), controls: artifact.controls, model_applicability: artifact.models, dependency_trace: artifact.dependency_trace, source_metadata: artifact.sources, runtime_usable: false, backend_acceptance: false })}\n`);
    const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
    for await (const command of lines) {
      if (command === "ARCHIVE") {
        const archived = await candidateModule.archiveWanConditionalSourceCandidate(artifact, projectRoot);
        process.stdout.write(`${JSON.stringify({ status: archived.status, version: archived.version, sources_remain_memory_only: true })}\n`);
        return { artifact, ...archived };
      }
      if (command === "DISCARD") { process.stdout.write("DISCARDED_NOT_ARCHIVED\n"); return { artifact, version: null, status: "not_archived" }; }
      process.stdout.write("EXPECTED_ARCHIVE_OR_DISCARD\n");
    }
    throw new Error("REVIEW_INPUT_CLOSED_WITHOUT_DECISION");
  }
  const result = await candidateModule.runWanConditionalSourceCandidateCli(args, { projectRoot, publicCatalog, settingsInventory, ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }) });
  process.stdout.write(`${JSON.stringify({ status: result.status, version: result.version, build_id: result.artifact.build_id, models: result.artifact.models.length, controls: result.artifact.controls.length, dependency_trace: result.artifact.dependency_trace.app_binding, runtime_usable: false, backend_acceptance: false })}\n`);
  return result;
}

let errorClasses = [];
function safeError(error) {
  if (errorClasses.some(ErrorClass => error instanceof ErrorClass)) return JSON.stringify({ code: error.message, details: error.details });
  if (error instanceof Error && /^[A-Z][A-Z0-9_]{1,80}$/u.test(error.message)) return error.message;
  return "WAN_SOURCE_CANDIDATE_FAILED";
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => { process.stderr.write(`${safeError(error)}\n`); process.exitCode = 1; });
