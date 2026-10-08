'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { Modal } from './modal';
type Sharing = { enabled: boolean; path: string | null };
export function ShareDialog({
  id,
  selectedId,
  onClose,
}: {
  id: string;
  selectedId?: string;
  onClose: () => void;
}) {
  const [sharing, setSharing] = useState<Sharing | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [copied, setCopied] = useState('');
  useEffect(() => {
    let active = true;
    api<Sharing>(`diagrams/${id}/share`)
      .then((s) => {
        if (active) setSharing(s);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [id]);
  async function change(enabled: boolean, rotate = false) {
    const previous = sharing;
    setSharing((s) => (s ? { ...s, enabled, path: enabled ? s.path : null } : s));
    setBusy(true);
    setError('');
    setCopied('');
    try {
      setSharing(await api(`diagrams/${id}/share`, 'POST', { enabled, rotate }));
    } catch (e) {
      setSharing(previous);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const url = sharing?.path ? new URL(sharing.path, location.origin).href : '';
  return (
    <Modal title="Поделиться диаграммой" onClose={onClose}>
      <p>
        Любой пользователь со ссылкой сможет просматривать последнюю сохранённую диаграмму и
        связанное дерево объектов без входа в аккаунт.
      </p>
      {sharing && (
        <label className="inline-check">
          <input
            type="checkbox"
            checked={sharing.enabled}
            disabled={busy}
            onChange={(e) => void change(e.target.checked)}
          />
          Доступ по ссылке
        </label>
      )}
      {url && (
        <div className="form-stack">
          <label>
            Публичная ссылка
            <input
              aria-label="Публичная ссылка"
              readOnly
              value={url}
              onFocus={(e) => e.target.select()}
            />
          </label>
          <button
            className="secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                setCopied('Ссылка скопирована');
              } catch {
                setCopied('Выделите и скопируйте ссылку из поля');
              }
            }}
          >
            Копировать ссылку
          </button>
          {selectedId && (
            <label>
              Ссылка на выделенный элемент
              <input
                aria-label="Ссылка на выделенный элемент"
                readOnly
                value={`${url}?element=${encodeURIComponent(selectedId)}`}
                onFocus={(e) => e.target.select()}
              />
            </label>
          )}
          <a href={url} target="_blank" rel="noreferrer">
            Открыть вьюер
          </a>
          <button className="secondary" disabled={busy} onClick={() => void change(true, true)}>
            Заменить ссылку
          </button>
          <small className="muted">
            Замена или отключение ссылки закрывает доступ по прежнему адресу.
          </small>
        </div>
      )}
      {copied && <p role="status">{copied}</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </Modal>
  );
}
