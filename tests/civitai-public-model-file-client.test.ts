import assert from "node:assert/strict";
import test from "node:test";

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
}

test("public file metadata joins an exact LORA model, selected version, and selected SafeTensor file", async () => {
  const modulePath = "../src/adapter/civitai/public-model-file-client.js";
  const api = await import(modulePath) as {
    CivitaiPublicModelFileClient: new (options: { fetchImpl: typeof fetch }) => {
      getPublicLoraFileMetadata(input: { model_id?: number; model_version_id: number; file_id: number }): Promise<Record<string, unknown>>;
    };
  };
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const client = new api.CivitaiPublicModelFileClient({ fetchImpl: async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === "https://civitai.com/api/v1/model-versions/202") {
      return json({ id: 202, modelId: 101, baseModel: "SD 1.5", status: "Published", availability: "Public", usageControl: "Download",
        files: [{ id: 303, type: "Model", name: "style.safetensors", primary: true, sizeKB: 12.25,
          metadata: { format: "SafeTensor", size: "pruned", fp: "fp16" }, hashes: { SHA256: "A".repeat(64) },
          virusScanResult: "Success", pickleScanResult: "Success",
          downloadUrl: "https://civitai.com/api/download/models/202?fileId=303" }] });
    }
    if (url === "https://civitai.com/api/v1/models/101") {
      return json({ id: 101, name: "fixture-lora", type: "LORA", status: "Published", availability: "Public", mode: null,
        allowCommercialUse: ["Image", "Rent"], allowNoCredit: true, allowDerivatives: true, allowDifferentLicense: false,
        modelVersions: [{ id: 202 }] });
    }
    return new Response("unexpected endpoint", { status: 404 });
  } });

  const result = await client.getPublicLoraFileMetadata({ model_id: 101, model_version_id: 202, file_id: 303 });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.url), [
    "https://civitai.com/api/v1/model-versions/202",
    "https://civitai.com/api/v1/models/101"
  ]);
  assert.ok(calls.every(({ init }) => init?.method === "GET" && init.redirect === "error" && init.credentials === "omit"));
  assert.ok(calls.every(({ init }) => new Headers(init?.headers).get("accept") === "application/json" &&
    !new Headers(init?.headers).has("authorization") && !new Headers(init?.headers).has("cookie")));
  assert.deepEqual(result, {
    metadata_status: "VERIFIED",
    source_kind: "MODEL_PAGE_VERSION_SELECTION",
    model_id: 101,
    model_version_id: 202,
    file_id: 303,
    model_type: "LORA",
    base_model: "SD 1.5",
    version_status: "Published",
    model_availability: "Public",
    version_availability: "Public",
    usage_control: "Download",
    file_type: "Model",
    format: "SafeTensor",
    size_kb: 12.25,
    sha256: "a".repeat(64),
    virus_scan_result: "Success",
    pickle_scan_result: "Success",
    license_flags: { allow_commercial_use: ["Image", "Rent"], allow_no_credit: true,
      allow_derivatives: true, allow_different_license: false, legal_approval: "NOT_ESTABLISHED" },
    download_path: "/api/download/models/202?fileId=303",
    download_selection: "VERIFIED_SOURCE_SELECTOR",
    primary: true,
    content_attestation: "NOT_CHECKED",
    content_gap: "DYNAMIC_DOWNLOAD_REDIRECT_UNVERIFIED"
  });
  assert.equal(JSON.stringify(result).includes("style.safetensors"), false);
  assert.equal(JSON.stringify(result).includes("unexpected endpoint"), false);
});

function versionFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 202, modelId: 101, baseModel: "SDXL 1.0", status: "Published", availability: "Public", usageControl: "Download",
    files: [{ id: 303, type: "Model", name: "fixture.safetensors", primary: false, sizeKB: 12.25,
      metadata: { format: "SafeTensor" }, hashes: { SHA256: "b".repeat(64) },
      virusScanResult: "Success", pickleScanResult: "Success",
      downloadUrl: "https://civitai.com/api/download/models/202?fileId=303" }],
    ...overrides
  };
}

function modelFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 101, name: "do-not-return", type: "LORA", availability: "Public", mode: null,
    modelVersions: [{ id: 202 }], ...overrides };
}

