"use client";

import { Modal } from "antd";
import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from "react";

type Guard = {
  lock: (key: symbol) => void;
  unlock: (key: symbol) => void;
  navigate: (leave: () => void) => void;
  confirmDiscard: (dirty: boolean, leave: () => void, explicitClose?: boolean) => void;
};
const Context = createContext<Guard>({
  lock: () => {},
  unlock: () => {},
  navigate: (leave) => leave(),
  confirmDiscard: (_, leave) => leave(),
});

export function NavigationProtection({ children }: { children: ReactNode }) {
  const locks = useRef(new Set<symbol>());
  const activeLocation = useRef<{ href: string; state: unknown } | null>(null);
  const confirming = useRef(false);
  const replaying = useRef(false);
  const [modal, holder] = Modal.useModal();

  const lock = useCallback((key: symbol) => {
    if (!locks.current.size) activeLocation.current = { href: location.href, state: history.state };
    locks.current.add(key);
  }, []);
  const unlock = useCallback((key: symbol) => {
    locks.current.delete(key);
    if (!locks.current.size) activeLocation.current = null;
  }, []);
  const confirmDiscard = useCallback(
    (dirty: boolean, leave: () => void, explicitClose = false) => {
      if ((!dirty && !explicitClose) || replaying.current) {
        leave();
        return;
      }
      if (confirming.current) return;
      confirming.current = true;
      modal.confirm({
        title: dirty ? "Выйти без сохранения?" : "Закрыть форму?",
        content: dirty ? "В текущей форме есть несохранённые изменения." : undefined,
        okText: "Выйти",
        cancelText: "Продолжить работу",
        focusable: { autoFocusButton: "cancel" },
        zIndex: 2000,
        onOk: () => {
          replaying.current = true;
          try {
            leave();
          } finally {
            replaying.current = false;
          }
        },
        afterClose: () => {
          confirming.current = false;
        },
      });
    },
    [modal],
  );
  const navigate = useCallback(
    (leave: () => void) =>
      confirmDiscard(locks.current.size > 0, () => {
        locks.current.clear();
        activeLocation.current = null;
        leave();
      }),
    [confirmDiscard],
  );

  useEffect(() => {
    function click(event: MouseEvent) {
      if (
        !locks.current.size ||
        replaying.current ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey ||
        !(event.target instanceof Element)
      )
        return;
      const link = event.target.closest<HTMLAnchorElement>("a[href]:not([aria-expanded])");
      if (
        !link ||
        link.target === "_blank" ||
        link.hasAttribute("download") ||
        link.href === location.href
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      navigate(() => link.click());
    }
    function beforeUnload(event: BeforeUnloadEvent) {
      if (!locks.current.size || replaying.current) return;
      event.preventDefault();
      event.returnValue = "";
    }
    let approvedBack = false;
    function back(event: PopStateEvent) {
      const current = activeLocation.current;
      if (approvedBack) {
        approvedBack = false;
        return;
      }
      if (!current || location.href === current.href) return;
      event.stopImmediatePropagation();
      history.pushState(current.state, "", current.href);
      navigate(() => {
        approvedBack = true;
        history.back();
      });
    }
    document.addEventListener("click", click, true);
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("popstate", back, true);
    return () => {
      document.removeEventListener("click", click, true);
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("popstate", back, true);
    };
  }, [navigate]);

  return (
    <Context.Provider value={{ lock, unlock, navigate, confirmDiscard }}>
      {holder}
      {children}
    </Context.Provider>
  );
}

export function useNavigationGuard() {
  return useContext(Context);
}

export function useNavigationLock(active: boolean) {
  const { lock, unlock } = useNavigationGuard();
  const key = useRef(Symbol("unfinished form"));
  const release = useCallback(() => unlock(key.current), [unlock]);
  useEffect(() => {
    const current = key.current;
    if (active) lock(current);
    return () => unlock(current);
  }, [active, lock, unlock]);
  return release;
}
