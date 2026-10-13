import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createDefaultApplication } from "../src/application/factory.js";
import type { OwnerImageChatClient } from "../src/application/owner-generate-image.js";
import { createMcpServer } from "../src/mcp/server.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { OwnerImageRecoveryStore } from "../src/application/owner-image-recovery.js";
import {
  SYNTX_OWNER_GENERATE_IMAGE_TOOL_NAME,
  SYNTX_OWNER_LIST_IMAGE_RECOVERY_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_IMAGE_TOOL_NAME
} from "../src/mcp/owner-generate-image-tool.js";

const LINK_ATTEMPT_ID = "link_owner_generate_test_attempt01";

async function instant(): Promise<void> {
  // Skips the real wall-clock delay between polls in this test only.
}

function textOf(result: CallToolResult): string {
  const block = result.content.find((item) => item.type === "text");
  assert.ok(block, "expected a text MCP result");
  return block.text;
}

function fakeChatClient(
  finalUrl: string,
  onStart?: (request: Parameters<OwnerImageChatClient["startImage"]>[0]) => void,
  mimeType = "image/png"
): OwnerImageChatClient {
  let chatCounter = 0;
  return {
    async createChat(_scope, _title) {
      chatCounter += 1;
      return { chat_uuid: `chat-tool-test-${chatCounter}` };
    },
    async deleteChat(chatUuid) {
      return { chat_uuid: chatUuid, accepted: true };
    },
    async startImage(request) {
      onStart?.(structuredClone(request));
      return { chat_uuid: request.chat_uuid, message_id: "echo-1" };
    },
    async listInProgress() {
      return [{ message_id: "bot-1", message_object_id: "obj-1", object_type: "image", model_type: "banana" }];
    },
    async getMessage(chatUuid) {
      return {
        chat_uuid: chatUuid,
        message_id: "bot-1",
        artifacts: [{ url: finalUrl, mime_type: mimeType }]
      };
    }
  };
}

test("owner generate-image dispatches only the observed banana-2.1 settings tuple", async () => {
  let starts = 0;
  let captured: Parameters<OwnerImageChatClient["startImage"]>[0] | undefined;
  const server = createMcpServer(createDefaultApplication(), {
    ownerGenerateImage: {
      resolveChatClient: () => fakeChatClient("https://r2.syntx.ai/generated/banana-21-test.jpg", (request) => {
        starts += 1;
        captured = request;
      }, "image/jpeg"),
      wait: instant
    }
  });
  const client = new Client({ name: "owner-banana-21-profile-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = requireResult(await client.callTool({
      name: SYNTX_OWNER_GENERATE_IMAGE_TOOL_NAME,
      arguments: {
        link_attempt_id: LINK_ATTEMPT_ID,
        model_id: "banana-2.1",
        prompt: "a small wooden lighthouse"
      }
    }));
    assert.equal(result.isError, undefined);
    assert.equal(starts, 1);
    assert.equal(captured?.ai_name, "banana");
    assert.deepEqual(captured?.settings, {
      n: 1,
      model_type: "banana-2.1",
      aspect_ratio: "1:1",
      image_size: "1K",
      thinking_level: "minimal",
      file_urls: []
    });
    assert.deepEqual(result.structuredContent?.images, [
      { url: "https://r2.syntx.ai/generated/banana-21-test.jpg", mime_type: "image/jpeg" }
    ]);
  } finally {
    await client.close();
    await server.close();
  }
});

test("owner generate-image rejects an unobserved Banana variant before chat creation", async () => {
  let created = 0;
  const server = createMcpServer(createDefaultApplication(), {
    ownerGenerateImage: {
      resolveChatClient: () => ({
        ...fakeChatClient("https://r2.syntx.ai/generated/unused.jpg"),
        async createChat(scope, title, signal) {
          created += 1;
          return fakeChatClient("https://r2.syntx.ai/generated/unused.jpg").createChat(scope, title, signal);
        }
      }),
      wait: instant
    }
  });
  const client = new Client({ name: "owner-banana-unknown-variant-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = await client.callTool({
      name: SYNTX_OWNER_GENERATE_IMAGE_TOOL_NAME,
      arguments: {
        link_attempt_id: LINK_ATTEMPT_ID,
        model_id: "banana-2.2",
        prompt: "a small wooden lighthouse"
      }
    });
    assert.equal(result.isError, true);
    assert.equal(created, 0);
  } finally {
    await client.close();
    await server.close();
  }
});

