import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export interface ImageArtifactLinkInput {
  readonly url: unknown;
  readonly mime_type?: unknown;
}

/** Finds artifact fields only on an already projected tool result. */
export function imageArtifactContentForResult(value: unknown): CallToolResult["content"] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const artifacts: ImageArtifactLinkInput[] = [];
  for (const key of ["images", "artifacts"] as const) {
    const entries = record[key];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (entry !== null && typeof entry === "object" && !Array.isArray(entry) && "url" in entry) {
        artifacts.push(entry as ImageArtifactLinkInput);
      }
    }
  }
  const artifact = record.artifact;
  if (artifact !== null && typeof artifact === "object" && !Array.isArray(artifact) && "url" in artifact) {
    artifacts.push(artifact as ImageArtifactLinkInput);
  }
  return imageArtifactContent(artifacts);
}

/** Serializes the content text while removing URL userinfo from artifact fields. */
export function imageArtifactResultJsonText(value: unknown): string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  const sanitized: Record<string, unknown> = { ...record };
  for (const key of ["images", "artifacts"] as const) {
    const entries = record[key];
    if (Array.isArray(entries)) sanitized[key] = entries.map(redactArtifactUrl);
  }
  if (record.artifact !== null && typeof record.artifact === "object" && !Array.isArray(record.artifact)) {
    sanitized.artifact = redactArtifactUrl(record.artifact);
  }
  return JSON.stringify(sanitized);
}

function redactArtifactUrl(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value) || !("url" in value) || typeof value.url !== "string") return value;
  try {
    const parsed = new URL(value.url);
    return parsed.username === "" && parsed.password === "" ? value : { ...value, url: "[omitted credentialed artifact URL]" };
  } catch {
    return value;
  }
}

/** Adds client-visible links for valid source result URLs without retrieving them. */
export function imageArtifactContent(artifacts: readonly ImageArtifactLinkInput[]): CallToolResult["content"] {
  const seen = new Set<string>();
  const links: Array<{ name: string; uri: string; mimeType?: string }> = [];

  for (const artifact of artifacts) {
    if (typeof artifact.url !== "string") continue;
    let parsed: URL;
    try {
      parsed = new URL(artifact.url);
    } catch {
      continue;
    }
    if (parsed.protocol !== "https:" || parsed.hostname.length === 0 || parsed.username !== "" || parsed.password !== "") continue;
    const uri = parsed.href;
    if (seen.has(uri)) continue;
    seen.add(uri);
    links.push({
      name: `Generated image ${links.length + 1}`,
      uri,
      ...(typeof artifact.mime_type === "string" && /^image\/(?:jpeg|png|webp|gif)$/u.test(artifact.mime_type)
        ? { mimeType: artifact.mime_type }
        : {})
    });
  }

  if (links.length === 0) return [];
  const markdown = links.map(({ name, uri }) => `![${name}](<${uri}>)\n[Open ${name}](<${uri}>)`).join("\n\n");
  return [
    { type: "text", text: markdown },
    ...links.map(({ name, uri, mimeType }) => ({
      type: "resource_link" as const,
      name,
      uri,
      ...(mimeType === undefined ? {} : { mimeType })
    }))
  ];
}
