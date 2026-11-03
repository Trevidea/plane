import { Hocuspocus } from "@hocuspocus/server";
import type { BroadcastedEvent } from "@plane/editor/lib";

import { Redis } from "@/extensions/redis";
import { legacyLiveLog } from "@/lib/diagnostics";
import { AppError } from "@/lib/errors";

export const broadcastMessageToPage = async (
  hocuspocusServerInstance: Hocuspocus,
  documentName: string,
  eventData: BroadcastedEvent
): Promise<boolean> => {
  if (!hocuspocusServerInstance || !hocuspocusServerInstance.documents) {
    const appError = new AppError("HocusPocus server not available or initialized", {
      context: { operation: "broadcastMessageToPage", documentName },
    });
    legacyLiveLog("error", "LIVE_275BC21988A7", "Error while broadcasting message:", appError);
    return false;
  }

  const redisExtension = hocuspocusServerInstance.configuration.extensions.find((ext) => ext instanceof Redis);

  if (!redisExtension) {
    legacyLiveLog("error", "LIVE_89BFE2F2E8A9", "BROADCAST_MESSAGE_TO_PAGE: Redis extension not found");
    return false;
  }

  try {
    await redisExtension.broadcastToDocument(documentName, eventData);
    return true;
  } catch (error) {
    legacyLiveLog(
      "error",
      "LIVE_E7A3BBD910D7",
      `BROADCAST_MESSAGE_TO_PAGE: Error broadcasting to ${documentName}:`,
      error
    );
    return false;
  }
};
