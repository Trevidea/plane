// eslint-disable-next-line import/order
import { setupSentry } from "./instrument";
setupSentry();


// eslint-disable-next-line import/order -- Keep instrumentation setup ahead of application initialization.
import { legacyLiveLog, diagnostic } from "@/lib/diagnostics";
import { Server } from "./server";

let server: Server;

async function startServer() {
  server = new Server();
  try {
    await server.initialize();
    server.listen();
  } catch {
    diagnostic("service.failed", { error_code: "STARTUP_FAILED" }, "error");
    process.exit(1);
  }
}

startServer();

// Handle process signals
process.on("SIGTERM", async () => {
  legacyLiveLog("info", "LIVE_5393D6B256B8", "Received SIGTERM signal. Initiating graceful shutdown...");
  try {
    if (server) {
      await server.destroy();
    }
    legacyLiveLog("info", "LIVE_B4A3DDC32837", "Server shut down gracefully");
  } catch {
    diagnostic("service.shutdown.failed", { error_code: "SHUTDOWN_FAILED" }, "error");
    process.exit(1);
  }
  process.exit(0);
});

process.on("SIGINT", async () => {
  legacyLiveLog("info", "LIVE_FD18D1BEDD77", "Received SIGINT signal. Killing node process...");
  try {
    if (server) {
      await server.destroy();
    }
    legacyLiveLog("info", "LIVE_7B25516A7A5A", "Server shut down gracefully");
  } catch {
    diagnostic("service.shutdown.failed", { error_code: "SHUTDOWN_FAILED" }, "error");
    process.exit(1);
  }
  process.exit(1);
});

process.on("unhandledRejection", () => {
  diagnostic("service.failed", { error_code: "UNHANDLED_REJECTION" }, "error");
});

process.on("uncaughtException", () => {
  diagnostic("service.failed", { error_code: "UNCAUGHT_EXCEPTION" }, "error");
});
