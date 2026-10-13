import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertRemainingImageSourceAdmissionPackagePaths,
  assertRemainingImageSourceAdmissionSnapshot,
  collectRemainingImageSourceAdmissionSnapshot,
  RemainingImageSourceAdmissionError
} from "../scripts/check-installed-remaining-image-source-admission.mjs";

const modules = [
  "owner-runway-image-parameters", "owner-runway-image-source-profile",
  "owner-seedream-image-parameters", "owner-seedream-image-source-profile",
  "owner-flux-image-parameters", "owner-flux-image-source-profile"
];
const paths = new Set([
  "dist/src/index.js", "dist/src/index.d.ts",
  ...modules.flatMap((module) => [`dist/src/application/${module}.js`, `dist/src/application/${module}.d.ts`])
]);
const catalog = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";

test("remaining image admission requires compiled modules and declarations", () => {
  assert.equal(assertRemainingImageSourceAdmissionPackagePaths(paths), true);
  paths.delete("dist/src/application/owner-flux-image-source-profile.d.ts");
  assert.throws(() => assertRemainingImageSourceAdmissionPackagePaths(paths),
    (error) => error instanceof RemainingImageSourceAdmissionError && error.code === "INSTALLED_REMAINING_IMAGE_PACKAGE_CONTENT_MISSING");
});

test("remaining image snapshot admits nine source profiles without promoting capability", () => {
  const profiles = Array.from({ length: 9 }, (_, index) => ({
    profile_id: `profile-${index}`, public_catalog_version: catalog, dispatch_allowed: false,
    runtime_activation: false, backend_acceptance: "UNPROVEN", effective_defaults: "UNKNOWN"
  }));
  assert.equal(assertRemainingImageSourceAdmissionSnapshot({ profiles, normalizer_cases: 100 }), true);
});

test("remaining image snapshot rejects missing profiles and upgraded activation claims", () => {
  assert.throws(() => assertRemainingImageSourceAdmissionSnapshot({ profiles: [], normalizer_cases: 100 }),
    (error) => error instanceof RemainingImageSourceAdmissionError && error.code === "INSTALLED_REMAINING_IMAGE_COVERAGE_MISMATCH");
  const profiles = Array.from({ length: 9 }, (_, index) => ({
    profile_id: `profile-${index}`, public_catalog_version: catalog, dispatch_allowed: false,
    runtime_activation: false, backend_acceptance: index === 4 ? "ACCEPTED" : "UNPROVEN", effective_defaults: "UNKNOWN"
  }));
  assert.throws(() => assertRemainingImageSourceAdmissionSnapshot({ profiles, normalizer_cases: 100 }),
    (error) => error instanceof RemainingImageSourceAdmissionError && error.code === "INSTALLED_REMAINING_IMAGE_PROFILE_PROOF_UPGRADE");
});

test("compiled source getters preserve nested source-execution pins and all nine profile joins", async () => {
  const [api, selectedModule] = await Promise.all([
    import("../dist/src/index.js"), import("../dist/src/catalog/selected-discovery-catalog.js")
  ]);
  const selected = selectedModule.loadSelectedDiscoveryCatalog(catalog, fileURLToPath(new URL("../catalog/", import.meta.url)));
  const snapshot = collectRemainingImageSourceAdmissionSnapshot(api, selected.discoveryCatalog);
  assert.equal(snapshot.profiles.length, 9);
  assert.ok(snapshot.normalizer_cases >= 100);
  const seedream = snapshot.profiles.find((profile) => profile.profile_id === "seedream-image-source-reviewed-v1");
  assert.equal(seedream.public_settings.max_prompt_length, 0);
  assert.equal(seedream.prompt_metadata, undefined);
  assert.equal(snapshot.profiles.every((profile) => profile.dispatch_allowed === false &&
    profile.runtime_activation === false && profile.backend_acceptance === "UNPROVEN"), true);
});
