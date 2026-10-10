"use client";

import { useEffect, useState } from "react";

import MicroSlats from "@/components/MicroSlats";

/** React Bits MicroSlats as the hero backdrop. Light theme: pale blue slats on white with a blue glint; the animation freezes under reduced motion. */
export function HeroSlats() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduce(q.matches);
    sync();
    q.addEventListener("change", sync);
    return () => q.removeEventListener("change", sync);
  }, []);
  return (
    <MicroSlats
      preset="tide"
      color="#8aa9e8"
      glintColor="#0071e3"
      backgroundColor="#fbfbfd"
      paused={reduce}
      interactive={!reduce}
      slatWidth={9}
      slatHeight={21}
      gap={3}
    />
  );
}
