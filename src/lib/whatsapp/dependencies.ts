import { sendWhatsAppInteractive, sendWhatsAppText } from "./client";

export type WhatsAppTransport = {
  sendText: (
    input: Parameters<typeof sendWhatsAppText>[0],
  ) => ReturnType<typeof sendWhatsAppText>;
  sendInteractive: (
    input: Parameters<typeof sendWhatsAppInteractive>[0],
  ) => ReturnType<typeof sendWhatsAppInteractive>;
};

export type WhatsAppWorkerDependencies = {
  /** Optional tenant-number scope for isolated queue runners. Undefined sweeps all. */
  phoneNumberIds?: string[];
  transport: WhatsAppTransport;
  now: () => Date;
  sleep: (milliseconds: number) => Promise<void>;
};

export function whatsappWorkerDependencies(
  overrides: Partial<WhatsAppWorkerDependencies> = {},
): WhatsAppWorkerDependencies {
  return {
    transport: {
      sendText: sendWhatsAppText,
      sendInteractive: sendWhatsAppInteractive,
    },
    now: () => new Date(),
    sleep,
    ...overrides,
  };
}

import { sleep } from "@/lib/sleep";
