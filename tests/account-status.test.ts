import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { SyntxHttpClient } from "../src/adapter/syntx/http-client.js";
import { LinkedAttemptCredentialBroker } from "../src/adapter/syntx/link-credential-broker.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { OBSERVED_AUTHORIZATION_PROFILE, type AuthBinding, type AuthLinkProvider } from "../src/auth/types.js";
import { registerSyntxAccountStatusTool, SYNTX_ACCOUNT_STATUS_TOOL_NAME } from "../src/mcp/account-status-tool.js";

const SECRET = ["account", "synthetic", "credential", "not", "real"].join("-");
const OWNER: AuthBinding = { tenant_id: "account-tenant", subject: "account-owner" };
const NOW = Date.parse("2026-09-04T12:00:00.000Z");

async function fixture(fetchImpl?: typeof fetch) {
  let sequence = 0;
  let fetches = 0;
  const provider: AuthLinkProvider = {
    authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() {
      return {
        upstream_attempt_id: "018f2f60-91c4-7c3d-8e52-0f7d0e21b581",
        approval_url: "tg://resolve?domain=syntxaibot&start=auth_018f2f60-91c4-7c3d-8e52-0f7d0e21b581"
      };
    },
    async pollChallenge(_id, receive) {
      await receive({ scheme: "Bearer", value: SECRET });
      return { state: "LINKED" };
    }
  };
  const linkService = new PerUserLinkService(provider, new InMemoryAuthLinkStore(() => NOW), {
    now: () => NOW,
    attemptIdGenerator: () => `link_account_attempt_${String(++sequence).padStart(10, "0")}`
  });
  const link = async (binding: AuthBinding) => {
    const attempt = await linkService.createAttempt(binding);
    await linkService.issueHandoff(binding, attempt.attempt_id);
    await linkService.checkAttempt(binding, attempt.attempt_id);
    return attempt.attempt_id;
  };
  const attemptId = await link(OWNER);
  const server = new McpServer({ name: "account-status-test", version: "1" });
  registerSyntxAccountStatusTool(server, {
    now: () => NOW,
    resolveClient: (id) => new SyntxHttpClient({
      credentialBroker: new LinkedAttemptCredentialBroker(linkService, OWNER, id),
      fetchImpl: async (input, init) => {
        fetches += 1;
        assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${SECRET}`);
        return fetchImpl ? fetchImpl(input, init) : json(String(input).includes("balance")
          ? { balance: "0.000", ignored_identity: SECRET }
          : { active: false, type: "basic", end_date: "2026-09-04", ignored_payment: SECRET });
      }
    })
  });
  return { server, linkService, attemptId, link, fetches: () => fetches };
}

test("account-status MCP returns tight schema and explicit source evidence", async () => {
  const value = await fixture();
  await withClient(value.server, async (client) => {
    const tools = await client.listTools();
    const tool = tools.tools[0]!;
    assert.equal(tool.name, SYNTX_ACCOUNT_STATUS_TOOL_NAME);
    assert.equal(tool.annotations?.readOnlyHint, true);
    assert.equal(tool.annotations?.destructiveHint, false);
    assert.deepEqual(tool.inputSchema.required, ["link_attempt_id"]);
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(tool.outputSchema?.additionalProperties, false);
    const result = await call(client, value.attemptId);
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent, {
      balance: { unit: "tokens", available: "0.000" },
      subscription: { active: false, plan_type: "basic", end_date: "2026-09-04", end_date_kind: "DATE_ONLY" },
      contract_evidence: "PUBLIC_FRONTEND_OBSERVED",
      source_build: "1789134564",
      observed_at: "2026-09-04T12:00:00.000Z"
    });
    assert.equal(JSON.stringify(result).includes(SECRET), false);
    assert.equal(JSON.stringify(result).includes(value.attemptId), false);
    assert.equal(value.fetches(), 2);
  });
});

test("account-status denies foreign tenant/subject, unknown attempt and revoke without network", async () => {
  const value = await fixture();
  const foreignTenant = await value.link({ ...OWNER, tenant_id: "other-tenant" });
  const foreignSubject = await value.link({ ...OWNER, subject: "other-subject" });
  await value.linkService.revoke(OWNER, value.attemptId);
  await withClient(value.server, async (client) => {
    for (const id of [foreignTenant, foreignSubject, "link_unknown_attempt_0000000000", value.attemptId]) {
      const result = await call(client, id);
      assert.equal(result.isError, true);
      assert.match(JSON.stringify(result), /AUTH_REQUIRED/u);
      assert.equal(JSON.stringify(result).includes(SECRET), false);
      assert.equal(result.structuredContent, undefined);
    }
    assert.equal(value.fetches(), 0);
  });
});

test("account-status validates input before client creation and never accepts identity fields", async () => {
  let resolved = 0;
  const server = new McpServer({ name: "account-input-test", version: "1" });
  registerSyntxAccountStatusTool(server, {
    resolveClient: () => { resolved += 1; throw new Error(SECRET); }
  });
  await withClient(server, async (client) => {
    for (const args of [
      {}, { link_attempt_id: "bad" },
      { link_attempt_id: "link_account_attempt_0000000001", tenant_id: "injected" },
      { link_attempt_id: "link_account_attempt_0000000001", subject: "injected" }
    ]) {
      const result = await client.callTool({ name: SYNTX_ACCOUNT_STATUS_TOOL_NAME, arguments: args });
      assert.equal(result.isError, true);
    }
    assert.equal(resolved, 0);
    const result = await call(client, "link_account_attempt_0000000001");
    assert.equal(result.isError, true);
    assert.equal(JSON.stringify(result).includes(SECRET), false);
    assert.match(JSON.stringify(result), /INTERNAL_ERROR/u);
  });
});

test("account-status is all-or-nothing and rechecks revoke before second read", async () => {
  let value: Awaited<ReturnType<typeof fixture>>;
  value = await fixture(async () => {
    await value.linkService.revoke(OWNER, value.attemptId);
    return json({ balance: "250.5" });
  });
  await withClient(value.server, async (client) => {
    const result = await call(client, value.attemptId);
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent, undefined);
    assert.equal(JSON.stringify(result).includes("250.5"), false);
    assert.equal(value.fetches(), 1);
  });
});

test("account-status does not publish partial balance after unsupported subscription", async () => {
  const value = await fixture(async (input) => json(String(input).includes("balance")
    ? { balance: "250.5" }
    : { active: "true", private_error: SECRET }));
  await withClient(value.server, async (client) => {
    const result = await call(client, value.attemptId);
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent, undefined);
    assert.match(JSON.stringify(result), /UPSTREAM_PROTOCOL_ERROR/u);
    assert.equal(JSON.stringify(result).includes("250.5"), false);
    assert.equal(JSON.stringify(result).includes(SECRET), false);
    assert.equal(value.fetches(), 2);
  });
});

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
}

async function call(client: Client, attemptId: string): Promise<CallToolResult> {
  return await client.callTool({ name: SYNTX_ACCOUNT_STATUS_TOOL_NAME, arguments: { link_attempt_id: attemptId } }) as CallToolResult;
}

async function withClient(server: McpServer, work: (client: Client) => Promise<void>) {
  const client = new Client({ name: "account-client-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try { await work(client); } finally { await client.close(); await server.close(); }
}
