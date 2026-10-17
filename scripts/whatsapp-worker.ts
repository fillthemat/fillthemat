import { randomUUID } from "node:crypto";
import { runWhatsAppWorkerOnce } from "../src/lib/whatsapp/worker";

async function main() {
  const args = process.argv.slice(2);
  if (!args.includes("--once")) {
    console.error("usage: bun scripts/whatsapp-worker.ts --once  (drains one worker tick)");
    process.exit(1);
  }
  const result = await runWhatsAppWorkerOnce(`local:${randomUUID()}`);
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

await main();
