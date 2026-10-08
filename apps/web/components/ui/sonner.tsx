"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"

// theme is locked at the root (dark-first, tokens flip under prefers-color-scheme), so sonner follows the system
const Toaster = (props: ToasterProps) => (
  <Sonner
    theme="system"
    className="toaster group"
    style={
      {
        "--normal-bg": "var(--popover)",
        "--normal-text": "var(--popover-foreground)",
        "--normal-border": "var(--border)",
        "--border-radius": "var(--radius)",
      } as React.CSSProperties
    }
    {...props}
  />
)

export { Toaster }
