import type { fetchPayload, onLoadDocumentPayload, storePayload } from "@hocuspocus/server";
import type { DiagnosticContext } from "@/lib/diagnostics";

export type TConvertDocumentRequestBody = {
  description_html: string;
  variant: "rich" | "document";
};

export interface OnLoadDocumentPayloadWithContext extends onLoadDocumentPayload {
  context: HocusPocusServerContext;
}

export interface FetchPayloadWithContext extends fetchPayload {
  context: HocusPocusServerContext;
}

export interface StorePayloadWithContext extends storePayload {
  context: HocusPocusServerContext;
}

export type TDocumentTypes = "project_page";

// Additional Hocuspocus types that are not exported from the main package
export type HocusPocusServerContext = {
  diagnostics?: DiagnosticContext;
  projectId: string | null;
  cookie: string;
  documentType: TDocumentTypes;
  workspaceSlug: string | null;
  userId: string;
};