async function fixtureClient(version: unknown, model: unknown, onRequest?: (url: string, init: RequestInit | undefined) => void) {
  const api = await import("../src/adapter/civitai/public-model-file-client.js") as {
    CivitaiPublicModelFileClient: new (options: { fetchImpl: typeof fetch }) => {
      getPublicLoraFileMetadata(input: unknown): Promise<Record<string, unknown>>;
    };
  };
  const calls: string[] = [];
  const client = new api.CivitaiPublicModelFileClient({ fetchImpl: async (input, init) => {
    const url = String(input);
    calls.push(url);
    onRequest?.(url, init);
    if (url === "https://civitai.com/api/v1/model-versions/202") return json(version);
    if (url === "https://civitai.com/api/v1/models/101") return json(model);
    return new Response("unexpected", { status: 404 });
  } });
  return { client, calls };
}

test("version-only lookup preserves model, version, and file identities and does not fetch download bytes", async () => {
  const { client, calls } = await fixtureClient(versionFixture(), modelFixture());
  const result = await client.getPublicLoraFileMetadata({ model_version_id: 202, file_id: 303 });
  assert.deepEqual(calls, ["https://civitai.com/api/v1/model-versions/202", "https://civitai.com/api/v1/models/101"]);
  assert.equal(result.source_kind, "MODEL_VERSION_FILE_SELECTION");
  assert.equal(result.model_id, 101);
  assert.equal(result.base_model, "SDXL 1.0");
  assert.equal(result.model_version_id, 202);
  assert.equal(result.file_id, 303);
  assert.equal(result.size_kb, 12.25);
  assert.equal(Object.hasOwn(result, "actual_bytes"), false);
  assert.equal(Object.hasOwn(result, "content_sha256"), false);
  assert.equal(result.content_attestation, "NOT_CHECKED");
  assert.equal(result.content_gap, "DYNAMIC_DOWNLOAD_REDIRECT_UNVERIFIED");
  assert.ok(calls.every((url) => !url.includes("/api/download/")));
});

test("explicit model/version mismatch fails before reading an unrelated model", async () => {
  const { client, calls } = await fixtureClient(versionFixture(), modelFixture());
  await assert.rejects(client.getPublicLoraFileMetadata({ model_id: 999, model_version_id: 202, file_id: 303 }),
    (error: unknown) => (error as { code?: string }).code === "MODEL_ID_MISMATCH");
  assert.deepEqual(calls, ["https://civitai.com/api/v1/model-versions/202"]);
});

test("public API shape accepts version-scoped baseModel, absent version availability, and bare downloadUrl without claiming file selection", async () => {
  const version = {
    id: 202, modelId: 101, baseModel: "Flux.1 D", status: "Published", usageControl: "Download",
    files: [{ id: 303, type: "Model", name: "fixture.safetensors", primary: true, sizeKB: 8192,
      metadata: { format: "SafeTensor" }, hashes: { SHA256: "e".repeat(64) },
      virusScanResult: "Success", pickleScanResult: "Success",
      downloadUrl: "https://civitai.com/api/download/models/202" }]
  };
  const model = { id: 101, name: "private fixture label", type: "LORA", availability: "Public", mode: null,
    modelVersions: [{ id: 202 }] };
  const { client, calls } = await fixtureClient(version, model);
  const result = await client.getPublicLoraFileMetadata({ model_id: 101, model_version_id: 202, file_id: 303 });
  assert.deepEqual(calls, ["https://civitai.com/api/v1/model-versions/202", "https://civitai.com/api/v1/models/101"]);
  assert.equal(result.base_model, "Flux.1 D");
  assert.equal(result.model_availability, "Public");
  assert.equal(result.version_availability, "NOT_REPORTED");
  assert.equal(result.download_path, "/api/download/models/202");
  assert.equal(result.download_selection, "NOT_VERIFIED");
  assert.equal(result.content_attestation, "NOT_CHECKED");
  assert.equal(result.content_gap, "DYNAMIC_DOWNLOAD_REDIRECT_UNVERIFIED");
});

test("a contradictory model status is rejected only when the optional field is present", async () => {
  const { client } = await fixtureClient(versionFixture(), modelFixture({ status: "Draft" }));
  await assert.rejects(client.getPublicLoraFileMetadata({ model_id: 101, model_version_id: 202, file_id: 303 }),
    (error: unknown) => (error as { code?: string }).code === "MODEL_NOT_PUBLIC");
});

