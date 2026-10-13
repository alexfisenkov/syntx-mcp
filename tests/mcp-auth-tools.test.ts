import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CallToolResult,
  JSONRPCMessage,
  MessageExtraInfo
} from "@modelcontextprotocol/sdk/types.js";
import type {
  Transport,
  TransportSendOptions
} from "@modelcontextprotocol/sdk/shared/transport.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type {
  AuthBinding,
  AuthLinkProvider,
  ProviderCredentialReceiver,
  ProviderPollOutcome
} from "../src/auth/types.js";
import {
  AuthLinkError,
  OBSERVED_AUTHORIZATION_PROFILE
} from "../src/auth/types.js";
import { createDefaultApplication } from "../src/application/factory.js";
import {
  registerSyntxAuthTools,
  SYNTX_AUTH_TOOL_NAMES
} from "../src/mcp/auth-tools.js";
import type { RegisterSyntxAuthToolsOptions } from "../src/mcp/auth-tools.js";
import { createMcpServer, TOOL_NAMES } from "../src/mcp/server.js";
import {
  normalizeOmittedAuthArguments,
  withOmittedAuthArguments
} from "../src/transports/omitted-auth-arguments.js";

const BINDING: AuthBinding = {
  tenant_id: "tenant-mcp-auth",
  subject: "subject-mcp-auth"
};
const OTHER_BINDING: AuthBinding = {
  tenant_id: "tenant-mcp-auth-other",
  subject: "subject-mcp-auth-other"
};
const UPSTREAM_ATTEMPT_ID = "018f2f60-91c4-7c3d-8e52-0f7d0e21b581";
const APPROVAL_URL =
  `https://t.me/syntxaibot?start=auth_${UPSTREAM_ATTEMPT_ID}`;
const TEST_CREDENTIAL = "YOUR_TEST_BEARER_CREDENTIAL_VALUE";

test("auth tools are optional, strictly scoped, and fully annotated", async () => {
  const harness = createAuthHarness([{ state: "PENDING" }]);
  await withClient(harness.server, async (client) => {
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name),
      SYNTX_AUTH_TOOL_NAMES
    );

    const begin = listed.tools[0];
    const check = listed.tools[1];
    const unlink = listed.tools[2];
    assert.deepEqual(begin?.annotations, {
      title: "Begin SYNTX login",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    });
    assert.deepEqual(check?.annotations, {
      title: "Check SYNTX login",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    });
    assert.deepEqual(unlink?.annotations, {
      title: "Unlink SYNTX account",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true
    });
    assert.deepEqual(begin?.inputSchema.properties, {});
    assert.equal(check?.description?.includes("attempt_id"), true);
    assert.equal(unlink?.description?.includes("attempt_id"), true);

    for (const tool of [check, unlink]) {
      const inputSchema = requireRecord(tool?.inputSchema);
      assert.deepEqual(inputSchema.required, ["attempt_id"]);
      assert.equal(inputSchema.additionalProperties, false);
      const properties = requireRecord(inputSchema.properties);
      const attemptId = requireRecord(properties.attempt_id);
      assert.equal(attemptId.type, "string");
      assert.equal(attemptId.pattern, "^link_[A-Za-z0-9_-]{20,120}$");
      assert.equal(
        attemptId.description,
        "Opaque login attempt id returned by syntx_begin_login."
      );
      assert.equal(Object.hasOwn(attemptId, "default"), false);
    }
  });

  await withClient(createMcpServer(createDefaultApplication()), async (client) => {
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name),
      TOOL_NAMES
    );
  });
});

test("successful unlink invokes its optional owner-resource revocation hook once for the exact attempt", async () => {
  const { service } = createAuthHarness([]);
  const created = await service.createAttempt(BINDING);
  await service.issueHandoff(BINDING, created.attempt_id);
  const revoked: string[] = [];
  const server = new McpServer({ name: "auth-revoke-hook-test", version: "1" });
  registerSyntxAuthTools(server, {
    linkService: service,
    binding: BINDING,
    onRevoked: async (attemptId) => { revoked.push(attemptId); }
  });

  await withClient(server, async (client) => {
    const result = requireToolResult(await client.callTool({
      name: "syntx_unlink",
      arguments: { attempt_id: created.attempt_id }
    }));
    assert.equal(result.structuredContent?.status, "REVOKED");
    assert.deepEqual(revoked, [created.attempt_id]);
  });
});