test("owner generate-image tool is absent unless explicitly wired", async () => {
  const server = createMcpServer(createDefaultApplication());
  const client = new Client({ name: "owner-generate-absent-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const listed = await client.listTools();
    assert.equal(
      listed.tools.some((tool) => tool.name === SYNTX_OWNER_GENERATE_IMAGE_TOOL_NAME),
      false
    );
    assert.equal(listed.tools.some((tool) => tool.name === SYNTX_OWNER_RECONCILE_IMAGE_TOOL_NAME), false);
    assert.equal(listed.tools.some((tool) => tool.name === SYNTX_OWNER_LIST_IMAGE_RECOVERY_TOOL_NAME), false);
  } finally {
    await client.close();
    await server.close();
  }
});

test("post-start malformed HTTP receipt returns one opaque attempt-bound recovery handle without retry", async () => {
  const requests: Array<{ method: string; pathname: string }> = [];
  let generationPosts = 0;
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    requests.push({ method, pathname: url.pathname });
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      return new Response(JSON.stringify({ uuid: "chat-private-http-fixture" }), { headers: { "content-type": "application/json" } });
    }
    if (url.pathname === "/api/v1/design/generate" && method === "POST") {
      generationPosts += 1;
      // The server may already have accepted/billed this POST despite a malformed receipt.
      return new Response(JSON.stringify({ accepted_without_observed_id: true }), { headers: { "content-type": "application/json" } });
    }
    if (url.pathname === "/api/v1/chats/chat-private-http-fixture/inprogress" && method === "GET") {
      return new Response("[]", { headers: { "content-type": "application/json" } });
    }
    throw new Error("unexpected fake HTTP request");
  };
  const chatClient = new SyntxChatHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>) { return operation("fake-only-credential"); } },
    fetchImpl: fakeFetch,
    requestTimeoutMs: 100
  });
  const recoveryStore = new OwnerImageRecoveryStore();
  const server = createMcpServer(createDefaultApplication(), {
    ownerGenerateImage: { resolveChatClient: () => chatClient, recoveryStore, wait: instant }
  });
  const client = new Client({ name: "owner-image-http-unknown-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = requireResult(await client.callTool({
      name: SYNTX_OWNER_GENERATE_IMAGE_TOOL_NAME,
      arguments: { link_attempt_id: LINK_ATTEMPT_ID, model_id: "banana", prompt: "private prompt must not leave this test" }
    }));
    assert.equal(result.isError, true);
    assert.equal(textOf(result).includes("OUTCOME_UNKNOWN"), true);
    assert.equal(textOf(result).includes("chat-private-http-fixture"), false);
    assert.equal(textOf(result).includes("private prompt must not leave this test"), false);
    const errorBody = JSON.parse(textOf(result)) as { error: { recovery_id: string } };
    assert.match(errorBody.error.recovery_id, /^recovery_[0-9a-f-]{36}$/u);

    const listed = requireResult(await client.callTool({
      name: SYNTX_OWNER_LIST_IMAGE_RECOVERY_TOOL_NAME,
      arguments: { link_attempt_id: LINK_ATTEMPT_ID }
    }));
    assert.equal(JSON.stringify(listed).includes("chat-private-http-fixture"), false);
    assert.equal(JSON.stringify(listed).includes("private prompt must not leave this test"), false);
    assert.equal(JSON.stringify(listed).includes(errorBody.error.recovery_id), true);
    const listedRecords = (listed.structuredContent as { recoveries: Record<string, unknown>[] }).recoveries;
    assert.deepEqual(Object.keys(listedRecords[0]!).sort(), ["created_at", "model_id", "recovery_id"]);
    const foreignList = requireResult(await client.callTool({
      name: SYNTX_OWNER_LIST_IMAGE_RECOVERY_TOOL_NAME,
      arguments: { link_attempt_id: "link_foreign_owner_image_test01" }
    }));
    assert.deepEqual((foreignList.structuredContent as { recoveries: unknown[] }).recoveries, []);
    const requestsBeforeForeignReconcile = requests.length;
    const foreignReconcile = requireResult(await client.callTool({
      name: SYNTX_OWNER_RECONCILE_IMAGE_TOOL_NAME,
      arguments: { link_attempt_id: "link_foreign_owner_image_test01", model_id: "banana", recovery_id: errorBody.error.recovery_id }
    }));
    assert.equal(textOf(foreignReconcile).includes("RECOVERY_NOT_FOUND"), true);
    assert.equal(requests.length, requestsBeforeForeignReconcile, "foreign attempts never cause upstream reads");

    const reconciled = requireResult(await client.callTool({
      name: SYNTX_OWNER_RECONCILE_IMAGE_TOOL_NAME,
      arguments: { link_attempt_id: LINK_ATTEMPT_ID, model_id: "banana", recovery_id: errorBody.error.recovery_id }
    }));
    assert.equal(reconciled.isError, true);
    assert.equal(textOf(reconciled).includes(errorBody.error.recovery_id), true);
    assert.equal(generationPosts, 1);
    assert.equal(requests.some((request) => request.method === "DELETE"), false);
    assert.equal(requests.filter((request) => request.method === "POST" && request.pathname === "/api/v1/design/generate").length, 1);
  } finally {
    await client.close();
    await server.close();
  }
});

