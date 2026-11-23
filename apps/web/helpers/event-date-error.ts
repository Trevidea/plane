export function getEventDateError(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;

  const fields = "data" in error ? error.data : error;
  if (!fields || typeof fields !== "object") return undefined;

  for (const field of ["start_date", "target_date", "start_time"] as const) {
    const value = (fields as Record<string, unknown>)[field];
    const message = Array.isArray(value) ? value[0] : value;
    if (typeof message === "string" && message) return message;
  }
}
