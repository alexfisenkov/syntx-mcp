#!/usr/bin/env node
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../dist/src/mcp/server.js";
import { createObservedOwnerRuntime } from "../dist/src/runtime/observed-owner-runtime.js";
import { LinkedAttemptCredentialBroker } from "../dist/src/adapter/syntx/link-credential-broker.js";

/**
 * One-off, throwaway probe (companion to live-owner-generation-observe.mjs,
 * not a shipped path): logs in once, then tries a handful of settings
 * variants for ai_name="banana" (n, aspect_ratio, image_size) to see which
 * ones the real API accepts, so the eventual owner-generate MCP tool can
 * honestly expose count/format/resolution instead of guessing at them.
 * Rejections (HTTP 400) cost nothing; only accepted dispatches are polled
 * to completion and therefore billed.
 */

const CONFIRM_FLAG = "--confirm-live-format-probe";
const hasConfirmation =
  process.argv.length === 3 && process.argv[2] === CONFIRM_FLAG;

if (!hasConfirmation) {
  process.stderr.write(
    `Refusing: this may make several REAL, PAID SYNTX generation calls.\nUsage: live-owner-generation-format-probe.mjs ${CONFIRM_FLAG}\n`
  );
  process.exitCode = 2;
} else {
  await run().catch((error) => {
    process.stderr.write(
      `Format probe failed: ${error instanceof Error ? error.message : "unknown"}\n`
    );
    process.exitCode = 1;
  });

  async function run() {
    if (process.platform !== "darwin") {
      throw new Error("Unsupported local handoff platform.");
    }

    const runtime = createObservedOwnerRuntime({ requestTimeoutMs: 30_000 });
    const server = createMcpServer(runtime.application, runtime.serverOptions);
    const client = new Client({ name: "syntx-owner-live-format-probe", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    let attemptId = null;
    // The raw response's 400 body has not established a machine-verifiable
    // pre-dispatch rejection contract. Therefore this probe never treats a
    // write response as safe to clean up: a paid or ambiguous chat remains
    // available for manual follow-up even after its observation is saved.
    const chatObservations = new Map();
    const results = [];
    try {
      const begun = await client.callTool({ name: "syntx_begin_login", arguments: {} });
      attemptId = begun.structuredContent?.attempt_id;
      const approvalLink = begun.content.find((item) => item.type === "resource_link");
      if (typeof attemptId !== "string" || approvalLink?.type !== "resource_link") {
        throw new Error("No safe user handoff was returned.");
      }
      process.stdout.write(`Approve login in Telegram: ${approvalLink.uri}\n`);
      await promisify(execFile)("/usr/bin/open", [approvalLink.uri], { timeout: 10_000 });

      let linked = false;
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await delay(attempt === 0 ? 1_500 : 1_000);
        const checked = await client.callTool({
          name: "syntx_check_login",
          arguments: { attempt_id: attemptId }
        });
        if (checked.structuredContent?.linked === true) {
          linked = true;
          break;
        }
        const status = checked.structuredContent?.status;
        if (status === "EXPIRED" || status === "FAILED_TERMINAL" || status === "REVOKED") break;
      }
      if (!linked) throw new Error("Login did not complete in time.");
      process.stdout.write("Login confirmed.\n");

      const chatClient = runtime.createChatClient(attemptId);
      const broker = new LinkedAttemptCredentialBroker(
        runtime.serverOptions.auth.linkService,
        runtime.serverOptions.auth.binding,
        attemptId
      );

      const variants = [
        { label: "n=2", settings: { model_type: "banana", n: 2 } },
        { label: "aspect_ratio=16:9", settings: { model_type: "banana", aspect_ratio: "16:9" } },
        { label: "image_size=2K", settings: { model_type: "banana", image_size: "2K" } }
      ];

      for (const variant of variants) {
        process.stdout.write(`\n--- variant ${variant.label} ---\n`);
        const created = await chatClient.createChat(
          "image",
          `mcp-format-probe-${randomUUID()}`,
          AbortSignal.timeout(15_000)
        );
        chatObservations.set(created.chat_uuid, { observationSaved: false });
        const startRaw = await rawStartImage(broker, created.chat_uuid, "a small wooden lighthouse on a rocky coast", variant.settings);
        process.stdout.write(`start_image raw (${variant.label}): ${JSON.stringify(startRaw)}\n`);
        if (startRaw?.http_status >= 400) {
          results.push({ variant: variant.label, accepted: false, detail: startRaw });
          continue;
        }
        if (typeof startRaw?.id !== "number") {
          results.push({ variant: variant.label, accepted: true, polled: false, note: "no usable id", detail: startRaw });
          continue;
        }

        let botMessageId = null;
        for (let attempt = 0; attempt < 15 && botMessageId === null; attempt += 1) {
          await delay(2_000);
          const inProgress = await rawListInProgress(broker, created.chat_uuid);
          const entries = Array.isArray(inProgress) ? inProgress : [];
          const candidate = entries.find((entry) => String(entry?.message_id) !== String(startRaw.id));
          if (candidate) botMessageId = candidate.message_id;
        }
        if (botMessageId === null) {
          results.push({ variant: variant.label, accepted: true, polled: false, note: "no distinct bot message found" });
          continue;
        }

        let finalMessage = null;
        for (let attempt = 0; attempt < 30; attempt += 1) {
          await delay(3_000);
          const raw = await rawGetMessage(broker, created.chat_uuid, botMessageId);
          const objects = Array.isArray(raw?.message_object) ? raw.message_object : [];
          const allCompleted = objects.length > 0 && objects.every((object) => object?.completed === true);
          if (allCompleted) {
            finalMessage = raw;
            break;
          }
        }
        results.push({
          variant: variant.label,
          accepted: true,
          polled: finalMessage !== null,
          message_object: finalMessage?.message_object ?? null
        });
        process.stdout.write(
          `variant ${variant.label} result: ${JSON.stringify(finalMessage?.message_object ?? "TIMED_OUT")}\n`
        );
      }

      const outDir = join(fileURLToPath(new URL("../.черновики", import.meta.url)), "debt-048-format-probe");
      await mkdir(outDir, { recursive: true });
      const outPath = join(outDir, `raw-${Date.now()}.json`);
      await writeFile(outPath, JSON.stringify(results, null, 2), "utf8");
      for (const observation of chatObservations.values()) observation.observationSaved = true;
      process.stdout.write(`\nSaved: ${outPath}\n`);
    } finally {
      for (const [chatUuid, observation] of chatObservations) {
        process.stdout.write(
          `Not deleting chat ${chatUuid}: ${observation.observationSaved ? "observation was saved, but the write outcome is not proven pre-dispatch" : "observation was not saved"}.\n`
        );
      }
      if (attemptId !== null) {
        await client
          .callTool({ name: "syntx_unlink", arguments: { attempt_id: attemptId } })
          .catch(() => undefined);
      }
      await client.close();
      await server.close();
    }
  }
}

async function rawStartImage(broker, chatUuid, prompt, settings) {
  return broker.useCredential(async (credential) => {
    const url = new URL("design/generate", "https://api.syntx.ai/api/v1/");
    url.searchParams.set("ai_name", "banana");
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${credential}`,
        accept: "application/json",
        "content-type": "application/json"
      },
      body: JSON.stringify({ chat_uuid: chatUuid, prompt, settings }),
      signal: AbortSignal.timeout(30_000)
    });
    const text = await response.text();
    try {
      return { http_status: response.status, ...JSON.parse(text) };
    } catch {
      return { http_status: response.status, unparsed_body: text.slice(0, 2000) };
    }
  });
}

async function rawListInProgress(broker, chatUuid) {
  return broker.useCredential(async (credential) => {
    const response = await fetch(
      new URL(`chats/${chatUuid}/inprogress`, "https://api.syntx.ai/api/v1/"),
      {
        method: "GET",
        headers: { authorization: `Bearer ${credential}`, accept: "application/json" },
        signal: AbortSignal.timeout(15_000)
      }
    );
    const text = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { http_status: response.status, unparsed_body: text.slice(0, 2000) };
    }
    if (response.ok && Array.isArray(parsed)) return parsed;
    return { http_status: response.status, body: parsed };
  });
}

async function rawGetMessage(broker, chatUuid, messageId) {
  return broker.useCredential(async (credential) => {
    const response = await fetch(
      new URL(`chats/${chatUuid}/${messageId}`, "https://api.syntx.ai/api/v1/"),
      {
        method: "GET",
        headers: { authorization: `Bearer ${credential}`, accept: "application/json" },
        signal: AbortSignal.timeout(15_000)
      }
    );
    const text = await response.text();
    try {
      return { http_status: response.status, ...JSON.parse(text) };
    } catch {
      return { http_status: response.status, unparsed_body_length: text.length };
    }
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
