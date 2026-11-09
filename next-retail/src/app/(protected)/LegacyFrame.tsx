"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useNavigationGuard } from "./NavigationProtection";
import { legacyRoute } from "../../domain/navigation";

export default function LegacyFrame({ src, title }: { src: string; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const router = useRouter();
  const { lock, unlock, navigate } = useNavigationGuard();
  useEffect(() => {
    const active = new Map<string, symbol>();
    function onMessage(event: MessageEvent) {
      if (event.origin !== "http://127.0.0.1:8788" || event.source !== frame.current?.contentWindow)
        return;
      const message = event.data;
      if (
        message?.type === "aroma:form-lock" &&
        typeof message.key === "string" &&
        typeof message.open === "boolean"
      ) {
        const current = active.get(message.key);
        if (message.open && !current) {
          const key = Symbol(message.key);
          active.set(message.key, key);
          lock(key);
        } else if (!message.open && current) {
          active.delete(message.key);
          unlock(current);
        }
      } else if (message?.type === "aroma:navigate") {
        const route = legacyRoute(message.page);
        if (route) navigate(() => router.push(route));
      }
    }
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      active.forEach(unlock);
    };
  }, [lock, navigate, router, src, unlock]);
  return (
    <iframe
      key={src}
      ref={frame}
      className="legacy-section-frame"
      title={title}
      src={src}
      referrerPolicy="no-referrer"
    />
  );
}