test("file selection is explicit and duplicate matching file IDs are rejected instead of choosing primary/latest", async () => {
  const version = versionFixture({ files: [
    { id: 303, type: "Model", name: "selected.safetensors", primary: false, sizeKB: 1,
      metadata: { format: "SafeTensor" }, hashes: { SHA256: "c".repeat(64) }, virusScanResult: "Success", pickleScanResult: "Success",
      downloadUrl: "https://civitai.com/api/download/models/202?fileId=303" },
    { id: 404, type: "Model", name: "primary.safetensors", primary: true, sizeKB: 2,
      metadata: { format: "SafeTensor" }, hashes: { SHA256: "d".repeat(64) }, virusScanResult: "Success", pickleScanResult: "Success",
      downloadUrl: "https://civitai.com/api/download/models/202?fileId=404" }
  ] });
  const selected = await fixtureClient(version, modelFixture());
  const result = await selected.client.getPublicLoraFileMetadata({ model_id: 101, model_version_id: 202, file_id: 303 });
  assert.equal(result.file_id, 303);
  assert.equal(result.primary, false);

  const ambiguous = await fixtureClient(versionFixture({ files: [
    ...(versionFixture().files as unknown[]), ...(versionFixture().files as unknown[])
  ] }), modelFixture());
  await assert.rejects(ambiguous.client.getPublicLoraFileMetadata({ model_version_id: 202, file_id: 303 }),
    (error: unknown) => (error as { code?: string }).code === "FILE_SELECTION_AMBIGUOUS");
});

test("non-public, non-LORA, ungated, unscanned, malformed hash, and mismatched download metadata fail closed", async (t) => {
  const rejected: Array<{ name: string; version?: Record<string, unknown>; model?: Record<string, unknown>; code: string }> = [
    { name: "unpublished version", version: versionFixture({ status: "Draft" }), code: "VERSION_NOT_PUBLIC" },
    { name: "non-public version", version: versionFixture({ availability: "Private" }), code: "VERSION_NOT_PUBLIC" },
    { name: "non-download version", version: versionFixture({ usageControl: "Username" }), code: "VERSION_NOT_PUBLIC" },
    { name: "non-LORA model", model: modelFixture({ type: "Checkpoint" }), code: "MODEL_NOT_LORA" },
    { name: "archived model", model: modelFixture({ mode: "Archived" }), code: "MODEL_NOT_PUBLIC" },
    { name: "unlinked version", model: modelFixture({ modelVersions: [{ id: 999 }] }), code: "MODEL_VERSION_NOT_LINKED" },
    { name: "wrong file format", version: versionFixture({ files: [(versionFixture().files as Record<string, unknown>[])[0] && {
      ...(versionFixture().files as Record<string, unknown>[])[0], metadata: { format: "PickleTensor" }
    }] }), code: "FILE_NOT_ELIGIBLE" },
    { name: "failed virus scan", version: versionFixture({ files: [{ ...(versionFixture().files as Record<string, unknown>[])[0], virusScanResult: "Failed" }] }), code: "FILE_NOT_ELIGIBLE" },
    { name: "failed pickle scan", version: versionFixture({ files: [{ ...(versionFixture().files as Record<string, unknown>[])[0], pickleScanResult: "Dangerous" }] }), code: "FILE_NOT_ELIGIBLE" },
    { name: "missing provider hash", version: versionFixture({ files: [{ ...(versionFixture().files as Record<string, unknown>[])[0], hashes: {} }] }), code: "FILE_METADATA_INCOMPLETE" },
    { name: "unreviewed download host", version: versionFixture({ files: [{ ...(versionFixture().files as Record<string, unknown>[])[0],
      downloadUrl: "https://cdn.example.invalid/file?fileId=303" }] }), code: "DOWNLOAD_SELECTION_UNVERIFIABLE" }
  ];
  for (const scenario of rejected) await t.test(scenario.name, async () => {
    const { client } = await fixtureClient(scenario.version ?? versionFixture(), scenario.model ?? modelFixture());
    await assert.rejects(client.getPublicLoraFileMetadata({ model_id: 101, model_version_id: 202, file_id: 303 }),
      (error: unknown) => (error as { code?: string }).code === scenario.code);
  });
});

test("metadata redirects are rejected and transport failures never expose server text or location", async () => {
  const api = await import("../src/adapter/civitai/public-model-file-client.js") as {
    CivitaiPublicModelFileClient: new (options: { fetchImpl: typeof fetch }) => {
      getPublicLoraFileMetadata(input: unknown): Promise<Record<string, unknown>>;
    };
  };
  const urls: string[] = [];
  const client = new api.CivitaiPublicModelFileClient({ fetchImpl: async (input) => {
    urls.push(String(input));
    return new Response("secret response body", { status: 302, headers: { location: "https://signed.example.invalid/private?token=secret" } });
  } });
  await assert.rejects(client.getPublicLoraFileMetadata({ model_version_id: 202, file_id: 303 }),
    (error: unknown) => {
      const safe = error as { code?: string; message?: string };
      return safe.code === "METADATA_REDIRECT_REJECTED" && !safe.message?.includes("secret") &&
        !safe.message?.includes("signed.example.invalid");
    });
  assert.deepEqual(urls, ["https://civitai.com/api/v1/model-versions/202"]);
});

