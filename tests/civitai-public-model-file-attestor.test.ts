import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { CivitaiPinnedHttpsDownloadTransport } from "../src/adapter/civitai/pinned-https-download-transport.js";
import { CivitaiPublicModelFileClient } from "../src/adapter/civitai/public-model-file-client.js";

const MODULE_PATH = "../src/adapter/civitai/public-model-file-attestor.js";
const MODEL_ID = 101;
const VERSION_ID = 202;
const FILE_ID = 303;
const SOURCE_URL = `https://civitai.com/api/download/models/${VERSION_ID}?fileId=${FILE_ID}`;

type SafeError = Error & { readonly code?: string };
type Metadata = Record<string, unknown>;
type ResponsePort = {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: AsyncIterable<Uint8Array>;
  cancel(): Promise<void>;
};
type TestTransport = CivitaiPinnedHttpsDownloadTransport & { readonly urls: string[] };
type AttestorApi = {
  readonly CivitaiPublicModelFileAttestor: new (options?: unknown) => {
    attest(input: unknown, signal?: AbortSignal): Promise<object>;
  };
  snapshotCivitaiVerifiedModelFileWitness(witness: unknown): Readonly<Record<string, unknown>>;
};

async function api(): Promise<AttestorApi> {
  const modulePath = MODULE_PATH;
  return await import(modulePath) as AttestorApi;
}

function tensorFile(headerText?: string, data = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9])): Buffer {
  const header = Buffer.from(headerText ?? JSON.stringify({
    alpha: { dtype: "F32", shape: [2], data_offsets: [0, 8] },
    empty: { dtype: "F16", shape: [0, 3], data_offsets: [8, 8] },
    scalar: { dtype: "I8", shape: [], data_offsets: [8, 9] },
    __metadata__: { format: "pt" }
  }), "utf8");
  const payload = data;
  const prefix = Buffer.alloc(8);
  prefix.writeBigUInt64LE(BigInt(header.byteLength));
  return Buffer.concat([prefix, header, payload]);
}

function metadata(sha256: string, overrides: Record<string, unknown> = {}): Metadata {
  return {
    metadata_status: "VERIFIED", source_kind: "MODEL_VERSION_FILE_SELECTION", model_id: MODEL_ID,
    model_version_id: VERSION_ID, file_id: FILE_ID, model_type: "LORA", base_model: "Flux.1 D",
    version_status: "Published", model_availability: "Public", version_availability: "Public",
    usage_control: "Download", file_type: "Model", format: "SafeTensor", primary: true,
    size_kb: 1.5, sha256, virus_scan_result: "Success", pickle_scan_result: "Success",
    license_flags: { allow_commercial_use: null, allow_no_credit: null, allow_derivatives: null,
      allow_different_license: null, legal_approval: "NOT_ESTABLISHED" },
    download_path: `/api/download/models/${VERSION_ID}?fileId=${FILE_ID}`,
    download_selection: "VERIFIED_SOURCE_SELECTOR", content_attestation: "NOT_CHECKED",
    content_gap: "DYNAMIC_DOWNLOAD_REDIRECT_UNVERIFIED", ...overrides
  };
}

function fragment(bytes: Uint8Array, sizes: readonly number[] = [1, 2, 7, 3, 19]): AsyncIterable<Uint8Array> {
  return { async *[Symbol.asyncIterator]() {
    let offset = 0; let index = 0;
    while (offset < bytes.byteLength) {
      const size = sizes[index++ % sizes.length]!;
      yield bytes.subarray(offset, Math.min(bytes.byteLength, offset + size));
      offset += size;
    }
  } };
}

