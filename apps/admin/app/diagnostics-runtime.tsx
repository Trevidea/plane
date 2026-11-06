"use client";

import { useEffect } from "react";
import { installFrontendDiagnostics } from "@plane/logger/diagnostics-browser";

export function DiagnosticsRuntime() {
  useEffect(() => installFrontendDiagnostics(process.env.NEXT_PUBLIC_ADMIN_BASE_PATH || ""), []);
  return null;
}
