'use client';
import { createContext, useContext, useState, useLayoutEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Workflow,
  Library,
  Shapes,
  Settings,
  LogOut,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  BookOpen,
} from 'lucide-react';
import { api } from '@/lib/client';
import { CollaborationProvider, WorkspaceAccessButton } from './collaboration';
import { WorkspaceSwitcher, type WorkspaceItem } from './workspace-switcher';
export type User = {
  id: string;
  email: string;
  name: string;
  settings: { theme: 'light' | 'dark'; snapToGrid: boolean; autosave: boolean };
};
const UserContext = createContext<{
  user: User;
  setUser: (u: User) => void;
  workspaceId: string;
} | null>(null);
export function useUser() {
  return useContext(UserContext)!;
}
export function Workspace({
  initialUser,
  initialWorkspaces,
  workspaceId,
  children,
}: {
  initialUser: User;
  initialWorkspaces: WorkspaceItem[];
  workspaceId: string;
  children: React.ReactNode;
}) {
  const [user, setUser] = useState(initialUser);
  const pathname = usePathname(),
    router = useRouter(),
    searchParams = useSearchParams();
  const [error, setError] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const sidebarKey = `maket:sidebar:${initialUser.id}`;
  useLayoutEffect(() => {
    try {
      const saved = localStorage.getItem(sidebarKey);
      setCollapsed(
        saved === null ? window.matchMedia('(max-width: 650px)').matches : saved === '1',
      );
    } catch {
      setCollapsed(window.matchMedia('(max-width: 650px)').matches);
    }
  }, [sidebarKey]);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = user.settings.theme;
    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, [user.settings.theme]);
  useLayoutEffect(() => {
    document.documentElement.dataset.workspace = workspaceId;
    return () => {
      delete document.documentElement.dataset.workspace;
    };
  }, [workspaceId]);
  const editor = pathname.startsWith('/diagrams/') || !!searchParams.get('diagram');
  const links = [
    { href: '/solutions', label: 'Рабочая область', icon: Workflow },
    { href: '/library', label: 'Библиотека', icon: Library },
    { href: '/notations', label: 'Нотации', icon: Shapes },
    { href: '/settings', label: 'Настройки', icon: Settings },
  ];
  return (
    <UserContext.Provider value={{ user, setUser, workspaceId }}>
      <CollaborationProvider workspaceId={workspaceId}>
        <a className="skip-link" href="#workspace-content">
          К содержимому
        </a>
        <div className={`workspace ${user.settings.theme === 'dark' ? 'dark' : ''}`}>
          <aside className={`sidebar ${collapsed ? 'is-collapsed' : ''}`} aria-label="Главное меню">
            <button
              type="button"
              className="icon-button sidebar-toggle"
              aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
              title={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
              aria-expanded={!collapsed}
              aria-controls="workspace-navigation"
              onClick={() => {
                const next = !collapsed;
                setCollapsed(next);
                try {
                  localStorage.setItem(sidebarKey, next ? '1' : '0');
                } catch {
                  /* Keep the menu usable when browser storage is unavailable. */
                }
              }}
            >
              {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
            <Link href="/library" className="brand" aria-label="maket" title="maket">
              <span className="brand-icon">
                <Workflow size={23} />
              </span>
              <span className="sidebar-brand-name">
                maket<span className="brand-dot">.</span>
              </span>
            </Link>
            <WorkspaceSwitcher initialItems={initialWorkspaces} currentId={workspaceId} />
            <nav id="workspace-navigation" aria-label="Разделы приложения">
              {links.map(({ href, label, icon: Icon }) => (
                <Link
                  aria-current={
                    pathname === href || (href === '/solutions' && editor) ? 'page' : undefined
                  }
                  aria-label={label}
                  title={label}
                  key={href}
                  href={href}
                  className={pathname === href || (href === '/solutions' && editor) ? 'active' : ''}
                >
                  <Icon size={19} />
                  <span className="nav-label">{label}</span>
                  {pathname === href && <ChevronRight size={15} className="nav-chevron" />}
                </Link>
              ))}
              <Link
                href="/wiki"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Вики и справка (откроется в новой вкладке)"
                title="Вики и справка — новая вкладка"
              >
                <BookOpen size={19} />
                <span className="nav-label">Вики и справка</span>
              </Link>
            </nav>
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
          <div
            id="workspace-content"
            tabIndex={-1}
            className={`workspace-main ${editor ? 'editor-main' : ''}`}
          >
            <header className="topbar">
              <span>
                Рабочее пространство <ChevronRight size={13} />{' '}
                {editor ? 'Редактор' : links.find((x) => x.href === pathname)?.label}
              </span>
              <span className="topbar-right">
                <WorkspaceAccessButton />
                <span className="status-dot" />
                {initialWorkspaces.find((w) => w.id === workspaceId)?.name}
              </span>
            </header>
            {children}
          </div>
        </div>
      </CollaborationProvider>
    </UserContext.Provider>
  );
}
