"use client";

import { SpeakerHighIcon, SpeakerSlashIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

/** Demo video in a browser-window frame. Autoplays muted (browsers block sound); reduced motion gets controls instead of autoplay. */
export function HeroVideo() {
  const ref = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  useEffect(() => {
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) ref.current?.play().catch(() => {});
  }, []);
  return (
    <div className="overflow-hidden rounded-2xl border border-black/10 bg-white/70 shadow-[0_30px_80px_-20px_rgba(0,113,227,0.35)] backdrop-blur">
      <div className="flex items-center gap-3 border-b border-black/5 px-4 py-2.5">
        <div className="flex gap-1.5">
          <span className="size-3 rounded-full bg-[#ff5f57]" />
          <span className="size-3 rounded-full bg-[#febc2e]" />
          <span className="size-3 rounded-full bg-[#28c840]" />
        </div>
        <div className="flex-1 truncate rounded-md bg-black/[0.04] px-3 py-1 font-mono text-xs text-muted-foreground">gigtrust.grounded.sajal.sbs</div>
      </div>
      <div className="relative aspect-video bg-black">
        <video ref={ref} src="/demo.mp4" muted={muted} loop playsInline preload="metadata" className="size-full object-cover" aria-label="GigTrust demo video" />
        <button
          type="button"
          onClick={() => {
            setMuted(!muted);
            ref.current?.play().catch(() => {});
          }}
          className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-black/75 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur hover:bg-black"
        >
          {muted ? <SpeakerSlashIcon className="size-4" /> : <SpeakerHighIcon className="size-4" />}
          {muted ? "Unmute" : "Mute"}
        </button>
      </div>
    </div>
  );
}
