import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const cases = [
  {
    npmScript: "live:owner:smoke",
    scriptPath: "scripts/live-owner-smoke.mjs",
    flag: "--confirm-live-owner-smoke",
    legacyEnvironmentVariable: "SYNTX_LIVE_SMOKE"
  },
  {
    npmScript: "live:owner:chat-smoke",
    scriptPath: "scripts/live-owner-chat-smoke.mjs",
    flag: "--confirm-live-owner-chat-smoke",
    legacyEnvironmentVariable: "SYNTX_LIVE_CHAT_SMOKE"
  },
  {
    npmScript: "live:owner:account-status-smoke",
    scriptPath: "scripts/live-owner-account-status-smoke.mjs",
    flag: "--confirm-live-owner-account-status-smoke",
    legacyEnvironmentVariable: null
  },
  {
    npmScript: "live:owner:uploaded-files-smoke",
    scriptPath: "scripts/live-owner-uploaded-files-smoke.mjs",
    flag: "--confirm-live-owner-uploaded-files-smoke",
    legacyEnvironmentVariable: null
  },
  {
    npmScript: "live:owner:uploaded-files-shape-smoke",
    scriptPath: "scripts/live-owner-uploaded-files-shape-smoke.mjs",
    flag: "--confirm-live-owner-uploaded-files-shape-smoke",
    legacyEnvironmentVariable: null
  },
  {
    npmScript: "live:owner:upload-file-smoke",
    scriptPath: "scripts/live-owner-upload-file-smoke.mjs",
    flag: "--confirm-live-owner-upload-file-smoke",
    legacyEnvironmentVariable: null
  },
  {
    npmScript: "live:owner:reconcile-upload-smoke",
    scriptPath: "scripts/live-owner-reconcile-upload-smoke.mjs",
    flag: "--confirm-live-owner-reconcile-upload-smoke",
    legacyEnvironmentVariable: null
  },
  {
    npmScript: "live:owner:image-contract",
    scriptPath: "scripts/live-owner-image-contract-observe.mjs",
    flag: "--confirm-live-image-contract",
    legacyEnvironmentVariable: null
  },
  {
    npmScript: "live:owner:generate-video-smoke",
    scriptPath: "scripts/live-owner-generate-video-tool-smoke.mjs",
    flag: "--confirm-live-generate-video-tool-smoke",
    legacyEnvironmentVariable: null
  }
] as const;

test("live owner npm scripts use shell-independent explicit confirmation flags", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts: Record<string, string>;
  };

  for (const testCase of cases) {
    assert.equal(
      packageJson.scripts[testCase.npmScript],
      `npm run build && node ${testCase.scriptPath} ${testCase.flag}`
    );
  }
});

for (const testCase of cases) {
  test(`${testCase.npmScript} fails closed without its exact confirmation flag`, () => {
    for (const argumentsValue of [[], ["--wrong-confirmation"], [testCase.flag, "extra"]]) {
      const environment = { ...process.env };
      if (testCase.legacyEnvironmentVariable !== null) {
        delete environment[testCase.legacyEnvironmentVariable];
      }

      const result = spawnSync(
        process.execPath,
        [testCase.scriptPath, ...argumentsValue],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: environment,
          timeout: 5_000
        }
      );

      assert.equal(result.status, 2, String(result.stderr));
      assert.match(String(result.stderr), new RegExp(testCase.flag));
      assert.equal(String(result.stdout), "");
    }
  });

  test(`${testCase.npmScript} rejects CLI arguments when legacy env confirmation is used`, () => {
    if (testCase.legacyEnvironmentVariable === null) return;
    for (const argumentsValue of [["--wrong-confirmation"], [testCase.flag, "extra"]]) {
      const result: ReturnType<typeof spawnSync> = spawnSync(
        process.execPath,
        [
          "--import",
          "data:text/javascript,Object.defineProperty(process,'platform',{value:'linux'})",
          testCase.scriptPath,
          ...argumentsValue
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: {
            ...process.env,
            [testCase.legacyEnvironmentVariable]: "1"
          },
          timeout: 5_000
        }
      );

      assert.equal(result.status, 2, String(result.stderr));
      assert.match(String(result.stderr), new RegExp(testCase.flag));
      assert.equal(String(result.stdout), "");
    }
  });
}

