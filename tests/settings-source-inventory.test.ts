import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertSettingsSourceInventoryUnchanged,
  loadSettingsSourceInventory,
  refreshSettingsSourceInventory,
  serializeSettingsSourceInventory,
  SettingsSourceInventoryError,
  settingsSourceInventorySchema,
  type SettingsSourceInventory
} from "../src/catalog/settings-source-inventory.js";
import {
  fetchPinnedSettingsFormSourceMaterial
} from "../tools/settings-ir/pinned-settings-source-loader.js";
import {
  buildSyntxPublicCatalogSnapshot,
  type SyntxPublicCatalogSnapshot
} from "../src/catalog/syntx-public-catalog.js";

const BUILD_ID = "1234567890";
const BASE_URL = `https://syntx.ai/assets/${BUILD_ID}/`;
const GENERATED_AT = "2026-09-02T12:00:00.000Z";
const PRIVATE_SOURCE_MARKER = "PRIVATE_VENDOR_SOURCE_BODY_MUST_NOT_ESCAPE";

test("derives a strict evidence-only inventory without persisting source bodies", async () => {
  const fixture = inventoryFixture();
  let activeRequests = 0;
  let maximumActiveRequests = 0;
  const inventory = await refreshSettingsSourceInventory(fixture.catalog, {
    buildId: BUILD_ID,
    generatedAt: GENERATED_AT,
    concurrency: 2,
    fetchImpl: async (input, init) => {
      activeRequests += 1;
      maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
      await new Promise((resolve) => setTimeout(resolve, 1));
      activeRequests -= 1;
      assert.equal(init?.redirect, "manual");
      assert.equal(init?.credentials, "omit");
      assert.equal(new Headers(init?.headers).get("accept-encoding"), "identity");
      return fixture.response(String(input));
    }
  });

  assert.equal(maximumActiveRequests <= 2, true);
  assert.deepEqual(inventory.summary, {
    public_ai_families: 2,
    registry_forms: 3,
    mapped_family_forms: 2,
    unbound_registry_forms: 1,
    current_families_without_models: 0,
    model_variants: 5,
    literal_reference_evidence: 3,
    dynamic_family_form: 1,
    legacy_inactive_no_form: 1,
    legacy_families: 1,
    provider_form_modules: 3,
    direct_settings_helper_modules: 1,
    unpinned_direct_dependencies: 0,
    source_artifacts: 10
  });
  assert.deepEqual(
    inventory.unbound_registry_forms.map((entry) => entry.form_id),
    ["unbound"]
  );
  assert.deepEqual(inventory.legacy_families, ["legacy"]);
  assert.deepEqual(
    inventory.family_forms.find((entry) => entry.ai_name === "alpha")?.evidence,
    {
      module_url: `${BASE_URL}Settings2.js`,
      module_sha256: inventory.source_artifacts.find(
        (entry) =>
          entry.module_name === "Settings2.js" && entry.kind === "JAVASCRIPT"
      )!.sha256,
      form_path_line: 2,
      form_path_column: 3,
      dynamic_import_line: 2,
      dynamic_import_column: 46
    }
  );
  assert.equal(
    Object.hasOwn(
      inventory.family_forms.find((entry) => entry.ai_name === "alpha")!.evidence,
      "module_name"
    ),
    false
  );
  assert.equal(inventory.closure.status, "OPEN");
  assert.equal(inventory.runtime_usable, false);
  assert.deepEqual(settingsSourceInventorySchema.parse(inventory), inventory);
  assert.equal(
    inventory.models.find((entry) => entry.model_id === "alpha-literal")
      ?.evidence_class,
    "LITERAL_REFERENCE_EVIDENCE"
  );
  assert.equal(
    inventory.models.find((entry) => entry.model_id === "alpha-literal")
      ?.evidence.length,
    2
  );
  assert.equal(
    inventory.models.find((entry) => entry.model_id === "alpha-escaped")
      ?.evidence_class,
    "LITERAL_REFERENCE_EVIDENCE"
  );
  assert.equal(
    inventory.models.find((entry) => entry.model_id === "alpha-dynamic")
      ?.evidence_class,
    "DYNAMIC_FAMILY_FORM"
  );
  assert.equal(
    inventory.models.find((entry) => entry.model_id === "alpha-dynamic")
      ?.evidence.length,
    0
  );
  assert.equal(
    inventory.models.find((entry) => entry.model_id === "beta-literal")
      ?.evidence[0]?.source_path,
    "/src/components/chat/forms/settings/data/shared.ts"
  );
  const serialized = serializeSettingsSourceInventory(inventory);
  assert.equal(serialized.includes(PRIVATE_SOURCE_MARKER), false);
  assert.equal(serialized.includes("sourcesContent"), false);
  assert.equal(serialized.includes("alpha-literal"), true);
});

