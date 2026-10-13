import assert from "node:assert/strict";
import test, { mock } from "node:test";

const modulePath = "../src/adapter/civitai/pinned-https-download-transport.js";
type Address = { readonly address: string; readonly family: 4 | 6 };
type RequestOptions = {
  readonly hostname: string;
  readonly port: number;
  readonly path: string;
  readonly method: "GET";
  readonly servername: string;
  readonly rejectUnauthorized: true;
  readonly agent: false;
  readonly maxHeaderSize: number;
  readonly highWaterMark: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
  readonly lookup: (hostname: string, options: { readonly all?: boolean }, callback: (
    error: Error | null,
    address?: string | readonly Address[],
    family?: number
  ) => void) => void;
};
type RawResponse = {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly remoteAddress: string | undefined;
  readonly tlsAuthorized: boolean;
  readonly body: AsyncIterable<Uint8Array>;
  cancel(): Promise<void>;
};
type Options = {
  readonly approvedOrigins: readonly string[];
  readonly requestTimeoutMs?: number;
  readonly maxResponseHeaders?: number;
  readonly maxResponseHeaderBytes?: number;
  readonly civitaiAuthorizationProvider?: () => string | undefined | Promise<string | undefined>;
  readonly ports?: {
    readonly dnsLookup?: (hostname: string, signal: AbortSignal) => Promise<readonly Address[]>;
    readonly request?: (options: RequestOptions) => Promise<RawResponse>;
  };
};
type OpenResponse = {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: AsyncIterable<Uint8Array>;
  cancel(): Promise<void>;
};
type TransportApi = {
  CivitaiPinnedHttpsDownloadTransport: new (options: Options) => {
    allowsOrigin(url: URL): boolean;
    open(input: { readonly url: URL; readonly signal?: AbortSignal } | unknown): Promise<OpenResponse>;
  };
};

async function loadApi(): Promise<TransportApi> {
  return await import(modulePath) as TransportApi;
}

function createRawResponse(options: {
  statusCode?: number;
  headers?: Readonly<Record<string, string | readonly string[] | undefined>>;
  remoteAddress?: string;
  tlsAuthorized?: boolean;
  chunks?: readonly Uint8Array[];
  body?: AsyncIterable<Uint8Array>;
  onCancel?: () => void;
} = {}): RawResponse {
  return {
    statusCode: options.statusCode ?? 200,
    headers: options.headers ?? { "content-type": "application/octet-stream" },
    remoteAddress: options.remoteAddress ?? "1.1.1.1",
    tlsAuthorized: options.tlsAuthorized ?? true,
    body: options.body ?? (async function* () { for (const chunk of options.chunks ?? [new Uint8Array([1, 2, 3])]) yield chunk; })(),
    async cancel() { options.onCancel?.(); }
  };
}

const civitaiUrl = () => new URL("https://civitai.com/api/download/models/2228091?fileId=2121151");

test("constructor accepts the trusted first-party origin and origin checks are exact and side-effect free", async () => {
  const { CivitaiPinnedHttpsDownloadTransport } = await loadApi();
  const nativeDefaults = new CivitaiPinnedHttpsDownloadTransport({ approvedOrigins: ["https://civitai.com"] });
  assert.equal(nativeDefaults.allowsOrigin(civitaiUrl()), true);
  let dnsCalls = 0;
  const transport = new CivitaiPinnedHttpsDownloadTransport({
    approvedOrigins: ["https://civitai.com"],
    ports: { dnsLookup: async () => { dnsCalls += 1; return [{ address: "1.1.1.1", family: 4 }]; } }
  });
  assert.equal(transport.allowsOrigin(civitaiUrl()), true);
  assert.equal(transport.allowsOrigin(new URL("https://civitai.com:444/path")), false);
  assert.equal(transport.allowsOrigin(new URL("http://civitai.com/path")), false);
  assert.equal(transport.allowsOrigin(new URL("https://civitai.com.attacker.invalid/path")), false);
  assert.equal(transport.allowsOrigin(new URL("https://user@civitai.com/path")), false);
  await assert.rejects(transport.open({ url: new URL("https://unapproved.example.invalid/path") }),
    (error: unknown) => (error as { code?: string }).code === "ORIGIN_NOT_APPROVED");
  assert.equal(dnsCalls, 0);
});

