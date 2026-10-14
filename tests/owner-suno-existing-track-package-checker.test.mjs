import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const checker = readFileSync(new URL("../scripts/check-package-install.mjs", import.meta.url), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("installed media checker asserts one existing-track tool under the existing Suno opt-in only", () => {
  assert.match(checker,
    /optIn\.names\.filter\(n=>n==='syntx_owner_list_existing_suno_tracks'\)\.length,1/u);
  assert.match(checker,
    /sunoOff\.names\.includes\('syntx_owner_list_existing_suno_tracks'\),false/u);
  assert.match(checker, /SYNTX_OWNER_SUNO_GENERATION:'0'/u);
});

test("changed-media selector is the frozen existing-track chain only", () => {
  assert.equal(packageJson.scripts["test:media:changed"],
    "node --test --test-concurrency=2 dist/tests/syntx-chat-http-client-owner-suno-existing-track.test.js dist/tests/owner-suno-existing-track-service.test.js dist/tests/owner-suno-existing-track-tools.test.js tests/owner-suno-existing-track-package-checker.test.mjs");
});