test("accepts a rotated provider module name while keeping the form binding exact", async () => {
  const fixture = inventoryFixture();
  const registryUrl = `${BASE_URL}Settings2.js`;
  const rotatedSource = [
    "const forms = {",
    '  \"./forms/settings/alpha.vue\": () => import(\"./seedance2.js\"),',
    '  \"./forms/settings/beta.vue\": () => import(\"./beta.js\"),',
    '  \"./forms/settings/unbound.vue\": () => import(\"./unbound.js\")',
    "};"
  ].join("\n");
  const inventory = await refreshSettingsSourceInventory(fixture.catalog, {
    buildId: BUILD_ID,
    generatedAt: GENERATED_AT,
    fetchImpl: async (input) => {
      const url = String(input);
      if (url === registryUrl) return bodyResponse(url, rotatedSource, "application/javascript");
      if (url === `${BASE_URL}seedance2.js` || url === `${BASE_URL}seedance2.js.map`) {
        const original = fixture.response(url.replace("seedance2", "alpha"));
        return bodyResponse(
          url,
          await original.text(),
          url.endsWith(".map") ? "application/json" : "application/javascript"
        );
      }
      return fixture.response(url);
    }
  });
  const alpha = inventory.source_artifacts.find(
    (artifact) => artifact.role === "PROVIDER_FORM" && artifact.form_id === "alpha" && artifact.kind === "JAVASCRIPT"
  );
  assert.equal(alpha?.module_name, "seedance2.js");
  assert.equal(inventory.family_forms.find((entry) => entry.form_id === "alpha")?.evidence.module_name, "seedance2.js");
});

