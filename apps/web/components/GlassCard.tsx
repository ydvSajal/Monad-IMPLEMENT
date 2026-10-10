"use client";

import type { ElementType, HTMLAttributes, PointerEvent } from "react";

import { cn } from "@/lib/utils";

/** Glass surface with a cursor spotlight. Pointer position goes to CSS vars (no React state, no re-render). */
export function GlassCard({ as: Tag = "div", className, children, ...rest }: HTMLAttributes<HTMLElement> & { as?: ElementType }) {
  return (
    <Tag
      {...rest}
      onPointerMove={(e: PointerEvent<HTMLElement>) => {
        const r = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
        e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
      }}
      className={cn(
        "glass group relative overflow-hidden rounded-xl transition-transform duration-300 hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        "before:pointer-events-none before:absolute before:inset-0 before:opacity-0 before:transition-opacity before:duration-300 hover:before:opacity-100",
        "before:[background:radial-gradient(320px_circle_at_var(--mx,50%)_var(--my,0%),color-mix(in_oklab,var(--tint)_24%,transparent),transparent_70%)]",
        className,
      )}
    >
      {children}
    </Tag>
  );
}
