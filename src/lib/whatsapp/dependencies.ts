import {
  sendWhatsAppInteractive,
  sendWhatsAppTemplate,
  sendWhatsAppText,
} from "./client";

export type WhatsAppTransport = {
  sendText: (
    input: Parameters<typeof sendWhatsAppText>[0],
  ) => ReturnType<typeof sendWhatsAppText>;
  sendTemplate: (
    input: Parameters<typeof sendWhatsAppTemplate>[0],
  ) => ReturnType<typeof sendWhatsAppTemplate>;
  sendInteractive: (
    input: Parameters<typeof sendWhatsAppInteractive>[0],
  ) => ReturnType<typeof sendWhatsAppInteractive>;
};

export type WhatsAppWorkerDependencies = {
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
      sendTemplate: sendWhatsAppTemplate,
      sendInteractive: sendWhatsAppInteractive,
    },
    now: () => new Date(),
    sleep: (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    ...overrides,
  };
}