test("pre-dispatch provider errors never echo private identifiers, prompt, or raw text", async () => {
  const privateDetails = "private-chat-uuid bearer-secret malformed-token";
  const server = createMcpServer(createDefaultApplication(), {
    ownerGenerateImage: {
      resolveChatClient: () => ({
        ...fakeChatClient("https://r2.syntx.ai/generated/unused.png"),
        async createChat() { throw new Error(privateDetails); }
      }),
      wait: instant
    }
  });
  const client = new Client({ name: "owner-image-redaction-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = requireResult(await client.callTool({
      name: SYNTX_OWNER_GENERATE_IMAGE_TOOL_NAME,
      arguments: { link_attempt_id: LINK_ATTEMPT_ID, prompt: "private prompt value" }
    }));
    assert.equal(result.isError, true);
    for (const value of [privateDetails, "private-chat-uuid", "bearer-secret", "private prompt value"]) {
      assert.equal(JSON.stringify(result).includes(value), false);
    }
  } finally {
    await client.close();
    await server.close();
  }
});

test("owner generate-image tool reports an unverified aspect ratio for explicit nano-banana-pro", async () => {
  const server = createMcpServer(createDefaultApplication(), {
    ownerGenerateImage: {
      resolveChatClient: () => fakeChatClient("https://r2.syntx.ai/generated/tool-test.png"),
      wait: instant
    }
  });
  const client = new Client({ name: "owner-generate-present-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const listed = await client.listTools();
    assert.ok(
      listed.tools.some((tool) => tool.name === SYNTX_OWNER_GENERATE_IMAGE_TOOL_NAME)
    );

    const result = requireResult(
      await client.callTool({
        name: SYNTX_OWNER_GENERATE_IMAGE_TOOL_NAME,
        arguments: {
          link_attempt_id: LINK_ATTEMPT_ID,
          model_id: "nano-banana-pro",
          prompt: "a small wooden lighthouse",
          copies: 1,
          aspect_ratio: "9:16"
        }
      })
    );
    assert.equal(result.isError, undefined);
    assert.equal(result.structuredContent?.requested_copies, 1);
    assert.equal(result.structuredContent?.succeeded_copies, 1);
    assert.deepEqual(result.structuredContent?.images, [
      { url: "https://r2.syntx.ai/generated/tool-test.png", mime_type: "image/png" }
    ]);
    assert.deepEqual(result.structuredContent?.notes, [
      "aspect_ratio \"9:16\" is unverified; only \"1:1\" and \"16:9\" have been confirmed live."
    ]);
  } finally {
    await client.close();
    await server.close();
  }
});

test("owner generate-image tool exposes the live-verified gpt-image-1 profile", async () => {
  const server = createMcpServer(createDefaultApplication(), {
    ownerGenerateImage: {
      resolveChatClient: () => fakeChatClient("https://r2.syntx.ai/generated/gpt-image-test.png"),
      wait: instant
    }
  });
  const client = new Client({ name: "owner-gpt-image-profile-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = requireResult(
      await client.callTool({
        name: SYNTX_OWNER_GENERATE_IMAGE_TOOL_NAME,
        arguments: {
          link_attempt_id: LINK_ATTEMPT_ID,
          model_id: "gpt-image-1",
          prompt: "a small wooden lighthouse",
          copies: 1,
          aspect_ratio: "1:1"
        }
      })
    );
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent?.images, [
      { url: "https://r2.syntx.ai/generated/gpt-image-test.png", mime_type: "image/png" }
    ]);
  } finally {
    await client.close();
    await server.close();
  }
});

