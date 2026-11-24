'use client';
import { useEffect, useState } from 'react';
import { Plug, Copy, Plus, Trash2, Pencil } from 'lucide-react';
import { api } from '@/lib/client';
import { appPath } from '@/lib/base-path';
import {
  mcpCapabilities,
  mcpCapabilityLabels,
  readOnlyMcpCapabilities,
  type McpGrant,
} from '@/lib/mcp-permissions';
import type { WorkspaceItem } from './workspace-switcher';
type Key = {
  id: string;
  name: string;
  prefix: string;
  grants: McpGrant[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  revision: number;
};
export function McpSettings() {
  const [keys, setKeys] = useState<Key[]>([]),
    [areas, setAreas] = useState<WorkspaceItem[]>([]);
  const [editing, setEditing] = useState<Key | 'new' | null>(null),
    [name, setName] = useState(''),
    [grants, setGrants] = useState<McpGrant[]>([]),
    [expires, setExpires] = useState('');
  const [secret, setSecret] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  async function load() {
    const [k, w] = await Promise.all([api<Key[]>('mcp-keys'), api<WorkspaceItem[]>('workspaces')]);
    setKeys(k);
    setAreas(w);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  function edit(key: Key | 'new') {
    setEditing(key);
    setSecret('');
    setError('');
    setMessage('');
    setName(key === 'new' ? '' : key.name);
    setGrants(key === 'new' ? [] : key.grants);
    setExpires(
      key === 'new'
        ? new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10)
        : (key.expiresAt?.slice(0, 10) ?? ''),
    );
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage('Скопировано');
    } catch {
      setError('Не удалось скопировать. Выделите и скопируйте текст вручную.');
    }
  }
  const endpoint =
    typeof window === 'undefined'
      ? appPath('/api/mcp')
      : `${window.location.origin}${appPath('/api/mcp')}`;
  return (
    <section className="settings-panel password-panel mcp-settings">
      <h2>
        <Plug size={20} />
        Интеграция с LLM · MCP
      </h2>
      <p className="muted">
        Подключите модель через Streamable HTTP и отдельный Bearer-ключ. Права ключа ограничены
        вашей ролью в каждой области. Создавайте отдельный ключ для каждого клиента.
      </p>
      <label>
        Адрес MCP
        <input readOnly value={endpoint} onFocus={(e) => e.currentTarget.select()} />
      </label>
      <p className="muted">
        Доступны ваши области и области, где вы участник. Публичная ссылка просмотра не даёт доступ
        к области. <a href={appPath('/wiki/mcp')}>Инструкция по подключению</a>
      </p>
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      {message && (
        <div role="status" className="success">
          {message}
        </div>
      )}
      {secret && (
        <div className="mcp-secret form-stack">
          <strong>Сохраните ключ сейчас — повторно он не показывается.</strong>
          <textarea
            aria-label="Новый MCP-ключ"
            readOnly
            value={secret}
            rows={2}
            onFocus={(e) => e.currentTarget.select()}
          />
          <div className="mcp-actions">
            <button type="button" className="secondary" onClick={() => copy(secret)}>
              <Copy size={16} />
              Копировать ключ
            </button>
            <button type="button" className="secondary" onClick={() => setSecret('')}>
              Скрыть ключ
            </button>
          </div>
          <small className="muted">
            Передавайте его в заголовке Authorization: Bearer. Не вставляйте ключ в диалоги с
            моделью, URL или общедоступные файлы.
          </small>
        </div>
      )}
      {!editing && (
        <button type="button" className="secondary" onClick={() => edit('new')}>
          <Plus size={16} />
          Создать MCP-ключ
        </button>
      )}
      {editing && (
        <form
          className="form-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setError('');
            setBusy(true);
            try {
              const result = await api<Key & { secret?: string }>(
                `mcp-keys${editing === 'new' ? '' : `/${editing.id}`}`,
                editing === 'new' ? 'POST' : 'PATCH',
                {
                  name,
                  grants,
                  expiresAt: expires ? new Date(`${expires}T23:59:59.000Z`).toISOString() : null,
                  ...(editing === 'new' ? {} : { revision: editing.revision }),
                },
              );
              setSecret(result.secret ?? '');
              setEditing(null);
              await load();
              setMessage('Права MCP-ключа сохранены');
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Название ключа
            <input
              required
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например, Claude Desktop"
            />
          </label>
          <label>
            Действует до
            <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
          </label>
          <small className="muted">
            Пустая дата — без ограничения срока. Ключ можно отозвать в любой момент.
          </small>
          <fieldset className="mcp-grants">
            <legend>Области и функции</legend>
            {areas.map((area) => {
              const grant = grants.find((g) => g.workspaceId === area.id);
              return (
                <div key={area.id} className="mcp-workspace">
                  <label className="mcp-check">
                    <input
                      type="checkbox"
                      checked={!!grant}
                      onChange={(e) =>
                        setGrants((old) =>
                          e.target.checked
                            ? [
                                ...old,
                                {
                                  workspaceId: area.id,
                                  capabilities: [...readOnlyMcpCapabilities],
                                },
                              ]
                            : old.filter((g) => g.workspaceId !== area.id),
                        )
                      }
                    />
                    <strong>{area.name}</strong>
                  </label>
                  {grant && (
                    <div className="mcp-capabilities">
                      {mcpCapabilities.map((cap) => (
                        <label className="mcp-check" key={cap}>
                          <input
                            type="checkbox"
                            checked={grant.capabilities.includes(cap)}
                            onChange={(e) =>
                              setGrants((old) =>
                                old.map((g) =>
                                  g.workspaceId === area.id
                                    ? {
                                        ...g,
                                        capabilities: e.target.checked
                                          ? [...g.capabilities, cap]
                                          : g.capabilities.filter((c) => c !== cap),
                                      }
                                    : g,
                                ),
                              )
                            }
                          />
                          {mcpCapabilityLabels[cap]}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {grants
              .filter((g) => !areas.some((a) => a.id === g.workspaceId))
              .map((g) => (
                <div key={g.workspaceId} className="mcp-workspace">
                  <p>Нет доступа к области {g.workspaceId}. Удалите её из разрешений.</p>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setGrants((old) => old.filter((v) => v !== g))}
                  >
                    Убрать область
                  </button>
                </div>
              ))}
          </fieldset>
          <small className="muted">
            Экспорт JSON и draw.io включает свойства объектов. Импорт создаёт объекты и связи;
            разрешайте его только доверенным клиентам. PNG, JPEG и PDF доступны только для экспорта.
          </small>
          <div className="mcp-actions">
            <button
              className="primary"
              disabled={busy || !grants.length || grants.some((g) => !g.capabilities.length)}
            >
              {busy ? 'Сохраняем…' : 'Сохранить MCP-ключ'}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => setEditing(null)}
            >
              Отмена
            </button>
          </div>
        </form>
      )}
      <div className="mcp-key-list">
        {keys.map((key) => (
          <div className="mcp-key" key={key.id}>
            <strong>{key.name}</strong>
            <small className="muted">
              {key.prefix} · Областей: {key.grants.length} ·{' '}
              {key.expiresAt
                ? `до ${new Date(key.expiresAt).toLocaleDateString('ru-RU')}`
                : 'без срока'}
            </small>
            <small className="muted">
              Последнее использование:{' '}
              {key.lastUsedAt
                ? new Date(key.lastUsedAt).toLocaleString('ru-RU')
                : 'ещё не использовался'}
            </small>
            <div className="mcp-actions">
              <button type="button" className="secondary" disabled={busy} onClick={() => edit(key)}>
                <Pencil size={15} />
                Права
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    await api(`mcp-keys/${key.id}`, 'DELETE');
                    setSecret('');
                    if (editing !== 'new' && editing?.id === key.id) setEditing(null);
                    await load();
                    setMessage('Ключ отозван');
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Trash2 size={15} />
                Отозвать
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
