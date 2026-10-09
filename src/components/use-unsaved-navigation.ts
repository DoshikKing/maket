'use client';
import { useEffect, useRef } from 'react';

type NavigationResult = { committed: Promise<unknown>; finished: Promise<unknown> };
type BrowserNavigation = EventTarget & {
  currentEntry: { key: string };
  reload: () => NavigationResult;
  traverseTo: (key: string) => NavigationResult;
};
type NavigateEvent = Event & {
  navigationType: string;
  destination: { sameDocument: boolean; url: string; key: string };
};

/** Full document navigation uses the same browser confirmation as reload. */
export function useUnsavedNavigation(dirty: boolean, saveBeforeLeave?: () => Promise<boolean>) {
  const current = useRef({ dirty, saveBeforeLeave });
  current.current = { dirty, saveBeforeLeave };
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!current.current.dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const click = async (event: MouseEvent) => {
      const anchor = (event.target as Element).closest?.('a[href]') as HTMLAnchorElement | null;
      if (
        !current.current.dirty ||
        !anchor ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey ||
        anchor.target ||
        anchor.hasAttribute('download')
      )
        return;
      const destination = new URL(anchor.href);
      if (
        destination.origin !== location.origin ||
        (destination.pathname === location.pathname && destination.search === location.search)
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (current.current.saveBeforeLeave) {
        if (!(await current.current.saveBeforeLeave())) return;
        current.current.dirty = false;
      }
      window.location.assign(destination.href);
    };
    const navigation = (window as unknown as { navigation?: BrowserNavigation }).navigation;
    const pendingKey = 'maket:pending-history-navigation';
    // After an approved reload, resume the original history traversal in the clean document.
    const pending = sessionStorage.getItem(pendingKey);
    if (pending && navigation) {
      sessionStorage.removeItem(pendingKey);
      const result = navigation.traverseTo(pending);
      void result.committed.catch(() => {});
      void result.finished.catch(() => {});
    }
    const traverse = (event: Event) => {
      const e = event as NavigateEvent;
      if (!current.current.dirty || e.navigationType !== 'traverse' || !e.destination.sameDocument)
        return;
      const destination = new URL(e.destination.url);
      if (destination.pathname === location.pathname && destination.search === location.search)
        return;
      // Cancel before Next.js changes the editor, then ask the native reload confirmation.
      e.preventDefault();
      if (!e.defaultPrevented) return;
      sessionStorage.setItem(pendingKey, e.destination.key);
      const result = navigation!.reload();
      void result.committed.catch(() => {});
      void result.finished.catch(() => sessionStorage.removeItem(pendingKey));
    };
    window.addEventListener('beforeunload', warn);
    document.addEventListener('click', click, true);
    navigation?.addEventListener('navigate', traverse);
    return () => {
      window.removeEventListener('beforeunload', warn);
      document.removeEventListener('click', click, true);
      navigation?.removeEventListener('navigate', traverse);
    };
  }, []);
}