function metadataClient(value: Metadata, calls: string[] = []): CivitaiPublicModelFileClient {
  const versionId = Number(value.model_version_id ?? VERSION_ID);
  const modelId = Number(value.model_id ?? MODEL_ID);
  const fileId = Number(value.file_id ?? FILE_ID);
  return new CivitaiPublicModelFileClient({ fetchImpl: async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url === `https://civitai.com/api/v1/model-versions/${versionId}`) {
      return Response.json({ id: versionId, modelId, baseModel: value.base_model, status: value.version_status,
        availability: value.version_availability === "NOT_REPORTED" ? undefined : value.version_availability,
        usageControl: value.usage_control, files: [{ id: fileId, type: value.file_type, name: "not-returned.safetensors",
          primary: value.primary, sizeKB: value.size_kb, metadata: { format: value.format }, hashes: { SHA256: value.sha256 },
          virusScanResult: value.virus_scan_result, pickleScanResult: value.pickle_scan_result,
          downloadUrl: `https://civitai.com/api/download/models/${versionId}?fileId=${fileId}` }] });
    }
    if (url === `https://civitai.com/api/v1/models/${modelId}`) {
      return Response.json({ id: modelId, type: value.model_type, status: "Published", availability: value.model_availability,
        mode: null, modelVersions: [{ id: versionId }], allowCommercialUse: value.license_flags &&
          (value.license_flags as Record<string, unknown>).allow_commercial_use, allowNoCredit: null,
        allowDerivatives: null, allowDifferentLicense: null });
    }
    return new Response("unexpected metadata route", { status: 404 });
  } });
}

function transport(responseFor: (url: URL) => ResponsePort,
  approved = ["https://civitai.com"]): TestTransport {
  const urls: string[] = [];
  const instance = new CivitaiPinnedHttpsDownloadTransport({ approvedOrigins: approved,
    ports: { dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
      request: async (request: { readonly hostname: string; readonly path: string; readonly headers: Readonly<Record<string, string>> }) => {
        const url = new URL(`https://${request.hostname}${request.path}`);
        urls.push(url.href);
        const result = responseFor(url);
        return { statusCode: result.status, headers: result.headers, remoteAddress: "93.184.216.34", tlsAuthorized: true,
          body: result.body, cancel: result.cancel };
      } } });
  Object.defineProperty(instance, "urls", { value: urls, enumerable: false });
  return instance as TestTransport;
}

function response(bytes: Uint8Array, options: { status?: number; headers?: Record<string, string>; onCancel?: () => void } = {}): ResponsePort {
  return {
    status: options.status ?? 200,
    headers: Object.freeze({ "content-length": String(bytes.byteLength), "content-type": "application/octet-stream",
      "content-encoding": "identity", ...options.headers }),
    body: fragment(bytes),
    async cancel() { options.onCancel?.(); }
  };
}

function sha256(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }

test("attestor streams all fragments to EOF, hashes exact bytes, validates SafeTensors and returns only a nominal safe snapshot", async () => {
  const bytes = tensorFile();
  const calls: string[] = [];
  const transportPort = transport(() => response(bytes));
  const { CivitaiPublicModelFileAttestor, snapshotCivitaiVerifiedModelFileWitness } = await api();
  const attestor = new CivitaiPublicModelFileAttestor({ metadataClient: metadataClient(metadata(sha256(bytes)), calls), transport: transportPort });

  const witness = await attestor.attest({ model_version_id: VERSION_ID, file_id: FILE_ID });
  const snapshot = snapshotCivitaiVerifiedModelFileWitness(witness);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls, [`https://civitai.com/api/v1/model-versions/${VERSION_ID}`, `https://civitai.com/api/v1/models/${MODEL_ID}`]);
  assert.deepEqual(transportPort.urls, [SOURCE_URL]);
  assert.equal(snapshot.model_id, MODEL_ID);
  assert.equal(snapshot.model_version_id, VERSION_ID);
  assert.equal(snapshot.file_id, FILE_ID);
  assert.equal(snapshot.size, bytes.byteLength);
  assert.equal(snapshot.sha256, `sha256:${sha256(bytes)}`);
  assert.equal(snapshot.canonical_download_url, SOURCE_URL);
  assert.equal(snapshot.content_confidence, "STREAMED_SHA256_AND_SAFETENSORS_STRUCTURE");
  assert.equal(snapshot.legal_approval, "NOT_ESTABLISHED");
  assert.equal(snapshot.backend_acceptance, "UNPROVEN");
  assert.equal(Object.isFrozen(witness), true);
  assert.equal(Reflect.ownKeys(witness).length, 0);
  assert.equal(Object.isFrozen(snapshot), true);
  for (const privateValue of ["alpha", "private-r2", "download-token", "storage.example.test"] ) {
    assert.equal(JSON.stringify(snapshot).includes(privateValue), false);
  }
  assert.throws(() => snapshotCivitaiVerifiedModelFileWitness(Object.freeze({ ...witness })),
    (error: SafeError) => error.code === "INVALID_WITNESS");
  assert.throws(() => snapshotCivitaiVerifiedModelFileWitness(new Proxy(witness, {})),
    (error: SafeError) => error.code === "INVALID_WITNESS");
  assert.throws(() => snapshotCivitaiVerifiedModelFileWitness({ metadata_status: "VERIFIED", sha256: `sha256:${sha256(bytes)}` }),
    (error: SafeError) => error.code === "INVALID_WITNESS");
});