test("owner generate-image tool exposes the live-verified gpt-image-1.5 profile", async () => {
  const server = createMcpServer(createDefaultApplication(), {
    ownerGenerateImage: {
      resolveChatClient: () => fakeChatClient("https://r2.syntx.ai/generated/gpt-image-15-test.png"),
      wait: instant
    }
  });
  const client = new Client({ name: "owner-gpt-image-15-profile-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = requireResult(
      await client.callTool({
        name: SYNTX_OWNER_GENERATE_IMAGE_TOOL_NAME,
        arguments: {
          link_attempt_id: LINK_ATTEMPT_ID,
          model_id: "gpt-image-1.5",
          prompt: "a small wooden lighthouse",
          copies: 1,
          aspect_ratio: "1:1"
        }
      })
    );
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent?.images, [
      { url: "https://r2.syntx.ai/generated/gpt-image-15-test.png", mime_type: "image/png" }
    ]);
  } finally {
    await client.close();
    await server.close();
  }
});

test("owner generate-image tool forwards only the reviewed Sunburst settings variant", async () => {
  const server = createMcpServer(createDefaultApplication(), {
    ownerGenerateImage: {
      resolveChatClient: () => fakeChatClient("https://r2.syntx.ai/generated/sunburst-2k.png"),
      wait: instant
    }
  });
  const client = new Client({ name: "owner-sunburst-variant-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = requireResult(
      await client.callTool({
        name: SYNTX_OWNER_GENERATE_IMAGE_TOOL_NAME,
        arguments: {
          link_attempt_id: LINK_ATTEMPT_ID,
          model_id: "gpt-image-2.5-sunburst",
          prompt: "a small wooden lighthouse",
          settings_variant: "sunburst-2k-high-16x9"
        }
      })
    );
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent?.images, [
      { url: "https://r2.syntx.ai/generated/sunburst-2k.png", mime_type: "image/png" }
    ]);
  } finally {
    await client.close();
    await server.close();
  }
});

test("owner generate-image tool forwards only the reviewed Sunburst 4K ultra-wide settings variant", async () => {
  const server = createMcpServer(createDefaultApplication(), {
    ownerGenerateImage: {
      resolveChatClient: () => fakeChatClient("https://r2.syntx.ai/generated/sunburst-4k.png"),
      wait: instant
    }
  });
  const client = new Client({ name: "owner-sunburst-4k-variant-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = requireResult(
      await client.callTool({
        name: SYNTX_OWNER_GENERATE_IMAGE_TOOL_NAME,
        arguments: {
          link_attempt_id: LINK_ATTEMPT_ID,
          model_id: "gpt-image-2.5-sunburst",
          prompt: "a small wooden lighthouse",
          settings_variant: "sunburst-4k-max-21x9"
        }
      })
    );
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent?.images, [
      { url: "https://r2.syntx.ai/generated/sunburst-4k.png", mime_type: "image/png" }
    ]);
  } finally {
    await client.close();
    await server.close();
  }
});

test("owner generate-image tool forwards only the reviewed Flare settings variant", async () => {
  const server = createMcpServer(createDefaultApplication(), {
    ownerGenerateImage: {
      resolveChatClient: () => fakeChatClient("https://r2.syntx.ai/generated/flare-2k.png"),
      wait: instant
    }
  });
  const client = new Client({ name: "owner-flare-variant-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = requireResult(
      await client.callTool({
        name: SYNTX_OWNER_GENERATE_IMAGE_TOOL_NAME,
        arguments: {
          link_attempt_id: LINK_ATTEMPT_ID,
          model_id: "gpt-image-2.5-flare",
          prompt: "a small wooden lighthouse",
          settings_variant: "flare-2k-high-16x9",
          aspect_ratio: "16:9"
        }
      })
    );
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent?.images, [
      { url: "https://r2.syntx.ai/generated/flare-2k.png", mime_type: "image/png" }
    ]);
  } finally {
    await client.close();
    await server.close();
  }
});

test("owner generate-image tool rejects a Sunburst settings variant for another model before resolving a client", async () => {
  let resolveCalls = 0;
  const server = createMcpServer(createDefaultApplication(), {
    ownerGenerateImage: {
      resolveChatClient: () => {
        resolveCalls += 1;
        return fakeChatClient("https://r2.syntx.ai/generated/should-not-exist.png");
      },
      wait: instant
    }
  });
  const client = new Client({ name: "owner-sunburst-variant-reject-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = requireResult(
      await client.callTool({
        name: SYNTX_OWNER_GENERATE_IMAGE_TOOL_NAME,
        arguments: {
          link_attempt_id: LINK_ATTEMPT_ID,
          model_id: "gpt-image-1",
          prompt: "a small wooden lighthouse",
          settings_variant: "sunburst-2k-high-16x9"
        }
      })
    );
    assert.equal(result.isError, true);
    assert.equal(resolveCalls, 0);
  } finally {
    await client.close();
    await server.close();
  }
});

