import assert from "node:assert/strict";
import * as fileSystem from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { runPackageTestCachePrime } from "../scripts/prime-package-test-cache.mjs";

const FIXED_DEPENDENCIES = Object.freeze({
  "@modelcontextprotocol/sdk": "1.32.1",
  zod: "4.5.4"
});

async function createFixture(dependencies = FIXED_DEPENDENCIES) {
  const root = await fileSystem.mkdtemp(join(tmpdir(), "syntx-package-cache-prime-test-"));
  const projectRoot = join(root, "project");
  const npmRoot = join(root, "trusted-npm");
  const npmCliPath = join(npmRoot, "bin", "npm-cli.js");
  const cachePath = join(root, "user-cache");
  await fileSystem.mkdir(projectRoot, { recursive: true });
  await fileSystem.mkdir(join(npmRoot, "bin"), { recursive: true });
  await fileSystem.mkdir(cachePath, { recursive: true });
  await fileSystem.writeFile(join(projectRoot, "package.json"), JSON.stringify({ name: "syntx-mcp", dependencies }));
  await fileSystem.writeFile(join(npmRoot, "package.json"), JSON.stringify({ name: "npm", bin: { npm: "bin/npm-cli.js" } }));
  await fileSystem.writeFile(npmCliPath, "// synthetic trusted npm cli fixture\n");
  return { root, projectRoot, npmRoot, npmCliPath, cachePath };
}

const dependenciesFor = (fixture, overrides = {}) => ({
  fs: fileSystem,
  projectRoot: fixture.projectRoot,
  tempDirectory: fixture.root,
  env: {
    npm_execpath: fixture.npmCliPath,
    PATH: process.env.PATH ?? "",
    NPM_TOKEN: "never-forward-this-fixture-value",
    NODE_AUTH_TOKEN: "never-forward-this-fixture-value",
    HTTPS_PROXY: "https://proxy.invalid"
  },
  execPath: process.execPath,
  ...overrides
});

test("help, default, and invalid arguments do no file or process I/O", async () => {
  let ioCalls = 0;
  const noIo = {
    fs: new Proxy({}, { get() { ioCalls += 1; throw new Error("unexpected filesystem access"); } }),
    runProcess: async () => { ioCalls += 1; throw new Error("unexpected subprocess"); }
  };
  const defaultResult = await runPackageTestCachePrime([], noIo);
  const helpResult = await runPackageTestCachePrime(["--help"], noIo);
  const invalidResult = await runPackageTestCachePrime(["--confirm-registry-fetch", "extra"], noIo);
  assert.equal(defaultResult.exitCode, 0);
  assert.equal(helpResult.exitCode, 0);
  assert.match(helpResult.stdout, /--confirm-registry-fetch/u);
  assert.equal(invalidResult.exitCode, 2);
  assert.equal(invalidResult.stderr, "PACKAGE_TEST_CACHE_PRIME_ARGUMENTS_INVALID\n");
  assert.equal(ioCalls, 0);
});

