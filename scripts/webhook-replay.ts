import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { whatsappAppSecret } from "../src/lib/whatsapp/config";
import { readEnvFile } from "./local-env";

function loadEnvLocal() {
  const file = readEnvFile(".env.local");
  for (const [key, value] of Object.entries(file)) {
    if (!process.env[key]) process.env[key] = value;
  }
}

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] !== "whatsapp") {
    fail("usage: bun scripts/webhook-replay.ts whatsapp --fixture <name>");
  }

  let fixture = "text-inbound.json";
  const fixtureIndex = args.indexOf("--fixture");
  if (fixtureIndex >= 0 && args[fixtureIndex + 1]) {
    fixture = args[fixtureIndex + 1];
  }

  loadEnvLocal();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) fail("NEXT_PUBLIC_SITE_URL is not set. Run bun run setup first.");

  const secret = whatsappAppSecret();
  if (!secret) {
    fail("WHATSAPP_APP_SECRET is not set (and no local stub is available).");
  }

  const fixturePath = resolve("src/test/fixtures/whatsapp", fixture);
  if (!existsSync(fixturePath)) fail(`fixture not found: ${fixturePath}`);
  const body = readFileSync(fixturePath, "utf8");
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

  const url = `${siteUrl.replace(/\/+$/, "")}/api/webhooks/whatsapp`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": signature,
    },
    body,
  });

  console.log(`POST ${url}`);
  console.log(`fixture ${fixture}`);
  console.log(`signature ${signature}`);
  console.log(`${response.status} ${await response.text()}`);
  if (!response.ok) process.exit(1);
}

await main();
