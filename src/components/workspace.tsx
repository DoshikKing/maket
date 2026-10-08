'use client';
import { createContext, useContext, useState, useLayoutEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Workflow, Library, Shapes, Settings, LogOut, ChevronRight, Sparkles } from 'lucide-react';
import { api } from '@/lib/client';
export type User = {
  id: string;
  email: string;
  name: string;
  settings: { theme: 'light' | 'dark'; snapToGrid: boolean; autosave: boolean };
};
const UserContext = createContext<{ user: User; setUser: (u: User) => void } | null>(null);
export function useUser() {
  return useContext(UserContext)!;
}
export function Workspace({
  initialUser,
  children,
}: {
  initialUser: User;
  children: React.ReactNode;
}) {
  const [user, setUser] = useState(initialUser);
  const pathname = usePathname(),
    router = useRouter();
  const [error, setError] = useState('');
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = user.settings.theme;
    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, [user.settings.theme]);
  const editor = pathname.startsWith('/diagrams/');
  const links = [
    { href: '/solutions', label: 'Решения', icon: Workflow },
    { href: '/library', label: 'Библиотека', icon: Library },
    { href: '/notations', label: 'Нотации', icon: Shapes },
    { href: '/settings', label: 'Настройки', icon: Settings },
  ];
  return (
    <UserContext.Provider value={{ user, setUser }}>
      <div className={`workspace ${user.settings.theme === 'dark' ? 'dark' : ''}`}>
        <aside className="sidebar">
          <Link href="/library" className="brand">
            <span className="brand-icon">
              <Workflow size={23} />
            </span>
            maket<span className="brand-dot">.</span>
          </Link>
          <div className="workspace-label">ЛИЧНОЕ ПРОСТРАНСТВО</div>
          <nav>
            {links.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={pathname === href || (href === '/library' && editor) ? 'active' : ''}
              >
                <Icon size={19} />
                {label}
                {pathname === href && <ChevronRight size={15} className="nav-chevron" />}
              </Link>
            ))}
          </nav>
          <div className="sidebar-tip">
            <Sparkles size={21} />
            <strong>Ваши идеи, ваши правила</strong>
            <p>Создайте свою нотацию и моделируйте по-своему.</p>
            <Link href="/notations">Открыть нотации →</Link>
          </div>
          <div className="profile">
            <span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span>
            <div>
              <strong>{user.name}</strong>
              <small>{user.email}</small>
            </div>
            <button
              className="icon-button"
              title="Выйти"
              aria-label="Выйти"
              onClick={async () => {
                try {
                  await api('auth/logout', 'POST', {});
                  router.push('/login');
                  router.refresh();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
          {error && <div className="error">{error}</div>}
        </aside>
        <div className={`workspace-main ${editor ? 'editor-main' : ''}`}>
          <header className="topbar">
            <span>
              Рабочее пространство <ChevronRight size={13} />{' '}
              {editor ? 'Редактор' : links.find((x) => x.href === pathname)?.label}
            </span>
            <span className="topbar-right">
              <span className="status-dot" />
              Личное пространство
            </span>
          </header>
          {children}
        </div>
      </div>
    </UserContext.Provider>
  );
}