test("redirect is canceled before one approved HTTPS hop, and private final URL is not returned", async () => {
  const bytes = tensorFile();
  let firstCanceled = 0;
  let secondCanceled = 0;
  const port = transport((url) => url.origin === "https://civitai.com"
    ? response(new Uint8Array(), { status: 302, headers: { location: "https://storage.example.test/file?signature=fixture-secret" }, onCancel: () => firstCanceled += 1 })
    : response(bytes, { onCancel: () => secondCanceled += 1 }), ["https://civitai.com", "https://storage.example.test"]);
  const { CivitaiPublicModelFileAttestor, snapshotCivitaiVerifiedModelFileWitness } = await api();
  const attestor = new CivitaiPublicModelFileAttestor({ metadataClient: metadataClient(metadata(sha256(bytes))), transport: port });
  const result = snapshotCivitaiVerifiedModelFileWitness(await attestor.attest({ model_version_id: VERSION_ID, file_id: FILE_ID }));
  assert.equal(port.urls.length, 2);
  assert.equal(firstCanceled, 1);
  assert.equal(secondCanceled, 0);
  assert.equal(result.canonical_download_url, SOURCE_URL);
  assert.equal(JSON.stringify(result).includes("storage.example.test"), false);
  assert.equal(JSON.stringify(result).includes("fixture-secret"), false);
});

test("401/403 and disallowed, malformed, or second redirects fail closed without minting a token", async (t) => {
  const bytes = tensorFile();
  for (const scenario of [
    { name: "auth required", status: 401, headers: {}, allowed: ["https://civitai.com"], want: "AUTH_REQUIRED" },
    { name: "gated", status: 403, headers: {}, allowed: ["https://civitai.com"], want: "GATED" },
    { name: "unapproved origin", status: 302, headers: { location: "https://unapproved.example.test/file" }, allowed: ["https://civitai.com"], want: "REDIRECT_REJECTED" },
    { name: "credentialed location", status: 302, headers: { location: "https://user:pass@storage.example.test/file" }, allowed: ["https://civitai.com", "https://storage.example.test"], want: "REDIRECT_REJECTED" }
  ]) await t.test(scenario.name, async () => {
    let canceled = 0;
    const port = transport(() => response(bytes, { status: scenario.status, headers: scenario.headers, onCancel: () => canceled += 1 }), scenario.allowed);
    const { CivitaiPublicModelFileAttestor } = await api();
    const attestor = new CivitaiPublicModelFileAttestor({ metadataClient: metadataClient(metadata(sha256(bytes))), transport: port });
    await assert.rejects(attestor.attest({ model_version_id: VERSION_ID, file_id: FILE_ID }),
      (error: SafeError) => { assert.equal(error.code, scenario.want); assert.equal(error.message.includes("storage.example.test"), false);
        assert.equal(error.message.includes("pass"), false); return true; });
    assert.equal(canceled, 1);
  });
});

test("hash mismatch, truncation, malformed SafeTensor, and invalid metadata never mint a witness", async (t) => {
  const valid = tensorFile();
  const duplicateKeys = tensorFile('{"x":{"dtype":"U8","shape":[1],"data_offsets":[0,1]},"x":{"dtype":"U8","shape":[1],"data_offsets":[0,1]}}', Buffer.from([1]));
  const badOffsets = tensorFile('{"x":{"dtype":"U8","shape":[2],"data_offsets":[0,1]}}', Buffer.from([1, 2]));
  const badUtf8 = Buffer.concat([Buffer.from([2, 0, 0, 0, 0, 0, 0, 0]), Buffer.from([0xff, 0x00])]);
  const truncated = valid.subarray(0, valid.byteLength - 1);
  const scenarios = [
    { name: "metadata hash mismatch", bytes: valid, expectedHash: "0".repeat(64), want: "CONTENT_HASH_MISMATCH" },
    { name: "truncated tensor data", bytes: truncated, expectedHash: sha256(valid), want: "STREAM_TRUNCATED" },
    { name: "duplicate JSON keys", bytes: duplicateKeys, expectedHash: sha256(duplicateKeys), want: "SAFETENSORS_INVALID" },
    { name: "shape byte size mismatch", bytes: badOffsets, expectedHash: sha256(badOffsets), want: "SAFETENSORS_INVALID" },
    { name: "invalid UTF-8 header", bytes: badUtf8, expectedHash: sha256(badUtf8), want: "SAFETENSORS_INVALID" }
  ];
  for (const scenario of scenarios) await t.test(scenario.name, async () => {
    let canceled = 0;
    const port = transport(() => response(scenario.bytes, { onCancel: () => canceled += 1 }));
    const { CivitaiPublicModelFileAttestor } = await api();
    const attestor = new CivitaiPublicModelFileAttestor({ metadataClient: metadataClient(metadata(scenario.expectedHash)), transport: port });
    await assert.rejects(attestor.attest({ model_version_id: VERSION_ID, file_id: FILE_ID }),
      (error: SafeError) => { assert.equal(error.code, scenario.want); assert.equal(error.message.includes("fileId"), false); return true; });
    assert.equal(canceled, 1);
  });
});