test("transport normalizes only truly omitted arguments for bounded auth tools", () => {
  for (const name of ["syntx_check_login", "syntx_unlink"] as const) {
    const message = toolCallWithoutArguments(name);
    const normalized = normalizeOmittedAuthArguments(message);
    assert.notStrictEqual(normalized, message);
    assert.deepEqual(
      "params" in normalized && normalized.params,
      { name, arguments: {} }
    );
  }

  for (const explicitArguments of [null, [], "", undefined]) {
    const message = toolCallWithArguments(
      "syntx_check_login",
      explicitArguments
    );
    assert.equal(
      Object.hasOwn(
        requireRecord("params" in message ? message.params : undefined),
        "arguments"
      ),
      true
    );
    assert.strictEqual(normalizeOmittedAuthArguments(message), message);
  }

  const otherTool = toolCallWithoutArguments("syntx_get_balance");
  assert.strictEqual(normalizeOmittedAuthArguments(otherTool), otherTool);

  for (const params of [null, [], "not-an-object"] as const) {
    const malformed = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params
    } as unknown as JSONRPCMessage;
    assert.strictEqual(normalizeOmittedAuthArguments(malformed), malformed);
  }
});

test("transport decorator preserves lifecycle, extra, session, send options, and protocol version", async () => {
  const events: string[] = [];
  let sentMessage: JSONRPCMessage | undefined;
  let sentOptions: TransportSendOptions | undefined;
  let protocolVersion: string | undefined;
  let originalMessage: JSONRPCMessage | undefined;
  let decoratedMessage: JSONRPCMessage | undefined;
  let decoratedExtra: MessageExtraInfo | undefined;
  const raw: Transport = {
    sessionId: "session-before",
    onclose: () => events.push("raw-close"),
    onerror: () => events.push("raw-error"),
    onmessage: (message) => {
      originalMessage = message;
      events.push("raw-message");
    },
    async start() {
      events.push("start");
    },
    async send(message, options) {
      sentMessage = message;
      sentOptions = options;
      events.push("send");
    },
    async close() {
      events.push("close");
      raw.onclose?.();
    },
    setProtocolVersion(version) {
      protocolVersion = version;
    }
  };
  const decorated = withOmittedAuthArguments(raw);
  decorated.onclose = () => events.push("decorated-close");
  decorated.onerror = () => events.push("decorated-error");
  decorated.onmessage = (message, extra) => {
    decoratedMessage = message;
    decoratedExtra = extra;
    events.push("decorated-message");
  };

  const incoming = toolCallWithoutArguments("syntx_check_login");
  const extra: MessageExtraInfo = { closeSSEStream: () => undefined };
  raw.onmessage?.(incoming, extra);
  assert.strictEqual(originalMessage, incoming);
  assert.notStrictEqual(decoratedMessage, incoming);
  assert.deepEqual(
    decoratedMessage && "params" in decoratedMessage
      ? decoratedMessage.params
      : undefined,
    { name: "syntx_check_login", arguments: {} }
  );
  assert.strictEqual(decoratedExtra, extra);

  const error = new Error("transport-test");
  raw.onerror?.(error);
  assert.deepEqual(events.slice(-2), ["raw-error", "decorated-error"]);

  await decorated.start();
  const outgoing = {
    jsonrpc: "2.0",
    id: 1,
    result: {}
  } as JSONRPCMessage;
  const sendOptions: TransportSendOptions = {
    relatedRequestId: 1,
    resumptionToken: ["test", "resumption", "token"].join("-")
  };
  await decorated.send(outgoing, sendOptions);
  assert.strictEqual(sentMessage, outgoing);
  assert.strictEqual(sentOptions, sendOptions);
  assert.equal(decorated.sessionId, "session-before");
  raw.sessionId = "session-after";
  assert.equal(decorated.sessionId, "session-after");
  decorated.setProtocolVersion?.("2025-11-25");
  assert.equal(protocolVersion, "2025-11-25");

  await decorated.close();
  assert.deepEqual(events.slice(-3), [
    "close",
    "raw-close",
    "decorated-close"
  ]);
});

