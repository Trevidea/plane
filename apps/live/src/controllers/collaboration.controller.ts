import type { Hocuspocus } from "@hocuspocus/server";
import type { Request } from "express";
import type WebSocket from "ws";
// plane imports
import { Controller, WebSocket as WSDecorator } from "@plane/decorators";

import { legacyLiveLog, observeWebSocket } from "@/lib/diagnostics";

@Controller("/collaboration")
export class CollaborationController {
  [key: string]: unknown;
  private readonly hocusPocusServer: Hocuspocus;

  constructor(hocusPocusServer: Hocuspocus) {
    this.hocusPocusServer = hocusPocusServer;
  }

  @WSDecorator("/")
  handleConnection(ws: WebSocket, req: Request) {
    try {
      observeWebSocket(ws, req.headers);
      // Initialize the connection with Hocuspocus
      this.hocusPocusServer.handleConnection(ws, req);

      // Set up error handling for the connection
      ws.on("error", (error: Error) => {
        legacyLiveLog("error", "LIVE_C94541AB3C3E", "COLLABORATION_CONTROLLER: WebSocket connection error:", error);
        ws.close(1011, "Internal server error");
      });
    } catch (error) {
      legacyLiveLog("error", "LIVE_23374FBDD02C", "COLLABORATION_CONTROLLER: WebSocket connection error:", error);
      ws.close(1011, "Internal server error");
    }
  }
}
