import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function isMainModule(metaUrl: string): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return (
      realpathSync(fileURLToPath(metaUrl)) === realpathSync(resolve(entry))
    );
  } catch {
    return false;
  }
}