test("owner generate-image tool exposes the live-verified flux-1 profile", async () => {
  const server = createMcpServer(createDefaultApplication(), {
    ownerGenerateImage: {
      resolveChatClient: () => fakeChatClient("https://r2.syntx.ai/generated/flux-test.png"),
      wait: instant
    }
  });
  const client = new Client({ name: "owner-flux-profile-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = requireResult(
      await client.callTool({
        name: SYNTX_OWNER_GENERATE_IMAGE_TOOL_NAME,
        arguments: {
          link_attempt_id: LINK_ATTEMPT_ID,
          model_id: "flux-1",
          prompt: "a small wooden lighthouse",
          copies: 1,
          aspect_ratio: "1:1"
        }
      })
    );
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent?.images, [
      { url: "https://r2.syntx.ai/generated/flux-test.png", mime_type: "image/png" }
    ]);
  } finally {
    await client.close();
    await server.close();
  }
});

test("owner generate-image tool exposes the live-verified seedream-5 profile", async () => {
  const server = createMcpServer(createDefaultApplication(), {
    ownerGenerateImage: {
      resolveChatClient: () => fakeChatClient("https://r2.syntx.ai/generated/seedream-test.jpg"),
      wait: instant
    }
  });
  const client = new Client({ name: "owner-seedream-profile-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = requireResult(
      await client.callTool({
        name: SYNTX_OWNER_GENERATE_IMAGE_TOOL_NAME,
        arguments: {
          link_attempt_id: LINK_ATTEMPT_ID,
          model_id: "seedream-5",
          prompt: "a small wooden lighthouse",
          copies: 1,
          aspect_ratio: "1:1"
        }
      })
    );
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent?.images, [
      { url: "https://r2.syntx.ai/generated/seedream-test.jpg", mime_type: "image/png" }
    ]);
  } finally {
    await client.close();
    await server.close();
  }
});

test("owner generate-image tool exposes the live-verified seedream-4 profile", async () => {
  const server = createMcpServer(createDefaultApplication(), {
    ownerGenerateImage: {
      resolveChatClient: () => fakeChatClient("https://r2.syntx.ai/generated/seedream4-test.jpg"),
      wait: instant
    }
  });
  const client = new Client({ name: "owner-seedream4-profile-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = requireResult(
      await client.callTool({
        name: SYNTX_OWNER_GENERATE_IMAGE_TOOL_NAME,
        arguments: {
          link_attempt_id: LINK_ATTEMPT_ID,
          model_id: "seedream-4",
          prompt: "a small wooden lighthouse",
          copies: 1,
          aspect_ratio: "1:1"
        }
      })
    );
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent?.images, [
      { url: "https://r2.syntx.ai/generated/seedream4-test.jpg", mime_type: "image/png" }
    ]);
  } finally {
    await client.close();
    await server.close();
  }
});

test("owner generate-image tool exposes the live-verified seedream-4.5 profile", async () => {
  const server = createMcpServer(createDefaultApplication(), {
    ownerGenerateImage: {
      resolveChatClient: () => fakeChatClient("https://r2.syntx.ai/generated/seedream45-test.jpg"),
      wait: instant
    }
  });
  const client = new Client({ name: "owner-seedream45-profile-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = requireResult(
      await client.callTool({
        name: SYNTX_OWNER_GENERATE_IMAGE_TOOL_NAME,
        arguments: {
          link_attempt_id: LINK_ATTEMPT_ID,
          model_id: "seedream-4.5",
          prompt: "a small wooden lighthouse",
          copies: 1,
          aspect_ratio: "1:1"
        }
      })
    );
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent?.images, [
      { url: "https://r2.syntx.ai/generated/seedream45-test.jpg", mime_type: "image/png" }
    ]);
  } finally {
    await client.close();
    await server.close();
  }
});

test("owner generate-image tool exposes the live-verified seedream-5.0-pro profile", async () => {
  const server = createMcpServer(createDefaultApplication(), {
    ownerGenerateImage: {
      resolveChatClient: () => fakeChatClient("https://r2.syntx.ai/generated/seedream50pro-test.jpg"),
      wait: instant
    }
  });
  const client = new Client({ name: "owner-seedream50pro-profile-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = requireResult(
      await client.callTool({
        name: SYNTX_OWNER_GENERATE_IMAGE_TOOL_NAME,
        arguments: {
          link_attempt_id: LINK_ATTEMPT_ID,
          model_id: "seedream-5.0-pro",
          prompt: "a small wooden lighthouse",
          copies: 1,
          aspect_ratio: "1:1"
        }
      })
    );
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent?.images, [
      { url: "https://r2.syntx.ai/generated/seedream50pro-test.jpg", mime_type: "image/png" }
    ]);
  } finally {
    await client.close();
    await server.close();
  }
});

