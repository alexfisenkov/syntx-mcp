import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const checker = readFileSync(new URL("../scripts/check-package-install.mjs", import.meta.url), "utf8");
const toolName = "syntx_owner_get_video_recovery_diagnostic";

test("installed joint startup checks one configured recovery diagnostic and none without reviewed video services", () => {
  assert.ok(checker.includes(`const videoRecoveryDiagnosticToolName = "${toolName}";`));
  assert.match(checker, /assert\.equal\(optIn\.names\.filter\(n=>n===\$\{JSON\.stringify\(videoRecoveryDiagnosticToolName\)\}\)\.length,1\);/u);
  assert.match(checker, /assert\.equal\(reviewedVideoDiagnosticsOff\.names\.includes\(\$\{JSON\.stringify\(videoRecoveryDiagnosticToolName\)\}\),false\);/u);
  assert.match(checker,
    /reviewedVideoDiagnosticsOff=await runList\(\{\.\.\.cfg\.env,SYNTX_OWNER_HAILUO01_T2V:'0',SYNTX_OWNER_HAILUO01_DIRECTOR_T2V:'0',SYNTX_OWNER_HAILUO02_T2V:'0',SYNTX_OWNER_HAILUO23_T2V:'0',SYNTX_OWNER_HAILUO_LIVE_T2V:'0',SYNTX_OWNER_SEEDANCE20_T2V:'0',SYNTX_OWNER_KLING_T2V:'0',SYNTX_OWNER_VEO_T2V:'0',SYNTX_OWNER_GROK_T2V:'0'\},auditReviewedVideoDiagnosticsOff\)/u);
  assert.match(checker, /const jointToolCount=optIn\.count;/u, "joint count must remain derived from tools/list");
  assert.doesNotMatch(checker, /joint_tools\s*=\s*154/u, "do not pin a joint installed count as fresh proof");
});
