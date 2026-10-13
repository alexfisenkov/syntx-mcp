#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { lstat, mkdtemp, realpath, rm, writeFile, readFile } from "node:fs/promises";

export const PACKAGE_TEST_CACHE_PRIME_FLAG = "--confirm-registry-fetch";
export const PACKAGE_TEST_CACHE_PRIME_REGISTRY = "https://registry.npmjs.org";

const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const SEED_PREFIX = "syntx-package-test-cache-prime-";
const REQUIRED_DEPENDENCY_NAMES = Object.freeze(["@modelcontextprotocol/sdk", "zod"]);
const HELP_TEXT = [
  "Prime the current user's npm cache for the repository's exact test dependencies.",
  "",
  "Usage:",
  `  node scripts/prime-package-test-cache.mjs ${PACKAGE_TEST_CACHE_PRIME_FLAG}`,
  "",
  "No registry access occurs unless the exact confirmation flag is supplied.",
  "Only https://registry.npmjs.org is used; this does not run package or provider checks."
].join("\n") + "\n";

class PrimeCacheFailure extends Error {
  constructor(code) { super(code); this.name = "PrimeCacheFailure"; this.code = code; }
}

const execFileAsync = promisify(execFile);
const DEFAULT_FS = Object.freeze({ readFile, lstat, realpath, mkdtemp, writeFile, rm });

function isWithin(parent, target) {
  const child = relative(parent, target);
  return child === "" || (!isAbsolute(child) && child !== ".." && !child.startsWith(`..${sep}`));
}

function result(exitCode, stdout = "", stderr = "") {
  return Object.freeze({ exitCode, stdout, stderr });
}

function safeFailure(code) {
  return result(1, "", `PACKAGE_TEST_CACHE_PRIME_${code}\n`);
}

function parseArguments(argv) {
  if (!Array.isArray(argv) || argv.some((argument) => typeof argument !== "string")) return "invalid";
  if (argv.length === 0 || (argv.length === 1 && argv[0] === "--help")) return "help";
  if (argv.length === 1 && argv[0] === PACKAGE_TEST_CACHE_PRIME_FLAG) return "confirm";
  return "invalid";
}

function exactDependencySpecs(manifest) {
  const dependencies = manifest?.dependencies;
  if (dependencies === null || typeof dependencies !== "object" || Array.isArray(dependencies)) {
    throw new PrimeCacheFailure("DEPENDENCIES_INVALID");
  }
  const names = Object.keys(dependencies).sort();
  if (JSON.stringify(names) !== JSON.stringify([...REQUIRED_DEPENDENCY_NAMES].sort())) {
    throw new PrimeCacheFailure("DEPENDENCIES_INVALID");
  }
  return REQUIRED_DEPENDENCY_NAMES.map((name) => {
    const version = dependencies[name];
    if (typeof version !== "string" || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u.test(version)) {
      throw new PrimeCacheFailure("DEPENDENCIES_INVALID");
    }
    return `${name}@${version}`;
  });
}

async function resolveTrustedNpmCli(env, fileSystem) {
  const configuredPath = env?.npm_execpath;
  if (typeof configuredPath !== "string" || configuredPath.length < 1 || configuredPath.length > 4_096 ||
      configuredPath.includes("\0") || !isAbsolute(configuredPath) || basename(configuredPath).toLowerCase() !== "npm-cli.js") {
    throw new PrimeCacheFailure("NPM_CLI_INVALID");
  }
  let cliStats;
  let canonicalCliPath;
  try {
    cliStats = await fileSystem.lstat(configuredPath);
    canonicalCliPath = await fileSystem.realpath(configuredPath);
  } catch {
    throw new PrimeCacheFailure("NPM_CLI_INVALID");
  }
  if (!cliStats.isFile() || cliStats.isSymbolicLink() || !isAbsolute(canonicalCliPath)) {
    throw new PrimeCacheFailure("NPM_CLI_INVALID");
  }
  const npmRoot = resolve(dirname(canonicalCliPath), "..");
  let manifest;
  let declaredCliPath;
  try {
    manifest = JSON.parse(await fileSystem.readFile(join(npmRoot, "package.json"), "utf8"));
    if (manifest?.bin?.npm !== "bin/npm-cli.js") throw new PrimeCacheFailure("NPM_CLI_INVALID");
    declaredCliPath = await fileSystem.realpath(resolve(npmRoot, manifest.bin.npm));
  } catch (error) {
    if (error instanceof PrimeCacheFailure) throw error;
    throw new PrimeCacheFailure("NPM_CLI_INVALID");
  }
  if (manifest?.name !== "npm" || declaredCliPath !== canonicalCliPath) {
    throw new PrimeCacheFailure("NPM_CLI_INVALID");
  }
  return canonicalCliPath;
}