test("owner generate-image tool exposes the live-verified grok_t2i profile", async () => {
  const server = createMcpServer(createDefaultApplication(), {
    ownerGenerateImage: {
      resolveChatClient: () => fakeChatClient("https://r2.syntx.ai/generated/grok-test.jpg"),
      wait: instant
    }
  });
  const client = new Client({ name: "owner-grok-profile-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = requireResult(
      await client.callTool({
        name: SYNTX_OWNER_GENERATE_IMAGE_TOOL_NAME,
        arguments: {
          link_attempt_id: LINK_ATTEMPT_ID,
          model_id: "grok_t2i",
          prompt: "a small wooden lighthouse",
          copies: 1,
          aspect_ratio: "1:1"
        }
      })
    );
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent?.images, [
      { url: "https://r2.syntx.ai/generated/grok-test.jpg", mime_type: "image/png" }
    ]);
  } finally {
    await client.close();
    await server.close();
  }
});

test("owner generate-image tool exposes the live-verified grok_t2i_pro profile", async () => {
  const server = createMcpServer(createDefaultApplication(), {
    ownerGenerateImage: {
      resolveChatClient: () => fakeChatClient("https://r2.syntx.ai/generated/grok-pro-test.jpg"),
      wait: instant
    }
  });
  const client = new Client({ name: "owner-grok-pro-profile-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = requireResult(
      await client.callTool({
        name: SYNTX_OWNER_GENERATE_IMAGE_TOOL_NAME,
        arguments: {
          link_attempt_id: LINK_ATTEMPT_ID,
          model_id: "grok_t2i_pro",
          prompt: "a small wooden lighthouse",
          copies: 1,
          aspect_ratio: "1:1"
        }
      })
    );
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent?.images, [
      { url: "https://r2.syntx.ai/generated/grok-pro-test.jpg", mime_type: "image/png" }
    ]);
  } finally {
    await client.close();
    await server.close();
  }
});

test("owner generate-image tool exposes the live-verified grok_imagine_2 profile", async () => {
  const server = createMcpServer(createDefaultApplication(), {
    ownerGenerateImage: {
      resolveChatClient: () => fakeChatClient("https://r2.syntx.ai/generated/grok-imagine-2-test.jpg"),
      wait: instant
    }
  });
  const client = new Client({ name: "owner-grok-imagine-2-profile-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = requireResult(
      await client.callTool({
        name: SYNTX_OWNER_GENERATE_IMAGE_TOOL_NAME,
        arguments: {
          link_attempt_id: LINK_ATTEMPT_ID,
          model_id: "grok_imagine_2",
          prompt: "a small wooden lighthouse",
          copies: 1,
          aspect_ratio: "1:1"
        }
      })
    );
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent?.images, [
      { url: "https://r2.syntx.ai/generated/grok-imagine-2-test.jpg", mime_type: "image/png" }
    ]);
  } finally {
    await client.close();
    await server.close();
  }
});

test("owner generate-image tool exposes the live-verified grok_imagine_quality profile", async () => {
  const server = createMcpServer(createDefaultApplication(), {
    ownerGenerateImage: {
      resolveChatClient: () => fakeChatClient("https://r2.syntx.ai/generated/grok-imagine-quality-test.jpg"),
      wait: instant
    }
  });
  const client = new Client({ name: "owner-grok-imagine-quality-profile-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = requireResult(
      await client.callTool({
        name: SYNTX_OWNER_GENERATE_IMAGE_TOOL_NAME,
        arguments: {
          link_attempt_id: LINK_ATTEMPT_ID,
          model_id: "grok_imagine_quality",
          prompt: "a small wooden lighthouse",
          copies: 1,
          aspect_ratio: "1:1"
        }
      })
    );
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent?.images, [
      { url: "https://r2.syntx.ai/generated/grok-imagine-quality-test.jpg", mime_type: "image/png" }
    ]);
  } finally {
    await client.close();
    await server.close();
  }
});

test("owner generate-image tool exposes the live-verified runway_frames profile", async () => {
  const server = createMcpServer(createDefaultApplication(), {
    ownerGenerateImage: {
      resolveChatClient: () => fakeChatClient("https://r2.syntx.ai/generated/runway-frames-test.png"),
      wait: instant
    }
  });
  const client = new Client({ name: "owner-runway-frames-profile-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = requireResult(
      await client.callTool({
        name: SYNTX_OWNER_GENERATE_IMAGE_TOOL_NAME,
        arguments: {
          link_attempt_id: LINK_ATTEMPT_ID,
          model_id: "runway_frames",
          prompt: "a small wooden lighthouse",
          copies: 1,
          aspect_ratio: "1:1"
        }
      })
    );
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent?.images, [
      { url: "https://r2.syntx.ai/generated/runway-frames-test.png", mime_type: "image/png" }
    ]);
  } finally {
    await client.close();
    await server.close();
  }
});

