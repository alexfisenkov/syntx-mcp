import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { readOwnerStdioMaxBufferBytes, OWNER_STDIO_DEFAULT_MAX_BUFFER_BYTES, OWNER_STDIO_MAX_BUFFER_BYTES } from "../src/transports/owner-stdio-buffer.js";
const require = createRequire(import.meta.url);

test("owner stdio buffer defaults remain10MiB and only bounded integer operator values are accepted", () => {
  assert.equal(readOwnerStdioMaxBufferBytes(undefined), OWNER_STDIO_DEFAULT_MAX_BUFFER_BYTES);
  assert.equal(readOwnerStdioMaxBufferBytes(String(OWNER_STDIO_MAX_BUFFER_BYTES)), 201326592);
  for (const value of ["", "0", "-1", "NaN", "Infinity", "201326593", "10485759", "1e8", "10485760.0", " 10485760", "010485760"]) {
    assert.throws(() => readOwnerStdioMaxBufferBytes(value), /OWNER_STDIO_MAX_BUFFER_BYTES_INVALID/u);
  }
  const source = readFileSync(new URL("../../src/transports/stdio-owner.ts", import.meta.url), "utf8");
  assert.equal(source.match(/maxBufferSize: readOwnerStdioMaxBufferBytes\(process\.env\.SYNTX_STDIO_MAX_BUFFER_BYTES\)/gu)?.length, 2);
});

test("real SDK stdio wire rejects a >10MiB readonly payload by default and accepts the printed all-media profile", { timeout: 20_000 }, async () => {
  const printerUrl = new URL("../../scripts/print-media-mcp-config.mjs", import.meta.url).href;
  const printer = await import(printerUrl) as { buildMediaMcpConfig(entryUrl: string, node: string, options: { includeAllSupportedMedia: boolean }): { mcpServers: { syntx: { env: Record<string, string> } } } };
  const profileBuffer = printer.buildMediaMcpConfig(printerUrl, realpathSync(process.execPath), { includeAllSupportedMedia: true })
    .mcpServers.syntx.env.SYNTX_STDIO_MAX_BUFFER_BYTES;
  assert.equal(profileBuffer, String(OWNER_STDIO_MAX_BUFFER_BYTES));
  assert.ok(profileBuffer);
  const serverModule = pathToFileURL(require.resolve("@modelcontextprotocol/sdk/server/index.js")).href;
  const transportModule = pathToFileURL(require.resolve("@modelcontextprotocol/sdk/server/stdio.js")).href;
  const typesModule = pathToFileURL(require.resolve("@modelcontextprotocol/sdk/types.js")).href;
  const helperModule = new URL("../src/transports/owner-stdio-buffer.js", import.meta.url).href;
  const script = `
    import {Server} from ${JSON.stringify(serverModule)};
    import {StdioServerTransport} from ${JSON.stringify(transportModule)};
    import {CallToolRequestSchema} from ${JSON.stringify(typesModule)};
    import {readOwnerStdioMaxBufferBytes} from ${JSON.stringify(helperModule)};
    import {createHash} from 'node:crypto';
    const server=new Server({name:'offline-large-wire-echo',version:'1'}, {capabilities:{tools:{}}});
    server.onerror=()=>process.stderr.write('READ_LIMIT_REJECTED\\n');
    server.onclose=()=>process.stdin.destroy();
    server.setRequestHandler(CallToolRequestSchema,async(request)=>{
      const value=request.params.arguments?.payload;
      if(typeof value!=='string')throw new Error('INVALID_FIXTURE');
      return {content:[{type:'text',text:JSON.stringify({length:value.length,sha256:createHash('sha256').update(value).digest('hex')})}]};
    });
    await server.connect(new StdioServerTransport(process.stdin,process.stdout,{maxBufferSize:readOwnerStdioMaxBufferBytes(process.env.SYNTX_STDIO_MAX_BUFFER_BYTES)}));
  `;
  const payload = "x".repeat(11 * 1024 * 1024);
  for (const configured of [false, true]) {
    const transport = new StdioClientTransport({ command: realpathSync(process.execPath), args: ["--input-type=module", "-e", script],
      cwd: fileURLToPath(new URL("../../", import.meta.url)), stderr: "pipe", env: configured ? { SYNTX_STDIO_MAX_BUFFER_BYTES: profileBuffer } : {} });
    let stderr = ""; transport.stderr?.on("data", (data) => { stderr += String(data); });
    const client = new Client({ name: "offline-buffer-proof", version: "1" });
    try {
      await client.connect(transport as unknown as Transport, { timeout: 5000 });
      const result = client.callTool({ name: "readonly_fixture", arguments: { payload } }, undefined, { timeout: 5000 });
      if (!configured) { await assert.rejects(result); assert.match(stderr, /READ_LIMIT_REJECTED/u); }
      else {
        const response = await result;
        const text = (response.content as Array<{ type: string; text?: string }>)[0]!.text!;
        assert.deepEqual(JSON.parse(text), { length: payload.length, sha256: createHash("sha256").update(payload).digest("hex") });
        assert.equal(stderr.includes("READ_LIMIT_REJECTED"), false);
      }
    } finally { await client.close(); }
  }
});
