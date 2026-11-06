"use client";
import { useEffect } from "react";
import { reportFrontendFailure } from "@plane/logger/diagnostics-browser";

export default function RootErrorPage({ error }: { error: Error }) {
  useEffect(() => {
    reportFrontendFailure(error, process.env.NEXT_PUBLIC_ADMIN_BASE_PATH || "");
  }, [error]);
  return (
    <div>
      <p>Something went wrong.</p>
    </div>
  );
}
