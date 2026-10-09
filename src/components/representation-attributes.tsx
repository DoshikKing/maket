'use client';
import { useState } from 'react';
import { attributesSchema, effectiveAttributes, type ModelObject } from '@/lib/model';

type Attributes = ModelObject['attributes'];
export function RepresentationAttributes({
  local = {},
  object,
  onChange,
}: {
  local?: Attributes;
  object?: ModelObject;
  onChange: (attributes: Attributes) => void;
}) {
  const [key, setKey] = useState(''),
    [type, setType] = useState('string'),
    [value, setValue] = useState(''),
    [error, setError] = useState('');
  function update(next: Attributes) {
    const result = attributesSchema.safeParse(next);
    if (!result.success) {
      setError(result.error.issues[0].message);
      return;
    }
    setError('');
    onChange(result.data);
  }
  return (
    <section className="inspector-appearance representation-attributes form-stack">
      <h3>Атрибуты представления</h3>
      <p className="muted small-text">
        Значения объекта наследуются. Локальные значения действуют только для этого представления.
      </p>
      {object && (
        <p className="small-text">
          Объект: {object.name}
          {object.description && <small>{object.description}</small>}
        </p>
      )}
      {Object.entries(effectiveAttributes(local, object)).map(([name, v]) => {
        const own = Object.hasOwn(local, name);
        return (
          <div className="representation-attribute" key={name}>
            <label>
              {name} <small>{own ? 'Локальное' : 'Наследуется'}</small>
              {typeof v === 'boolean' ? (
                <input
                  aria-label={`Атрибут представления ${name}`}
                  type="checkbox"
                  disabled={!own}
                  checked={v}
                  onChange={(e) => update({ ...local, [name]: e.target.checked })}
                />
              ) : (
                <input
                  aria-label={`Атрибут представления ${name}`}
                  disabled={!own}
                  type={typeof v === 'number' ? 'number' : 'text'}
                  maxLength={typeof v === 'string' ? 2000 : undefined}
                  value={String(v)}
                  onChange={(e) => {
                    const next = typeof v === 'number' ? Number(e.target.value) : e.target.value;
                    if (typeof next !== 'number' || Number.isFinite(next))
                      update({ ...local, [name]: next });
                  }}
                />
              )}
            </label>
            {own ? (
              <button
                className="secondary small"
                onClick={() => {
                  const next = { ...local };
                  delete next[name];
                  update(next);
                }}
              >
                {object && Object.hasOwn(object.attributes, name)
                  ? 'Наследовать'
                  : 'Удалить атрибут'}
              </button>
            ) : (
              <button className="secondary small" onClick={() => update({ ...local, [name]: v })}>
                Переопределить
              </button>
            )}
          </div>
        );
      })}
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          const parsed =
            type === 'boolean' ? value === 'true' : type === 'number' ? Number(value) : value;
          if (!key || Object.hasOwn(local, key)) {
            setError('Укажите уникальный ключ локального атрибута');
            return;
          }
          const next = { ...local, [key]: parsed };
          const result = attributesSchema.safeParse(next);
          if (!result.success) {
            setError(result.error.issues[0].message);
            return;
          }
          update(next);
          setKey('');
          setValue('');
        }}
      >
        <label>
          Ключ нового атрибута
          <input
            aria-label="Ключ атрибута представления"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            pattern="[a-zA-Z0-9_-]+"
            maxLength={100}
            required
          />
        </label>
        <label>
          Тип
          <select
            aria-label="Тип атрибута представления"
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setValue(e.target.value === 'boolean' ? 'false' : '');
            }}
          >
            <option value="string">Текст</option>
            <option value="number">Число</option>
            <option value="boolean">Да / Нет</option>
          </select>
        </label>
        <label>
          Значение
          {type === 'boolean' ? (
            <select
              aria-label="Значение нового атрибута представления"
              value={value || 'false'}
              onChange={(e) => setValue(e.target.value)}
            >
              <option value="false">Нет</option>
              <option value="true">Да</option>
            </select>
          ) : (
            <input
              aria-label="Значение нового атрибута представления"
              type={type === 'number' ? 'number' : 'text'}
              maxLength={type === 'string' ? 2000 : undefined}
              value={value}
              required={type === 'number'}
              onChange={(e) => setValue(e.target.value)}
            />
          )}
        </label>
        <button className="secondary small" disabled={Object.keys(local).length >= 100}>
          Добавить атрибут представления
        </button>
      </form>
      {error && (
        <p className="error small-text" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
