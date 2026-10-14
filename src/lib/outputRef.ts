/**
 * Large step outputs are stored out of band and the run state carries a small
 * reference instead of the value:
 *
 *   {"__ref__": true, "uri", "key", "field", "bytes", "sha256", "preview",
 *    "kind", "download_url"?}
 *
 * The run response resolves small ones inline; big ones stay refs and carry a
 * `download_url` relative to the API root (same convention as run data
 * artifacts).
 */
export interface OutputRef {
  __ref__: true;
  uri?: string;
  key?: string;
  field?: string;
  bytes?: number;
  sha256?: string;
  preview?: string;
  kind?: string;
  download_url?: string;
}

export function isOutputRef(value: unknown): value is OutputRef {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).__ref__ === true
  );
}

/** Filename to save a ref's bytes under. */
export function outputRefFilename(ref: OutputRef): string {
  const fromUrl = ref.download_url?.split("?")[0].split("/").filter(Boolean).pop();
  const fromKey = ref.key?.split("/").filter(Boolean).pop();
  return fromUrl || fromKey || `${ref.field ?? "output"}.md`;
}

export function formatBytes(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return "? bytes";
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