test("tensor offsets must exactly cover data; holes, overlaps, and trailing bytes are rejected", async (t) => {
  const cases = [
    { name: "hole", header: JSON.stringify({ x: { dtype: "U8", shape: [1], data_offsets: [1, 2] } }), data: Buffer.from([1, 2]) },
    { name: "overlap", header: JSON.stringify({ a: { dtype: "U8", shape: [2], data_offsets: [0, 2] }, b: { dtype: "U8", shape: [1], data_offsets: [1, 2] } }), data: Buffer.from([1, 2]) },
    { name: "trailing unindexed data", header: JSON.stringify({ x: { dtype: "U8", shape: [1], data_offsets: [0, 1] } }), data: Buffer.from([1, 2]) }
  ];
  for (const scenario of cases) await t.test(scenario.name, async () => {
    const bytes = tensorFile(scenario.header, scenario.data);
    const port = transport(() => response(bytes));
    const { CivitaiPublicModelFileAttestor } = await api();
    const attestor = new CivitaiPublicModelFileAttestor({ metadataClient: metadataClient(metadata(sha256(bytes))), transport: port });
    await assert.rejects(attestor.attest({ model_version_id: VERSION_ID, file_id: FILE_ID }),
      (error: SafeError) => error.code === "SAFETENSORS_INVALID");
  });
});

test("sub-byte/unknown dtype is explicitly unsupported, while scalar and zero-sized tensors are valid", async () => {
  const subByte = tensorFile(JSON.stringify({ q: { dtype: "F4", shape: [2], data_offsets: [0, 1] } }), Buffer.from([0]));
  const port = transport(() => response(subByte));
  const { CivitaiPublicModelFileAttestor } = await api();
  const attestor = new CivitaiPublicModelFileAttestor({ metadataClient: metadataClient(metadata(sha256(subByte))), transport: port });
  await assert.rejects(attestor.attest({ model_version_id: VERSION_ID, file_id: FILE_ID }),
    (error: SafeError) => error.code === "SAFETENSORS_UNSUPPORTED_DTYPE");

  const complex64 = tensorFile(JSON.stringify({ weight: { dtype: "C64", shape: [1], data_offsets: [0, 8] } }),
    Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));
  const complexPort = transport(() => response(complex64));
  const complexAttestor = new CivitaiPublicModelFileAttestor({ metadataClient: metadataClient(metadata(sha256(complex64))), transport: complexPort });
  await assert.doesNotReject(complexAttestor.attest({ model_version_id: VERSION_ID, file_id: FILE_ID }));

  const valid = tensorFile();
  const validPort = transport(() => response(valid));
  const validAttestor = new CivitaiPublicModelFileAttestor({ metadataClient: metadataClient(metadata(sha256(valid))), transport: validPort });
  await assert.doesNotReject(validAttestor.attest({ model_version_id: VERSION_ID, file_id: FILE_ID }));
});

