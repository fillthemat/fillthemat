import { randomUUID } from "node:crypto";
import { runWhatsAppWorkerOnce } from "../src/lib/whatsapp/worker";
import { readEnvFile } from "./local-env";

function loadEnvLocal() {
  const file = readEnvFile(".env.local");
  for (const [key, value] of Object.entries(file)) {
    if (!process.env[key]) process.env[key] = value;
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.includes("--once")) {
    console.error("usage: bun scripts/whatsapp-worker.ts --once  (drains one worker tick)");
    process.exit(1);
  }
  loadEnvLocal();
  const result = await runWhatsAppWorkerOnce(`local:${randomUUID()}`);
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

await main();