test("trusted origin configuration rejects wildcard, HTTP, IP literal, path, query, credentials, and non-443 origins", async () => {
  const { CivitaiPinnedHttpsDownloadTransport } = await loadApi();
  for (const origin of ["https://*.example.test", "http://files.example.test", "https://192.0.2.10",
    "https://files.example.test:8443", "https://files.example.test/path", "https://files.example.test?x=1",
    "https://user:pass@files.example.test", "https://files.example.test#fragment"]) {
    assert.throws(() => new CivitaiPinnedHttpsDownloadTransport({ approvedOrigins: ["https://civitai.com", origin] }),
      (error: unknown) => (error as { code?: string }).code === "INVALID_CONFIGURATION");
  }
});

test("default transfer deadline is five minutes and trusted maximum is finite at fifteen minutes", async () => {
  const { CivitaiPinnedHttpsDownloadTransport } = await loadApi();
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const transport = new CivitaiPinnedHttpsDownloadTransport({
      approvedOrigins: ["https://civitai.com"],
      ports: { dnsLookup: async () => await new Promise<readonly Address[]>(() => undefined) }
    });
    const pending = transport.open({ url: civitaiUrl() });
    await Promise.resolve();
    mock.timers.tick(299_999);
    await Promise.resolve();
    mock.timers.tick(1);
    await assert.rejects(pending,
      (error: unknown) => (error as { code?: string }).code === "REQUEST_TIMEOUT");
    assert.throws(() => new CivitaiPinnedHttpsDownloadTransport({
      approvedOrigins: ["https://civitai.com"], requestTimeoutMs: 900_001
    }), (error: unknown) => (error as { code?: string }).code === "INVALID_CONFIGURATION");
    assert.doesNotThrow(() => new CivitaiPinnedHttpsDownloadTransport({
      approvedOrigins: ["https://civitai.com"], requestTimeoutMs: 900_000
    }));
  } finally {
    mock.timers.reset();
  }
});

test("DNS rejects any private, reserved, documentation, mapped, loopback, or link-local answer before HTTPS", async (t) => {
  const { CivitaiPinnedHttpsDownloadTransport } = await loadApi();
  const rejected: Array<{ address: string; family: 4 | 6 }> = [
    { address: "127.0.0.1", family: 4 }, { address: "10.3.4.5", family: 4 },
    { address: "100.64.0.1", family: 4 }, { address: "169.254.1.2", family: 4 },
    { address: "172.16.0.1", family: 4 }, { address: "192.168.1.1", family: 4 },
    { address: "192.0.2.1", family: 4 }, { address: "198.18.0.1", family: 4 },
    { address: "224.0.0.1", family: 4 }, { address: "240.0.0.1", family: 4 },
    { address: "::1", family: 6 }, { address: "fe80::1", family: 6 },
    { address: "fc00::1", family: 6 }, { address: "ff02::1", family: 6 },
    { address: "2001:db8::1", family: 6 }, { address: "2002::1", family: 6 },
    { address: "::ffff:127.0.0.1", family: 6 }
  ];
  for (const address of rejected) await t.test(address.address, async () => {
    let requestCalls = 0;
    const transport = new CivitaiPinnedHttpsDownloadTransport({
      approvedOrigins: ["https://civitai.com"],
      ports: {
        dnsLookup: async () => [address],
        request: async () => { requestCalls += 1; return createRawResponse(); }
      }
    });
    await assert.rejects(transport.open({ url: civitaiUrl() }),
      (error: unknown) => (error as { code?: string }).code === "DNS_ADDRESS_REJECTED");
    assert.equal(requestCalls, 0);
  });
});