test("loader enforces schema relationships and drift comparison is fail-closed", async () => {
  const fixture = inventoryFixture();
  const recorded = await buildFixtureInventory(fixture);
  const directory = await mkdtemp(join(tmpdir(), "syntx-settings-inventory-"));
  const path = join(directory, "inventory.json");
  try {
    await writeFile(path, serializeSettingsSourceInventory(recorded), "utf8");
    assert.deepEqual(loadSettingsSourceInventory(path, fixture.catalog), recorded);

    const invalidInjectedCatalog = structuredClone(
      fixture.catalog
    ) as Partial<SyntxPublicCatalogSnapshot>;
    delete invalidInjectedCatalog.summary;
    assert.throws(() =>
      loadSettingsSourceInventory(
        path,
        invalidInjectedCatalog as SyntxPublicCatalogSnapshot
      )
    );

    const invalid = structuredClone(recorded);
    invalid.summary.model_variants += 1;
    await writeFile(path, `${JSON.stringify(invalid)}\n`, "utf8");
    assert.throws(() => loadSettingsSourceInventory(path, fixture.catalog));

    const wrongPublicBinding = structuredClone(recorded);
    wrongPublicBinding.family_forms.find(
      (entry) => entry.ai_name === "alpha"
    )!.ai_active = false;
    await writeFile(path, `${JSON.stringify(wrongPublicBinding)}\n`, "utf8");
    assert.throws(
      () => loadSettingsSourceInventory(path, fixture.catalog),
      hasInventoryCode("FAMILY_FORM_MAPPING_INVALID")
    );

    const movedModel = structuredClone(recorded);
    const moved = movedModel.models.find(
      (entry) => entry.model_id === "alpha-literal"
    )!;
    moved.ai_name = "beta";
    moved.form_id = "beta";
    movedModel.family_forms.find(
      (entry) => entry.ai_name === "alpha"
    )!.model_count -= 1;
    movedModel.family_forms.find(
      (entry) => entry.ai_name === "beta"
    )!.model_count += 1;
    await writeFile(path, `${JSON.stringify(movedModel)}\n`, "utf8");
    assert.throws(
      () => loadSettingsSourceInventory(path, fixture.catalog),
      hasInventoryCode("FAMILY_FORM_MAPPING_INVALID")
    );

    const wrongSourcePath = structuredClone(recorded);
    wrongSourcePath.models.find(
      (entry) => entry.evidence.length > 0
    )!.evidence[0]!.source_path = "/src/components/not-settings/fake.vue";
    await writeFile(path, `${JSON.stringify(wrongSourcePath)}\n`, "utf8");
    assert.throws(() => loadSettingsSourceInventory(path, fixture.catalog));

    const changedFixture = inventoryFixture({
      alphaSource: `const models = ["alpha-literal"];\nconst changed = true;`
    });
    const changed = await buildFixtureInventory(changedFixture);
    assert.throws(
      () => assertSettingsSourceInventoryUnchanged(recorded, changed),
      hasInventoryCode("SOURCE_DRIFT_DETECTED")
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("fetches and returns only the exact hash-pinned form source material", async () => {
  const fixture = inventoryFixture();
  const inventory = await buildFixtureInventory(fixture);
  const requested: string[] = [];
  const material = await fetchPinnedSettingsFormSourceMaterial(
    inventory,
    "alpha",
    {
      fetchImpl: async (input, init) => {
        requested.push(String(input));
        assert.equal(init?.redirect, "manual");
        assert.equal(init?.credentials, "omit");
        assert.equal(init?.cache, "no-store");
        assert.equal(
          new Headers(init?.headers).get("accept-encoding"),
          "identity"
        );
        return fixture.response(String(input));
      }
    }
  );

  const recordedJavaScript = inventory.source_artifacts.find(
    (artifact) =>
      artifact.form_id === "alpha" && artifact.kind === "JAVASCRIPT"
  )!;
  const recordedSourceMap = inventory.source_artifacts.find(
    (artifact) =>
      artifact.form_id === "alpha" && artifact.kind === "SOURCE_MAP_V3"
  )!;
  const recordedSource = recordedSourceMap.source_map!.settings_sources.find(
    (source) =>
      source.source_path ===
      "/src/components/chat/forms/settings/alpha.vue"
  )!;

  assert.deepEqual(requested, [
    `${BASE_URL}alpha.js`,
    `${BASE_URL}alpha.js.map`
  ]);
  assert.equal(material.form_id, "alpha");
  assert.equal(
    material.source.source_path,
    "/src/components/chat/forms/settings/alpha.vue"
  );
  assert.equal(material.source.source_index, recordedSource.source_index);
  assert.equal(
    material.source.source_content_sha256,
    recordedSource.source_content_sha256
  );
  assert.equal(material.source.content.includes(PRIVATE_SOURCE_MARKER), true);
  assert.deepEqual(material.artifacts.javascript, {
    kind: "JAVASCRIPT",
    module_name: "alpha.js",
    url: recordedJavaScript.url,
    content_type: recordedJavaScript.content_type,
    bytes: recordedJavaScript.bytes,
    sha256: recordedJavaScript.sha256
  });
  assert.deepEqual(material.artifacts.source_map, {
    kind: "SOURCE_MAP_V3",
    module_name: "alpha.js",
    url: recordedSourceMap.url,
    content_type: recordedSourceMap.content_type,
    bytes: recordedSourceMap.bytes,
    sha256: recordedSourceMap.sha256
  });
  assert.equal(
    JSON.stringify(material).includes(
      'import { ids } from "./shared-settings.js"'
    ),
    false
  );
  assert.equal("source_map" in material.artifacts.source_map, false);
});

test("rejects missing, duplicate, and URL-drifted pinned artifacts before fetch", async () => {
  const fixture = inventoryFixture();
  const inventory = await buildFixtureInventory(fixture);
  const alphaMapIndex = inventory.source_artifacts.findIndex(
    (artifact) =>
      artifact.form_id === "alpha" && artifact.kind === "SOURCE_MAP_V3"
  );
  const alphaJavaScriptIndex = inventory.source_artifacts.findIndex(
    (artifact) =>
      artifact.form_id === "alpha" && artifact.kind === "JAVASCRIPT"
  );
  assert.notEqual(alphaMapIndex, -1);
  assert.notEqual(alphaJavaScriptIndex, -1);

  const missing = structuredClone(inventory);
  missing.source_artifacts.splice(alphaMapIndex, 1);
  missing.summary.source_artifacts -= 1;

  const duplicate = structuredClone(inventory);
  duplicate.source_artifacts.push(
    structuredClone(duplicate.source_artifacts[alphaMapIndex]!)
  );
  duplicate.summary.source_artifacts += 1;

  const wrongUrl = structuredClone(inventory);
  wrongUrl.source_artifacts[alphaJavaScriptIndex]!.url =
    `${BASE_URL}beta.js`;

  for (const candidate of [missing, duplicate, wrongUrl]) {
    let fetched = false;
    await assert.rejects(
      fetchPinnedSettingsFormSourceMaterial(candidate, "alpha", {
        fetchImpl: async () => {
          fetched = true;
          throw new Error("must not fetch");
        }
      }),
      hasInventoryCode("SOURCE_DRIFT_DETECTED")
    );
    assert.equal(fetched, false);
  }
});

test("detects pinned JavaScript and source-map body, byte, hash, and media drift", async () => {
  const fixture = inventoryFixture();
  const inventory = await buildFixtureInventory(fixture);
  const javascriptUrl = `${BASE_URL}alpha.js`;
  const sourceMapUrl = `${BASE_URL}alpha.js.map`;
  const javascriptBody = await fixture.response(javascriptUrl).text();
  const sourceMapBody = await fixture.response(sourceMapUrl).text();
  const changedMap = mutateSourceMap(sourceMapBody, (map) => {
    map.sourcesContent[0] = `${map.sourcesContent[0]}\nconst changed = true;`;
  });
  const cases: Array<{
    name: string;
    targetUrl: string;
    body: string;
    mediaType: string;
  }> = [
    {
      name: "JavaScript content hash and byte drift",
      targetUrl: javascriptUrl,
      body: `${javascriptBody}\n`,
      mediaType: "application/javascript"
    },
    {
      name: "JavaScript allowed media drift",
      targetUrl: javascriptUrl,
      body: javascriptBody,
      mediaType: "text/javascript"
    },
    {
      name: "source-map content hash drift",
      targetUrl: sourceMapUrl,
      body: changedMap,
      mediaType: "application/octet-stream"
    },
    {
      name: "source-map raw byte and hash drift",
      targetUrl: sourceMapUrl,
      body: `${sourceMapBody} `,
      mediaType: "application/octet-stream"
    },
    {
      name: "source-map allowed media drift",
      targetUrl: sourceMapUrl,
      body: sourceMapBody,
      mediaType: "application/json"
    }
  ];

  for (const item of cases) {
    await assert.rejects(
      fetchPinnedSettingsFormSourceMaterial(inventory, "alpha", {
        fetchImpl: async (input) =>
          String(input) === item.targetUrl
            ? bodyResponse(item.targetUrl, item.body, item.mediaType)
            : fixture.response(String(input))
      }),
      hasInventoryCode("SOURCE_DRIFT_DETECTED"),
      item.name
    );
  }

  for (const mutation of [
    (candidate: SettingsSourceInventory) => {
      candidate.source_artifacts.find(
        (artifact) =>
          artifact.form_id === "alpha" && artifact.kind === "JAVASCRIPT"
      )!.bytes += 1;
    },
    (candidate: SettingsSourceInventory) => {
      candidate.source_artifacts.find(
        (artifact) =>
          artifact.form_id === "alpha" && artifact.kind === "SOURCE_MAP_V3"
      )!.content_type = "application/json";
    }
  ]) {
    const candidate = structuredClone(inventory);
    mutation(candidate);
    await assert.rejects(
      fetchPinnedSettingsFormSourceMaterial(candidate, "alpha", {
        fetchImpl: async (input) => fixture.response(String(input))
      }),
      hasInventoryCode("SOURCE_DRIFT_DETECTED")
    );
  }
});

test("requires one exact pinned form source with the recorded index, path, and hash", async () => {
  const fixture = inventoryFixture();
  const inventory = await buildFixtureInventory(fixture);
  const sourceMapUrl = `${BASE_URL}alpha.js.map`;
  const sourceMapBody = await fixture.response(sourceMapUrl).text();
  const cases: Array<{
    name: string;
    expected: SettingsSourceInventoryError["code"];
    body: string;
  }> = [
    {
      name: "missing exact form source path",
      expected: "SOURCE_MAP_INVALID",
      body: mutateSourceMap(sourceMapBody, (map) => {
        map.sources[0] =
          "../../../src/components/chat/forms/settings/other.vue";
      })
    },
    {
      name: "duplicate exact form source path",
      expected: "SOURCE_MAP_INVALID",
      body: mutateSourceMap(sourceMapBody, (map) => {
        map.sources.push(map.sources[0]!);
        map.sourcesContent.push(map.sourcesContent[0]!);
      })
    },
    {
      name: "changed exact form source content hash",
      expected: "SOURCE_DRIFT_DETECTED",
      body: mutateSourceMap(sourceMapBody, (map) => {
        map.sourcesContent[0] = "const replaced = true;";
      })
    },
    {
      name: "changed exact form source index",
      expected: "SOURCE_DRIFT_DETECTED",
      body: mutateSourceMap(sourceMapBody, (map) => {
        map.sources.unshift("../../../src/unrelated.ts");
        map.sourcesContent.unshift("const unrelated = true;");
      })
    }
  ];

  for (const item of cases) {
    await assert.rejects(
      fetchPinnedSettingsFormSourceMaterial(inventory, "alpha", {
        fetchImpl: async (input) =>
          String(input) === sourceMapUrl
            ? bodyResponse(
                sourceMapUrl,
                item.body,
                "application/octet-stream"
              )
            : fixture.response(String(input))
      }),
      hasInventoryCode(item.expected),
      item.name
    );
  }
});

test("preserves deadline, size, redirect, and body-leak protections for pinned fetches", async () => {
  const fixture = inventoryFixture();
  const inventory = await buildFixtureInventory(fixture);
  const javascriptUrl = `${BASE_URL}alpha.js`;
  const sourceMapUrl = `${BASE_URL}alpha.js.map`;

  await assert.rejects(
    fetchPinnedSettingsFormSourceMaterial(inventory, "alpha", {
      absoluteTimeoutMs: 5,
      fetchImpl: () => new Promise<Response>(() => undefined)
    }),
    hasInventoryCode("SOURCE_FETCH_FAILED")
  );

  for (const item of [
    {
      name: "oversized JavaScript",
      targetUrl: javascriptUrl,
      option: { maxJavaScriptBytes: 1_024 },
      mediaType: "application/javascript"
    },
    {
      name: "oversized source map",
      targetUrl: sourceMapUrl,
      option: { maxSourceMapBytes: 1_024 },
      mediaType: "application/octet-stream"
    }
  ]) {
    await assert.rejects(
      fetchPinnedSettingsFormSourceMaterial(inventory, "alpha", {
        ...item.option,
        fetchImpl: async (input) =>
          String(input) === item.targetUrl
            ? responseWithUrl(
                new Response(new Uint8Array([1]), {
                  status: 200,
                  headers: {
                    "content-type": item.mediaType,
                    "content-length": "1025"
                  }
                }),
                item.targetUrl
              )
            : fixture.response(String(input))
      }),
      hasInventoryCode("SOURCE_TOO_LARGE"),
      item.name
    );
  }

  await assert.rejects(
    fetchPinnedSettingsFormSourceMaterial(inventory, "alpha", {
      fetchImpl: async (input) =>
        String(input) === javascriptUrl
          ? responseWithUrl(
              new Response(null, {
                status: 302,
                headers: { location: `${BASE_URL}beta.js` }
              }),
              javascriptUrl
            )
          : fixture.response(String(input))
    }),
    hasInventoryCode("SOURCE_REDIRECTED")
  );

  const leakCases: Array<{
    expected: SettingsSourceInventoryError["code"];
    fetchImpl: typeof fetch;
  }> = [
    {
      expected: "SOURCE_FETCH_FAILED",
      fetchImpl: async () => {
        throw new Error(PRIVATE_SOURCE_MARKER);
      }
    },
    {
      expected: "SOURCE_FETCH_FAILED",
      fetchImpl: async (input) =>
        responseWithUrl(
          new Response(PRIVATE_SOURCE_MARKER, {
            status: 500,
            headers: { "content-type": "text/plain" }
          }),
          String(input)
        )
    },
    {
      expected: "SOURCE_MAP_INVALID",
      fetchImpl: async (input) =>
        String(input) === sourceMapUrl
          ? bodyResponse(
              sourceMapUrl,
              PRIVATE_SOURCE_MARKER,
              "application/octet-stream"
            )
          : fixture.response(String(input))
    }
  ];
  for (const item of leakCases) {
    await assert.rejects(
      fetchPinnedSettingsFormSourceMaterial(inventory, "alpha", {
        fetchImpl: item.fetchImpl
      }),
      (error: unknown) =>
        error instanceof SettingsSourceInventoryError &&
        error.code === item.expected &&
        !error.message.includes(PRIVATE_SOURCE_MARKER)
    );
  }
});

test("validates pinned form identifiers and fetch bounds before network use", async () => {
  const fixture = inventoryFixture();
  const inventory = await buildFixtureInventory(fixture);
  let fetched = false;
  const fetchImpl: typeof fetch = async () => {
    fetched = true;
    throw new Error("must not fetch");
  };
  await assert.rejects(
    fetchPinnedSettingsFormSourceMaterial(inventory, "../alpha", {
      fetchImpl
    }),
    TypeError
  );
  await assert.rejects(
    fetchPinnedSettingsFormSourceMaterial(inventory, "alpha", {
      fetchImpl,
      absoluteTimeoutMs: 0
    }),
    TypeError
  );
  await assert.rejects(
    fetchPinnedSettingsFormSourceMaterial(inventory, "alpha", {
      fetchImpl,
      maxSourceMapBytes: 65 * 1024 * 1024
    }),
    TypeError
  );
  assert.equal(fetched, false);
});

test("rejects redirects, wrong media, declared oversize, and streamed oversize", async () => {
  const fixture = inventoryFixture();
  const firstUrl = `${BASE_URL}Settings2.js`;
  const cases: Array<{
    expected: SettingsSourceInventoryError["code"];
    maxJavaScriptBytes?: number;
    response: () => Response;
  }> = [
    {
      expected: "SOURCE_REDIRECTED",
      response: () =>
        responseWithUrl(
          new Response(null, {
            status: 302,
            headers: { location: `${BASE_URL}elsewhere.js` }
          }),
          firstUrl
        )
    },
    {
      expected: "SOURCE_MEDIA_TYPE_INVALID",
      response: () =>
        responseWithUrl(
          new Response("not javascript", {
            status: 200,
            headers: { "content-type": "text/html" }
          }),
          firstUrl
        )
    },
    {
      expected: "SOURCE_TOO_LARGE",
      maxJavaScriptBytes: 1_024,
      response: () =>
        responseWithUrl(
          new Response(new Uint8Array([1]), {
            status: 200,
            headers: {
              "content-type": "application/javascript",
              "content-length": "2048"
            }
          }),
          firstUrl
        )
    },
    {
      expected: "SOURCE_TOO_LARGE",
      maxJavaScriptBytes: 1_024,
      response: () =>
        responseWithUrl(
          new Response(new Uint8Array(1_025), {
            status: 200,
            headers: { "content-type": "application/javascript" }
          }),
          firstUrl
        )
    }
  ];

  for (const item of cases) {
    await assert.rejects(
      refreshSettingsSourceInventory(fixture.catalog, {
        buildId: BUILD_ID,
        generatedAt: GENERATED_AT,
        ...(item.maxJavaScriptBytes === undefined
          ? {}
          : { maxJavaScriptBytes: item.maxJavaScriptBytes }),
        fetchImpl: async (input) =>
          String(input) === firstUrl ? item.response() : fixture.response(String(input))
      }),
      hasInventoryCode(item.expected)
    );
  }
});

test("enforces an absolute deadline for hostile fetches and response bodies", async () => {
  const fixture = inventoryFixture();
  await assert.rejects(
    refreshSettingsSourceInventory(fixture.catalog, {
      buildId: BUILD_ID,
      generatedAt: GENERATED_AT,
      absoluteTimeoutMs: 5,
      fetchImpl: () => new Promise<Response>(() => undefined)
    }),
    hasInventoryCode("SOURCE_FETCH_FAILED")
  );

  let bodyCanceled = false;
  const hostileBody = new ReadableStream<Uint8Array>({
    pull: () => new Promise<void>(() => undefined),
    cancel: () => {
      bodyCanceled = true;
    }
  });
  await assert.rejects(
    refreshSettingsSourceInventory(fixture.catalog, {
      buildId: BUILD_ID,
      generatedAt: GENERATED_AT,
      absoluteTimeoutMs: 5,
      fetchImpl: async (input) =>
        responseWithUrl(
          new Response(hostileBody, {
            status: 200,
            headers: { "content-type": "application/javascript" }
          }),
          String(input)
        )
    }),
    hasInventoryCode("SOURCE_FETCH_FAILED")
  );
  assert.equal(bodyCanceled, true);

  let resolveLateResponse: (response: Response) => void = () => undefined;
  const lateResponse = new Promise<Response>((resolve) => {
    resolveLateResponse = resolve;
  });
  const lateOperation = refreshSettingsSourceInventory(fixture.catalog, {
    buildId: BUILD_ID,
    generatedAt: GENERATED_AT,
    absoluteTimeoutMs: 5,
    fetchImpl: () => lateResponse
  });
  await assert.rejects(
    lateOperation,
    hasInventoryCode("SOURCE_FETCH_FAILED")
  );
  let lateBodyCanceled = false;
  const lateBody = new ReadableStream<Uint8Array>({
    cancel: () => {
      lateBodyCanceled = true;
    }
  });
  resolveLateResponse(
    responseWithUrl(
      new Response(lateBody, {
        status: 200,
        headers: { "content-type": "application/javascript" }
      }),
      `${BASE_URL}Settings2.js`
    )
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(lateBodyCanceled, true);
});

test("cancels bodies rejected before reading", async () => {
  const fixture = inventoryFixture();
  let canceled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1]));
    },
    cancel() {
      canceled = true;
    }
  });
  await assert.rejects(
    refreshSettingsSourceInventory(fixture.catalog, {
      buildId: BUILD_ID,
      generatedAt: GENERATED_AT,
      fetchImpl: async (input) =>
        responseWithUrl(
          new Response(body, {
            status: 200,
            headers: { "content-type": "text/html" }
          }),
          String(input)
        )
    }),
    hasInventoryCode("SOURCE_MEDIA_TYPE_INVALID")
  );
  assert.equal(canceled, true);
});