test("account-status live smoke is read-only and redacts account values", () => {
  const source = readFileSync(
    "scripts/live-owner-account-status-smoke.mjs",
    "utf8"
  );
  assert.match(source, /accountStatusEnabled:\s*true/u);
  assert.match(source, /syntx_get_account_status/u);
  assert.match(source, /returned_fields:\s*"REDACTED"/u);
  assert.match(source, /shape_check:\s*"PASS"/u);
  assert.match(source, /balance\.available/u);
  assert.match(source, /subscription\.active/u);
  assert.match(source, /plan_type/u);
  assert.match(source, /end_date_kind/u);
  assert.match(source, /ACCOUNT_CONTRACT_EVIDENCE/u);
  assert.doesNotMatch(source, /SYNTX_LIVE/u);
  assert.doesNotMatch(source, /syntx_owner_generate/u);
  assert.doesNotMatch(source, /startImage|startVideo|createChat|deleteChat/u);
  assert.doesNotMatch(source, /JSON\.stringify\(status\.structuredContent\)/u);
  assert.doesNotMatch(source, /JSON\.stringify\(value\)/u);
  assert.doesNotMatch(source, /console\.(log|info|dir)\([^)]*(balance|subscription|available|plan_type|end_date)/u);
});

test("uploaded-files live smoke is read-only, exact, bounded, and redacts metadata", () => {
  const source = readFileSync(
    "scripts/live-owner-uploaded-files-smoke.mjs",
    "utf8"
  );
  assert.match(source, /uploadedFilesEnabled:\s*true/u);
  assert.match(source, /syntx_begin_login/u);
  assert.match(source, /syntx_check_login/u);
  assert.match(source, /syntx_list_uploaded_files/u);
  assert.match(source, /scope:\s*"all"/u);
  assert.match(source, /page:\s*1/u);
  assert.match(source, /page_size:\s*10/u);
  assert.match(source, /shape_check:\s*"PASS"/u);
  assert.match(source, /item_count/u);
  assert.match(source, /has_more/u);
  assert.match(source, /local_credential_removed:\s*"PASS"/u);
  assert.match(source, /assertSafeUploadedFilesShape/u);
  assert.doesNotMatch(source, /SYNTX_LIVE/u);
  assert.doesNotMatch(source, /syntx_owner_generate/u);
  assert.doesNotMatch(source, /upload-files|files\/delete|\bdownload\s*\(/u);
  assert.doesNotMatch(source, /JSON\.stringify\(result\.structuredContent\)/u);
  assert.doesNotMatch(source, /console\.(log|info|dir)/u);
});

test("uploaded-files shape smoke is one-read, shape-only, and redacted", () => {
  const source = readFileSync("scripts/live-owner-uploaded-files-shape-smoke.mjs", "utf8");
  assert.match(source, /inspectUploadedFilesResponseShape/u);
  assert.match(source, /decoder_status/u);
  assert.match(source, /top_level/u);
  assert.match(source, /item:.*summary\.item.*null/u);
  assert.match(source, /One authenticated GET only/u);
  assert.match(source, /assertSafeShapeSummary/u);
  assert.doesNotMatch(source, /upload-files|files\/delete|\bdownload\s*\(/u);
  assert.doesNotMatch(source, /JSON\.stringify\(summary\)/u);
  assert.doesNotMatch(source, /console\.(log|info|dir)/u);
  assert.doesNotMatch(source, /filename|signed_url|object_url|download_url/u);
});

test("uploaded-file reconciliation smoke is read-only, exact, and redacted", () => {
  const source = readFileSync("scripts/live-owner-reconcile-upload-smoke.mjs", "utf8");
  assert.match(source, /reconcileUploadedFileEnabled:\s*true/u);
  assert.match(source, /syntx_reconcile_uploaded_file/u);
  assert.match(source, /file_reconcile_probe_000000/u);
  assert.match(source, /NOT_FOUND/u);
  assert.match(source, /CONTROLLED_ERROR/u);
  assert.match(source, /local_credential_removed:\s*"PASS"/u);
  assert.match(source, /no environment-variable bypass/iu);
  assert.doesNotMatch(source, /upload-files|files\/delete|\bdownload\s*\(/u);
  assert.doesNotMatch(source, /JSON\.stringify\(result\.structuredContent\)/u);
  assert.doesNotMatch(source, /console\.(log|info|dir)/u);
  assert.doesNotMatch(source, /filename|signed_url|object_url|download_url/u);
});

test("image contract observer is owner-only, bounded, and preserves paid outcomes", () => {
  const source = readFileSync(
    "scripts/live-owner-image-contract-observe.mjs",
    "utf8"
  );
  assert.match(source, /createObservedOwnerRuntime/u);
  assert.match(source, /syntx_begin_login/u);
  assert.match(source, /syntx_check_login/u);
  assert.match(source, /startImage\(/u);
  assert.match(source, /MAX_SETTINGS_BYTES/u);
  assert.match(source, /MAX_SETTINGS_KEYS/u);
  assert.match(source, /listInProgress/u);
  assert.match(source, /getMessage/u);
  assert.match(source, /180_000/u);
  assert.match(source, /image-contract-observation/u);
  assert.match(source, /settings\s*:\s*settings/u);
  assert.match(source, /Object\.getPrototypeOf/u);
  assert.match(source, /Number\.isFinite/u);
  assert.match(source, /__proto__|prototype|constructor/u);
  assert.match(source, /OUTCOME_UNKNOWN/u);
  assert.match(source, /dispatch_accepted/u);
  assert.match(source, /chat_uuid:\s*safeObservationId\(chatUuid\)/u);
  assert.match(source, /message_id\s*=\s*safeMessageId/u);
  assert.match(source, /safeObservationId/u);
  assert.doesNotMatch(source, /writeUnknownObservation\(model/u);
  assert.doesNotMatch(source, /unknown[\s\S]{0,500}requestedPrompt/u);
  assert.doesNotMatch(source, /unknown[\s\S]{0,500}settings/u);
  assert.doesNotMatch(source, /unknown[\s\S]{0,500}envelope/u);
  assert.doesNotMatch(source, /deleteChat\(/u);
  assert.doesNotMatch(source, /fetch\(/u);
  assert.doesNotMatch(source, /process\.env\.SYNTX_LIVE_IMAGE_CONTRACT/u);
});

test("image contract observer validates settings before platform checks", () => {
  if (process.platform === "darwin") return;
  const result = spawnSync(process.execPath, [
    "scripts/live-owner-image-contract-observe.mjs",
    "--confirm-live-image-contract",
    "gpt-image-1",
    "prompt",
    '{"aspect_ratio":"1:1","nested":{"mode":"fast"}}'
  ], { cwd: process.cwd(), encoding: "utf8", timeout: 5_000 });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /safe stage platform/u);
  assert.equal(result.stdout, '{"status":"FAILED","stage":"platform"}\n');
});

test("video tool smoke calls the shipped tool with a fixed profile and redacts its output", () => {
  const source = readFileSync(
    "scripts/live-owner-generate-video-tool-smoke.mjs",
    "utf8"
  );
  assert.match(source, /generateVideoEnabled:\s*true/u);
  assert.match(source, /syntx_owner_generate_video/u);
  assert.match(source, /seedance-2\.0/u);
  assert.match(source, /video_mime/u);
  assert.match(source, /tool_result_present/u);
  assert.match(source, /boundedCall/u);
  assert.match(source, /TOOL_TIMEOUT_MS/u);
  assert.match(source, /syntx_unlink/u);
  assert.doesNotMatch(source, /deleteChat\(/u);
  assert.doesNotMatch(source, /startVideo\(/u);
  assert.doesNotMatch(source, /JSON\.stringify\(toolResult/u);
  assert.doesNotMatch(source, /console\.log/u);
  assert.doesNotMatch(source, /process\.env\.SYNTX/u);
});

test("video tool smoke cannot replace a result with cleanup failure", () => {
  const source = readFileSync(
    "scripts/live-owner-generate-video-tool-smoke.mjs",
    "utf8"
  );
  assert.match(source, /safeClose\(\(\) => client\.close\(\)\)/u);
  assert.match(source, /safeClose\(\(\) => server\.close\(\)\)/u);
});
