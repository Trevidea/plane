"use client";
import { useEffect, useRef, useState } from "react";
import { Download, LoaderCircle } from "lucide-react";
import { downloadDiagnosticExport } from "./export";

export function ReportExportButton({ id, url }: { id: string; url: string }) {
  const active = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => () => active.current?.abort(), []);
  const download = async () => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError("");
    try {
      await downloadDiagnosticExport(url, id, controller.signal);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Report export failed.");
    } finally {
      active.current = null;
      setBusy(false);
    }
  };
  return (
    <div className="max-w-[220px]">
      <button
        type="button"
        aria-label={`Export JSON ${id}`}
        title="Export JSON"
        disabled={busy}
        onClick={() => void download()}
        className="grid size-8 place-items-center rounded border border-custom-border-200 hover:bg-custom-background-80 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-custom-primary-100"
      >
        {busy ? (
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
        ) : (
          <Download className="size-4" aria-hidden />
        )}
      </button>
      {error ? (
        <p className="mt-1 break-words text-xs text-red-500" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
