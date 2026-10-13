import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";

type EvidenceReferenceStyle =
  | "STATIC_IMPORT"
  | "EXPORT_FROM"
  | "LITERAL_DYNAMIC_IMPORT"
  | "NON_LITERAL_DYNAMIC_IMPORT";

interface EvidenceReference {
  readonly style: EvidenceReferenceStyle;
  readonly specifier: string | null;
}

const FIXTURE_SPECIFIERS = [
  "../src/catalog/normalized-settings-ir.js",
  "../src/catalog/normalized-settings-parser-canary.js",
  "../src/catalog/normalized-settings-parser-census-manifest.js",
  "../src/catalog/normalized-settings-parser-source-backed-result.js",
  "../tools/settings-ir/static-settings-compiler.js"
] as const;

const EVIDENCE_MODULE_ORIGINS = new Set([
  "src/catalog/normalized-settings-ir.ts",
  "src/catalog/normalized-settings-parser-canary.ts",
  "src/catalog/normalized-settings-parser-census-manifest.ts",
  "src/catalog/normalized-settings-parser-source-backed-result.ts"
]);

test("detects every evidence-only family through all supported import styles", () => {
  const fixtureBuilders: ReadonlyArray<{
    readonly style: EvidenceReferenceStyle;
    readonly build: (specifier: string) => string;
  }> = [
    {
      style: "STATIC_IMPORT",
      build: (specifier) => `import evidence from "${specifier}";`
    },
    {
      style: "EXPORT_FROM",
      build: (specifier) => `export { evidence } from "${specifier}";`
    },
    {
      style: "LITERAL_DYNAMIC_IMPORT",
      build: (specifier) => `void import("${specifier}");`
    }
  ];

  for (const specifier of FIXTURE_SPECIFIERS) {
    for (const fixture of fixtureBuilders) {
      assert.deepEqual(
        findEvidenceOnlyReferences(
          "src/runtime/fixture.ts",
          fixture.build(specifier)
        ),
        [{ style: fixture.style, specifier }],
        `${fixture.style} must detect ${specifier}`
      );
    }
  }
});

test("ignores comments, ordinary strings, and safe literal dynamic imports", () => {
  const source = `
// import "../src/catalog/normalized-settings-ir.js";
const documentation = "../src/catalog/normalized-settings-parser-canary.js";
const moduleName = "../src/catalog/normalized-settings-parser-census-manifest.js";
void documentation;
void moduleName;
void import("../runtime/safe-module.js");
`;

  assert.deepEqual(
    findEvidenceOnlyReferences("src/runtime/fixture.ts", source),
    []
  );
});

test("fails closed for variable and concatenated dynamic imports", () => {
  const cases = [
    `const moduleName = "../runtime/safe-module.js"; void import(moduleName);`,
    `void import("../runtime/" + "safe-module.js");`,
    "const moduleName = 'safe-module'; void import(`../runtime/${moduleName}.js`);"
  ];

  for (const source of cases) {
    assert.deepEqual(
      findEvidenceOnlyReferences("src/runtime/fixture.ts", source),
      [{ style: "NON_LITERAL_DYNAMIC_IMPORT", specifier: null }]
    );
  }
});

test("excludes evidence modules themselves as scan origins", () => {
  const source =
    'export { evidence } from "../tools/settings-ir/compiler.js";';
  for (const path of [
    "src/catalog/normalized-settings-ir.ts",
    "src/catalog/normalized-settings-parser-canary.ts",
    "src/catalog/normalized-settings-parser-census-manifest.ts",
    "src/catalog/normalized-settings-parser-source-backed-result.ts"
  ]) {
    assert.deepEqual(findEvidenceOnlyReferences(path, source), []);
  }
});

test("does not exclude an evidence-module basename outside src/catalog", () => {
  const specifier = "../tools/settings-ir/compiler.js";
  assert.deepEqual(
    findEvidenceOnlyReferences(
      "src/runtime/normalized-settings-parser-canary.ts",
      `export { evidence } from "${specifier}";`
    ),
    [{ style: "EXPORT_FROM", specifier }]
  );
});

test("production src has no runtime references to evidence-only modules", async () => {
  const violations: string[] = [];
  for (const path of await listTypeScriptFiles("src")) {
    const source = await readFile(path, "utf8");
    for (const reference of findEvidenceOnlyReferences(path, source)) {
      violations.push(
        `${path}: ${reference.style} -> ${reference.specifier ?? "NON_LITERAL_ARGUMENT"}`
      );
    }
  }

  assert.deepEqual(
    violations,
    [],
    `production runtime must not reference evidence-only settings modules:\n${violations.join("\n")}`
  );
});

function findEvidenceOnlyReferences(
  path: string,
  source: string
): EvidenceReference[] {
  if (isEvidenceModuleOrigin(path)) return [];

  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.toLowerCase().endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const references: EvidenceReference[] = [];
  const addReference = (
    style: EvidenceReferenceStyle,
    expression: ts.Expression | undefined
  ): void => {
    if (
      expression !== undefined &&
      ts.isStringLiteralLike(expression) &&
      isEvidenceOnlySpecifier(expression.text)
    ) {
      references.push({ style, specifier: expression.text });
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      addReference("STATIC_IMPORT", node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      addReference("STATIC_IMPORT", node.moduleReference.expression);
    } else if (ts.isExportDeclaration(node)) {
      addReference("EXPORT_FROM", node.moduleSpecifier);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const argument = node.arguments[0];
      if (argument !== undefined && ts.isStringLiteralLike(argument)) {
        addReference("LITERAL_DYNAMIC_IMPORT", argument);
      } else {
        references.push({
          style: "NON_LITERAL_DYNAMIC_IMPORT",
          specifier: null
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return references;
}

function isEvidenceOnlySpecifier(specifier: string): boolean {
  const normalized = specifier.replaceAll("\\", "/").toLowerCase();
  return (
    normalized.includes("normalized-settings-ir") ||
    normalized.includes("normalized-settings-parser-canary") ||
    normalized.includes("normalized-settings-parser-source-backed-result") ||
    normalized.includes("census-manifest") ||
    normalized.includes("tools/settings-ir")
  );
}

function isEvidenceModuleOrigin(path: string): boolean {
  const normalized = path
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .toLowerCase();
  return EVIDENCE_MODULE_ORIGINS.has(normalized);
}

async function listTypeScriptFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listTypeScriptFiles(path)));
    } else if (entry.isFile() && /\.[cm]?tsx?$/u.test(entry.name)) {
      files.push(path);
    }
  }
  return files.sort();
}