function safeInstallEnvironment(sourceEnvironment, cachePath) {
  const allowedKeys = new Set([
    "path", "systemroot", "windir", "temp", "tmp", "tmpdir", "userprofile", "appdata", "localappdata",
    "homedrive", "homepath", "comspec", "pathext"
  ]);
  const environment = Object.create(null);
  for (const [name, value] of Object.entries(sourceEnvironment ?? {})) {
    if (allowedKeys.has(name.toLowerCase()) && typeof value === "string") environment[name] = value;
  }
  environment.NPM_CONFIG_CACHE = cachePath;
  return environment;
}

async function defaultRunProcess(command, argumentsValue, options) {
  try {
    const response = await execFileAsync(command, argumentsValue, {
      ...options,
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true
    });
    return { exitCode: 0, stdout: response.stdout, stderr: response.stderr };
  } catch (error) {
    return {
      exitCode: Number.isInteger(error?.code) ? error.code : 1,
      stdout: typeof error?.stdout === "string" ? error.stdout : "",
      stderr: typeof error?.stderr === "string" ? error.stderr : ""
    };
  }
}

export async function runPackageTestCachePrime(argv = [], dependencies = {}) {
  const parsed = parseArguments(argv);
  if (parsed === "help") return result(0, HELP_TEXT);
  if (parsed === "invalid") return result(2, "", "PACKAGE_TEST_CACHE_PRIME_ARGUMENTS_INVALID\n");

  const fileSystem = dependencies.fs ?? DEFAULT_FS;
  const runProcess = dependencies.runProcess ?? defaultRunProcess;
  const environment = dependencies.env ?? process.env;
  const nodeExecutable = dependencies.execPath ?? process.execPath;
  const projectRootInput = resolve(dependencies.projectRoot ?? PROJECT_ROOT);
  let projectRoot;
  let seedPath;
  let validatedSeedPath;
  let temporaryRoot;
  let finalResult;

  try {
    if (typeof nodeExecutable !== "string" || !isAbsolute(nodeExecutable)) {
      throw new PrimeCacheFailure("NODE_EXECUTABLE_INVALID");
    }
    try { projectRoot = await fileSystem.realpath(projectRootInput); }
    catch { throw new PrimeCacheFailure("PROJECT_ROOT_INVALID"); }
    let sourceManifest;
    try { sourceManifest = JSON.parse(await fileSystem.readFile(join(projectRoot, "package.json"), "utf8")); }
    catch { throw new PrimeCacheFailure("PACKAGE_MANIFEST_INVALID"); }
    const dependencySpecs = exactDependencySpecs(sourceManifest);
    const npmCliPath = await resolveTrustedNpmCli(environment, fileSystem);

    let cacheResult;
    try {
      cacheResult = await runProcess(nodeExecutable, [npmCliPath, "config", "get", "cache"], {
        cwd: projectRoot,
        env: environment,
        timeout: 15_000
      });
    } catch {
      throw new PrimeCacheFailure("USER_CACHE_DISCOVERY_FAILED");
    }
    if (cacheResult?.exitCode !== 0 || typeof cacheResult.stdout !== "string") {
      throw new PrimeCacheFailure("USER_CACHE_DISCOVERY_FAILED");
    }
    const cacheValue = cacheResult.stdout.trim();
    if (cacheValue.length < 1 || cacheValue.length > 4_096 || /[\r\n\0]/u.test(cacheValue) || !isAbsolute(cacheValue)) {
      throw new PrimeCacheFailure("USER_CACHE_PATH_INVALID");
    }
    const cachePath = resolve(cacheValue);
    let effectiveCachePath;
    try { effectiveCachePath = await fileSystem.realpath(cachePath); }
    catch (error) {
      if (error?.code !== "ENOENT") throw new PrimeCacheFailure("USER_CACHE_PATH_INVALID");
      let cacheParent;
      try { cacheParent = await fileSystem.realpath(dirname(cachePath)); }
      catch { throw new PrimeCacheFailure("USER_CACHE_PATH_INVALID"); }
      effectiveCachePath = join(cacheParent, basename(cachePath));
    }
    if (effectiveCachePath === parse(effectiveCachePath).root || dirname(effectiveCachePath) === parse(effectiveCachePath).root ||
        isWithin(projectRoot, effectiveCachePath)) {
      throw new PrimeCacheFailure("USER_CACHE_PATH_INVALID");
    }

    try { temporaryRoot = await fileSystem.realpath(dependencies.tempDirectory ?? (await import("node:os")).tmpdir()); }
    catch { throw new PrimeCacheFailure("TEMP_ROOT_INVALID"); }
    seedPath = await fileSystem.mkdtemp(join(temporaryRoot, SEED_PREFIX));
    let seedStats;
    try {
      seedStats = await fileSystem.lstat(seedPath);
      validatedSeedPath = await fileSystem.realpath(seedPath);
    } catch { throw new PrimeCacheFailure("SEED_DIRECTORY_INVALID"); }
    if (!seedStats.isDirectory() || seedStats.isSymbolicLink() || !isAbsolute(validatedSeedPath) ||
        dirname(validatedSeedPath) !== temporaryRoot || !basename(validatedSeedPath).startsWith(SEED_PREFIX)) {
      throw new PrimeCacheFailure("SEED_DIRECTORY_INVALID");
    }

    const seedManifestPath = join(validatedSeedPath, "package.json");
    const userConfigPath = join(validatedSeedPath, "npm-user.npmrc");
    const globalConfigPath = join(validatedSeedPath, "npm-global.npmrc");
    const projectConfigPath = join(validatedSeedPath, ".npmrc");
    try {
      await fileSystem.writeFile(seedManifestPath, `${JSON.stringify({
        name: "syntx-package-test-cache-prime", version: "0.0.0", private: true
      }, null, 2)}\n`, { flag: "wx" });
      await fileSystem.writeFile(userConfigPath, "", { flag: "wx" });
      await fileSystem.writeFile(globalConfigPath, "", { flag: "wx" });
      await fileSystem.writeFile(projectConfigPath, "", { flag: "wx" });
    } catch { throw new PrimeCacheFailure("SEED_SETUP_FAILED"); }

    let installResult;
    try {
      installResult = await runProcess(nodeExecutable, [npmCliPath, "install", "--ignore-scripts", "--no-audit", "--no-fund",
        `--registry=${PACKAGE_TEST_CACHE_PRIME_REGISTRY}`, "--save-exact", "--prefix", validatedSeedPath,
        "--cache", effectiveCachePath, "--userconfig", userConfigPath, "--globalconfig", globalConfigPath,
        ...dependencySpecs], {
        cwd: validatedSeedPath,
        env: safeInstallEnvironment(environment, effectiveCachePath),
        timeout: 120_000
      });
    } catch { throw new PrimeCacheFailure("REGISTRY_INSTALL_FAILED"); }
    if (installResult?.exitCode !== 0) throw new PrimeCacheFailure("REGISTRY_INSTALL_FAILED");
    finalResult = result(0,
      "registry_cache_prime=PASS dependency_metadata=PRIMED registry=https://registry.npmjs.org offline_install=NOT_RUN\n");
  } catch (error) {
    finalResult = safeFailure(error instanceof PrimeCacheFailure ? error.code : "UNEXPECTED_FAILURE");
  } finally {
    if (validatedSeedPath !== undefined) {
      try {
        const after = await fileSystem.lstat(validatedSeedPath);
        const currentRealpath = await fileSystem.realpath(validatedSeedPath);
        if (!after.isDirectory() || after.isSymbolicLink() || currentRealpath !== validatedSeedPath ||
            dirname(currentRealpath) !== temporaryRoot || !basename(currentRealpath).startsWith(SEED_PREFIX)) {
          throw new PrimeCacheFailure("SEED_CLEANUP_TARGET_INVALID");
        }
        await fileSystem.rm(validatedSeedPath, { recursive: true, force: false });
      } catch {
        finalResult = safeFailure("SEED_CLEANUP_FAILED");
      }
    }
  }
  return finalResult ?? safeFailure("UNEXPECTED_FAILURE");
}

export async function main(argv = process.argv.slice(2)) {
  const output = await runPackageTestCachePrime(argv);
  if (output.stdout !== "") process.stdout.write(output.stdout);
  if (output.stderr !== "") process.stderr.write(output.stderr);
  return output.exitCode;
}

const entry = process.argv[1];
if (entry !== undefined && resolve(entry) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = await main();
}
