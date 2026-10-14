import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const checker = readFileSync(new URL("../scripts/check-package-install.mjs", import.meta.url), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("installed media checker requires one Suno track-input tool only with Suno generation enabled", () => {
  assert.ok(checker.includes("auditSunoOff=join(temp,'audit-suno-off.json')"));
  assert.match(checker, /const sunoOff=await runList\(\{\.\.\.cfg\.env,SYNTX_OWNER_SUNO_GENERATION:'0'\},auditSunoOff\)/u);
  assert.match(checker, /optIn\.names\.filter\(n=>n==='syntx_owner_list_suno_track_inputs'\)\.length,1/u);
  assert.match(checker, /sunoOff\.names\.includes\('syntx_owner_list_suno_track_inputs'\),false/u);
});

test("changed media test command includes the focused SDK and installed-checker regressions", () => {
  const script = packageJson.scripts["test:media:changed"];
  assert.ok(script.includes("dist/tests/owner-suno-track-tools.test.js"));
  assert.ok(script.includes("tests/owner-suno-track-package-checker.test.mjs"));
});