test("asset and header byte ceilings are finite trusted constructor policies and cancel oversized streams", async () => {
  const bytes = tensorFile();
  let canceled = 0;
  const port = transport(() => response(bytes, { onCancel: () => canceled += 1 }));
  const { CivitaiPublicModelFileAttestor } = await api();
  const attestor = new CivitaiPublicModelFileAttestor({ metadataClient: metadataClient(metadata(sha256(bytes))), transport: port,
    maxAssetBytes: bytes.byteLength - 1 });
  await assert.rejects(attestor.attest({ model_version_id: VERSION_ID, file_id: FILE_ID }),
    (error: SafeError) => error.code === "RESPONSE_TOO_LARGE");
  assert.equal(canceled, 1);
  assert.throws(() => new CivitaiPublicModelFileAttestor({ unexpected: true }), (error: SafeError) => error.code === "INVALID_INPUT");
  assert.throws(() => new CivitaiPublicModelFileAttestor({ maxAssetBytes: Number.POSITIVE_INFINITY }),
    (error: SafeError) => error.code === "INVALID_INPUT");
});

test("header cap is enforced before parsing and metadata selection mismatch never opens the download", async (t) => {
  const largeHeader = tensorFile(JSON.stringify({ __metadata__: { info: "x".repeat(128) } }), Buffer.alloc(0));
  await t.test("oversized local header", async () => {
    let canceled = 0;
    const port = transport(() => response(largeHeader, { onCancel: () => canceled += 1 }));
    const { CivitaiPublicModelFileAttestor } = await api();
    const attestor = new CivitaiPublicModelFileAttestor({ metadataClient: metadataClient(metadata(sha256(largeHeader))),
      transport: port, maxHeaderBytes: 64 });
    await assert.rejects(attestor.attest({ model_version_id: VERSION_ID, file_id: FILE_ID }),
      (error: SafeError) => error.code === "RESPONSE_TOO_LARGE");
    assert.equal(canceled, 1);
  });
  await t.test("metadata file id mismatch", async () => {
    let opens = 0;
    const port = transport(() => { opens += 1; return response(largeHeader); });
    const { CivitaiPublicModelFileAttestor } = await api();
    const attestor = new CivitaiPublicModelFileAttestor({ metadataClient: metadataClient(metadata(sha256(largeHeader), { file_id: 404 })), transport: port });
    await assert.rejects(attestor.attest({ model_version_id: VERSION_ID, file_id: FILE_ID }),
      (error: SafeError) => error.code === "METADATA_UNVERIFIED");
    assert.equal(opens, 0);
  });
});

test("caller-provided URLs, hashes, or metadata are rejected before metadata read or network", async () => {
  const bytes = tensorFile();
  const readUrls: string[] = [];
  const client = metadataClient(metadata(sha256(bytes)), readUrls);
  const port = transport(() => response(bytes));
  const { CivitaiPublicModelFileAttestor } = await api();
  const attestor = new CivitaiPublicModelFileAttestor({ metadataClient: client, transport: port });
  for (const input of [
    { model_version_id: VERSION_ID, file_id: FILE_ID, url: SOURCE_URL },
    { model_version_id: VERSION_ID, file_id: FILE_ID, sha256: sha256(bytes) },
    Object.defineProperty({}, "file_id", { enumerable: true, get: () => FILE_ID })
  ]) await assert.rejects(attestor.attest(input), (error: SafeError) => error.code === "INVALID_INPUT");
  assert.equal(readUrls.length, 0);
  assert.equal(port.urls.length, 0);
});

test("attestor constructor rejects structural fake ports instead of minting a nominal proof from caller callbacks", async () => {
  const { CivitaiPublicModelFileAttestor } = await api();
  assert.doesNotThrow(() => new CivitaiPublicModelFileAttestor());
  assert.doesNotThrow(() => new CivitaiPublicModelFileAttestor({ approvedOrigins: ["https://civitai.com", "https://storage.example.test"] }));
  assert.throws(() => new CivitaiPublicModelFileAttestor({ approvedOrigins: ["https://civitai.com", "https://*.example.test"] }),
    (error: SafeError) => error.code === "INVALID_INPUT");
  const fakeMetadataClient = { async getPublicLoraFileMetadata() { return metadata("a".repeat(64)); } };
  const fakeTransport = { allowsOrigin() { return true; }, async open() { return response(tensorFile()); } };
  assert.throws(() => new CivitaiPublicModelFileAttestor({ metadataClient: fakeMetadataClient, transport: fakeTransport }),
    (error: SafeError) => error.code === "INVALID_INPUT");
});

