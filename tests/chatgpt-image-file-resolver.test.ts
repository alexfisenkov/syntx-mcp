import assert from "node:assert/strict";
import test from "node:test";
import {
  ChatgptImageFileResolveError,
  resolveChatgptImageFile,
  type ChatgptImageFileResolverPorts
} from "../src/application/chatgpt-image-file-resolver.js";

const URL = "https://files.oaiusercontent.com/file-test?signature=private";
const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const FILE = { download_url: URL, file_id: "opaque-file-id" };

function ports(options: {
  readonly address?: string;
  readonly status?: number;
  readonly headers?: Record<string, string>;
  readonly bytes?: Uint8Array;
  readonly authorized?: boolean;
  readonly remoteAddress?: string;
  readonly onRequest?: (request: Parameters<NonNullable<ChatgptImageFileResolverPorts["request"]>>[0]) => void;
  readonly onCancel?: () => void;
} = {}): ChatgptImageFileResolverPorts {
  return {
    async dnsLookup(hostname) {
      assert.equal(hostname, "files.oaiusercontent.com");
      return [{ address: options.address ?? "93.184.216.34", family: 4 }];
    },
    async request(request) {
      options.onRequest?.(request);
      return {
        status: options.status ?? 200,
        headers: options.headers ?? { "content-type": "image/png", "content-length": String((options.bytes ?? PNG).byteLength) },
        remoteAddress: options.remoteAddress ?? options.address ?? "93.184.216.34",
        authorized: options.authorized ?? true,
        body: (async function* () { yield options.bytes ?? PNG; })(),
        cancel() { options.onCancel?.(); }
      };
    }
  };
}

test("downloads only a bounded, pinned, exact-origin image and supplies safe default metadata", async () => {
  let requestSeen = false;
  const result = await resolveChatgptImageFile(FILE, 1024, undefined, { ports: ports({ onRequest(request) {
    requestSeen = true;
    assert.equal(request.hostname, "files.oaiusercontent.com");
    assert.equal(request.port, 443);
    const headers = request.headers as Record<string, string>;
    assert.equal("redirect" in request, false);
    assert.equal(headers.authorization, undefined);
    assert.equal(headers.cookie, undefined);
    assert.equal(headers["accept-encoding"], "identity");
  } }) });
  assert.equal(requestSeen, true);
  assert.deepEqual(result.bytes, PNG);
  assert.equal(result.filename, "attachment.png");
  assert.equal(result.mime_type, "image/png");
  result.bytes.fill(0);
});

test("rejects non-allowlisted hosts before DNS and refuses non-public DNS answers", async () => {
  let dnsCalls = 0;
  let requestCalls = 0;
  const blockedPorts: ChatgptImageFileResolverPorts = {
    async dnsLookup() { dnsCalls += 1; return [{ address: "93.184.216.34", family: 4 }]; },
    async request() { requestCalls += 1; throw new Error("unexpected request"); }
  };
  await assert.rejects(() => resolveChatgptImageFile({ ...FILE, download_url: "https://attacker.example/file" }, 1024, undefined,
    { ports: blockedPorts }), (error: unknown) => error instanceof ChatgptImageFileResolveError && error.code === "UNSUPPORTED_HOST");
  assert.equal(dnsCalls, 0);
  await assert.rejects(() => resolveChatgptImageFile(FILE, 1024, undefined, { ports: ports({ address: "127.0.0.1" }) }),
    (error: unknown) => error instanceof ChatgptImageFileResolveError && error.code === "UNSAFE_ADDRESS");
  assert.equal(requestCalls, 0);
});

test("rejects redirects, non-image or mismatched MIME, and over-limit bodies without following or returning them", async () => {
  let cancelled = 0;
  await assert.rejects(() => resolveChatgptImageFile(FILE, 1024, undefined, { ports: ports({ status: 302, onCancel() { cancelled += 1; } }) }),
    (error: unknown) => error instanceof ChatgptImageFileResolveError && error.code === "DOWNLOAD_FAILED");
  assert.equal(cancelled, 1);
  await assert.rejects(() => resolveChatgptImageFile({ ...FILE, mime_type: "image/jpeg" }, 1024, undefined, { ports: ports() }),
    (error: unknown) => error instanceof ChatgptImageFileResolveError && error.code === "INVALID_FILE");
  await assert.rejects(() => resolveChatgptImageFile(FILE, 4, undefined, { ports: ports() }),
    (error: unknown) => error instanceof ChatgptImageFileResolveError && error.code === "LIMIT_EXCEEDED");
});

test("rejects explicit ports, credentials and cancellation before request", async () => {
  let requests = 0;
  const injected: ChatgptImageFileResolverPorts = { ...ports(), async request(options) {
    requests += 1;
    return await ports().request!(options);
  } };
  for (const download_url of ["https://files.oaiusercontent.com:443/file", "https://user@files.oaiusercontent.com/file"]) {
    await assert.rejects(() => resolveChatgptImageFile({ ...FILE, download_url }, 1024, undefined, { ports: injected }),
      (error: unknown) => error instanceof ChatgptImageFileResolveError && error.code === "UNSUPPORTED_HOST");
  }
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => resolveChatgptImageFile(FILE, 1024, controller.signal, { ports: injected }),
    (error: unknown) => error instanceof ChatgptImageFileResolveError && error.code === "REQUEST_ABORTED");
  assert.equal(requests, 0);
});
