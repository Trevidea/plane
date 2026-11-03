"use client";

import { useParams } from "next/navigation";
import { AccountDiagnosticsPage } from "@/components/profile/diagnostics/page";

export default function DiagnosticsSettingsPage() {
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  return <AccountDiagnosticsPage key={workspaceSlug} workspaceSlug={workspaceSlug} />;
}