test("one private DNS answer rejects the whole set even if another answer is public", async () => {
  const { CivitaiPinnedHttpsDownloadTransport } = await loadApi();
  let requestCalls = 0;
  const transport = new CivitaiPinnedHttpsDownloadTransport({
    approvedOrigins: ["https://civitai.com"],
    ports: {
      dnsLookup: async () => [{ address: "1.1.1.1", family: 4 }, { address: "10.0.0.7", family: 4 }],
      request: async () => { requestCalls += 1; return createRawResponse(); }
    }
  });
  await assert.rejects(transport.open({ url: civitaiUrl() }),
    (error: unknown) => (error as { code?: string }).code === "DNS_ADDRESS_REJECTED");
  assert.equal(requestCalls, 0);
});

test("HTTPS request pins DNS result and enforces SNI, certificate verification, peer match, and no connection reuse", async () => {
  const { CivitaiPinnedHttpsDownloadTransport } = await loadApi();
  let seen: RequestOptions | undefined;
  let cancelled = 0;
  const transport = new CivitaiPinnedHttpsDownloadTransport({
    approvedOrigins: ["https://civitai.com"],
    ports: {
      dnsLookup: async () => [{ address: "1.1.1.1", family: 4 }, { address: "2606:4700:4700::1111", family: 6 }],
      request: async (options) => { seen = options; return createRawResponse({ onCancel: () => { cancelled += 1; } }); }
    }
  });
  const response = await transport.open({ url: civitaiUrl() });
  assert.ok(seen);
  assert.equal(seen.hostname, "civitai.com");
  assert.equal(seen.port, 443);
  assert.equal(seen.method, "GET");
  assert.equal(seen.servername, "civitai.com");
  assert.equal(seen.rejectUnauthorized, true);
  assert.equal(seen.agent, false);
  assert.equal(seen.highWaterMark, 16_384);
  assert.equal(Object.hasOwn(seen, "proxyEnv"), false);
  assert.equal(seen.headers.cookie, undefined);
  assert.equal(seen.headers.authorization, undefined);
  const pinned = await new Promise<string>((resolve, reject) => {
    seen!.lookup("civitai.com", {}, (error, address) => error ? reject(error) : resolve(address as string));
  });
  assert.equal(pinned, "1.1.1.1");
  assert.equal(response.status, 200);
  const chunks: number[] = [];
  for await (const chunk of response.body) chunks.push(...chunk);
  assert.deepEqual(chunks, [1, 2, 3]);
  await response.cancel();
  assert.equal(cancelled, 1);
});

test("manual redirect response is returned without an automatic follow or retry", async () => {
  const { CivitaiPinnedHttpsDownloadTransport } = await loadApi();
  let requestCalls = 0;
  let cancelled = 0;
  const transport = new CivitaiPinnedHttpsDownloadTransport({
    approvedOrigins: ["https://civitai.com", "https://files.example.test"],
    ports: {
      dnsLookup: async () => [{ address: "1.1.1.1", family: 4 }],
      request: async () => {
        requestCalls += 1;
        return createRawResponse({ statusCode: 302,
          headers: { location: "https://files.example.test/model?signature=synthetic" },
          onCancel: () => { cancelled += 1; } });
      }
    }
  });
  const response = await transport.open({ url: civitaiUrl() });
  assert.equal(response.status, 302);
  assert.equal(response.headers.location, "https://files.example.test/model?signature=synthetic");
  assert.equal(requestCalls, 1);
  await response.cancel();
  assert.equal(cancelled, 1);
});

