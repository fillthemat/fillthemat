"use client";

import { Switch as SwitchPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

// Throwaway control for the WhatsApp flow discussion; not production UI.
export function PrototypeSwitch(
  props: ComponentProps<typeof SwitchPrimitive.Root>,
) {
  return (
    <SwitchPrimitive.Root
      {...props}
      className="inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-border bg-muted transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 data-[state=checked]:bg-primary"
    >
      <SwitchPrimitive.Thumb className="block size-5 translate-x-0.5 rounded-full bg-foreground transition-transform data-[state=checked]:translate-x-5 data-[state=checked]:bg-primary-foreground" />
    </SwitchPrimitive.Root>
  );
}
