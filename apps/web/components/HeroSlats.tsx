"use client";

import { useEffect, useState } from "react";

import MicroSlats from "@/components/MicroSlats";

/** React Bits MicroSlats as the hero backdrop. Colors follow the page theme; the animation freezes under reduced motion. */
export function HeroSlats() {
  const [mode, setMode] = useState<{ dark: boolean; reduce: boolean }>({ dark: true, reduce: false });
  useEffect(() => {
    const dark = window.matchMedia("(prefers-color-scheme: dark)");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setMode({ dark: dark.matches, reduce: reduce.matches });
    sync();
    dark.addEventListener("change", sync);
    reduce.addEventListener("change", sync);
    return () => {
      dark.removeEventListener("change", sync);
      reduce.removeEventListener("change", sync);
    };
  }, []);
  return (
    <MicroSlats
      preset="tide"
      color={mode.dark ? "#1f6b52" : "#8fd1b6"}
      glintColor={mode.dark ? "#6dffc9" : "#ffffff"}
      backgroundColor={mode.dark ? "#0a0d0c" : "#f6f7f6"}
      paused={mode.reduce}
      interactive={!mode.reduce}
      slatWidth={6}
      slatHeight={14}
      gap={2}
    />
  );
}