test("owner generate-image tool exposes the live-verified wan_26_t2i profile", async () => {
  const server = createMcpServer(createDefaultApplication(), {
    ownerGenerateImage: {
      resolveChatClient: () => fakeChatClient("https://r2.syntx.ai/generated/wan-test.png"),
      wait: instant
    }
  });
  const client = new Client({ name: "owner-wan-profile-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = requireResult(
      await client.callTool({
        name: SYNTX_OWNER_GENERATE_IMAGE_TOOL_NAME,
        arguments: {
          link_attempt_id: LINK_ATTEMPT_ID,
          model_id: "wan_26_t2i",
          prompt: "a small wooden lighthouse",
          aspect_ratio: "1:1"
        }
      })
    );
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent?.images, [
      { url: "https://r2.syntx.ai/generated/wan-test.png", mime_type: "image/png" }
    ]);
  } finally {
    await client.close();
    await server.close();
  }
});

test("owner generate-image tool exposes the live-verified uni-1 Luma Image profile", async () => {
  const server = createMcpServer(createDefaultApplication(), {
    ownerGenerateImage: {
      resolveChatClient: () => fakeChatClient("https://r2.syntx.ai/generated/uni-1-test.png"),
      wait: instant
    }
  });
  const client = new Client({ name: "owner-luma-image-profile-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = requireResult(
      await client.callTool({
        name: SYNTX_OWNER_GENERATE_IMAGE_TOOL_NAME,
        arguments: {
          link_attempt_id: LINK_ATTEMPT_ID,
          model_id: "uni-1",
          prompt: "a small wooden lighthouse",
          copies: 1,
          aspect_ratio: "1:1"
        }
      })
    );
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent?.images, [
      { url: "https://r2.syntx.ai/generated/uni-1-test.png", mime_type: "image/png" }
    ]);
  } finally {
    await client.close();
    await server.close();
  }
});

test("owner generate-image tool rejects wan_26_t2i's unverified aspect ratio before resolving a chat client", async () => {
  let resolveCalls = 0;
  const server = createMcpServer(createDefaultApplication(), {
    ownerGenerateImage: {
      resolveChatClient: () => {
        resolveCalls += 1;
        return fakeChatClient("https://r2.syntx.ai/generated/should-not-run.png");
      },
      wait: instant
    }
  });
  const client = new Client({ name: "owner-wan-rejection-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = requireResult(
      await client.callTool({
        name: SYNTX_OWNER_GENERATE_IMAGE_TOOL_NAME,
        arguments: {
          link_attempt_id: LINK_ATTEMPT_ID,
          model_id: "wan_26_t2i",
          prompt: "a small wooden lighthouse",
          aspect_ratio: "16:9"
        }
      })
    );
    assert.equal(result.isError, true);
    assert.equal(resolveCalls, 0);
  } finally {
    await client.close();
    await server.close();
  }
});

test("owner generate-image tool rejects runway_frames' unverified aspect ratio before resolving a chat client", async () => {
  let createCalls = 0;
  let startCalls = 0;
  const server = createMcpServer(createDefaultApplication(), {
    ownerGenerateImage: {
      resolveChatClient: () => {
        const client = fakeChatClient("https://r2.syntx.ai/generated/should-not-run.png");
        return {
          ...client,
          async createChat(...args: Parameters<OwnerImageChatClient["createChat"]>) {
            createCalls += 1;
            return client.createChat(...args);
          },
          async startImage(...args: Parameters<OwnerImageChatClient["startImage"]>) {
            startCalls += 1;
            return client.startImage(...args);
          }
        };
      },
      wait: instant
    }
  });
  const client = new Client({ name: "owner-runway-frames-rejection-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = requireResult(
      await client.callTool({
        name: SYNTX_OWNER_GENERATE_IMAGE_TOOL_NAME,
        arguments: {
          link_attempt_id: LINK_ATTEMPT_ID,
          model_id: "runway_frames",
          prompt: "a small wooden lighthouse",
          aspect_ratio: "16:9"
        }
      })
    );
    assert.equal(result.isError, true);
    assert.equal(createCalls, 0);
    assert.equal(startCalls, 0);
  } finally {
    await client.close();
    await server.close();
  }
});