test("Civitai authorization is added only on the fixed first-party origin, never an approved storage origin", async () => {
  const { CivitaiPinnedHttpsDownloadTransport } = await loadApi();
  const sentHeaders: Array<Readonly<Record<string, string>>> = [];
  let credentialCalls = 0;
  const transport = new CivitaiPinnedHttpsDownloadTransport({
    approvedOrigins: ["https://civitai.com", "https://files.example.test"],
    civitaiAuthorizationProvider: () => { credentialCalls += 1; return "synthetic-bearer"; },
    ports: {
      dnsLookup: async (hostname) => [{ address: hostname === "civitai.com" ? "1.1.1.1" : "1.0.0.1", family: 4 }],
      request: async (options) => { sentHeaders.push(options.headers); return createRawResponse({ remoteAddress: options.hostname === "civitai.com" ? "1.1.1.1" : "1.0.0.1" }); }
    }
  });
  const first = await transport.open({ url: civitaiUrl() });
  await first.cancel();
  const storage = await transport.open({ url: new URL("https://files.example.test/model?signed=synthetic") });
  await storage.cancel();
  assert.equal(credentialCalls, 1);
  assert.equal(sentHeaders[0]?.authorization, "Bearer synthetic-bearer");
  assert.equal(sentHeaders[1]?.authorization, undefined);
  assert.ok(sentHeaders.every((headers) => headers.cookie === undefined));
});

test("TLS verification failure and remote-address mismatch cancel the response and expose safe codes only", async (t) => {
  const { CivitaiPinnedHttpsDownloadTransport } = await loadApi();
  for (const scenario of [
    { name: "unverified TLS peer", remoteAddress: "1.1.1.1", tlsAuthorized: false, code: "TLS_REJECTED" },
    { name: "DNS pin mismatch", remoteAddress: "1.0.0.1", tlsAuthorized: true, code: "PEER_ADDRESS_MISMATCH" }
  ]) await t.test(scenario.name, async () => {
    let cancelled = 0;
    const transport = new CivitaiPinnedHttpsDownloadTransport({
      approvedOrigins: ["https://civitai.com"],
      ports: {
        dnsLookup: async () => [{ address: "1.1.1.1", family: 4 }],
        request: async () => createRawResponse({ remoteAddress: scenario.remoteAddress,
          tlsAuthorized: scenario.tlsAuthorized, onCancel: () => { cancelled += 1; } })
      }
    });
    await assert.rejects(transport.open({ url: civitaiUrl() }),
      (error: unknown) => (error as { code?: string; message?: string }).code === scenario.code &&
        !(error as { message?: string }).message?.includes("civitai.com"));
    assert.equal(cancelled, 1);
  });
});

test("response header count and bytes are bounded before the body is exposed", async (t) => {
  const { CivitaiPinnedHttpsDownloadTransport } = await loadApi();
  const scenarios = [
    { name: "header count", headers: { a: "1", b: "2", c: "3" }, options: { maxResponseHeaders: 2 }, code: "RESPONSE_HEADERS_REJECTED" },
    { name: "header bytes", headers: { a: "x".repeat(2_048) }, options: { maxResponseHeaderBytes: 1_024 }, code: "RESPONSE_HEADERS_REJECTED" }
  ];
  for (const scenario of scenarios) await t.test(scenario.name, async () => {
    let cancelled = 0;
    const transport = new CivitaiPinnedHttpsDownloadTransport({
      approvedOrigins: ["https://civitai.com"], ...scenario.options,
      ports: {
        dnsLookup: async () => [{ address: "1.1.1.1", family: 4 }],
        request: async () => createRawResponse({ headers: scenario.headers, onCancel: () => { cancelled += 1; } })
      }
    });
    await assert.rejects(transport.open({ url: civitaiUrl() }),
      (error: unknown) => (error as { code?: string }).code === scenario.code);
    assert.equal(cancelled, 1);
  });
});