test("rejects malformed source maps without exposing their body", async () => {
  const fixture = inventoryFixture();
  const mapUrl = `${BASE_URL}Settings2.js.map`;
  for (const malformed of [
    PRIVATE_SOURCE_MARKER,
    JSON.stringify({ version: 2, file: "bad", sources: [], sourcesContent: [] }),
    JSON.stringify({
      version: 3,
      file: "bad",
      sources: ["a"],
      sourcesContent: []
    })
  ]) {
    await assert.rejects(
      refreshSettingsSourceInventory(fixture.catalog, {
        buildId: BUILD_ID,
        generatedAt: GENERATED_AT,
        fetchImpl: async (input) =>
          String(input) === mapUrl
            ? bodyResponse(mapUrl, malformed, "application/octet-stream")
            : fixture.response(String(input))
      }),
      (error: unknown) =>
        error instanceof SettingsSourceInventoryError &&
        error.code === "SOURCE_MAP_INVALID" &&
        !error.message.includes(PRIVATE_SOURCE_MARKER)
    );
  }
});

test("structurally binds exact registry properties and rejects ambiguous mappings", async () => {
  const fixture = inventoryFixture();
  const registryUrl = `${BASE_URL}Settings2.js`;
  const viteWrapped = await buildFixtureInventory(
    inventoryFixture({
      registrySource:
        `const forms={"./forms/settings/alpha.vue":()=>e(()=>import("./alpha.js"),__vite__mapDeps([0,12,3])),` +
        `"./forms/settings/beta.vue":()=>e(()=>import("./beta.js"),__vite__mapDeps([])),` +
        `"./forms/settings/unbound.vue":()=>e(()=>import("./unbound.js"),__vite__mapDeps([4]))};`
    })
  );
  assert.equal(viteWrapped.family_forms.length, 2);

  const cases: Array<{ name: string; source: string }> = [
    {
      name: "orphan import",
      source: `const forms = {"./forms/settings/alpha.vue":()=>import("./alpha.js"),"./forms/settings/beta.vue":()=>import("./beta.js")}; import("./orphan.js");`
    },
    {
      name: "missing loader",
      source: `const forms = {"./forms/settings/alpha.vue":()=>import("./alpha.js"),"./forms/settings/beta.vue":()=>0};`
    },
    {
      name: "duplicate property",
      source: `const forms = {"./forms/settings/alpha.vue":()=>import("./alpha.js"),"./forms/settings/alpha.vue":()=>import("./alpha.js"),"./forms/settings/beta.vue":()=>import("./beta.js")};`
    },
    {
      name: "decoy path and unrelated import",
      source: `const decoy="./forms/settings/alpha.vue"; const unrelated=()=>import("./alpha.js"); const forms={"./forms/settings/beta.vue":()=>import("./beta.js")};`
    },
    {
      name: "lazy wrapper",
      source: `const forms={"./forms/settings/alpha.vue":()=>lazy(()=>import("./alpha.js")),"./forms/settings/beta.vue":()=>import("./beta.js")};`
    },
    {
      name: "lookalike Vite wrapper",
      source: `const forms={"./forms/settings/alpha.vue":()=>lazy(()=>import("./alpha.js"),__vite__mapDeps([0])),"./forms/settings/beta.vue":()=>import("./beta.js")};`
    },
    {
      name: "Vite wrapper with non-integer dependency",
      source: `const forms={"./forms/settings/alpha.vue":()=>e(()=>import("./alpha.js"),__vite__mapDeps(["0"])),"./forms/settings/beta.vue":()=>import("./beta.js")};`
    },
    {
      name: "other loader",
      source: `const forms={"./forms/settings/alpha.vue":()=>require("./alpha.js"),"./forms/settings/beta.vue":()=>import("./beta.js")};`
    },
    {
      name: "cross-property association",
      source: `const forms={"./forms/settings/alpha.vue":()=>0,other:()=>import("./alpha.js"),"./forms/settings/beta.vue":()=>import("./beta.js")};`
    },
    {
      name: "cross-branch association",
      source: `const selected=flag?"./forms/settings/alpha.vue":()=>import("./alpha.js"); const forms={"./forms/settings/beta.vue":()=>import("./beta.js")};`
    },
    {
      name: "conditional registry object",
      source: `const forms=enabled?{"./forms/settings/alpha.vue":()=>import("./alpha.js"),"./forms/settings/beta.vue":()=>import("./beta.js")}:{};`
    },
    {
      name: "separate exact decoy object",
      source: `const forms={"./forms/settings/alpha.vue":()=>import("./alpha.js"),"./forms/settings/beta.vue":()=>import("./beta.js")}; const decoy={"./forms/settings/decoy.vue":()=>import("./decoy.js")};`
    },
    {
      name: "mismatched loader",
      source: `const forms={"./forms/settings/alpha.vue":()=>import("./beta.js"),"./forms/settings/beta.vue":()=>import("./alpha.js")};`
    },
    {
      name: "ambiguous extra loader",
      source: `const forms={"./forms/settings/alpha.vue":()=>import("./alpha.js"),"./forms/settings/beta.vue":()=>import("./beta.js")}; const again=()=>import("./alpha.js");`
    }
  ];
  for (const item of cases) {
    await assert.rejects(
      refreshSettingsSourceInventory(fixture.catalog, {
        buildId: BUILD_ID,
        generatedAt: GENERATED_AT,
        fetchImpl: async (input) =>
          String(input) === registryUrl
            ? bodyResponse(registryUrl, item.source, "application/javascript")
            : fixture.response(String(input))
      }),
      hasInventoryCode("REGISTRY_MAPPING_INVALID"),
      item.name
    );
  }
});

