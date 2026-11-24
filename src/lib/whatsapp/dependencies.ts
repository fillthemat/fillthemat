import { sendWhatsAppInteractive, sendWhatsAppTemplate, sendWhatsAppText } from "./client";
import { connectionTransport } from "./connection-transport";

export type WhatsAppTransport = {
  sendText: (
    input: Parameters<typeof sendWhatsAppText>[0] & { schoolId: string },
  ) => ReturnType<typeof sendWhatsAppText>;
  sendTemplate: (
    input: Parameters<typeof sendWhatsAppTemplate>[0] & { schoolId: string },
  ) => ReturnType<typeof sendWhatsAppTemplate>;
  sendInteractive: (
    input: Parameters<typeof sendWhatsAppInteractive>[0] & { schoolId: string },
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
    transport: connectionTransport,
    now: () => new Date(),
    sleep,
    ...overrides,
  };
}

import { sleep } from "@/lib/sleep";
