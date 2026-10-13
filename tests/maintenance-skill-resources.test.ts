import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const EXPECTED_RESOURCES = [
  {
    name: "syntx-maintenance-skill",
    title: "SYNTX MCP maintenance skill",
    uri: "syntx://maintenance/skill"
  },
  {
    name: "syntx-maintenance-cli-guide",
    title: "SYNTX MCP maintenance CLI guide",
    uri: "syntx://maintenance/cli-guide"
  },
  {
    name: "syntx-maintenance-ui-guide",
    title: "SYNTX MCP maintenance UI audit guide",
    uri: "syntx://maintenance/ui-guide"
  }
] as const;

test("default MCP server exposes and serves the three packaged maintenance resources", async (t) => {
  const serverUrl = new URL("../src/mcp/server.js", import.meta.url);
  const factoryUrl = new URL("../src/application/factory.js", import.meta.url);
  if (!existsSync(fileURLToPath(serverUrl)) || !existsSync(fileURLToPath(factoryUrl))) {
    t.skip("The default-server integration is exercised by the compiled project suite.");
    return;
  }
  const [serverModule, factoryModule] = await Promise.all([
    import(serverUrl.href) as Promise<{ createMcpServer(application: unknown): McpServer }>,
    import(factoryUrl.href) as Promise<{ createDefaultApplication(): unknown }>
  ]);
  const server = serverModule.createMcpServer(factoryModule.createDefaultApplication());
  await withClient(server, async (client) => {
    const listed = await client.listResources();
    assert.deepEqual(listed.resources.map(({ name, title, uri }) => ({ name, title, uri })), EXPECTED_RESOURCES);

    const expectedSnippets = ["SYNTX MCP maintenance", "Maintenance CLI", "UI audit and source-to-code impact"];
    for (const [index, resource] of EXPECTED_RESOURCES.entries()) {
      const response = await client.readResource({ uri: resource.uri });
      assert.equal(response.contents.length, 1);
      const content = response.contents[0];
      assert.equal(content?.mimeType, "text/markdown");
      assert.equal(content?.uri, resource.uri);
      assert.equal(content && "text" in content, true);
      if (content && "text" in content) {
        assert.ok(content.text.includes(expectedSnippets[index]!));
        assert.equal(content.text.includes("/Users/AlexFisenkov"), false);
      }
    }

    await assert.rejects(client.readResource({ uri: "syntx://maintenance/../../package.json" }));
  });
});

test("maintenance resources resolve package files from source and compiled module layouts", async (t) => {
  for (const moduleLayout of ["src/mcp", "dist/src/mcp"] as const) {
    await t.test(moduleLayout, async () => {
      const fixture = await createResourceFixture(moduleLayout);
      try {
        const resourceModule = await loadCopiedResourceModule(fixture.modulePath);
        const server = new McpServer({ name: "maintenance-resource-layout-test", version: "1" });
        resourceModule.registerSyntxMaintenanceSkillResources(server);
        await withMcpClient(server, async (client) => {
          const listed = await client.listResources();
          assert.deepEqual(listed.resources.map((item) => item.uri).sort(), Object.keys(RESOURCE_FIXTURE_TEXT).sort());
          for (const [uri, expectedText] of Object.entries(RESOURCE_FIXTURE_TEXT)) {
            const response = await client.readResource({ uri });
            assert.deepEqual(response.contents, [{ uri, mimeType: "text/markdown", text: expectedText }]);
          }
          await assert.rejects(client.readResource({ uri: "syntx://maintenance/../../package.json" }), (error: unknown) => {
            assert.ok(error instanceof Error);
            assert.equal(error.message.includes(fixture.root), false);
            return true;
          });
        });
      } finally {
        await rm(fixture.root, { recursive: true, force: true });
      }
    });
  }
});