test("normalizes only unambiguous POSIX settings source paths", async () => {
  const valid = await buildFixtureInventory(
    inventoryFixture({
      alphaAdditionalPaths: [
        "webpack://vendor/pkg%20name/index.ts",
        "../../../src/transforms/settings/presets.ts"
      ],
      alphaPath: "/src/components/chat/forms/settings/alpha.vue"
    })
  );
  assert.equal(
    valid.models.find((entry) => entry.model_id === "alpha-literal")
      ?.evidence[0]?.source_path,
    "/src/components/chat/forms/settings/alpha.vue"
  );

  const invalidPaths = [
    "",
    "../../../src\\components/chat/forms/settings/alpha.vue",
    "../../../src/components/chat/forms/settings//alpha.vue",
    "../../../src/components/chat/forms/settings/./alpha.vue",
    "../../../src/components/chat/forms/settings/../alpha.vue",
    "../../../src/components/chat/forms/settings/%2e%2e/alpha.vue",
    "../../../src/components/chat/forms/settings\u2215alpha.vue",
    "/untrusted/src/components/chat/forms/settings/alpha.vue",
    "/src/components/chat/forms/settings-evasion/alpha.vue",
    "/src/components/chat/forms/settings/nested/alpha.vue"
  ];
  for (const alphaPath of invalidPaths) {
    await assert.rejects(
      buildFixtureInventory(inventoryFixture({ alphaPath })),
      hasInventoryCode("SOURCE_MAP_INVALID"),
      alphaPath
    );
  }

  await assert.rejects(
    buildFixtureInventory(
      inventoryFixture({
        alphaAdditionalPaths: [
          "/src/components/chat/forms/settings/alpha.vue"
        ]
      })
    ),
    hasInventoryCode("SOURCE_MAP_INVALID"),
    "duplicate path after canonical normalization"
  );
});

