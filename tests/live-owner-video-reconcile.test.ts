import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const scriptPath = "scripts/live-owner-video-reconcile.mjs";
const source = readFileSync(scriptPath, "utf8");
const { classifyProviderCompletedWithoutBotResult } = await import(
  pathToFileURL(resolve(scriptPath)).href
);

test("video reconciliation requires the exact safe confirmation shape", () => {
  for (const args of [
    [],
    ["--confirm-video-reconcile"],
    ["--confirm-video-reconcile", "chat"],
    ["--confirm-video-reconcile", "chat", "message", "extra"],
    ["--wrong", "chat", "message"],
    ["--confirm-video-reconcile", "bad id", "message"],
    ["--confirm-video-reconcile", "chat", "bad/id"]
  ]) {
    const result = spawnSync(process.execPath, [scriptPath, ...args], {
      cwd: process.cwd(), encoding: "utf8", timeout: 5_000
    });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /--confirm-video-reconcile/);
    assert.equal(result.stdout, "");
  }
});

test("reconciliation is read-only, owner-authenticated, bounded, and redacted", () => {
  assert.match(source, /createObservedOwnerRuntime/);
  assert.match(source, /syntx_begin_login/);
  assert.match(source, /syntx_check_login/);
  assert.match(source, /listInProgress/);
  assert.match(source, /getMessage/);
  assert.match(source, /LinkedAttemptCredentialBroker/);
  assert.match(source, /new URL\(`chats\/\$\{targetChatUuid\}`/);
  assert.match(source, /new URL\(`chats\/\$\{targetChatUuid\}\/\$\{targetMessageId\}`/);
  assert.match(source, /method:\s*"GET"/);
  assert.match(source, /content-type/);
  assert.match(source, /TextDecoder\("utf-8", \{ fatal: true \}\)/);
  assert.match(source, /MAX_HISTORY_BYTES/);
  assert.match(source, /MAX_RAW_MESSAGE_BYTES/);
  assert.match(source, /readRawMessageDiagnostic/);
  assert.match(source, /UnknownRawMessageShapeError/);
  assert.match(source, /raw_message_diagnostic/);
  assert.match(source, /artifact_host/);
  assert.match(source, /artifact_mime/);
  assert.match(source, /AbortSignal\.timeout/);
  assert.match(source, /UnknownChatHistoryShapeError/);
  assert.match(source, /history_discovery/);
  assert.match(source, /candidate_bot_message/);
  assert.match(source, /180_000/);
  assert.match(source, /OUTCOME_UNKNOWN/);
  assert.match(source, /saveUnknownObservation/);
  assert.match(source, /result:\s*null/);
  assert.match(source, /artifacts/);
  assert.match(source, /video-reconcile-observation/);
  assert.doesNotMatch(source, /startVideo\s*\(/);
  assert.doesNotMatch(source, /createChat\s*\(/);
  assert.doesNotMatch(source, /deleteChat\s*\(/);
  assert.doesNotMatch(source, /method:\s*"POST"/);
  assert.doesNotMatch(source, /method:\s*"DELETE"/);
  assert.doesNotMatch(source, /fetch\s*\(/);
  assert.doesNotMatch(source, /JSON\.stringify\(parsed\)/);
  assert.doesNotMatch(source, /raw:\s*parsed/);
  assert.doesNotMatch(source, /body:\s*parsed/);
  assert.doesNotMatch(source, /process\.env/);
});

test("classifies a consistent completed user echo without a bot result", () => {
  assert.match(source, /PROVIDER_COMPLETED_WITHOUT_BOT_RESULT/);
  assert.match(source, /classifyProviderCompletedWithoutBotResult/);
  assert.match(source, /author_id\s*!==\s*-1/);
  assert.match(source, /object_type\s*===\s*"text"/);
  assert.match(source, /completed\s*===\s*true/);
  assert.match(source, /history_discovery/);
  assert.match(source, /artifacts\.length\s*!==\s*0/);
  assert.match(source, /no automatic retry/i);
  assert.doesNotMatch(source, /deleteChat\s*\(/);
});

test("classification persistence is scalar-only and keeps unknown for uncertainty", () => {
  const persistence = source.slice(source.indexOf("const safeValue"), source.indexOf("await writeFile", source.indexOf("const safeValue")));
  assert.match(source, /classification/);
  assert.match(source, /observed_raw_diagnostics/);
  assert.match(source, /status:\s*"OUTCOME_UNKNOWN"/);
  assert.match(source, /"PROVIDER_COMPLETED_WITHOUT_BOT_RESULT"/);
  assert.doesNotMatch(persistence, /prompt|body|url|credential/i);
});

test("classifies only a complete user echo with no bot message or artifact", () => {
  const base = {
    targetMessageId: "target",
    result: { artifacts: [] },
    observations: [
      {
        message_id: "target",
        history_discovery: [],
        raw_message_diagnostic: {
          author_id: 42,
          objects: [{ object_type: "text", completed: true }]
        }
      }
    ]
  };
  assert.equal(
    classifyProviderCompletedWithoutBotResult(base),
    "PROVIDER_COMPLETED_WITHOUT_BOT_RESULT"
  );
  assert.equal(
    classifyProviderCompletedWithoutBotResult({
      ...base,
      observations: [{ ...base.observations[0], history_discovery: "unknown_shape" }]
    }),
    null
  );
  assert.equal(
    classifyProviderCompletedWithoutBotResult({
      ...base,
      observations: [{
        ...base.observations[0],
        history_discovery: [{ author_id: -1, objects: [] }]
      }]
    }),
    null
  );
  assert.equal(
    classifyProviderCompletedWithoutBotResult({
      ...base,
      observations: [{ ...base.observations[0], reconciliation_timeout: true }]
    }),
    null
  );
});

test("invalid reconciliation does not reach the platform", () => {
  if (process.platform === "darwin") return;
  const result = spawnSync(process.execPath, [
    scriptPath, "--confirm-video-reconcile", "chat", "message"
  ], { cwd: process.cwd(), encoding: "utf8", timeout: 5_000 });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /safe stage platform/);
  assert.equal(result.stdout, '{"status":"FAILED","stage":"platform"}\n');
});
