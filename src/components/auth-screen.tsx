'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Workflow, Hexagon, GitBranch, Layers } from 'lucide-react';
import { api } from '@/lib/client';
type Mode = 'login' | 'register' | 'recover' | 'reset' | 'verify';
export function AuthScreen({ mode, token }: { mode: Mode; token?: string }) {
  const router = useRouter();
  const [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const title = {
    login: 'С возвращением',
    register: 'Создайте своё пространство',
    recover: 'Восстановление пароля',
    reset: 'Новый пароль',
    verify: 'Подтвердите почту',
  }[mode];
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const values = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const result = await api<{ message?: string }>(`auth/${mode}`, 'POST', { ...values, token });
      if (mode === 'login') {
        router.push('/library');
        router.refresh();
      } else if (mode === 'reset' || mode === 'verify') {
        setMessage(
          mode === 'verify'
            ? 'Почта подтверждена. Теперь можно войти.'
            : 'Пароль изменён. Теперь можно войти.',
        );
      } else setMessage(result.message ?? 'Готово');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <section className="auth-story">
        <Link href="/" className="brand">
          <span className="brand-icon">
            <Workflow size={23} />
          </span>
          maket<span className="brand-dot">.</span>
        </Link>
        <div className="story-main">
          <div className="eyebrow">ОТ ИДЕИ К СТРУКТУРЕ</div>
          <h1>
            Мыслите свободно.
            <br />
            <span>Создавайте связи.</span>
          </h1>
          <p>Превращайте сложные процессы в понятные диаграммы. Ваши идеи — ваши правила.</p>
          <div className="story-diagram">
            <div className="story-node first">
              <Hexagon size={22} />
              Идея
            </div>
            <div className="story-line" />
            <div className="story-node">
              <GitBranch size={22} />
              Структура
            </div>
            <div className="story-line" />
            <div className="story-node last">
              <Layers size={22} />
              Результат
            </div>
          </div>
        </div>
        <div className="story-footer">
          Место, где ваши идеи обретают форму <span>© {new Date().getFullYear()} maket</span>
        </div>
      </section>
      <section className="auth-form-side">
        <div className="auth-box">
          <span className="tag">ВАШЕ РАБОЧЕЕ ПРОСТРАНСТВО</span>
          <h2>{title}</h2>
          <p className="muted">
            {mode === 'login'
              ? 'Войдите, чтобы продолжить работу над идеями.'
              : mode === 'register'
                ? 'Начните с первого шага — остальные связи появятся.'
                : mode === 'verify'
                  ? 'Нажмите кнопку, чтобы подтвердить адрес из письма.'
                  : 'Мы поможем восстановить доступ к вашим диаграммам.'}
          </p>
          {message ? (
            <div className="success">
              {message}
              <Link className="text-link block" href="/login">
                Перейти ко входу →
              </Link>
            </div>
          ) : (
            <form onSubmit={submit} className="form-stack">
              {mode === 'register' && (
                <label>
                  Ваше имя
                  <input
                    name="name"
                    autoComplete="name"
                    required
                    maxLength={100}
                    placeholder="Как к вам обращаться"
                  />
                </label>
              )}
              {['login', 'register', 'recover'].includes(mode) && (
                <label>
                  Электронная почта
                  <input
                    type="email"
                    name="email"
                    autoComplete="email"
                    required
                    placeholder="you@example.com"
                    maxLength={254}
                  />
                </label>
              )}
              {['login', 'register', 'reset'].includes(mode) && (
                <label>
                  Пароль
                  <input
                    type="password"
                    name="password"
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    required
                    minLength={10}
                    maxLength={128}
                    placeholder="Не менее 10 символов"
                  />
                </label>
              )}
              {mode === 'login' && (
                <Link className="text-link align-right" href="/recover">
                  Забыли пароль?
                </Link>
              )}
              {error && (
                <div role="alert" className="error">
                  {error}
                </div>
              )}
              <button
                className="primary wide"
                disabled={busy || (mode === 'verify' && !token) || (mode === 'reset' && !token)}
              >
                {busy
                  ? 'Подождите…'
                  : {
                      login: 'Войти в maket',
                      register: 'Создать аккаунт',
                      recover: 'Отправить ссылку',
                      reset: 'Сохранить пароль',
                      verify: 'Подтвердить почту',
                    }[mode]}
                <ArrowRight size={18} />
              </button>
            </form>
          )}
          {mode === 'login' && (
            <>
              <p className="auth-bottom">
                Ещё нет аккаунта? <Link href="/register">Зарегистрироваться</Link>
              </p>
              <Resend />
            </>
          )}
          {mode !== 'login' && (
            <p className="auth-bottom">
              <Link href="/login">← Вернуться ко входу</Link>
            </p>
          )}
          <div className="auth-note">Ваши диаграммы доступны только вам.</div>
        </div>
      </section>
    </main>
  );
}
function Resend() {
  const [open, setOpen] = useState(false),
    [message, setMessage] = useState('');
  return (
    <div className="resend">
      <button className="text-button" onClick={() => setOpen(!open)}>
        Не пришло письмо с подтверждением?
      </button>
      {open && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const email = new FormData(e.currentTarget).get('email');
              const result = await api<{ message: string }>('auth/resend', 'POST', { email });
              setMessage(result.message);
            } catch (e) {
              setMessage((e as Error).message);
            }
          }}
        >
          <input type="email" name="email" required placeholder="Ваша почта" />
          <button className="secondary">Отправить повторно</button>
          <p className="muted">{message}</p>
        </form>
      )}
    </div>
  );
}
