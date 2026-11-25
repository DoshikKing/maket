'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import type { ModelDiagram, ModelDocument } from '@/lib/model';
import type { NotationItem } from './library';
import { useEditLease, LeaseNotice } from './collaboration';

export function DiagramNotations({
  bindings,
  usedBindings,
  disabled,
  onUpdate,
}: {
  bindings: ModelDocument['bindings'];
  usedBindings: string[];
  disabled?: boolean;
  onUpdate: (notationId?: string, removeBindingId?: string) => Promise<void>;
}) {
  const [notations, setNotations] = useState<NotationItem[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    api<NotationItem[]>('notations')
      .then((items) => {
        if (active) setNotations(items);
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  async function update(notationId?: string, bindingId?: string) {
    setBusy(true);
    setError('');
    try {
      await onUpdate(notationId, bindingId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="diagram-notations" aria-label="Нотации диаграммы">
      <div className="section-title">
        <h3>Нотации диаграммы</h3>
        <span className="muted small-text">{bindings.length} / 12</span>
      </div>
      <p className="muted small-text">
        Нотации определяют набор инструментов. Используемую нотацию отключить нельзя. Изменения
        сохраняются сразу.
      </p>
      {bindings.map((b) => (
        <div className="revision-row" key={b.id}>
          <span>
            <strong>{b.document.name}</strong>
            <small>
              v{b.document.version}
              {usedBindings.includes(b.id) ? ' · Используется' : ''}
            </small>
          </span>
          <button
            type="button"
            className="secondary small"
            disabled={disabled || busy || bindings.length === 1 || usedBindings.includes(b.id)}
            onClick={() => void update(undefined, b.id)}
          >
            Отключить {b.document.name}
          </button>
        </div>
      ))}
      <label className="form-stack">
        Добавить нотацию
        <select
          aria-label="Добавить нотацию"
          value=""
          disabled={disabled || busy || bindings.length >= 12 || !notations.length}
          onChange={(e) => {
            if (e.target.value) void update(e.target.value);
          }}
        >
          <option value="">Выберите нотацию…</option>
          {notations
            .filter(
              (n) =>
                !bindings.some(
                  (b) =>
                    b.document.id === n.document.id && b.document.version === n.document.version,
                ),
            )
            .map((n) => (
              <option key={n.id} value={n.id}>
                {n.name} · v{n.document.version}
              </option>
            ))}
        </select>
      </label>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}

// Diagram settings in the model tree use the same revision-checked API as the canvas.
export function ObjectDiagramNotations({
  diagramId,
  disabled,
  onChanged,
}: {
  diagramId: string;
  disabled: boolean;
  onChanged?: () => void;
}) {
  const [diagram, setDiagram] = useState<ModelDiagram>();
  const [error, setError] = useState('');
  const lease = useEditLease(diagram?.id, false);
  useEffect(() => {
    let active = true;
    api<ModelDiagram>(`diagrams/${diagramId}`)
      .then((item) => {
        if (active) setDiagram(item);
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [diagramId]);
  return (
    <>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {diagram && (
        <>
          <LeaseNotice {...lease} />
          <DiagramNotations
            bindings={diagram.document.bindings}
            usedBindings={[...diagram.document.nodes, ...diagram.document.edges].flatMap((e) =>
              e.bindingId ? [e.bindingId] : [],
            )}
            disabled={disabled || !lease.held}
            onUpdate={async (notationId, removeBindingId) => {
              try {
                const result = await api<ModelDiagram>(`diagrams/${diagram.id}/notations`, 'POST', {
                  revision: diagram.revision,
                  notationId,
                  removeBindingId,
                });
                setDiagram(result);
                onChanged?.();
              } catch (e) {
                // Reload after a concurrent edit so a retry uses the current revision.
                try {
                  setDiagram(await api<ModelDiagram>(`diagrams/${diagram.id}`));
                } catch {
                  /* Keep the original error. */
                }
                throw e;
              }
            }}
          />
        </>
      )}
    </>
  );
}
