import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";

const CHAT = "wan-t2v-native-chat";
const MODEL = "wan_27_t2v" as const;

function makeFixture(options: {
  readonly historyRows?: readonly Record<string, unknown>[];
  readonly resultByMessage?: Readonly<Record<string, unknown>>;
  readonly pageDrift?: boolean;
} = {}) {
  const requests: Array<{ method: string; url: URL }> = [];
  const credentialBroker: SyntxCredentialBroker = {
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      return operation("synthetic-wan-native-credential");
    }
  };
  const rows = options.historyRows ?? [];
  const client = new SyntxChatHttpClient({ credentialBroker, fetchImpl: async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    requests.push({ method, url });
    const historyMatch = /^\/api\/v1\/chats\/([^/]+)\/messages$/u.exec(url.pathname);
    if (historyMatch) {
      assert.equal(historyMatch[1], CHAT);
      const page = Number(url.searchParams.get("page"));
      assert.equal(url.searchParams.get("page_size"), "10");
      const pageRows = rows.slice((page - 1) * 10, page * 10);
      const pages = Math.ceil(rows.length / 10);
      return Response.json({ messages: pageRows, pagination: { page: options.pageDrift && page === 2 ? 1 : page,
        page_size: 10, total_count: rows.length, total_pages: pages, has_next: page < pages, has_previous: page > 1 } });
    }
    const resultMatch = /^\/api\/v1\/chats\/([^/]+)\/([^/]+)$/u.exec(url.pathname);
    if (resultMatch && method === "GET") {
      assert.equal(resultMatch[1], CHAT);
      const result = options.resultByMessage?.[resultMatch[2]!];
      if (result === undefined) throw new Error("unexpected native result GET");
      return Response.json(result);
    }
    throw new Error(`unexpected native request ${method} ${url.pathname}`);
  } });
  return { client, requests };
}

function object(id: string, messageId: string, modelId: string = MODEL) {
  return { id, message_id: messageId, object_type: "video", model_type: modelId };
}

function row(id: string, authorId: number, objects: readonly Record<string, unknown>[] = [], chatId = 421) {
  return { id, chat_id: chatId, author_id: authorId, message_object: objects };
}

test("reads all bounded history pages and all 80 native video objects across three source messages", async () => {
  const videoGroups = [32, 32, 16];
  const rows: Record<string, unknown>[] = [row("owner-ack", 4123)];
  const results: Record<string, unknown> = {};
  const objectIds: string[][] = [];
  let objectIndex = 0;
  for (let groupIndex = 0; groupIndex < videoGroups.length; groupIndex += 1) {
    const messageId = `bot-${groupIndex + 1}`;
    const ids = Array.from({ length: videoGroups[groupIndex]! }, () => `video-object-${++objectIndex}`);
    objectIds.push(ids);
    rows.push(row(messageId, -1, ids.map((id) => object(id, messageId))));
    results[messageId] = { id: messageId, chat_id: 421, author_id: -1, message_object: ids.map((id) => ({
      ...object(id, messageId), completed: true, object_url: `https://r2.syntx.ai/video/${id}.mp4`
    })) };
  }
  for (let index = 0; index < 10; index += 1) rows.push(row(`other-${index}`, 7000 + index));
  const fixture = makeFixture({ historyRows: rows, resultByMessage: results });

  const snapshot = await fixture.client.listWanT2vMessageCandidates(CHAT, "owner-ack");
  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.total_count, 14);
  assert.equal(snapshot.total_pages, 2);
  assert.equal(snapshot.messages.length, 14);
  assert.deepEqual(fixture.requests.filter((request) => request.url.pathname.endsWith("/messages")).map((request) =>
    request.url.searchParams.get("page")), ["1", "2"]);
  assert.equal(snapshot.messages.find((message) => message.message_id === "owner-ack")?.author_role, "owner");
  assert.equal(snapshot.messages.find((message) => message.message_id === "other-0")?.author_role, "other");

  let readyCount = 0;
  for (let index = 0; index < 3; index += 1) {
    const candidate = snapshot.messages.find((message) => message.message_id === `bot-${index + 1}`)!;
    const result = await fixture.client.getWanT2vVideoResultMessage({ chat_uuid: CHAT, message_id: candidate.message_id,
      model_id: MODEL, provider_chat_id: candidate.provider_chat_id,
      message_object_ids: candidate.objects.map((item) => item.message_object_id) });
    assert.equal(result.message_binding, "BOUND");
    assert.equal(result.model_echo, "MATCHED");
    readyCount += result.ready_videos.length;
  }
  assert.equal(objectIds.flat().length, 80);
  assert.equal(readyCount, 80);
  assert.equal(fixture.requests.filter((request) => request.method === "POST").length, 0);
  assert.equal(fixture.requests.filter((request) => request.method === "GET" && !request.url.pathname.endsWith("/messages")).length, 3);
});