test("explicit confirmation resolves pinned dependencies and primes only the configured user cache", async () => {
  const fixture = await createFixture();
  try {
    const calls = [];
    let seedArguments;
    const writesBefore = await fileSystem.readFile(join(fixture.projectRoot, "package.json"), "utf8");
    const trustedCliPath = await fileSystem.realpath(fixture.npmCliPath);
    const canonicalFixtureRoot = await fileSystem.realpath(fixture.root);
    const canonicalCachePath = await fileSystem.realpath(fixture.cachePath);
    const result = await runPackageTestCachePrime(["--confirm-registry-fetch"], dependenciesFor(fixture, {
      runProcess: async (command, args, options) => {
        calls.push({ command, args, options });
        if (args[1] === "config") return { exitCode: 0, stdout: `${fixture.cachePath}\n`, stderr: "" };
        assert.equal(args[1], "install");
        const prefix = args[args.indexOf("--prefix") + 1];
        seedArguments = {
          prefix,
          userConfig: args[args.indexOf("--userconfig") + 1],
          globalConfig: args[args.indexOf("--globalconfig") + 1]
        };
        assert.deepEqual(JSON.parse(await fileSystem.readFile(join(prefix, "package.json"), "utf8")),
          { name: "syntx-package-test-cache-prime", version: "0.0.0", private: true });
        assert.equal(await fileSystem.readFile(args[args.indexOf("--userconfig") + 1], "utf8"), "");
        assert.equal(await fileSystem.readFile(args[args.indexOf("--globalconfig") + 1], "utf8"), "");
        return { exitCode: 0, stdout: "", stderr: "" };
      }
    }));
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "registry_cache_prime=PASS dependency_metadata=PRIMED registry=https://registry.npmjs.org offline_install=NOT_RUN\n");
    assert.equal(calls.length, 2);
    assert.equal(calls[0].command, process.execPath);
    assert.deepEqual(calls[0].args, [trustedCliPath, "config", "get", "cache"]);
    assert.equal(calls[1].command, process.execPath);
    assert.deepEqual(calls[1].args, [
      trustedCliPath, "install", "--ignore-scripts", "--no-audit", "--no-fund",
      "--registry=https://registry.npmjs.org", "--save-exact", "--prefix", seedArguments.prefix,
      "--cache", canonicalCachePath, "--userconfig", seedArguments.userConfig,
      "--globalconfig", seedArguments.globalConfig,
      "@modelcontextprotocol/sdk@1.32.1", "zod@4.5.4"
    ]);
    assert.equal(calls[1].options.env.NPM_TOKEN, undefined);
    assert.equal(calls[1].options.env.NODE_AUTH_TOKEN, undefined);
    assert.equal(calls[1].options.env.HTTPS_PROXY, undefined);
    const prefix = seedArguments.prefix;
    assert.equal(prefix.startsWith(canonicalFixtureRoot), true);
    assert.equal(dirname(prefix), canonicalFixtureRoot);
    assert.equal(basename(prefix).startsWith("syntx-package-test-cache-prime-"), true);
    await assert.rejects(fileSystem.stat(prefix), { code: "ENOENT" });
    assert.equal(await fileSystem.readFile(join(fixture.projectRoot, "package.json"), "utf8"), writesBefore);
  } finally {
    await fileSystem.rm(fixture.root, { recursive: true, force: true });
  }
});

test("non-exact or expanded package dependency sets fail before npm invocation", async () => {
  for (const dependencies of [
    { ...FIXED_DEPENDENCIES, zod: "^4.5.4" },
    { ...FIXED_DEPENDENCIES, zod: "04.5.4" },
    { ...FIXED_DEPENDENCIES, extra: "1.0.0" },
    { "@modelcontextprotocol/sdk": "1.32.1" }
  ]) {
    const fixture = await createFixture(dependencies);
    try {
      let calls = 0;
      const result = await runPackageTestCachePrime(["--confirm-registry-fetch"], dependenciesFor(fixture, {
        runProcess: async () => { calls += 1; throw new Error("must not run"); }
      }));
      assert.equal(result.exitCode, 1);
      assert.equal(result.stderr, "PACKAGE_TEST_CACHE_PRIME_DEPENDENCIES_INVALID\n");
      assert.equal(calls, 0);
    } finally {
      await fileSystem.rm(fixture.root, { recursive: true, force: true });
    }
  }
});

test("a configured cache inside the source tree is rejected before seed creation or registry install", async () => {
  const fixture = await createFixture();
  try {
    let calls = 0;
    const result = await runPackageTestCachePrime(["--confirm-registry-fetch"], dependenciesFor(fixture, {
      runProcess: async (_command, args) => {
        calls += 1;
        assert.deepEqual(args.slice(1), ["config", "get", "cache"]);
        return { exitCode: 0, stdout: `${join(fixture.projectRoot, ".npm-cache")}\n`, stderr: "" };
      }
    }));
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, "PACKAGE_TEST_CACHE_PRIME_USER_CACHE_PATH_INVALID\n");
    assert.equal(calls, 1);
    assert.deepEqual(await fileSystem.readdir(fixture.root), ["project", "trusted-npm", "user-cache"]);
  } finally {
    await fileSystem.rm(fixture.root, { recursive: true, force: true });
  }
});

test("registry install failures are sanitized and the created seed is removed", async () => {
  const fixture = await createFixture();
  try {
    let seedPath;
    const result = await runPackageTestCachePrime(["--confirm-registry-fetch"], dependenciesFor(fixture, {
      runProcess: async (_command, args) => {
        if (args[1] === "config") return { exitCode: 0, stdout: `${fixture.cachePath}\n`, stderr: "" };
        seedPath = args[args.indexOf("--prefix") + 1];
        return { exitCode: 1, stdout: "", stderr: "private raw subprocess detail" };
      }
    }));
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, "PACKAGE_TEST_CACHE_PRIME_REGISTRY_INSTALL_FAILED\n");
    assert.equal(JSON.stringify(result).includes("private raw subprocess detail"), false);
    assert.ok(seedPath);
    await assert.rejects(fileSystem.stat(seedPath), { code: "ENOENT" });
  } finally {
    await fileSystem.rm(fixture.root, { recursive: true, force: true });
  }
});