test("begin and check complete a fake flow without leaking private material", async () => {
  const harness = createAuthHarness([{ state: "LINKED" }]);
  await withClient(harness.server, async (client) => {
    const begun = requireToolResult(
      await client.callTool({ name: "syntx_begin_login" })
    );
    assert.equal(begun.isError, undefined);
    assert.equal(begun.structuredContent?.status, "HANDOFF_ISSUED");
    assert.equal("approval_url" in (begun.structuredContent ?? {}), false);

    const links = begun.content.filter(
      (item) => item.type === "resource_link"
    );
    assert.equal(links.length, 1);
    assert.equal(links[0]?.type === "resource_link" && links[0].uri, APPROVAL_URL);
    const text = begun.content.find((item) => item.type === "text");
    assert.equal(text?.type === "text" && text.text.includes(APPROVAL_URL), false);
    assert.equal(JSON.stringify(begun.structuredContent).includes(APPROVAL_URL), false);
    assert.equal(countOccurrences(JSON.stringify(begun), UPSTREAM_ATTEMPT_ID), 1);
    assert.equal(JSON.stringify(begun).includes(TEST_CREDENTIAL), false);

    const attemptId = requireAttemptId(begun);
    const checked = requireToolResult(
      await client.callTool({
        name: "syntx_check_login",
        arguments: { attempt_id: attemptId }
      })
    );
    assert.equal(checked.isError, undefined);
    assert.equal(checked.structuredContent?.status, "LINKED");
    assert.equal(checked.structuredContent?.linked, true);
    assert.equal(harness.provider.pollCalls, 1);
    assert.equal(
      checked.content.some((item) => item.type === "resource_link"),
      false
    );
    assert.equal(JSON.stringify(checked).includes(APPROVAL_URL), false);
    assert.equal(JSON.stringify(checked).includes(UPSTREAM_ATTEMPT_ID), false);
    assert.equal(JSON.stringify(checked).includes(TEST_CREDENTIAL), false);

    const credentialStored = await harness.service.useCredential(
      BINDING,
      attemptId,
      (credential) => credential.value === TEST_CREDENTIAL
    );
    assert.equal(credentialStored, true);
  });
});

test("each check tool call performs exactly one pending poll and returns no URL", async () => {
  const harness = createAuthHarness([
    { state: "PENDING" },
    { state: "PENDING" }
  ]);
  await withClient(harness.server, async (client) => {
    const begun = requireToolResult(
      await client.callTool({ name: "syntx_begin_login", arguments: {} })
    );
    const attemptId = requireAttemptId(begun);

    const first = requireToolResult(
      await client.callTool({
        name: "syntx_check_login",
        arguments: { attempt_id: attemptId }
      })
    );
    assert.equal(first.structuredContent?.status, "POLLING");
    assert.equal(harness.provider.pollCalls, 1);
    assert.equal(JSON.stringify(first).includes(APPROVAL_URL), false);

    const second = requireToolResult(
      await client.callTool({
        name: "syntx_check_login",
        arguments: { attempt_id: attemptId }
      })
    );
    assert.equal(second.structuredContent?.status, "POLLING");
    assert.equal(harness.provider.pollCalls, 2);
    assert.equal(JSON.stringify(second).includes(APPROVAL_URL), false);
  });
});

