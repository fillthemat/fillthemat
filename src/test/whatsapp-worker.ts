import { drainDueWhatsAppDeliveries } from "@/lib/whatsapp/deliveries";
import type { WhatsAppWorkerDependencies } from "@/lib/whatsapp/dependencies";
import {
  drainWhatsAppJobs,
  runWhatsAppWorkerOnce,
} from "@/lib/whatsapp/worker";

/** Every integration runner must name its own numbers; historical dates are not isolation. */
export function scopedWhatsAppRunner(phoneNumberIds: () => string[]) {
  function dependencies(
    overrides: Partial<WhatsAppWorkerDependencies> = {},
  ): Partial<WhatsAppWorkerDependencies> {
    let elapsed = 0;
    const start = new Date();
    const clock = overrides.now ?? (() => start);
    return {
      ...overrides,
      phoneNumberIds: phoneNumberIds(),
      now: () => new Date(clock().getTime() + elapsed),
      sleep:
        overrides.sleep ??
        (async (milliseconds) => {
          elapsed += milliseconds;
        }),
    };
  }
  return {
    runWhatsAppWorkerOnce: (
      runId: string,
      overrides?: Partial<WhatsAppWorkerDependencies>,
    ) => runWhatsAppWorkerOnce(runId, dependencies(overrides)),
    drainWhatsAppJobs: (
      runId: string,
      limit?: number,
      overrides?: Partial<WhatsAppWorkerDependencies>,
      opts?: Parameters<typeof drainWhatsAppJobs>[3],
    ) => drainWhatsAppJobs(runId, limit, dependencies(overrides), opts),
    drainDueWhatsAppDeliveries: (
      runId: string,
      limit?: number,
      overrides?: Partial<WhatsAppWorkerDependencies>,
      opts?: Parameters<typeof drainDueWhatsAppDeliveries>[3],
    ) =>
      drainDueWhatsAppDeliveries(runId, limit, dependencies(overrides), opts),
  };
}