test("abort during DNS cancels resolution before any HTTPS request", async () => {
  const { CivitaiPinnedHttpsDownloadTransport } = await loadApi();
  const controller = new AbortController();
  let requestCalls = 0;
  let dnsCancelled = false;
  const transport = new CivitaiPinnedHttpsDownloadTransport({
    approvedOrigins: ["https://civitai.com"],
    ports: {
      dnsLookup: async (_hostname, signal) => await new Promise<readonly Address[]>((_resolve, reject) => {
        signal.addEventListener("abort", () => { dnsCancelled = true; reject(new Error("private dns detail")); }, { once: true });
      }),
      request: async () => { requestCalls += 1; return createRawResponse(); }
    }
  });
  const pending = transport.open({ url: civitaiUrl(), signal: controller.signal });
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(pending, (error: unknown) => (error as { code?: string }).code === "REQUEST_ABORTED");
  assert.equal(dnsCancelled, true);
  assert.equal(requestCalls, 0);
});

test("never-resolving DNS is bounded by request deadline and never reaches HTTPS", async () => {
  const { CivitaiPinnedHttpsDownloadTransport } = await loadApi();
  let requestCalls = 0;
  let signalAborted = false;
  const transport = new CivitaiPinnedHttpsDownloadTransport({
    approvedOrigins: ["https://civitai.com"],
    requestTimeoutMs: 10,
    ports: {
      dnsLookup: async (_hostname, signal) => await new Promise<readonly Address[]>((resolve) => {
        signal.addEventListener("abort", () => { signalAborted = true; resolve([]); }, { once: true });
      }),
      request: async () => { requestCalls += 1; return createRawResponse(); }
    }
  });
  await assert.rejects(transport.open({ url: civitaiUrl() }),
    (error: unknown) => (error as { code?: string }).code === "REQUEST_TIMEOUT");
  assert.equal(signalAborted, true);
  assert.equal(requestCalls, 0);
});

test("request deadline aborts a stalled HTTPS handshake without retry", async () => {
  const { CivitaiPinnedHttpsDownloadTransport } = await loadApi();
  let requestCalls = 0;
  let requestSignalAborted = false;
  const transport = new CivitaiPinnedHttpsDownloadTransport({
    approvedOrigins: ["https://civitai.com"], requestTimeoutMs: 10,
    ports: {
      dnsLookup: async () => [{ address: "1.1.1.1", family: 4 }],
      request: async (options) => {
        requestCalls += 1;
        return await new Promise<RawResponse>((_resolve, reject) => {
          options.signal.addEventListener("abort", () => {
            requestSignalAborted = true;
            reject(new Error("private socket detail"));
          }, { once: true });
        });
      }
    }
  });
  await assert.rejects(transport.open({ url: civitaiUrl() }),
    (error: unknown) => (error as { code?: string }).code === "REQUEST_TIMEOUT");
  assert.equal(requestSignalAborted, true);
  assert.equal(requestCalls, 1);
});

test("request deadline and caller abort cancel an opened response body", async (t) => {
  const { CivitaiPinnedHttpsDownloadTransport } = await loadApi();
  for (const mode of ["timeout", "abort"] as const) await t.test(mode, async () => {
    const controller = new AbortController();
    let cancelled = 0;
    const transport = new CivitaiPinnedHttpsDownloadTransport({
      approvedOrigins: ["https://civitai.com"], requestTimeoutMs: mode === "timeout" ? 10 : 1_000,
      ports: {
        dnsLookup: async () => [{ address: "1.1.1.1", family: 4 }],
        request: async () => createRawResponse({
          body: { async *[Symbol.asyncIterator]() { await new Promise<void>(() => undefined); } },
          onCancel: () => { cancelled += 1; }
        })
      }
    });
    const response = await transport.open({ url: civitaiUrl(), ...(mode === "abort" ? { signal: controller.signal } : {}) });
    if (mode === "abort") setTimeout(() => controller.abort(), 5);
    await assert.rejects(async () => { for await (const _chunk of response.body) { /* stalled source */ } },
      (error: unknown) => (error as { code?: string }).code === (mode === "abort" ? "REQUEST_ABORTED" : "REQUEST_TIMEOUT"));
    assert.equal(cancelled, 1);
  });
});