test("maintenance resource reader rejects missing, oversized, symlinked, and invalid UTF-8 files without paths", async (t) => {
  const cases = [
    { name: "missing", code: "MAINTENANCE_RESOURCE_UNAVAILABLE" },
    { name: "oversized", code: "MAINTENANCE_RESOURCE_TOO_LARGE" },
    { name: "symlink", code: "MAINTENANCE_RESOURCE_SYMLINK_REJECTED" },
    { name: "invalid UTF-8", code: "MAINTENANCE_RESOURCE_INVALID_UTF8" }
  ] as const;

  for (const entry of cases) {
    await t.test(entry.name, async () => {
      const fixture = await createResourceFixture("src/mcp");
      try {
        const skillPath = join(fixture.root, "skills/syntx-mcp-update/SKILL.md");
        if (entry.name === "missing") await unlink(skillPath);
        if (entry.name === "oversized") await writeFile(skillPath, Buffer.alloc(64 * 1024 + 1, 0x41));
        if (entry.name === "invalid UTF-8") await writeFile(skillPath, Buffer.from([0xc3, 0x28]));
        if (entry.name === "symlink") {
          const outsidePath = join(fixture.root, "private-test-sentinel.md");
          await writeFile(outsidePath, "PRIVATE_SENTINEL");
          await unlink(skillPath);
          await symlink(outsidePath, skillPath);
        }

        const resourceModule = await loadCopiedResourceModule(fixture.modulePath);
        const server = new McpServer({ name: "maintenance-resource-negative-test", version: "1" });
        resourceModule.registerSyntxMaintenanceSkillResources(server);
        await withMcpClient(server, async (client) => {
          await assert.rejects(client.readResource({ uri: "syntx://maintenance/skill" }), (error: unknown) => {
            assert.ok(error instanceof Error);
            assert.equal(error.message.includes(entry.code), true);
            assert.equal(error.message.includes(fixture.root), false);
            assert.equal(error.message.includes("PRIVATE_SENTINEL"), false);
            return true;
          });
        });
      } finally {
        await rm(fixture.root, { recursive: true, force: true });
      }
    });
  }
});

async function withClient(
  server: McpServer,
  operation: (client: Client) => Promise<void>
): Promise<void> {
  const client = new Client({ name: "maintenance-resource-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    await operation(client);
  } finally {
    await client.close();
    await server.close();
  }
}

const RESOURCE_FIXTURE_TEXT: Readonly<Record<string, string>> = Object.freeze({
  "syntx://maintenance/skill": "# Synthetic packaged maintenance skill\n",
  "syntx://maintenance/cli-guide": "# Synthetic offline CLI guide\n",
  "syntx://maintenance/ui-guide": "# Synthetic UI audit guide\n"
});

async function createResourceFixture(moduleLayout: "src/mcp" | "dist/src/mcp"): Promise<{
  readonly root: string;
  readonly modulePath: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "syntx-maintenance-resource-test-"));
  await writeFile(join(root, "package.json"), JSON.stringify({ type: "module" }));
  for (const [uri, relativePath] of Object.entries(RESOURCE_FIXTURE_PATHS)) {
    const fullPath = join(root, relativePath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, RESOURCE_FIXTURE_TEXT[uri]!);
  }

  const moduleSource = await findCurrentResourceModule();
  const extension = moduleSource.endsWith(".ts") ? ".ts" : ".js";
  const modulePath = join(root, moduleLayout, `maintenance-skill-resources${extension}`);
  await mkdir(dirname(modulePath), { recursive: true });
  await copyFile(moduleSource, modulePath);
  return { root, modulePath };
}

async function findCurrentResourceModule(): Promise<string> {
  const compiledUrl = new URL("../src/mcp/maintenance-skill-resources.js", import.meta.url);
  if (existsSync(fileURLToPath(compiledUrl))) return fileURLToPath(compiledUrl);
  const sourceUrl = new URL("../src/mcp/maintenance-skill-resources.ts", import.meta.url);
  if (existsSync(fileURLToPath(sourceUrl))) return fileURLToPath(sourceUrl);
  throw new Error("MAINTENANCE_RESOURCE_TEST_MODULE_MISSING");
}

async function loadCopiedResourceModule(modulePath: string): Promise<{
  registerSyntxMaintenanceSkillResources(server: McpServer): void;
}> {
  return await import(pathToFileURL(modulePath).href) as {
    registerSyntxMaintenanceSkillResources(server: McpServer): void;
  };
}

const RESOURCE_FIXTURE_PATHS: Readonly<Record<string, string>> = Object.freeze({
  "syntx://maintenance/skill": "skills/syntx-mcp-update/SKILL.md",
  "syntx://maintenance/cli-guide": "skills/syntx-mcp-update/references/maintenance-cli.md",
  "syntx://maintenance/ui-guide": "skills/syntx-mcp-update/references/ui-audit-and-adaptation.md"
});

async function withMcpClient(server: McpServer, operation: (client: Client) => Promise<void>): Promise<void> {
  const client = new Client({ name: "maintenance-resource-protocol-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    await operation(client);
  } finally {
    await client.close();
    await server.close();
  }
}