test("invalid caller selections and forged option objects are rejected before fetch", async () => {
  const api = await import("../src/adapter/civitai/public-model-file-client.js") as {
    CivitaiPublicModelFileClient: new (options: unknown) => {
      getPublicLoraFileMetadata(input: unknown): Promise<Record<string, unknown>>;
    };
  };
  let requests = 0;
  const fetchImpl: typeof fetch = async () => { requests += 1; return json({}); };
  for (const selection of [
    { model_version_id: 0, file_id: 303 }, { model_version_id: 202, file_id: 0 },
    { model_version_id: 202, file_id: 303, url: "https://evil.invalid" },
    Object.defineProperty({}, "model_version_id", { enumerable: true, get: () => 202 })
  ]) {
    const client = new api.CivitaiPublicModelFileClient({ fetchImpl });
    await assert.rejects(client.getPublicLoraFileMetadata(selection),
      (error: unknown) => (error as { code?: string }).code === "INVALID_INPUT");
  }
  assert.throws(() => new api.CivitaiPublicModelFileClient({ fetchImpl, unexpected: true }),
    (error: unknown) => (error as { code?: string }).code === "INVALID_INPUT");
  assert.equal(requests, 0);
});

test("fetch deadline is enforced even when an injected transport ignores AbortSignal, with no retry", async () => {
  const api = await import("../src/adapter/civitai/public-model-file-client.js") as {
    CivitaiPublicModelFileClient: new (options: { fetchImpl: typeof fetch; requestTimeoutMs: number }) => {
      getPublicLoraFileMetadata(input: unknown): Promise<Record<string, unknown>>;
    };
  };
  let requests = 0;
  const client = new api.CivitaiPublicModelFileClient({ requestTimeoutMs: 10, fetchImpl: async () => {
    requests += 1;
    return await new Promise<Response>(() => undefined);
  } });
  await assert.rejects(client.getPublicLoraFileMetadata({ model_version_id: 202, file_id: 303 }),
    (error: unknown) => (error as { code?: string }).code === "REQUEST_TIMEOUT");
  assert.equal(requests, 1);
});

test("caller abort cancels a stalled metadata body and reports only a safe code", async () => {
  const api = await import("../src/adapter/civitai/public-model-file-client.js") as {
    CivitaiPublicModelFileClient: new (options: { fetchImpl: typeof fetch; requestTimeoutMs: number }) => {
      getPublicLoraFileMetadata(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
    };
  };
  const controller = new AbortController();
  let requests = 0;
  const client = new api.CivitaiPublicModelFileClient({ requestTimeoutMs: 1_000, fetchImpl: async () => {
    requests += 1;
    return new Response(new ReadableStream<Uint8Array>({ start() { /* deliberately stalled fixture */ } }),
      { status: 200, headers: { "content-type": "application/json" } });
  } });
  const pending = client.getPublicLoraFileMetadata({ model_version_id: 202, file_id: 303 }, controller.signal);
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(pending, (error: unknown) => (error as { code?: string }).code === "REQUEST_ABORTED");
  assert.equal(requests, 1);
});

test("metadata JSON is byte-bounded and oversized response text is not surfaced", async () => {
  const api = await import("../src/adapter/civitai/public-model-file-client.js") as {
    CivitaiPublicModelFileClient: new (options: { fetchImpl: typeof fetch; maxResponseBytes: number }) => {
      getPublicLoraFileMetadata(input: unknown): Promise<Record<string, unknown>>;
    };
  };
  let requests = 0;
  const oversizedBody = JSON.stringify({ note: "private-provider-response-".repeat(100) });
  const client = new api.CivitaiPublicModelFileClient({ maxResponseBytes: 1_024, fetchImpl: async () => {
    requests += 1;
    return new Response(oversizedBody, { status: 200, headers: { "content-type": "application/json" } });
  } });
  await assert.rejects(client.getPublicLoraFileMetadata({ model_version_id: 202, file_id: 303 }),
    (error: unknown) => {
      const safe = error as { code?: string; message?: string };
      return safe.code === "RESPONSE_TOO_LARGE" && !safe.message?.includes("private-provider-response");
    });
  assert.equal(requests, 1);
});