test("normalizes network errors and never leaks upstream text", async () => {
  const fixture = inventoryFixture();
  await assert.rejects(
    refreshSettingsSourceInventory(fixture.catalog, {
      buildId: BUILD_ID,
      generatedAt: GENERATED_AT,
      fetchImpl: async () => {
        throw new Error(PRIVATE_SOURCE_MARKER);
      }
    }),
    (error: unknown) =>
      error instanceof SettingsSourceInventoryError &&
      error.code === "SOURCE_FETCH_FAILED" &&
      !error.message.includes(PRIVATE_SOURCE_MARKER)
  );
});

function inventoryFixture(
  overrides: {
    alphaAdditionalPaths?: string[];
    alphaPath?: string;
    alphaSource?: string;
    registrySource?: string;
  } = {}
): FixtureInventory {
  const registry =
    overrides.registrySource ??
    [
      "const forms = {",
      '  "./forms/settings/alpha.vue": () => import("./alpha.js"),',
      '  "./forms/settings/beta.vue": () => import("./beta.js"),',
      '  "./forms/settings/unbound.vue": () => import("./unbound.js")',
      "};"
    ].join("\n");
  const sharedSource = `export const ids = ["beta-literal"];\nconst marker = "${PRIVATE_SOURCE_MARKER}";`;
  const bodies = new Map<string, { body: string; mediaType: string }>();

  addModule(bodies, "Settings2.js", registry, [
    {
      path: "../../../src/components/chat/Settings.vue",
      content: "export const observed = true;"
    }
  ]);
  addModule(
    bodies,
    "alpha.js",
    'import { ids } from "./shared-settings.js"; export const alpha = ids;',
    [
      {
        path:
          overrides.alphaPath ??
          "../../../src/components/chat/forms/settings/alpha.vue",
        content:
          overrides.alphaSource ??
          [
            "<template>",
            "  <div :[field]=\"model === 'alpha-literal'\"></div>",
            "  <div v-if=\"/'alpha-dynamic'/.test(model)\"></div>",
            "</template>",
            "<script setup>",
            'const escaped = "\\u0061lpha-escaped";',
            'const divided = 10 / "alpha-literal".length;',
            'const regexOnly = /"alpha-dynamic"/u;',
            'const uiOnly = "Selected \'alpha-dynamic\'";',
            '// "alpha-dynamic" is documentation, not evidence.',
            `const marker = "${PRIVATE_SOURCE_MARKER}";`,
            "</script>"
          ].join("\n")
      },
      ...(overrides.alphaAdditionalPaths ?? []).map((path) => ({
        path,
        content: "const duplicateCanonicalPath = true;"
      }))
    ]
  );
  addModule(
    bodies,
    "beta.js",
    'import { ids } from "./shared-settings.js"; export const beta = ids;',
    [
      {
        path: "../../../src/components/chat/forms/settings/beta.vue",
        content: "const formIsDynamic = true;"
      }
    ]
  );
  addModule(
    bodies,
    "unbound.js",
    'import { ids } from "./shared-settings.js"; export const unbound = ids;',
    [
      {
        path: "../../../src/components/chat/forms/settings/unbound.vue",
        content: "const formIsUnbound = true;"
      }
    ]
  );
  addModule(bodies, "shared-settings.js", "export const ids = [];", [
    {
      path: "../../../src/components/chat/forms/settings/data/shared.ts",
      content: sharedSource
    }
  ]);

  return {
    catalog: fixtureCatalog(),
    response(url: string): Response {
      const artifact = bodies.get(url);
      assert.notEqual(artifact, undefined, `Unexpected fixture URL: ${url}`);
      return bodyResponse(url, artifact!.body, artifact!.mediaType);
    }
  };
}