test("attempt lookup and internal failures return only allowlisted errors", async () => {
  const harness = createAuthHarness([{ state: "PENDING" }]);
  await withClient(harness.server, async (client) => {
    const missing = requireToolResult(
      await client.callTool({
        name: "syntx_check_login",
        arguments: { attempt_id: "link_unknown_attempt_00000001" }
      })
    );
    assert.equal(missing.isError, true);
    assert.deepEqual(parseTextPayload(missing), {
      error: {
        code: "AUTH_LINK_NOT_FOUND",
        message:
          "The login attempt is not available for the authenticated MCP principal."
      }
    });
    assert.equal(harness.provider.pollCalls, 0);

    const injectedBinding = requireToolResult(
      await client.callTool({
        name: "syntx_begin_login",
        arguments: {
          tenant_id: "attacker-tenant",
          subject: "attacker-subject"
        }
      })
    );
    assert.equal(injectedBinding.isError, true);
    assert.deepEqual(parseTextPayload(injectedBinding), {
      error: {
        code: "INVALID_TOOL_INPUT",
        message: "Tool input does not match the declared login schema."
      }
    });
    assert.equal(JSON.stringify(injectedBinding).includes("attacker-tenant"), false);
    assert.equal(JSON.stringify(injectedBinding).includes("attacker-subject"), false);
    assert.equal(harness.provider.createCalls, 0);

    const invalidAttempt = requireToolResult(
      await client.callTool({
        name: "syntx_check_login",
        arguments: { attempt_id: "not-an-attempt" }
      })
    );
    assert.equal(invalidAttempt.isError, true);
    assert.deepEqual(parseTextPayload(invalidAttempt), {
      error: {
        code: "INVALID_TOOL_INPUT",
        message: "Tool input does not match the declared login schema."
      }
    });

    for (const name of ["syntx_check_login", "syntx_unlink"] as const) {
      const omittedArguments = requireToolResult(
        await client.callTool({ name })
      );
      assert.equal(omittedArguments.isError, true);
      assert.deepEqual(parseTextPayload(omittedArguments), {
        error: {
          code: "INVALID_TOOL_INPUT",
          message: "Tool input does not match the declared login schema."
        }
      });
      assert.equal(JSON.stringify(omittedArguments).includes("Input validation error"), false);
    }
  });

  const privateDetails = "private provider details must not escape";
  const failingService: RegisterSyntxAuthToolsOptions["linkService"] = {
    async createAttempt() {
      throw new Error(privateDetails);
    },
    async issueHandoff() {
      throw new Error(privateDetails);
    },
    async checkAttempt() {
      throw new Error(privateDetails);
    },
    async revoke() {
      throw new Error(privateDetails);
    }
  };
  const server = new McpServer({ name: "auth-error-test", version: "1.0.0" });
  registerSyntxAuthTools(server, { linkService: failingService, binding: BINDING });
  await withClient(server, async (client) => {
    const result = requireToolResult(
      await client.callTool({ name: "syntx_begin_login", arguments: {} })
    );
    assert.equal(result.isError, true);
    assert.deepEqual(parseTextPayload(result), {
      error: {
        code: "INTERNAL_ERROR",
        message: "The login operation failed without exposing internal details."
      }
    });
    assert.equal(JSON.stringify(result).includes(privateDetails), false);
  });
});

test("a known attempt cannot cross the injected server-side binding", async () => {
  const harness = createAuthHarness([{ state: "PENDING" }]);
  let attemptId = "";
  await withClient(harness.server, async (client) => {
    const begun = requireToolResult(
      await client.callTool({ name: "syntx_begin_login" })
    );
    attemptId = requireAttemptId(begun);
  });

  const otherServer = new McpServer({
    name: "auth-other-binding-test",
    version: "1.0.0"
  });
  registerSyntxAuthTools(otherServer, {
    linkService: harness.service,
    binding: OTHER_BINDING
  });
  await withClient(otherServer, async (client) => {
    for (const name of ["syntx_check_login", "syntx_unlink"] as const) {
      const result = requireToolResult(
        await client.callTool({ name, arguments: { attempt_id: attemptId } })
      );
      assert.equal(result.isError, true);
      assert.deepEqual(parseTextPayload(result), {
        error: {
          code: "AUTH_LINK_NOT_FOUND",
          message:
            "The login attempt is not available for the authenticated MCP principal."
        }
      });
      assert.equal(JSON.stringify(result).includes(APPROVAL_URL), false);
      assert.equal(JSON.stringify(result).includes(UPSTREAM_ATTEMPT_ID), false);
      assert.equal(JSON.stringify(result).includes(TEST_CREDENTIAL), false);
    }
  });

  assert.equal(harness.provider.pollCalls, 0);
  assert.equal(
    (await harness.service.getStatus(BINDING, attemptId)).status,
    "HANDOFF_ISSUED"
  );
});

test("begin rejects an unsafe approval link supplied by a substitute service", async () => {
  const unsafeUrl = "https://example.invalid/approve?private=details";
  const harness = createAuthHarness([], unsafeUrl);
  await withClient(harness.server, async (client) => {
    const result = requireToolResult(
      await client.callTool({ name: "syntx_begin_login", arguments: {} })
    );
    assert.equal(result.isError, true);
    assert.deepEqual(parseTextPayload(result), {
      error: {
        code: "INVALID_APPROVAL_URL",
        message:
          "The login provider did not return an approved Telegram handoff."
      }
    });
    assert.equal(
      result.content.some((item) => item.type === "resource_link"),
      false
    );
    assert.equal(JSON.stringify(result).includes(unsafeUrl), false);
  });
});

