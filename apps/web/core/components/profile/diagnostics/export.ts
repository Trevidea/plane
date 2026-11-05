const MAX_BYTES = 16 * 1024 * 1024 + 8192;

export async function readDiagnosticExport(response: Response, analysisId: string): Promise<string> {
  if (!response.ok)
    throw new Error(
      response.status === 403
        ? "Administrator access is required."
        : response.status === 409
          ? "The report is not ready or export is busy."
          : "The report is unavailable or expired."
    );
  if (response.headers.get("content-type")?.split(";")[0] !== "application/json" || !response.body)
    throw new Error("The export did not contain JSON.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw new Error("The export exceeds its download limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    if (
      !value ||
      value.format !== "kanavio-diagnostic-export" ||
      value.version !== 1 ||
      Object.keys(value).sort().join(",") !==
        "analysis_id,format,incident_id,installation_id,report,report_sha256,version" ||
      value.analysis_id !== analysisId ||
      (value.incident_id !== null && !/^[a-f0-9]{32}$/.test(String(value.incident_id))) ||
      !/^[a-f0-9]{32}$/.test(String(value.installation_id)) ||
      !/^[a-f0-9]{64}$/.test(String(value.report_sha256)) ||
      !value.report ||
      typeof value.report !== "object" ||
      Array.isArray(value.report)
    )
      throw new Error();
  } catch {
    throw new Error("The report export is invalid or incomplete.");
  }
  return text;
}

export async function downloadDiagnosticExport(url: string, analysisId: string, signal?: AbortSignal): Promise<void> {
  const destination = new URL(url, window.location.origin);
  if (destination.origin !== window.location.origin || !/^[a-f0-9]{32}$/.test(analysisId))
    throw new Error("Invalid report export destination.");
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 20000);
  try {
    const response = await fetch(destination, {
      credentials: "include",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    const text = await readDiagnosticExport(response, analysisId);
    const objectUrl = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `diagnostic-${analysisId}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
