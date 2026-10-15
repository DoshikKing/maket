'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { entityLabels } from '@/lib/model';
import type { PublicObject } from '@/lib/sharing';
export function PublicObjectViewer({ id, token }: { id: string; token: string }) {
  const [object, setObject] = useState<PublicObject | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setObject(null);
    setError('');
    api<PublicObject>(`public-objects/${encodeURIComponent(id)}/${encodeURIComponent(token)}`).then(
      (value) => {
        if (active) setObject(value);
      },
      (reason) => {
        if (active) setError(reason.message);
      },
    );
    return () => {
      active = false;
    };
  }, [id, token]);
  return (
    <main className="public-object-page">
      <section className="public-object-card form-stack" aria-label="Свойства объекта">
        <p className="muted">maket · Просмотр объекта</p>
        {error ? (
          <p role="alert" className="error">
            {error}
          </p>
        ) : !object ? (
          <p role="status">Загружаем свойства…</p>
        ) : (
          <>
            <h1>{object.name}</h1>
            <p className="muted">
              {object.derivation === 'instance'
                ? 'Реализация · «instance»'
                : object.derivation === 'inheritance'
                  ? 'Наследник'
                  : entityLabels[object.kind as keyof typeof entityLabels]}
              {object.archived ? ' · Архив' : ''}
            </p>
            <label>
              ID объекта
              <input
                aria-label="ID объекта"
                readOnly
                value={object.id}
                onFocus={(e) => e.target.select()}
              />
            </label>
            <label>
              Имя объекта
              <input aria-label="Имя объекта" readOnly value={object.name} />
            </label>
            <label>
              Описание объекта
              <textarea
                aria-label="Описание объекта"
                readOnly
                value={object.description}
                rows={3}
              />
            </label>
            <h2>Атрибуты</h2>
            {Object.keys(object.attributes).length ? (
              <table className="public-object-attributes">
                <thead>
                  <tr>
                    <th>Атрибут</th>
                    <th>Значение</th>
                    <th>Источник</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(object.attributes).map(([key, value]) => (
                    <tr key={key}>
                      <th scope="row">{key}</th>
                      <td>{typeof value === 'boolean' ? (value ? 'Да' : 'Нет') : String(value)}</td>
                      <td>
                        {Object.hasOwn(object.ownAttributes, key) ? 'Собственный' : 'Унаследован'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted">Атрибуты не заданы.</p>
            )}
            <p className="muted small-text">Только просмотр · Версия объекта: {object.revision}</p>
          </>
        )}
      </section>
    </main>
  );
}
