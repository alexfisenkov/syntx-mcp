import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadMaplessSettingsInventoryVersion } from "../dist/src/catalog/mapless-settings-inventory.js";
import { main } from "../scripts/sync-mapless-settings-inventory.mjs";

const publicVersion = "sha256-19c882601bb8ecdba994adf819544ebf06fd2db30374335631bb6078a66e5a76.json";
const scriptRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));

test("default catalog lookup uses the source checkout path independently of cwd", async (t) => {
  const temporaryCwd = await mkdtemp(join(tmpdir(), "syntx-mapless-cwd-1741-"));
  const previousCwd = process.cwd();
  let fetchCalls = 0;
  t.after(async () => {
    process.chdir(previousCwd);
    await rm(temporaryCwd, { recursive: true, force: true });
  });
  process.chdir(temporaryCwd);

  await assert.rejects(
    main(["--public-version", publicVersion, "--confirm-source-fetch"], {
      fetchImpl: async () => {
        fetchCalls += 1;
        throw new Error("stop after canonical catalog lookup");
      }
    }),
    /MAPLESS_SOURCE_FETCH_FAILED/u
  );
  assert.equal(fetchCalls, 1, "canonical 19C catalog should load before the mocked homepage fetch");
});

test("isolated catalog override supplies both the input snapshot and append-only archive", async (t) => {
  const temporaryCatalog = await mkdtemp(join(tmpdir(), "syntx-mapless-catalog-1741-"));
  t.after(() => rm(temporaryCatalog, { recursive: true, force: true }));
  await mkdir(join(temporaryCatalog, "public"), { recursive: true });
  await copyFile(
    join(scriptRoot, "catalog", "public", publicVersion),
    join(temporaryCatalog, "public", publicVersion)
  );

  const archived = await main(["--public-version", publicVersion, "--confirm-source-fetch"], {
    catalogDirectory: temporaryCatalog,
    fetchImpl: fixtureFetch
  });
  assert.equal(archived.status, "created");
  assert.ok(archived.path.startsWith(join(temporaryCatalog, "settings", "v2")));
  assert.ok(!archived.path.startsWith(join(scriptRoot, "catalog")));
  assert.ok(!archived.path.startsWith(join(scriptRoot, "dist")));
  const restored = loadMaplessSettingsInventoryVersion(archived.version, temporaryCatalog);
  assert.equal(restored.public_catalog.version, publicVersion);
  assert.equal(restored.public_catalog.models_sha256, "sha256:20b8c6482d72dbb4bf7e6500a0fbc0514eeac29bf5b7170559cd7665045583e3");
  assert.equal(restored.runtime_usable, false);
});

test("invalid confirmation and unsafe catalog override fetch and archive nothing", async (t) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "syntx-mapless-unsafe-1741-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const sourceCatalog = join(scriptRoot, "catalog");
  const unsafeCatalog = join(temporaryRoot, "catalog-link");
  await symlink(sourceCatalog, unsafeCatalog, "dir");
  let fetchCalls = 0;
  const fetchImpl = async () => {
    fetchCalls += 1;
    throw new Error("fixture fetch must not run");
  };

  await assert.rejects(main(["--public-version", publicVersion], { fetchImpl }), (error) => error instanceof Error && error.message.startsWith("Usage:"));
  await assert.rejects(
    main(["--public-version", publicVersion, "--confirm-source-fetch"], { catalogDirectory: unsafeCatalog, fetchImpl }),
    /PUBLIC_CATALOG_DIRECTORY_UNSAFE/u
  );
  assert.equal(fetchCalls, 0);
  assert.deepEqual(await readdir(temporaryRoot), ["catalog-link"]);
});

async function fixtureFetch(url) {
  const buildId = "1792069332";
  const responses = new Map([
    ["https://syntx.ai/", ["text/html", `<script src="/assets/${buildId}/app.js"></script>`]],
    [`https://syntx.ai/assets/${buildId}/app.js`, ["application/javascript", ["Settings2.js", "settings3.js", "useSettingsParams.js"].map((name) => `assets/${buildId}/${name}`).join(" ")]],
    [`https://syntx.ai/assets/${buildId}/Settings2.js`, ["application/javascript", `const R={"./forms/settings/banana.vue":()=>import("./banana.js")};`]],
    [`https://syntx.ai/assets/${buildId}/settings3.js`, ["application/javascript", "const x={setSettingsByModel:()=>{}};"]],
    [`https://syntx.ai/assets/${buildId}/useSettingsParams.js`, ["application/javascript", "const keys=[];"]],
    [`https://syntx.ai/assets/${buildId}/banana.js`, ["application/javascript", "const view={};"]]
  ]);
  const fixture = responses.get(url);
  assert.ok(fixture, `unexpected fixture request: ${url}`);
  const response = new Response(fixture[1], { status: 200, headers: { "content-type": fixture[0] } });
  Object.defineProperty(response, "url", { value: url });
  return response;
}
