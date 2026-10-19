'use client';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Users, LockKeyhole } from 'lucide-react';
import { api, ApiError, activeEditLeases } from '@/lib/client';
import {
  builtinRoles,
  permitted,
  workspaceActions,
  type WorkspaceAccess,
  type WorkspaceAction,
} from '@/lib/workspace-permissions';
import { Modal } from './modal';
type Lock = { targetId: string; userId: string; userName: string; expiresAt: string };
type State = { access: WorkspaceAccess; revision: number; locks: Lock[] };
const Context = createContext<{ state: State | null; error: string; refresh: () => Promise<void> }>(
  { state: null, error: '', refresh: async () => {} },
);
export const useCollaboration = () => useContext(Context);
export function CollaborationProvider({
  workspaceId,
  children,
}: {
  workspaceId: string;
  children: ReactNode;
}) {
  const [state, setState] = useState<State | null>(null),
    [error, setError] = useState('');
  const version = useRef<number | null>(null);
  const pending = useRef(false);
  async function refresh() {
    if (pending.current) return;
    pending.current = true;
    try {
      const next = await api<State>('collaboration');
      const changed = version.current !== null && next.revision !== version.current;
      version.current = next.revision;
      setState(next);
      setError('');
      if (changed) window.dispatchEvent(new Event('maket:workspace-changed'));
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError && [401, 403, 404].includes(e.status)) setState(null);
    } finally {
      pending.current = false;
    }
  }
  useEffect(() => {
    version.current = null;
    void refresh();
    const poll = () => {
      if (!document.hidden) void refresh();
    };
    const timer = setInterval(poll, 2000);
    window.addEventListener('focus', poll);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', poll);
    };
  }, [workspaceId]);
  return <Context.Provider value={{ state, error, refresh }}>{children}</Context.Provider>;
}
// One tab may edit an object both through its diagram and its property card.
// Server locks keep these leases separate, so closing a card never unlocks a diagram.
export function useEditLease(targetId?: string, acquireLease = true) {
  const { state } = useCollaboration();
  const [held, setHeld] = useState(false),
    [message, setMessage] = useState('Проверяем доступ…');
  const [attempt, setAttempt] = useState(0);
  const allow =
    !!state && permitted(state.access, targetId ? 'edit' : 'create', targetId ? [targetId] : []);
  useEffect(() => {
    let active = true,
      inFlight = false,
      acquired = false,
      stopped = false;
    setHeld(false);
    if (!allow) {
      setMessage(state ? 'Доступ только для просмотра' : 'Проверяем доступ…');
      return;
    }
    if (!targetId || !acquireLease) {
      setHeld(true);
      setMessage('');
      return;
    }
    const leaseId = crypto.randomUUID();
    const acquire = async () => {
      if (inFlight || !active || stopped) return;
      inFlight = true;
      try {
        await api(`collaboration/locks/${targetId}`, 'POST', { renew: acquired, leaseId });
        acquired = true;
        if (active) {
          activeEditLeases.set(targetId, leaseId);
          setHeld(true);
          setMessage('');
        } else void api(`collaboration/locks/${targetId}`, 'DELETE', { leaseId }).catch(() => {});
      } catch (e) {
        if (active) {
          if (activeEditLeases.get(targetId) === leaseId) activeEditLeases.delete(targetId);
          stopped = true;
          setHeld(false);
          setMessage((e as Error).message);
        }
      } finally {
        inFlight = false;
      }
    };
    void acquire();
    const timer = setInterval(() => void acquire(), 12000);
    const release = () => {
      if (activeEditLeases.get(targetId) === leaseId) activeEditLeases.delete(targetId);
      void api(`collaboration/locks/${targetId}`, 'DELETE', { leaseId }).catch(() => {});
    };
    window.addEventListener('pagehide', release);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('pagehide', release);
      release();
    };
  }, [targetId, allow, attempt, acquireLease]);
  return { held: allow && held, message, allow, retry: () => setAttempt((v) => v + 1) };
}
export function LeaseNotice({
  held,
  message,
  allow,
  retry,
}: {
  held: boolean;
  message: string;
  allow?: boolean;
  retry?: () => void;
}) {
  return held ? null : (
    <div className="collaboration-notice" role="status">
      <LockKeyhole size={16} />
      {message || 'Редактирование недоступно'}
      {allow && retry && (
        <button type="button" className="secondary small" onClick={retry}>
          Получить доступ
        </button>
      )}
    </div>
  );
}
const actionLabels: Record<WorkspaceAction, string> = {
  read: 'Просмотр пространства',
  create: 'Создание',
  edit: 'Редактирование',
  delete: 'Удаление',
  share: 'Публичные ссылки',
  members: 'Участники',
  roles: 'Роли',
  unlock: 'Снятие блокировок',
};
function activityLabel(value: string) {
  const [method, resource] = value.split(' ');
  const names: Record<string, string> = {
    objects: 'объекта',
    relations: 'связи',
    diagrams: 'диаграммы',
    viewpoints: 'ракурса',
    'context-links': 'перехода',
    workspaces: 'пространства',
    'collaboration/members': 'участников',
    'collaboration/roles': 'ролей',
  };
  const [base, operation] = (resource ?? '').split('/');
  const noun = names[resource] ?? names[base] ?? 'элемента';
  if (operation === 'share') return `Настройка публикации ${noun}`;
  if (operation === 'restore') return `Восстановление ${noun}`;
  if (operation === 'duplicate') return `Копирование ${noun}`;
  return `${({ POST: 'Создание / настройка', PATCH: 'Изменение', PUT: 'Сохранение', DELETE: 'Удаление' } as Record<string, string>)[method] ?? 'Изменение'} ${noun}`;
}
type Role = {
  id: string;
  name: string;
  actions: WorkspaceAction[];
  elementIds: string[];
  revision: number;
};
type Person = { id: string; name: string; email: string };
type Members = { owner: Person; members: { user: Person; role: string }[] };
type Entity = { id: string; name: string; kind?: string };
export function WorkspaceAccessButton() {
  const { state, error } = useCollaboration();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="secondary compact"
        onClick={() => setOpen(true)}
        title="Участники и доступ"
      >
        <Users size={16} />
        {state?.access.name ?? (error ? 'Нет соединения' : 'Доступ')}
      </button>
      {open && <AccessDialog onClose={() => setOpen(false)} />}
    </>
  );
}
function AccessDialog({ onClose }: { onClose: () => void }) {
  const { state, refresh } = useCollaboration();
  const [members, setMembers] = useState<Members | null>(null),
    [roles, setRoles] = useState<Role[]>([]),
    [entities, setEntities] = useState<Entity[]>([]),
    [email, setEmail] = useState(''),
    [role, setRole] = useState('editor'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [draft, setDraft] = useState<Role | null>(null),
    [events, setEvents] = useState<
      { id: string; userName: string; action: string; targetId?: string; createdAt: string }[]
    >([]);
  const can = (a: WorkspaceAction) => !!state && permitted(state.access, a);
  async function load() {
    try {
      const [r, m, s, e] = await Promise.all([
        api<Role[]>('collaboration/roles'),
        can('members') ? api<Members>('collaboration/members') : Promise.resolve(null),
        api<{ objects: Entity[]; relations: Entity[]; diagrams: Entity[] }>('model'),
        api<typeof events>('collaboration/events'),
      ]);
      setRoles(r);
      setMembers(m);
      setEntities([
        ...s.objects,
        ...s.relations,
        ...s.diagrams.filter((d) => !s.objects.some((o) => o.id === d.id)),
      ]);
      setEvents(e);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, [state?.access.role]);
  async function mutate(path: string, method: string, data?: unknown) {
    setBusy(true);
    setError('');
    try {
      await api(path, method, data);
      await refresh();
      await load();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const options = (
    <>
      {Object.entries(builtinRoles).map(([id, r]) => (
        <option key={id} value={id}>
          {r.name}
        </option>
      ))}
      {roles.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name}
        </option>
      ))}
    </>
  );
  return (
    <Modal title="Участники и доступ к пространству" onClose={onClose} className="access-modal">
      <p className="muted">
        Ваша роль: {state?.access.name ?? 'Нет доступа'}. Участники видят всё пространство.
        Ограничения элементов задают, что можно изменять.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {members && (
        <>
          <h3>Участники</h3>
          <p>
            {members.owner.name} · {members.owner.email} · Владелец
          </p>
          {members.members.map((m) => (
            <div className="access-member" key={m.user.id}>
              <span>
                <strong>{m.user.name}</strong>
                <small>{m.user.email}</small>
              </span>
              <select
                aria-label={`Роль ${m.user.email}`}
                value={m.role}
                disabled={busy}
                onChange={(e) =>
                  void mutate('collaboration/members', 'PATCH', {
                    email: m.user.email,
                    role: e.target.value,
                  })
                }
              >
                {options}
              </select>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void mutate(`collaboration/members/${m.user.id}`, 'DELETE')}
              >
                Отозвать доступ
              </button>
            </div>
          ))}
          <form
            className="access-member"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await mutate('collaboration/members', 'POST', { email, role })) setEmail('');
            }}
          >
            <input
              aria-label="Email участника"
              type="email"
              placeholder="Email зарегистрированного пользователя"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <select
              aria-label="Роль нового участника"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              {options}
            </select>
            <button className="primary" disabled={busy}>
              Добавить
            </button>
          </form>
        </>
      )}
      <h3>Роли</h3>
      <div className="access-roles">
        {Object.entries(builtinRoles).map(([id, r]) => (
          <div key={id}>
            <strong>{r.name}</strong>
            <small>{r.actions.map((a) => actionLabels[a]).join(', ')}</small>
          </div>
        ))}
        {roles.map((r) => (
          <div key={r.id}>
            <strong>{r.name}</strong>
            <small>
              {r.actions.map((a) => actionLabels[a]).join(', ')}
              {r.elementIds.length ? ` · ${r.elementIds.length} элементов` : ''}
            </small>
            {can('roles') && (
              <span>
                <button className="secondary" onClick={() => setDraft(r)}>
                  Изменить
                </button>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void mutate(`collaboration/roles/${r.id}`, 'DELETE')}
                >
                  Удалить
                </button>
              </span>
            )}
          </div>
        ))}
      </div>
      {can('roles') && (
        <button
          className="secondary"
          onClick={() =>
            setDraft({ id: '', name: '', actions: ['read'], elementIds: [], revision: 1 })
          }
        >
          Создать роль
        </button>
      )}
      {draft && (
        <form
          className="form-stack access-role-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await mutate(
                `collaboration/roles${draft.id ? `/${draft.id}` : ''}`,
                draft.id ? 'PATCH' : 'POST',
                draft,
              )
            )
              setDraft(null);
          }}
        >
          <label>
            Название роли
            <input
              required
              maxLength={100}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <div className="access-actions">
            {workspaceActions.map((a) => (
              <label key={a}>
                <input
                  type="checkbox"
                  disabled={a === 'read'}
                  checked={draft.actions.includes(a)}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      actions: e.target.checked
                        ? [...draft.actions, a]
                        : draft.actions.filter((v) => v !== a),
                    })
                  }
                />
                {actionLabels[a]}
              </label>
            ))}
          </div>
          <label>
            Редактируемые элементы (пустой список — вся область)
            <select
              multiple
              size={7}
              value={draft.elementIds}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  elementIds: Array.from(e.target.selectedOptions, (o) => o.value),
                })
              }
            >
              {entities.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} · {o.kind ?? 'связь / диаграмма'} · {o.id}
                </option>
              ))}
            </select>
          </label>
          <small className="muted">
            Ограничения не наследуются по дереву. Для редактирования диаграммы разрешите саму
            диаграмму и все её объекты и связи. Административные действия действуют на всё
            пространство.
          </small>
          <div className="button-row">
            <button className="primary" disabled={busy}>
              Сохранить роль
            </button>
            <button type="button" className="secondary" onClick={() => setDraft(null)}>
              Отмена
            </button>
          </div>
        </form>
      )}
      <h3>Активные блокировки</h3>
      {!state?.locks.length && <p className="muted">Сейчас нет занятых элементов.</p>}
      {Array.from(new Map(state?.locks.map((l) => [l.targetId, l]) ?? []).values()).map((l) => (
        <div className="access-member" key={l.targetId}>
          <span>
            {entities.find((o) => o.id === l.targetId)?.name ?? l.targetId}
            <small>Редактирует {l.userName}</small>
          </span>
          {can('unlock') && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void mutate(`collaboration/locks/${l.targetId}`, 'DELETE', { force: true })
              }
            >
              Снять блокировку
            </button>
          )}
        </div>
      ))}
      <h3>Последние изменения</h3>
      <div className="access-events">
        {events.map((e) => (
          <p key={e.id}>
            <strong>{e.userName}</strong> · {activityLabel(e.action)}{' '}
            {e.targetId && (entities.find((o) => o.id === e.targetId)?.name ?? e.targetId)}
            <small>{new Date(e.createdAt).toLocaleString('ru-RU')}</small>
          </p>
        ))}
      </div>
      <p className="muted small-text">
        Изменения синхронизируются каждые 2 секунды. Занятые элементы доступны для просмотра;
        блокировка освобождается при закрытии редактора или через 45 секунд без продления.
      </p>
    </Modal>
  );
}
