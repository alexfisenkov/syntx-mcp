import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  RuntimeSourceVerificationError,
  verifyRuntimeSourceArtifacts
} from "../src/catalog/runtime-source-verifier.js";
import {
  loadRuntimeCapabilityOverlay,
  type RuntimeCapabilityOverlay
} from "../src/catalog/runtime-capability-catalog.js";

test("verifies every exact artifact without returning source bodies", async () => {
  const { overlay, bodies } = fixtureOverlay(2);
  const seen: string[] = [];
  const result = await verifyRuntimeSourceArtifacts(overlay, {
    fetchImpl: async (input, init) => {
      const url = String(input);
      seen.push(url);
      assert.equal(init?.method, "GET");
      assert.equal(init?.redirect, "manual");
      assert.equal(init?.credentials, "omit");
      return scriptResponse(url, bodies.get(url)!);
    }
  });

  assert.deepEqual(result, { verified_count: 2, manifest_matches: true });
  assert.deepEqual(seen, overlay.source_artifacts.map((item) => item.url));
  assert.equal(JSON.stringify(result).includes("observed"), false);
});

test("rejects hash drift, redirects, wrong media, and oversized bodies", async () => {
  const { overlay, bodies } = fixtureOverlay(1);
  const exactUrl = overlay.source_artifacts[0]!.url;
  const exactBody = bodies.get(exactUrl)!;
  const cases: Array<{
    expected: RuntimeSourceVerificationError["code"];
    response: () => Response;
    maxArtifactBytes?: number;
  }> = [
    {
      expected: "SOURCE_HASH_MISMATCH",
      response: () => scriptResponse(exactUrl, new TextEncoder().encode("changed"))
    },
    {
      expected: "SOURCE_REDIRECTED",
      response: () =>
        responseWithUrl(
          new Response(null, {
            status: 302,
            headers: { location: "/assets/1788368942/elsewhere.js" }
          }),
          exactUrl
        )
    },
    {
      expected: "SOURCE_MEDIA_TYPE_INVALID",
      response: () =>
        responseWithUrl(
          new Response(Buffer.from(exactBody), {
            status: 200,
            headers: { "content-type": "text/html" }
          }),
          exactUrl
        )
    },
    {
      expected: "SOURCE_TOO_LARGE",
      response: () => scriptResponse(exactUrl, new Uint8Array(2_000)),
      maxArtifactBytes: 1_024
    }
  ];

  for (const item of cases) {
    await assert.rejects(
      verifyRuntimeSourceArtifacts(overlay, {
        fetchImpl: async () => item.response(),
        ...(item.maxArtifactBytes === undefined
          ? {}
          : { maxArtifactBytes: item.maxArtifactBytes })
      }),
      (error: unknown) =>
        error instanceof RuntimeSourceVerificationError &&
        error.code === item.expected &&
        !error.message.includes("changed")
    );
  }
});

test("normalizes network failures without exposing their messages", async () => {
  const privateMessage = "private-cookie-or-upstream-body";
  const { overlay } = fixtureOverlay(1);
  await assert.rejects(
    verifyRuntimeSourceArtifacts(overlay, {
      fetchImpl: async () => {
        throw new Error(privateMessage);
      }
    }),
    (error: unknown) =>
      error instanceof RuntimeSourceVerificationError &&
      error.code === "SOURCE_FETCH_FAILED" &&
      !error.message.includes(privateMessage)
  );
});

test("enforces its own deadline when injected fetch or stream ignores signal", async () => {
  const { overlay } = fixtureOverlay(1);
  await assert.rejects(
    verifyRuntimeSourceArtifacts(overlay, {
      fetchImpl: () => new Promise<Response>(() => undefined),
      requestTimeoutMs: 5
    }),
    hasVerificationCode("SOURCE_FETCH_FAILED")
  );

  let streamCanceled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull: () => new Promise<void>(() => undefined),
    cancel: () => {
      streamCanceled = true;
    }
  });
  await assert.rejects(
    verifyRuntimeSourceArtifacts(overlay, {
      fetchImpl: async (input) =>
        responseWithUrl(
          new Response(stream, {
            status: 200,
            headers: { "content-type": "application/javascript" }
          }),
          String(input)
        ),
      requestTimeoutMs: 5
    }),
    hasVerificationCode("SOURCE_FETCH_FAILED")
  );
  assert.equal(streamCanceled, true);
});

test("cancels response bodies on early media and declared-size rejection", async () => {
  const { overlay } = fixtureOverlay(1);
  const exactUrl = overlay.source_artifacts[0]!.url;
  for (const failure of [
    {
      code: "SOURCE_MEDIA_TYPE_INVALID" as const,
      headers: { "content-type": "text/html" }
    },
    {
      code: "SOURCE_TOO_LARGE" as const,
      headers: {
        "content-type": "application/javascript",
        "content-length": "2000"
      }
    }
  ]) {
    let canceled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
      cancel() {
        canceled = true;
      }
    });
    await assert.rejects(
      verifyRuntimeSourceArtifacts(overlay, {
        fetchImpl: async () =>
          responseWithUrl(
            new Response(stream, { status: 200, headers: failure.headers }),
            exactUrl
          ),
        maxArtifactBytes: 1_024
      }),
      hasVerificationCode(failure.code)
    );
    assert.equal(canceled, true);
  }
});

function fixtureOverlay(count: number): {
  overlay: RuntimeCapabilityOverlay;
  bodies: Map<string, Uint8Array>;
} {
  const overlay = structuredClone(loadRuntimeCapabilityOverlay());
  const bodies = new Map<string, Uint8Array>();
  overlay.source_artifacts = Array.from({ length: count }, (_, index) => {
    const url = `https://syntx.ai/assets/1788368942/test-${index}.js`;
    const body = new TextEncoder().encode(
      `export const observed_${index} = true;\n`
    );
    bodies.set(url, body);
    return {
      url,
      sha256: `sha256:${createHash("sha256").update(body).digest("hex")}`
    };
  });
  overlay.entries = [];
  return { overlay, bodies };
}

function scriptResponse(url: string, body: Uint8Array): Response {
  return responseWithUrl(
    new Response(Buffer.from(body), {
      status: 200,
      headers: {
        "content-type": "application/javascript",
        "content-length": String(body.byteLength)
      }
    }),
    url
  );
}

function responseWithUrl(response: Response, url: string): Response {
  Object.defineProperty(response, "url", { value: url });
  return response;
}

function hasVerificationCode(
  code: RuntimeSourceVerificationError["code"]
): (error: unknown) => boolean {
  return (error: unknown) =>
    error instanceof RuntimeSourceVerificationError && error.code === code;
}
