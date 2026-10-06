export async function register() {
  if (
    process.env.NEXT_RUNTIME !== "nodejs" ||
    process.env.CHAT_DEBUG_CAPTURE_ENABLED !== "1"
  )
    return;
  try {
    const { captureRuntime } = await import("./lib/observability/tracing");
    captureRuntime();
  } catch {
    console.error(JSON.stringify({ event: "chat_debug_init_failed" }));
  }
}
