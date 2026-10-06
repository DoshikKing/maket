'use client';
import { useState } from 'react';
import { Save, UserRound, SlidersHorizontal, LockKeyhole } from 'lucide-react';
import { api } from '@/lib/client';
import { useUser, User } from './workspace';
export function SettingsPage() {
  const { user, setUser } = useUser();
  const [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <main className="page narrow">
      <div className="page-heading">
        <div>
          <div className="eyebrow">ВАШЕ ПРОСТРАНСТВО</div>
          <h1>Настройки</h1>
          <p className="muted">Сделайте maket удобным для себя.</p>
        </div>
      </div>
      {message && (
        <div role="status" className="success">
          {message}
        </div>
      )}
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      <form
        className="settings-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMessage('');
          setError('');
          const d = new FormData(e.currentTarget);
          try {
            const u = await api<User>('settings', 'PATCH', {
              name: d.get('name'),
              theme: d.get('theme'),
              snapToGrid: d.has('snapToGrid'),
              autosave: d.has('autosave'),
            });
            setUser(u);
            setMessage('Настройки сохранены');
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <section className="settings-panel">
          <h2>
            <UserRound size={20} />
            Профиль
          </h2>
          <label>
            Имя
            <input name="name" defaultValue={user.name} required maxLength={100} />
          </label>
          <label>
            Электронная почта
            <input value={user.email} disabled readOnly />
          </label>
          <small className="muted">Адрес используется для входа и восстановления доступа.</small>
        </section>
        <section className="settings-panel">
          <h2>
            <SlidersHorizontal size={20} />
            Редактор и оформление
          </h2>
          <label>
            Тема
            <select aria-label="Тема" name="theme" defaultValue={user.settings.theme}>
              <option value="light">Светлая</option>
              <option value="dark">Тёмная</option>
            </select>
          </label>
          <label className="toggle-row">
            <span>
              <strong>Привязка к сетке</strong>
              <small>Элементы выравниваются по шагу 20 px</small>
            </span>
            <input type="checkbox" name="snapToGrid" defaultChecked={user.settings.snapToGrid} />
          </label>
          <label className="toggle-row">
            <span>
              <strong>Автосохранение</strong>
              <small>Сохранять изменения после паузы в редактировании</small>
            </span>
            <input type="checkbox" name="autosave" defaultChecked={user.settings.autosave} />
          </label>
        </section>
        <button className="primary" disabled={busy}>
          <Save size={17} />
          {busy ? 'Сохраняем…' : 'Сохранить настройки'}
        </button>
      </form>
      <section className="settings-panel password-panel">
        <h2>
          <LockKeyhole size={20} />
          Безопасность
        </h2>
        <form
          className="form-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setError('');
            setMessage('');
            const form = e.currentTarget;
            try {
              await api('password', 'POST', Object.fromEntries(new FormData(form)));
              form.reset();
              setMessage('Пароль изменён. Остальные сессии завершены.');
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <label>
            Текущий пароль
            <input
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
            />
          </label>
          <label>
            Новый пароль
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={10}
              maxLength={128}
              required
            />
          </label>
          <button className="secondary">Изменить пароль</button>
        </form>
      </section>
    </main>
  );
}
