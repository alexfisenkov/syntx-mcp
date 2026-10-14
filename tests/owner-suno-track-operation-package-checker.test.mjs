import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const checker = readFileSync(new URL("../scripts/check-package-install.mjs", import.meta.url), "utf8");
const legacySunoChecker = readFileSync(new URL("../scripts/check-installed-suno-generation-flow.mjs", import.meta.url), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const operationTools = [
  "syntx_get_suno_track_operation_parameters",
  "syntx_owner_cover_suno_audio",
  "syntx_owner_extend_suno_audio",
  "syntx_owner_reconcile_suno_track_operation",
  "syntx_owner_list_suno_track_operation_recoveries",
  "syntx_owner_get_suno_track_operation_result_page"
];

test("installed media checker requires all six Suno track-operation tools only with Suno enabled", () => {
  for (const name of operationTools) assert.ok(checker.includes(name), `missing installed assertion for ${name}`);
  assert.match(checker, /for\(const n of sunoTrackOperationNames\)\{assert\.equal\(optIn\.names\.filter\(x=>x===n\)\.length,1\);assert\.equal\(sunoOff\.names\.includes\(n\),false\);\}/u);
  assert.match(checker, /SYNTX_OWNER_SUNO_GENERATION:'0'/u);
  const legacyNamesMatch = legacySunoChecker.match(/const TOOL_NAMES = Object\.freeze\((\[[\s\S]*?\])\);/u);
  assert.ok(legacyNamesMatch);
  assert.deepEqual(JSON.parse(legacyNamesMatch[1]), [
    "syntx_get_suno_generate_parameters",
    "syntx_owner_generate_suno_audio",
    "syntx_owner_reconcile_suno_audio",
    "syntx_owner_list_suno_recoveries",
    "syntx_owner_get_suno_result_page"
  ]);
  assert.match(checker, /optIn\.names\.filter\(n=>n==='syntx_owner_list_suno_track_inputs'\)\.length,1/u);
  assert.match(checker, /sunoOff\.names\.includes\('syntx_owner_list_suno_track_inputs'\),false/u);
});

test("changed media gate selects the new existing-track chain and excludes previous audio reruns", () => {
  const script = packageJson.scripts["test:media:changed"];
  for (const path of [
    "dist/tests/syntx-chat-http-client-owner-suno-existing-track.test.js",
    "dist/tests/owner-suno-existing-track-service.test.js",
    "dist/tests/owner-suno-existing-track-tools.test.js",
    "tests/owner-suno-existing-track-package-checker.test.mjs"
  ]) assert.ok(script.includes(path), `missing changed media target ${path}`);
  for (const path of [
    "dist/tests/owner-suno-track-operation-parameters.test.js",
    "dist/tests/owner-suno-track-operation-preparer.test.js",
    "dist/tests/syntx-chat-http-client-owner-suno-track-operation.test.js",
    "dist/tests/owner-suno-track-operation-generation-service.test.js",
    "dist/tests/owner-suno-track-operation-tools.test.js",
    "dist/tests/owner-topaz-astra-source-profile.test.js",
    "dist/tests/owner-suno-track-metadata.test.js",
    "dist/tests/owner-suno-track-context.test.js",
    "dist/tests/owner-suno-track-service.test.js",
    "dist/tests/owner-suno-track-tools.test.js",
    "tests/owner-suno-track-operation-package-checker.test.mjs"
  ]) assert.equal(script.includes(path), false, `previous audio target should not be repeated: ${path}`);
});