test("trusted attestor timeout supports long bounded file transfers without removing finite caps", async () => {
  const { CivitaiPublicModelFileAttestor } = await api();
  assert.doesNotThrow(() => new CivitaiPublicModelFileAttestor({ requestTimeoutMs: 300_000 }));
  assert.doesNotThrow(() => new CivitaiPublicModelFileAttestor({ requestTimeoutMs: 900_000 }));
  assert.throws(() => new CivitaiPublicModelFileAttestor({ requestTimeoutMs: 900_001 }),
    (error: SafeError) => error.code === "INVALID_INPUT");
});

test("content encoding, declared byte length, and second redirect fail closed", async (t) => {
  const bytes = tensorFile();
  for (const scenario of [
    { name: "compressed transfer", headers: { "content-encoding": "gzip" }, want: "RESPONSE_HEADERS_INVALID" },
    { name: "wrong content length", headers: { "content-length": String(bytes.byteLength + 1) }, want: "RESPONSE_HEADERS_INVALID" }
  ]) await t.test(scenario.name, async () => {
    let canceled = 0;
    const port = transport(() => response(bytes, { headers: scenario.headers, onCancel: () => canceled += 1 }));
    const { CivitaiPublicModelFileAttestor } = await api();
    const attestor = new CivitaiPublicModelFileAttestor({ metadataClient: metadataClient(metadata(sha256(bytes))), transport: port });
    await assert.rejects(attestor.attest({ model_version_id: VERSION_ID, file_id: FILE_ID }),
      (error: SafeError) => error.code === scenario.want);
    assert.equal(canceled, 1);
  });
  await t.test("second redirect", async () => {
    let canceled = 0;
    const port = transport((url) => response(new Uint8Array(), { status: 302,
      headers: { location: url.origin === "https://civitai.com" ? "https://storage.example.test/first" : "https://other.example.test/second" },
      onCancel: () => canceled += 1 }), ["https://civitai.com", "https://storage.example.test", "https://other.example.test"]);
    const { CivitaiPublicModelFileAttestor } = await api();
    const attestor = new CivitaiPublicModelFileAttestor({ metadataClient: metadataClient(metadata(sha256(bytes))), transport: port });
    await assert.rejects(attestor.attest({ model_version_id: VERSION_ID, file_id: FILE_ID }),
      (error: SafeError) => error.code === "REDIRECT_REJECTED");
    assert.equal(port.urls.length, 2);
    assert.equal(canceled, 2);
  });
});

test("request abort cancels a stalled body with a safe code and no retry", async () => {
  let opens = 0;
  let canceled = 0;
  const bytes = tensorFile();
  const port = transport(() => {
    opens += 1;
    return { status: 200, headers: {}, body: { async *[Symbol.asyncIterator]() { await new Promise<void>(() => undefined); } },
      async cancel() { canceled += 1; } };
  });
  const { CivitaiPublicModelFileAttestor } = await api();
  const attestor = new CivitaiPublicModelFileAttestor({ metadataClient: metadataClient(metadata(sha256(bytes))), transport: port,
    requestTimeoutMs: 15 });
  await assert.rejects(attestor.attest({ model_version_id: VERSION_ID, file_id: FILE_ID }),
    (error: SafeError) => error.code === "REQUEST_TIMEOUT" && !error.message.includes("AbortSignal"));
  assert.equal(opens, 1);
  assert.equal(canceled, 1);
});

test("shape overflow and excessive header nesting fail before attestation", async (t) => {
  const scenarios = [
    { name: "shape multiplication overflow", header: JSON.stringify({ huge: { dtype: "F64", shape: [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER], data_offsets: [0, 0] } }) },
    { name: "header nesting limit", header: `{"__metadata__":{"deep":${"[".repeat(70)}0${"]".repeat(70)}}}` }
  ];
  for (const scenario of scenarios) await t.test(scenario.name, async () => {
    const bytes = tensorFile(scenario.header, Buffer.alloc(0));
    const port = transport(() => response(bytes));
    const { CivitaiPublicModelFileAttestor } = await api();
    const attestor = new CivitaiPublicModelFileAttestor({ metadataClient: metadataClient(metadata(sha256(bytes))), transport: port });
    await assert.rejects(attestor.attest({ model_version_id: VERSION_ID, file_id: FILE_ID }),
      (error: SafeError) => error.code === "SAFETENSORS_INVALID");
  });
});