interface FixtureInventory {
  catalog: SyntxPublicCatalogSnapshot;
  response(url: string): Response;
}

function fixtureCatalog(): SyntxPublicCatalogSnapshot {
  const featureFlags = {
    files_generation: false,
    files_processing: false,
    image_generation: false,
    image_processing: false,
    search: false
  };
  return buildSyntxPublicCatalogSnapshot({
    fetchedAt: GENERATED_AT,
    aiPayload: [
      {
        active: true,
        description: null,
        label: "Alpha",
        scope: "image",
        value: "alpha"
      },
      {
        active: true,
        description: null,
        label: "Beta",
        scope: "video",
        value: "beta"
      }
    ],
    modelsPayload: [
      modelPayload("alpha-literal", "alpha", true, featureFlags),
      modelPayload("alpha-escaped", "alpha", true, featureFlags),
      modelPayload("alpha-dynamic", "alpha", true, featureFlags),
      modelPayload("beta-literal", "beta", true, featureFlags),
      modelPayload("legacy-model", "legacy", false, featureFlags)
    ],
    llmModelsPayload: {
      count: 1,
      models: [
        {
          ai_name: "alpha",
          available_subscriptions: [],
          capabilities: {
            deep_research: false,
            files: false,
            images: false,
            planning: false,
            streaming: false,
            system_message: false,
            thinking: false,
            web_explorer: false
          },
          context_window: 1,
          default_max_tokens: 1,
          description: null,
          enabled: true,
          free_from_sub: null,
          icon: null,
          id: "fixture-llm",
          is_free: false,
          label: "Fixture LLM",
          max_images_count: 0,
          min_subscription: null,
          performance_level: 1,
          supported_tools: []
        }
      ]
    }
  });
}