test("unlink is replay-safe, local, and removes the linked credential", async () => {
  const harness = createAuthHarness([{ state: "LINKED" }]);
  await withClient(harness.server, async (client) => {
    const begun = requireToolResult(
      await client.callTool({ name: "syntx_begin_login", arguments: {} })
    );
    const attemptId = requireAttemptId(begun);
    await client.callTool({
      name: "syntx_check_login",
      arguments: { attempt_id: attemptId }
    });

    for (let call = 0; call < 2; call += 1) {
      const unlinked = requireToolResult(
        await client.callTool({
          name: "syntx_unlink",
          arguments: { attempt_id: attemptId }
        })
      );
      assert.equal(unlinked.isError, undefined);
      assert.equal(unlinked.structuredContent?.status, "REVOKED");
      assert.equal(unlinked.structuredContent?.linked, false);
      assert.equal(
        unlinked.content.some((item) => item.type === "resource_link"),
        false
      );
      assert.equal(JSON.stringify(unlinked).includes(APPROVAL_URL), false);
      assert.equal(JSON.stringify(unlinked).includes(TEST_CREDENTIAL), false);
    }

    await assert.rejects(
      harness.service.useCredential(BINDING, attemptId, () => true),
      (error: unknown) =>
        error instanceof AuthLinkError &&
        error.code === "AUTH_CREDENTIAL_UNAVAILABLE"
    );
    assert.equal(harness.provider.pollCalls, 1);
  });
});

class FakeAuthProvider implements AuthLinkProvider {
  readonly authorizationProfile = OBSERVED_AUTHORIZATION_PROFILE;
  createCalls = 0;
  pollCalls = 0;
  readonly #outcomes: ProviderPollOutcome[];
  readonly #approvalUrl: string;

  constructor(outcomes: ProviderPollOutcome[], approvalUrl = APPROVAL_URL) {
    this.#outcomes = [...outcomes];
    this.#approvalUrl = approvalUrl;
  }

  async createChallenge(signal?: AbortSignal) {
    signal?.throwIfAborted();
    this.createCalls += 1;
    return {
      upstream_attempt_id: UPSTREAM_ATTEMPT_ID,
      approval_url: this.#approvalUrl
    };
  }

  async pollChallenge(
    upstreamAttemptId: string,
    receiveCredential: ProviderCredentialReceiver,
    signal?: AbortSignal
  ): Promise<ProviderPollOutcome> {
    signal?.throwIfAborted();
    assert.equal(upstreamAttemptId, UPSTREAM_ATTEMPT_ID);
    this.pollCalls += 1;
    const outcome = this.#outcomes.shift() ?? { state: "PENDING" };
    if (outcome.state === "LINKED") {
      await receiveCredential({ scheme: "Bearer", value: TEST_CREDENTIAL });
    }
    return outcome;
  }
}

function createAuthHarness(
  outcomes: ProviderPollOutcome[],
  approvalUrl = APPROVAL_URL
) {
  const provider = new FakeAuthProvider(outcomes, approvalUrl);
  const now = () => Date.parse("2026-09-02T12:00:00.000Z");
  let sequence = 0;
  const store = new InMemoryAuthLinkStore(now);
  const service = new PerUserLinkService(provider, store, {
    now,
    attemptIdGenerator: () => {
      sequence += 1;
      return `link_mcp_test_attempt_${String(sequence).padStart(8, "0")}`;
    }
  });
  const server = new McpServer({ name: "auth-tool-test", version: "1.0.0" });
  registerSyntxAuthTools(server, { linkService: service, binding: BINDING });
  return { provider, server, service };
}

async function withClient(
  server: McpServer,
  callback: (client: Client) => Promise<void>
): Promise<void> {
  const client = new Client({ name: "auth-tool-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(withOmittedAuthArguments(serverTransport));
  await client.connect(clientTransport);
  try {
    await callback(client);
  } finally {
    await client.close();
    await server.close();
  }
}

function requireToolResult(result: unknown): CallToolResult {
  assert.ok(result && typeof result === "object" && "content" in result);
  return result as CallToolResult;
}

function requireAttemptId(result: CallToolResult): string {
  const attemptId = result.structuredContent?.attempt_id;
  assert.ok(typeof attemptId === "string");
  return attemptId;
}

function parseTextPayload(result: CallToolResult): unknown {
  const text = result.content.find((item) => item.type === "text");
  assert.equal(text?.type, "text");
  return JSON.parse(text.text) as unknown;
}

function countOccurrences(value: string, fragment: string): number {
  return value.split(fragment).length - 1;
}

function requireRecord(value: unknown): Record<string, unknown> {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function toolCallWithoutArguments(name: string): JSONRPCMessage {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name }
  } as JSONRPCMessage;
}

function toolCallWithArguments(
  name: string,
  value: unknown
): JSONRPCMessage {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: value }
  } as unknown as JSONRPCMessage;
}
