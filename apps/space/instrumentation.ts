export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerFrontendRuntime } = await import("@plane/logger/diagnostics-server");
    registerFrontendRuntime("plane-space");
  }
}
