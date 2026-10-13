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
 * DEBT-010 observation tool, NOT a shipped generation path. Makes exactly one
 * REAL, PAID SYNTX generation call (owner-confirmed) and prints the raw,
 * pre-redaction `GET chats/{uuid}/{messageId}` response — the one thing
 * chat-http-client.ts's redactMessage() deliberately never exposes — so a
 * human can decide how a real completed-generation response is actually
 * shaped before anyone writes a decoder for it. The paid create/dispatch
 * calls go through the already-reviewed SyntxChatHttpClient (createChat/
 * startImage); only the raw-observation GET bypasses redaction, via a
 * credential obtained from the same LinkedAttemptCredentialBroker the
 * reviewed client itself uses — no new auth path, no new endpoint.
 *
 * The raw response is saved locally (never committed — see .gitignore-style
 * caution below) so a human can inspect it before any redacted excerpt is
 * ever written into a committed observation doc.
 */

const CONFIRM_FLAG = "--confirm-live-generation";
const promptArg = process.argv[3];
const hasConfirmation =
  process.argv.length === 4 &&
  process.argv[2] === CONFIRM_FLAG &&
  typeof promptArg === "string" &&
  promptArg.length > 0;

if (!hasConfirmation) {
  process.stderr.write(
    `Refusing: this makes one REAL, PAID SYNTX generation call.\nUsage: live-owner-generation-observe.mjs ${CONFIRM_FLAG} "<prompt text>"\n`
  );
  process.exitCode = 2;
} else {
  let currentStage = "guard";
  await run(promptArg).catch((error) => {
    process.stderr.write(
      `Live generation observe failed at safe stage ${currentStage}: ${error instanceof Error ? error.message : "unknown"}\n`
    );
    process.exitCode = 1;
  });

  async function run(prompt) {
    currentStage = "platform";
    if (process.platform !== "darwin") {
      throw new Error("Unsupported local handoff platform.");
    }

    const runtime = createObservedOwnerRuntime({ requestTimeoutMs: 30_000 });
    const server = createMcpServer(runtime.application, runtime.serverOptions);
    const client = new Client({ name: "syntx-owner-live-generation-observe", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    let attemptId = null;
    let chatUuid = null;
    let chatClient = null;
    let observationSaved = false;
    let generationCompleted = false;
    const observations = [];
    try {
      currentStage = "begin_login";
      const begun = await client.callTool({ name: "syntx_begin_login", arguments: {} });
      attemptId = begun.structuredContent?.attempt_id;
      const approvalLink = begun.content.find((item) => item.type === "resource_link");
      if (typeof attemptId !== "string" || approvalLink?.type !== "resource_link") {
        throw new Error("No safe user handoff was returned.");
      }

      currentStage = "telegram_handoff";
      process.stdout.write(`Approve login in Telegram: ${approvalLink.uri}\n`);
      await promisify(execFile)("/usr/bin/open", [approvalLink.uri], { timeout: 10_000 });

      currentStage = "check_login";
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

      chatClient = runtime.createChatClient(attemptId);
      const broker = new LinkedAttemptCredentialBroker(
        runtime.serverOptions.auth.linkService,
        runtime.serverOptions.auth.binding,
        attemptId
      );

      currentStage = "create_chat";
      const created = await chatClient.createChat(
        "image",
        `mcp-generation-observe-${randomUUID()}`,
        AbortSignal.timeout(15_000)
      );
      chatUuid = created.chat_uuid;
      process.stdout.write(`Chat created: ${chatUuid}\n`);

      currentStage = "start_image";
      // ai_name="banana" is the only real, executable Nano Banana entry in
      // catalog/v1/public-samples.json today (nano-banana-pro); settings is
      // deliberately empty — which SYNTX variant a bare request runs is
      // unobserved (DEBT-048), and this call does not claim to control it.
      // Raw (not via the reviewed SyntxChatHttpClient) specifically so a
      // rejection's real HTTP status/body is visible for diagnosis — the
      // reviewed client's mapHttpFailure() collapses most non-2xx statuses
      // to one generic UPSTREAM_UNAVAILABLE code, which hides exactly the
      // detail needed to tell "bad request" from "server issue".
      // First attempt (empty settings) came back 400 "model_type is required
      // for banana" (round 1 of this diagnosis) — no cost, nothing was
      // dispatched. Trying the known enum in order, newest-non-light first,
      // stopping at the first that isn't a 400 validation rejection, so a
      // wrong guess costs nothing and doesn't need a fresh Telegram approval.
      // Round 1 of this diagnosis (kept in commit history / observation
      // docs, not repeated here): empty settings -> 400 "model_type is
      // required for banana"; model_type=banana3/banana2 -> 400 "image_size
      // is required for banana"; model_type=banana (bare, no digit) -> 200.
      // Which SYNTX variant this actually runs is still unconfirmed (DEBT-048)
      // — this call does not claim to control it, only that it is the one
      // combination observed to be accepted.
      const startRaw = await rawStartImage(broker, chatUuid, prompt, { model_type: "banana" });
      observations.push({ at: new Date().toISOString(), phase: "start_image", raw: startRaw });
      process.stdout.write(`start_image raw: ${JSON.stringify(startRaw)}\n`);
      if (startRaw?.http_status >= 400 || typeof startRaw?.id !== "number") {
        throw new Error("start_image did not return a usable created-message id (see raw output above).");
      }
      // The response is the CREATED (echoed) user message, not the bot's
      // result — object_type "text" is the prompt echo. The bot's own
      // response message does not exist yet; found via listInProgress below,
      // same as the real UI does (docs/интеграция/наблюдение-banana-light-2026-09-04.md).
      process.stdout.write(`Message created (echo): id=${startRaw.id}, chat_id=${startRaw.chat_id}\n`);

      currentStage = "poll_in_progress";
      let botMessageId = null;
      let botMessageConfirmedInProgress = false;
      for (let attempt = 0; attempt < 20 && botMessageId === null; attempt += 1) {
        await delay(attempt === 0 ? 2_000 : 2_000);
        const inProgress = await rawListInProgress(broker, chatUuid);
        observations.push({ at: new Date().toISOString(), phase: "in_progress", attempt, raw: inProgress });
        process.stdout.write(`in_progress poll ${attempt}: ${JSON.stringify(inProgress)}\n`);
        // GET chats/{uuid}/inprogress returns a bare JSON array (see
        // inProgressResponseSchema in chat-http-client.ts), one entry per
        // {message_id, message_object_id, object_type, model_type} — not our
        // wrapper's {http_status,...} shape, since rawListInProgress below
        // only adds http_status when the body isn't already an array.
        const entries = Array.isArray(inProgress) ? inProgress : [];
        const candidate = entries.find((entry) => String(entry?.message_id) !== String(startRaw.id));
        if (candidate) {
          botMessageId = candidate.message_id;
          botMessageConfirmedInProgress = true;
        }
      }
      if (botMessageId === null) {
        process.stdout.write("No distinct in-progress bot message id was found within the poll window; polling the created message id itself instead.\n");
        botMessageId = startRaw.id;
      }

      currentStage = "poll_raw";
      // Two independent terminal signals, matching
      // docs/интеграция/наблюдение-banana-light-2026-09-04.md: the message's
      // own message_object[].completed flag, AND the authoritative UI signal
      // (disappearance from listInProgress) — completed=true alone does not
      // prove success (it is also set on cancel/error), so both are recorded.
      // The disappearance signal is only trusted once this message has been
      // confirmed present in listInProgress at least once: otherwise "not in
      // the list" could mean "never tracked there" rather than "finished",
      // and would end the loop (and later delete the chat) prematurely.
      for (let attempt = 0; attempt < 40; attempt += 1) {
        await delay(attempt === 0 ? 3_000 : 3_000);
        const raw = await rawGetMessage(broker, chatUuid, botMessageId);
        const inProgress = await rawListInProgress(broker, chatUuid);
        const entries = Array.isArray(inProgress) ? inProgress : [];
        const stillInProgress = entries.some((entry) => String(entry?.message_id) === String(botMessageId));
        if (stillInProgress) botMessageConfirmedInProgress = true;
        observations.push({
          at: new Date().toISOString(),
          phase: "get_message",
          attempt,
          raw,
          still_in_progress: stillInProgress
        });
        const objects = Array.isArray(raw?.message_object) ? raw.message_object : [];
        const completedFlag = objects.length > 0 && objects.every((object) => object?.completed === true);
        const disappearedAfterConfirmed = botMessageConfirmedInProgress && !stillInProgress;
        process.stdout.write(
          `poll ${attempt}: http_status=${raw?.http_status} objects=${objects.length} completed_flag=${completedFlag} still_in_progress=${stillInProgress}\n`
        );
        if (completedFlag || disappearedAfterConfirmed) {
          generationCompleted = true;
          break;
        }
      }
      if (!generationCompleted) {
        process.stdout.write(
          "Polling window ended without observing a completed message; saving whatever was captured, but the chat will be left alive rather than deleted.\n"
        );
      }

      currentStage = "save_local";
      const outDir = join(fileURLToPath(new URL("../.черновики", import.meta.url)), "debt-010-observation");
      await mkdir(outDir, { recursive: true });
      const outPath = join(outDir, `raw-${Date.now()}.json`);
      await writeFile(outPath, JSON.stringify(observations, null, 2), "utf8");
      observationSaved = true;
      process.stdout.write(`Raw (unredacted) observations saved locally: ${outPath}\n`);
      process.stdout.write("This file is NOT committed and must be reviewed/redacted by hand before any excerpt goes into a committed doc.\n");
    } finally {
      // Only delete the chat once a full observation has actually been
      // written to disk. An earlier version of this script deleted the chat
      // in every case, including when an error was thrown mid-flight after a
      // real dispatch had already succeeded — destroying the only remaining
      // access to that generation's result before it could be observed.
      if (chatUuid !== null && chatClient !== null && observationSaved && generationCompleted) {
        currentStage = "cleanup_chat";
        await chatClient.deleteChat(chatUuid, AbortSignal.timeout(15_000)).catch(() => undefined);
      } else if (chatUuid !== null) {
        process.stdout.write(
          `Not deleting chat ${chatUuid}: no confirmed-complete observation this run. It is left as-is for manual follow-up (inspect in the SYNTX app, or re-run this script's polling against the same chat_uuid).\n`
        );
      }
      if (attemptId !== null) {
        currentStage = "cleanup_unlink";
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
    // On success this mirrors the reviewed client's inProgressResponseSchema:
    // a bare array. Only wrap with http_status on a non-2xx/non-array body,
    // so callers can tell "empty in-progress list" (ok, []) apart from an
    // actual error without inspecting a status field that only sometimes exists.
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