test("actual 638 metadata client and 648 pinned HTTPS transport compose with synthetic DNS/socket ports", async () => {
  const bytes = tensorFile();
  const expectedHash = sha256(bytes);
  const clientPath = "../src/adapter/civitai/public-model-file-client.js";
  const transportPath = "../src/adapter/civitai/pinned-https-download-transport.js";
  const clientModule = await import(clientPath) as {
    CivitaiPublicModelFileClient: new (options: { fetchImpl: typeof fetch }) => unknown;
  };
  const transportModule = await import(transportPath) as {
    CivitaiPinnedHttpsDownloadTransport: new (options: unknown) => unknown;
  };
  const fetched: string[] = [];
  const metadataClient = new clientModule.CivitaiPublicModelFileClient({ fetchImpl: async (input) => {
    const url = String(input);
    fetched.push(url);
    if (url === `https://civitai.com/api/v1/model-versions/${VERSION_ID}`) {
      return Response.json({ id: VERSION_ID, modelId: MODEL_ID, baseModel: "Flux.1 D", status: "Published", availability: "Public",
        usageControl: "Download", files: [{ id: FILE_ID, type: "Model", name: "never-return-file-name.safetensors",
          primary: true, sizeKB: bytes.byteLength / 1024, metadata: { format: "SafeTensor" }, hashes: { SHA256: expectedHash.toUpperCase() },
          virusScanResult: "Success", pickleScanResult: "Success",
          downloadUrl: `https://civitai.com/api/download/models/${VERSION_ID}?fileId=${FILE_ID}` }] });
    }
    if (url === `https://civitai.com/api/v1/models/${MODEL_ID}`) {
      return Response.json({ id: MODEL_ID, type: "LORA", status: "Published", availability: "Public", mode: null,
        modelVersions: [{ id: VERSION_ID }], allowCommercialUse: ["Image"], allowNoCredit: null,
        allowDerivatives: null, allowDifferentLicense: null });
    }
    return new Response("unexpected metadata route", { status: 404 });
  } });
  const requested: Array<{ hostname: string; path: string; headers: Readonly<Record<string, string>> }> = [];
  let cancels = 0;
  const transport = new transportModule.CivitaiPinnedHttpsDownloadTransport({
    approvedOrigins: ["https://civitai.com", "https://storage.example.test"],
    ports: {
      dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
      request: async (options: { hostname: string; path: string; headers: Readonly<Record<string, string>> }) => {
        requested.push({ hostname: options.hostname, path: options.path, headers: options.headers });
        if (options.hostname === "civitai.com") return {
          statusCode: 302, headers: { location: "https://storage.example.test/weight?signature=synthetic-only" },
          remoteAddress: "93.184.216.34", tlsAuthorized: true, body: fragment(new Uint8Array()), async cancel() { cancels += 1; }
        };
        return {
          statusCode: 200, headers: { "content-length": String(bytes.byteLength), "content-type": "application/octet-stream",
            "content-encoding": "identity" }, remoteAddress: "93.184.216.34", tlsAuthorized: true,
          body: fragment(bytes), async cancel() { cancels += 1; }
        };
      }
    }
  });
  const { CivitaiPublicModelFileAttestor, snapshotCivitaiVerifiedModelFileWitness } = await api();
  const attestor = new CivitaiPublicModelFileAttestor({ metadataClient: metadataClient as never, transport: transport as never });
  const output = snapshotCivitaiVerifiedModelFileWitness(await attestor.attest({ model_version_id: VERSION_ID, file_id: FILE_ID }));
  assert.deepEqual(fetched, [`https://civitai.com/api/v1/model-versions/${VERSION_ID}`, `https://civitai.com/api/v1/models/${MODEL_ID}`]);
  assert.deepEqual(requested.map(({ hostname, path }) => [hostname, path]), [
    ["civitai.com", `/api/download/models/${VERSION_ID}?fileId=${FILE_ID}`], ["storage.example.test", "/weight?signature=synthetic-only"]
  ]);
  assert.ok(requested.every(({ headers }) => headers.authorization === undefined && headers.cookie === undefined));
  assert.equal(cancels, 1);
  assert.equal(output.sha256, `sha256:${expectedHash}`);
  assert.equal(output.size, bytes.byteLength);
  assert.equal(output.canonical_download_url, SOURCE_URL);
  for (const privateValue of ["storage.example.test", "synthetic-only", "never-return-file-name.safetensors"]) {
    assert.equal(JSON.stringify(output).includes(privateValue), false);
  }
});