test("unknown ACK history remains non-owner and inconsistent source pagination is rejected", async () => {
  const rows = [row("owner-1", 4123), row("bot-1", -1, [object("obj-1", "bot-1")])];
  const fixture = makeFixture({ historyRows: rows });
  const snapshot = await fixture.client.listWanT2vMessageCandidates(CHAT, null);
  assert.equal(snapshot.messages.find((message) => message.message_id === "owner-1")?.author_role, "other");

  const multiPage = makeFixture({ historyRows: Array.from({ length: 11 }, (_, index) => row(`row-${index}`, index ? -1 : 4123)), pageDrift: true });
  await assert.rejects(multiPage.client.listWanT2vMessageCandidates(CHAT, "row-0"), { code: "UPSTREAM_PROTOCOL_ERROR" });
  assert.deepEqual(multiPage.requests.filter((request) => request.url.pathname.endsWith("/messages")).map((request) =>
    request.url.searchParams.get("page")), ["1", "2"]);
});

test("result reads use fixed GET routes and decode provider, model, and author mismatches without claiming results", async () => {
  const context = { chat_uuid: CHAT, message_id: "bot-1", model_id: MODEL, provider_chat_id: "421", message_object_ids: ["obj-1"] };
  for (const raw of [
    { id: "bot-1", chat_id: 422, author_id: -1, message_object: [
      { ...object("obj-1", "bot-1"), completed: true, object_url: "https://r2.syntx.ai/a.mp4" }] },
    { id: "bot-1", chat_id: 421, author_id: -1, message_object: [
      { ...object("obj-1", "bot-1", "wan_26_t2v"), completed: true, object_url: "https://r2.syntx.ai/a.mp4" }] },
    { id: "bot-1", chat_id: 421, author_id: 7100, message_object: [
      { ...object("obj-1", "bot-1"), completed: true, object_url: "https://r2.syntx.ai/a.mp4" }] }
  ]) {
    const fixture = makeFixture({ resultByMessage: { "bot-1": raw } });
    const result = await fixture.client.getWanT2vVideoResultMessage(context);
    assert.equal(result.message_binding, "UNVERIFIED");
    assert.deepEqual(result.ready_videos, []);
    assert.equal(fixture.requests.length, 1);
    assert.equal(fixture.requests[0]?.method, "GET");
    assert.equal(fixture.requests[0]?.url.pathname, `/api/v1/chats/${CHAT}/bot-1`);
  }
});

test("malformed or unknown result contexts and pre-aborted reads do not reach the network", async () => {
  const fixture = makeFixture({ resultByMessage: { "bot-1": {} } });
  await assert.rejects(fixture.client.getWanT2vVideoResultMessage({ chat_uuid: CHAT, message_id: "bot-1", model_id: "wan_unknown",
    provider_chat_id: "421", message_object_ids: ["obj-1"] }), { code: "INVALID_REQUEST" });
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  await assert.rejects(fixture.client.getWanT2vVideoResultMessage(revoked.proxy), { code: "INVALID_REQUEST" });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(fixture.client.getWanT2vVideoResultMessage({ chat_uuid: CHAT, message_id: "bot-1", model_id: MODEL,
    provider_chat_id: "421", message_object_ids: ["obj-1"] }, controller.signal));
  assert.equal(fixture.requests.length, 0);
});
