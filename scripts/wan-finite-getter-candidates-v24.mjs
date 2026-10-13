#!/usr/bin/env node

import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

const PUBLIC_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const SETTINGS_VERSION = "sha256-00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61.json";

export async function main(args = process.argv.slice(2), deps = {}) {
  if (args.length !== 6 || !["--review", "--form-diagnostics", "--aspect-ratio-helper-review", "--aspect-ratio-list-review"].includes(args[0]) || args[1] !== "--public-version" || args[2] !== PUBLIC_VERSION || args[3] !== "--settings-version" || args[4] !== SETTINGS_VERSION || args[5] !== "--confirm-source-fetch") throw new Error("Usage: wan-finite-getter-candidates-v24.mjs --review|--form-diagnostics|--aspect-ratio-helper-review|--aspect-ratio-list-review --public-version <pinned> --settings-version <pinned> --confirm-source-fetch");
  const projectRoot = deps.projectRoot ?? process.cwd();
  let buildRoot = process.env.SYNTX_TASK41_BUILD_DIR ?? join(projectRoot, "dist");
  let moduleNonce = 0;
  const load = async (path, root = buildRoot) => import(`${pathToFileURL(join(root, path)).href}?task41=${moduleNonce++}`);
  let [publicHistory, inventoryModule, tool] = await Promise.all([
    load("src/catalog/public-catalog-history.js"), load("src/catalog/mapless-settings-inventory.js"), load("tools/wan-finite-getter-candidates-v24.js")
  ]);
  const catalogDirectory = join(projectRoot, "catalog");
  const inventory = deps.settings_inventory ?? inventoryModule.loadMaplessSettingsInventoryVersion(SETTINGS_VERSION, catalogDirectory);
  if (args[0] === "--aspect-ratio-helper-review") {
    const parentArtifactPath = join(catalogDirectory, "runtime/v24/sha256-1b2f798011bb7630e368c3f76d7f4cc16fa5af7359c5c005b859f377bc3b4f81.json");
    const parentBytes = await readFile(parentArtifactPath);
    if (createHash("sha256").update(parentBytes).digest("hex") !== "1b2f798011bb7630e368c3f76d7f4cc16fa5af7359c5c005b859f377bc3b4f81") throw new Error("WAN_V24_PARENT_DIAGNOSTICS_HASH_MISMATCH");
    const parentArtifact = JSON.parse(parentBytes.toString("utf8"));
    const directImport = parentArtifact.source_diagnostics.imports_by_module.find(module => module.module_name === "wan-video.js")?.bindings.find(binding => binding.specifier === "./AspectRatio.js" && binding.imported_name === "A" && binding.local_name === "St");
    if (!directImport) throw new Error("WAN_V24_ASPECT_RATIO_PARENT_IMPORT_UNPROVEN");
    const helper = await tool.fetchWanFiniteAspectRatioHelperForReview(inventory, PUBLIC_VERSION, SETTINGS_VERSION, deps.fetch_impl ?? fetch);
    const printHelperReview = async (activeTool, buildPath = buildRoot) => {
      if (activeTool.wanFiniteSourceSha256(Buffer.from(helper.text, "utf8")) !== helper.sha256 || Buffer.byteLength(helper.text, "utf8") !== helper.bytes) throw new Error("WAN_V24_HELD_HELPER_HASH_MISMATCH");
      const analysis = activeTool.analyzeWanFiniteGetterCandidates({ source: helper.text, model_ids: [], module_name: helper.module_name, include_controls: false });
      process.stdout.write(`${JSON.stringify({ status: "awaiting_root_helper_review", evidence_scope: "PARTIAL_STATIC_SOURCE_CANDIDATE", parent_source_identity: { module_name: "wan-video.js", url: "https://syntx.ai/assets/1791467421/wan-video.js", bytes: 19503, sha256: "sha256:aae2be04ca8a814db7dfb93717a234f55922b4b9f0ebc3eccd517c9d82f46119" }, parent_field_import: { field: "aspect_ratio", ...directImport }, source_identity: { module_name: helper.module_name, url: helper.url, bytes: helper.bytes, sha256: helper.sha256, bom_present: helper.bom_present, pin_kind: "NEWLY_PINNED_DIRECT_IMPORT" }, render_list_candidates: analysis.render_list_candidates, source_diagnostics: analysis.source_diagnostics, reanalyze_build_path: buildPath, source_persisted: false, runtime_usable: false, backend_acceptance: false })}\n`);
    };
    await printHelperReview(tool);
    const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
    for await (const line of lines) {
      if (line === "DISCARD") { process.stdout.write("DISCARDED_NOT_ARCHIVED\n"); return { status: "not_archived" }; }
      if (line.startsWith("REANALYZE ")) {
        const requestedBuild = resolve(line.slice("REANALYZE ".length));
        tool = await load("tools/wan-finite-getter-candidates-v24.js", requestedBuild);
        await printHelperReview(tool, requestedBuild);
        continue;
      }
      process.stdout.write("EXPECTED_DISCARD_OR_REANALYZE_BUILD_PATH\n");
    }
    throw new Error("WAN_V24_HELPER_REVIEW_INPUT_CLOSED_WITHOUT_DECISION");
  }
  if (args[0] === "--aspect-ratio-list-review") {
    const parent = { module_name: "AspectRatio.js", bytes: 2695, sha256: "sha256:ba08e10bef5b19f13ffe8bb425dab56c38700178d1d8fecc8d01bdd054452cbf", imported_names: ["i as b", "g as r", "r as T"] };
    const helper = await tool.fetchWanFiniteAspectRatioListHelperForReview(inventory, PUBLIC_VERSION, SETTINGS_VERSION, parent, deps.fetch_impl ?? fetch);
    const printHelperReview = async (activeTool, buildPath = buildRoot) => {
      if (activeTool.wanFiniteSourceSha256(Buffer.from(helper.text, "utf8")) !== helper.sha256 || Buffer.byteLength(helper.text, "utf8") !== helper.bytes) throw new Error("WAN_V24_HELD_RATIO_LIST_HASH_MISMATCH");
      const analysis = activeTool.analyzeWanFiniteGetterCandidates({ source: helper.text, model_ids: [], module_name: helper.module_name, include_controls: false });
      process.stdout.write(`${JSON.stringify({ status: "awaiting_root_helper_review", evidence_scope: "PARTIAL_STATIC_SOURCE_CANDIDATE", parent_source_identity: parent, parent_import_use: "AspectRatio.js passes imported ratio-list aliases to its component factory; its renderList input is the ratios parameter.", source_identity: { module_name: helper.module_name, url: helper.url, bytes: helper.bytes, sha256: helper.sha256, bom_present: helper.bom_present, pin_kind: "NEWLY_PINNED_DIRECT_IMPORT" }, render_list_candidates: analysis.render_list_candidates, source_diagnostics: analysis.source_diagnostics, reanalyze_build_path: buildPath, source_persisted: false, runtime_usable: false, backend_acceptance: false })}\n`);
    };
    await printHelperReview(tool);
    const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
    for await (const line of lines) {
      if (line === "DISCARD") { process.stdout.write("DISCARDED_NOT_ARCHIVED\n"); return { status: "not_archived" }; }
      if (line.startsWith("REANALYZE ")) {
        const requestedBuild = resolve(line.slice("REANALYZE ".length));
        tool = await load("tools/wan-finite-getter-candidates-v24.js", requestedBuild);
        await printHelperReview(tool, requestedBuild);
        continue;
      }
      process.stdout.write("EXPECTED_DISCARD_OR_REANALYZE_BUILD_PATH\n");
    }
    throw new Error("WAN_V24_RATIO_LIST_REVIEW_INPUT_CLOSED_WITHOUT_DECISION");
  }
  if (args[0] === "--form-diagnostics") {
    const source = await tool.fetchWanFinitePinnedFormSource(inventory, PUBLIC_VERSION, SETTINGS_VERSION, deps.fetch_impl ?? fetch);
    const modelIds = inventory.models.filter(model => model.form_id === "wan-video" && model.active).map(model => model.model_id).sort();
    let heldHelper = null;
    const parentArtifactPath = join(catalogDirectory, "runtime/v24/sha256-1b2f798011bb7630e368c3f76d7f4cc16fa5af7359c5c005b859f377bc3b4f81.json");
    const parentBytes = await readFile(parentArtifactPath);
    const parentSha = createHash("sha256").update(parentBytes).digest("hex");
    if (parentSha !== "1b2f798011bb7630e368c3f76d7f4cc16fa5af7359c5c005b859f377bc3b4f81") throw new Error("WAN_V24_PARENT_DIAGNOSTICS_HASH_MISMATCH");
    const parentArtifact = JSON.parse(parentBytes.toString("utf8"));
    const parentBindings = parentArtifact.source_diagnostics.dependency_bindings.filter(binding => binding.importer_module === "wan-video.js");
    const sourceIdentity = { module_name: source.module_name, url: source.url, bytes: source.bytes, sha256: source.sha256, bom_present: source.bom_present };
    const printFormReview = async (activeTool, buildPath = buildRoot) => {
      if (activeTool.wanFiniteSourceSha256(Buffer.from(source.text, "utf8")) !== source.sha256 || Buffer.byteLength(source.text, "utf8") !== source.bytes) throw new Error("WAN_V24_HELD_FORM_SOURCE_HASH_MISMATCH");
      const analysis = activeTool.analyzeWanFiniteGetterCandidates({ source: source.text, model_ids: modelIds, module_name: source.module_name });
      const formBindings = analysis.source_diagnostics.imports_by_module[0]?.bindings ?? [];
      const appBindingSet = new Set(formBindings.filter(binding => binding.specifier === "./app.js").map(binding => `${binding.imported_name}\u0000${binding.local_name}`));
      const appBindingResolution = parentBindings.filter(binding => appBindingSet.has(`${binding.imported_name}\u0000${binding.local_name}`));
      const output = {
        status: "awaiting_root_source_review",
        evidence_scope: "PARTIAL_STATIC_SOURCE_CANDIDATE",
        source_identity: sourceIdentity,
        model_ids: modelIds,
        controls: analysis.controls.map(({ field, options, model_options, model_applicability, source_line, source_column }) => ({ field, options, model_options, model_applicability, source_line, source_column })),
        render_list_candidates: analysis.render_list_candidates,
        source_diagnostics: { ...analysis.source_diagnostics, app_binding_resolution: appBindingResolution },
        parent_graph_source: "catalog/runtime/v24/sha256-1b2f798011bb7630e368c3f76d7f4cc16fa5af7359c5c005b859f377bc3b4f81.json",
        reanalyze_build_path: buildPath,
        source_persisted: false,
        runtime_usable: false,
        backend_acceptance: false
      };
      process.stdout.write(`${JSON.stringify(output)}\n`);
      return { analysis, app_binding_resolution: appBindingResolution };
    };
    const printHelperReview = activeTool => {
      if (!heldHelper) return;
      if (activeTool.wanFiniteSourceSha256(Buffer.from(heldHelper.text, "utf8")) !== heldHelper.sha256 || Buffer.byteLength(heldHelper.text, "utf8") !== heldHelper.bytes) throw new Error("WAN_V24_HELD_HELPER_HASH_MISMATCH");
      const analysis = activeTool.analyzeWanFiniteGetterCandidates({ source: heldHelper.text, model_ids: modelIds, module_name: heldHelper.module_name, include_controls: false });
      const output = {
        status: "awaiting_root_helper_review",
        evidence_scope: "PARTIAL_STATIC_SOURCE_CANDIDATE",
        source_identity: { module_name: heldHelper.module_name, url: heldHelper.url, bytes: heldHelper.bytes, sha256: heldHelper.sha256, bom_present: heldHelper.bom_present, pin_kind: "NEWLY_PINNED_DIRECT_IMPORT" },
        render_list_candidates: analysis.render_list_candidates,
        source_diagnostics: analysis.source_diagnostics,
        source_persisted: false,
        runtime_usable: false,
        backend_acceptance: false
      };
      process.stdout.write(`${JSON.stringify(output)}\n`);
    };
    await printFormReview(tool);
    const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
    for await (const line of lines) {
      if (line === "FETCH_HELPER AspectRatio.js") {
        heldHelper = await tool.fetchWanFiniteDirectAspectRatioHelper(inventory, PUBLIC_VERSION, SETTINGS_VERSION, source, deps.fetch_impl ?? fetch);
        printHelperReview(tool);
        continue;
      }
      if (line === "DISCARD") { process.stdout.write("DISCARDED_NOT_ARCHIVED\n"); return { source_identity: sourceIdentity, status: "not_archived" }; }
      if (line.startsWith("REANALYZE ")) {
        const requestedBuild = resolve(line.slice("REANALYZE ".length));
        tool = await load("tools/wan-finite-getter-candidates-v24.js", requestedBuild);
        await printFormReview(tool, requestedBuild);
        printHelperReview(tool);
        continue;
      }
      process.stdout.write("EXPECTED_FETCH_ASPECT_RATIO_HELPER_DISCARD_OR_REANALYZE_BUILD_PATH\n");
    }
    throw new Error("WAN_V24_FORM_REVIEW_INPUT_CLOSED_WITHOUT_DECISION");
  }
  const publicCatalog = deps.public_catalog ?? publicHistory.loadPublicCatalogVersion(PUBLIC_VERSION, catalogDirectory);
  let sources = await tool.fetchWanFinitePinnedSources(inventory, PUBLIC_VERSION, SETTINGS_VERSION, deps.fetch_impl ?? fetch);
  let artifact = tool.analyzeWanFiniteSourceCandidates({ public_catalog: publicCatalog, public_version: PUBLIC_VERSION, settings_inventory: inventory, settings_version: SETTINGS_VERSION, sources });
  printReview(artifact);
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    if (line === "ARCHIVE") {
      const archived = await tool.archiveWanFiniteSourceCandidates(artifact, projectRoot);
      process.stdout.write(`${JSON.stringify({ status: archived.status, version: archived.version, sources_remain_memory_only: true })}\n`);
      return { artifact, ...archived };
    }
    if (line === "DISCARD") { process.stdout.write("DISCARDED_NOT_ARCHIVED\n"); return { artifact, version: null, status: "not_archived" }; }
    if (line.startsWith("REANALYZE ")) {
      buildRoot = resolve(line.slice("REANALYZE ".length));
      tool = await load("tools/wan-finite-getter-candidates-v24.js", buildRoot);
      sources = tool.reverifyWanFiniteSourceTexts(inventory, PUBLIC_VERSION, SETTINGS_VERSION, sources);
      artifact = tool.analyzeWanFiniteSourceCandidates({ public_catalog: publicCatalog, public_version: PUBLIC_VERSION, settings_inventory: inventory, settings_version: SETTINGS_VERSION, sources });
      printReview(artifact);
      continue;
    }
    process.stdout.write("EXPECTED_ARCHIVE_DISCARD_OR_REANALYZE_BUILD_PATH\n");
  }
  throw new Error("WAN_V24_REVIEW_INPUT_CLOSED_WITHOUT_DECISION");
}

function printReview(artifact) {
  process.stdout.write(`${JSON.stringify({ status: "awaiting_root_review", evidence_scope: artifact.evidence_scope, model_ids: artifact.model_ids, target_fields: artifact.target_fields, controls: artifact.controls, render_list_candidates: artifact.render_list_candidates, source_diagnostics: artifact.source_diagnostics, unresolved_import_count: artifact.unresolved_imports.length, source_identities: artifact.source_identities, runtime_usable: false, backend_acceptance: false })}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { process.stderr.write(`${error instanceof Error && /^[A-Z][A-Z0-9_]{1,80}$/u.test(error.message) ? error.message : "WAN_V24_SOURCE_CANDIDATE_FAILED"}\n`); process.exitCode = 1; });
}