test("owner generate-image tool rejects grok_t2i's unverified aspect ratio before resolving a chat client", async () => {
  let createCalls = 0;
  let startCalls = 0;
  const server = createMcpServer(createDefaultApplication(), {
    ownerGenerateImage: {
      resolveChatClient: () => {
        const client = fakeChatClient("https://r2.syntx.ai/generated/should-not-run.png");
        return {
          ...client,
          async createChat(...args: Parameters<OwnerImageChatClient["createChat"]>) {
            createCalls += 1;
            return client.createChat(...args);
          },
          async startImage(...args: Parameters<OwnerImageChatClient["startImage"]>) {
            startCalls += 1;
            return client.startImage(...args);
          }
        };
      },
      wait: instant
    }
  });
  const client = new Client({ name: "owner-grok-rejection-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = requireResult(
      await client.callTool({
        name: SYNTX_OWNER_GENERATE_IMAGE_TOOL_NAME,
        arguments: {
          link_attempt_id: LINK_ATTEMPT_ID,
          model_id: "grok_t2i",
          prompt: "a small wooden lighthouse",
          aspect_ratio: "16:9"
        }
      })
    );
    assert.equal(result.isError, true);
    assert.equal(createCalls, 0);
    assert.equal(startCalls, 0);
  } finally {
    await client.close();
    await server.close();
  }
});

test("owner generate-image tool rejects seedream-5's unverified aspect ratio before resolving a chat client", async () => {
  let createCalls = 0;
  let startCalls = 0;
  const server = createMcpServer(createDefaultApplication(), {
    ownerGenerateImage: {
      resolveChatClient: () => {
        const client = fakeChatClient("https://r2.syntx.ai/generated/should-not-run.png");
        return {
          ...client,
          async createChat(...args: Parameters<OwnerImageChatClient["createChat"]>) {
            createCalls += 1;
            return client.createChat(...args);
          },
          async startImage(...args: Parameters<OwnerImageChatClient["startImage"]>) {
            startCalls += 1;
            return client.startImage(...args);
          }
        };
      },
      wait: instant
    }
  });
  const client = new Client({ name: "owner-seedream-rejection-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = requireResult(
      await client.callTool({
        name: SYNTX_OWNER_GENERATE_IMAGE_TOOL_NAME,
        arguments: {
          link_attempt_id: LINK_ATTEMPT_ID,
          model_id: "seedream-5",
          prompt: "a small wooden lighthouse",
          aspect_ratio: "16:9"
        }
      })
    );
    assert.equal(result.isError, true);
    assert.equal(createCalls, 0);
    assert.equal(startCalls, 0);
  } finally {
    await client.close();
    await server.close();
  }
});

test("owner generate-image tool rejects an unknown model id before resolving a chat client", async () => {
  let resolveCalls = 0;
  const server = createMcpServer(createDefaultApplication(), {
    ownerGenerateImage: {
      resolveChatClient: () => {
        resolveCalls += 1;
        return fakeChatClient("https://r2.syntx.ai/generated/should-not-run.png");
      },
      wait: instant
    }
  });
  const client = new Client({ name: "owner-unknown-image-profile-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = requireResult(
      await client.callTool({
        name: SYNTX_OWNER_GENERATE_IMAGE_TOOL_NAME,
        arguments: {
          link_attempt_id: LINK_ATTEMPT_ID,
          model_id: "unreviewed-model",
          prompt: "a small wooden lighthouse"
        }
      })
    );
    assert.equal(result.isError, true);
    assert.equal(resolveCalls, 0);
  } finally {
    await client.close();
    await server.close();
  }
});

test("owner generate-image tool rejects copies above the live-verified limit", async () => {
  const server = createMcpServer(createDefaultApplication(), {
    ownerGenerateImage: {
      resolveChatClient: () => fakeChatClient("https://r2.syntx.ai/generated/tool-test.png"),
      wait: instant
    }
  });
  const client = new Client({ name: "owner-generate-copy-limit-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = requireResult(
      await client.callTool({
        name: SYNTX_OWNER_GENERATE_IMAGE_TOOL_NAME,
        arguments: {
          link_attempt_id: LINK_ATTEMPT_ID,
          prompt: "a small wooden lighthouse",
          copies: 2
        }
      })
    );
    assert.equal(result.isError, true);
  } finally {
    await client.close();
    await server.close();
  }
});

function requireResult(value: unknown): CallToolResult {
  assert.ok(value && typeof value === "object" && "content" in value);
  return value as CallToolResult;
}