function modelPayload(
  value: string,
  aiName: string,
  active: boolean,
  features: {
    files_generation: boolean;
    files_processing: boolean;
    image_generation: boolean;
    image_processing: boolean;
    search: boolean;
  }
) {
  return {
    active,
    ai_name: aiName,
    default: false,
    description: null,
    features,
    label: value,
    settings: null,
    type: null,
    value
  };
}

function addModule(
  bodies: Map<string, { body: string; mediaType: string }>,
  moduleName: string,
  javascript: string,
  sources: Array<{ path: string; content: string }>
): void {
  bodies.set(`${BASE_URL}${moduleName}`, {
    body: javascript,
    mediaType: "application/javascript"
  });
  bodies.set(`${BASE_URL}${moduleName}.map`, {
    body: JSON.stringify({
      version: 3,
      file: `assets/${BUILD_ID}/${moduleName}`,
      names: [],
      mappings: "",
      sources: sources.map((entry) => entry.path),
      sourcesContent: sources.map((entry) => entry.content)
    }),
    mediaType: "application/octet-stream"
  });
}

async function buildFixtureInventory(
  fixture: FixtureInventory
): Promise<SettingsSourceInventory> {
  return refreshSettingsSourceInventory(fixture.catalog, {
    buildId: BUILD_ID,
    generatedAt: GENERATED_AT,
    fetchImpl: async (input) => fixture.response(String(input))
  });
}

function bodyResponse(url: string, body: string, mediaType: string): Response {
  const bytes = new TextEncoder().encode(body);
  return responseWithUrl(
    new Response(bytes, {
      status: 200,
      headers: {
        "content-type": mediaType,
        "content-length": String(bytes.byteLength)
      }
    }),
    url
  );
}

function responseWithUrl(response: Response, url: string): Response {
  Object.defineProperty(response, "url", { value: url });
  return response;
}

function mutateSourceMap(
  body: string,
  mutation: (map: { sources: string[]; sourcesContent: string[] }) => void
): string {
  const map = JSON.parse(body) as {
    sources: string[];
    sourcesContent: string[];
  };
  mutation(map);
  return JSON.stringify(map);
}

function hasInventoryCode(
  code: SettingsSourceInventoryError["code"]
): (error: unknown) => boolean {
  return (error: unknown) =>
    error instanceof SettingsSourceInventoryError && error.code === code;
}
