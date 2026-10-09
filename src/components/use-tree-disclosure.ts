'use client';
import { useEffect, useState } from 'react';
import { useUser } from './workspace';
export function useTreeDisclosure(id: string) {
  const { user } = useUser();
  const key = `maket:tree:${user.id}:${id}`;
  const [value, setOpen] = useState<boolean | null>(null);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem(key) === 'true');
    } catch {
      setOpen(false);
    }
  }, [key]);
  useEffect(() => {
    if (value !== null)
      try {
        localStorage.setItem(key, String(value));
      } catch {}
  }, [key, value]);
  return { open: value ?? false, setOpen };
}
