import { createFrontendReceiver } from "@plane/logger/diagnostics-server";

export const runtime = "nodejs";
export const POST = createFrontendReceiver("plane-web");
