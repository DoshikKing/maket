'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { Modal } from './modal';
type Sharing = { enabled: boolean; path: string | null };
export function ShareDialog({
  id,
  selectedId,
  resource = 'diagrams',
  onClose,
}: {
  id: string;
  selectedId?: string;
  resource?: 'diagrams' | 'objects';
  onClose: () => void;
}) {
  const [sharing, setSharing] = useState<Sharing | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [copied, setCopied] = useState('');
  useEffect(() => {
    let active = true;
    api<Sharing>(`${resource}/${id}/share`)
      .then((s) => {
        if (active) setSharing(s);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [id, resource]);
  async function change(enabled: boolean, rotate = false) {
    const previous = sharing;
    setSharing((s) => (s ? { ...s, enabled } : s));
    setBusy(true);
    setError('');
    setCopied('');
    try {
      setSharing(await api(`${resource}/${id}/share`, 'POST', { enabled, rotate }));
    } catch (e) {
      setSharing(previous);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const url = sharing?.path ? new URL(sharing.path, location.origin).href : '';
  return (
    <Modal
      title={resource === 'objects' ? 'Поделиться объектом' : 'Поделиться диаграммой'}
      onClose={onClose}
    >
      <p>
        {resource === 'objects'
          ? 'Любой пользователь со ссылкой сможет просматривать свойства этого объекта, включая унаследованные атрибуты, без входа в аккаунт.'
          : 'Любой пользователь со ссылкой сможет просматривать последнюю сохранённую диаграмму и связанное дерево объектов без входа в аккаунт.'}
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
            {resource === 'objects' ? 'Открыть карточку' : 'Открыть вьюер'}
          </a>
          <small className="muted">
            Отключение доступа сохраняет адрес. Новая ссылка делает прежний адрес недействительным.
          </small>
        </div>
      )}
      {sharing && (
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void change(sharing.enabled, true)}
        >
          Сгенерировать новую
        </button>
      )}
      {busy && (
        <p className="muted" role="status">
          Сохраняем доступ…
        </p>
      )}
      {!busy && sharing && !sharing.enabled && <p className="muted">Доступ по ссылке отключён.</p>}
      {copied && <p role="status">{copied}</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </Modal>
  );
}
