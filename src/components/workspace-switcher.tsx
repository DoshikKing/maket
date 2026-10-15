'use client';
import { useState } from 'react';
import { Check, ChevronDown, Plus, Workflow } from 'lucide-react';
import { api } from '@/lib/client';
import { Modal } from './modal';
export type WorkspaceItem = { id: string; name: string; revision: number };
export function WorkspaceSwitcher({
  initialItems,
  currentId,
}: {
  initialItems: WorkspaceItem[];
  currentId: string;
}) {
  const [items, setItems] = useState(initialItems),
    [creating, setCreating] = useState(false),
    [name, setName] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [created, setCreated] = useState<WorkspaceItem | null>(null);
  const current = items.find((i) => i.id === currentId);
  return (
    <>
      <details
        className="workspace-switcher"
        onToggle={async (event) => {
          if (!event.currentTarget.open) return;
          try {
            setItems(await api<WorkspaceItem[]>('workspaces'));
            setError('');
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <summary
          aria-label="Выбрать рабочую область"
          title={current?.name ?? 'Выбрать рабочую область'}
        >
          <Workflow size={16} />
          <span>
            <small>РАБОЧАЯ ОБЛАСТЬ</small>
            <strong>{current?.name ?? 'Рабочая область'}</strong>
          </span>
          <ChevronDown size={14} />
        </summary>
        <div className="workspace-switcher-menu">
          <div className="workspace-switcher-list" aria-label="Рабочие области">
            {items.map((item) => (
              <a
                key={item.id}
                href={`/api/workspaces/${item.id}/open`}
                aria-current={item.id === currentId ? 'true' : undefined}
              >
                {item.name}
                {item.id === currentId && <Check size={14} />}
              </a>
            ))}
          </div>
          <button
            className="secondary small"
            onClick={() => {
              setName('');
              setCreated(null);
              setError('');
              setCreating(true);
            }}
          >
            <Plus size={14} />
            Новая рабочая область
          </button>
          {error && !creating && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
      </details>
      {creating && (
        <Modal
          title={created ? 'Рабочая область создана' : 'Новая рабочая область'}
          onClose={() => setCreating(false)}
        >
          {created ? (
            <>
              <p>«{created.name}» готова к работе. В ней пока нет объектов и диаграмм.</p>
              <a className="primary" href={`/api/workspaces/${created.id}/open`}>
                Открыть рабочую область
              </a>
            </>
          ) : (
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                setBusy(true);
                setError('');
                try {
                  const item = await api<WorkspaceItem>('workspaces', 'POST', { name });
                  setItems((previous) => [...previous, item]);
                  setCreated(item);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <p className="muted">
                У новой области будут собственные объекты, связи, ракурсы и диаграммы.
              </p>
              <label>
                Название
                <input
                  aria-label="Название рабочей области"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={100}
                  required
                  autoFocus
                />
              </label>
              <button className="primary" type="submit" disabled={busy || !name.trim()}>
                {busy ? 'Создаём…' : 'Создать рабочую область'}
              </button>
            </form>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </Modal>
      )}
    </>
  );
}
