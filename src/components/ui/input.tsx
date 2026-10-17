import type * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const controlClass =
  "h-11 w-full min-w-0 rounded-md border border-input bg-transparent px-3 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/70 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:h-9 md:text-sm dark:bg-input/20";

const inputVariants = cva(controlClass, {
  variants: {
    variant: {
      default: "",
      // Values entered as short codes: monospace + uppercase (hex colors).
      code: "font-mono uppercase",
      // Short codes that stay in the default font (e.g. two-letter country codes).
      uppercase: "uppercase",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

function Input({
  className,
  type,
  variant,
  ...props
}: React.ComponentProps<"input"> & VariantProps<typeof inputVariants>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(inputVariants({ variant, className }))}
      {...props}
    />
  );
}

export { controlClass, Input };
