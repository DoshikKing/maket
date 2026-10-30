'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLayoutEffect, useState } from 'react';
import { Menu, Moon, Search, Sun, X } from 'lucide-react';
import { wikiArticles, wikiGroups } from '@/lib/wiki';
const normalized = (text: string) => text.toLocaleLowerCase('ru').replaceAll('ё', 'е');
const searchIndex = wikiArticles.map((article) => ({
  article,
  text: normalized(JSON.stringify(article)),
}));
export function WikiNavigation() {
  const pathname = usePathname();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const words = normalized(query).trim().split(/\s+/).filter(Boolean);
  const matches = searchIndex.filter(({ text }) => words.every((word) => text.includes(word)));
  return (
    <aside className="wiki-sidebar" aria-label="Навигация по вики">
      <button
        className="secondary wiki-mobile-menu"
        aria-expanded={open}
        aria-controls="wiki-navigation"
        onClick={() => setOpen(!open)}
      >
        {open ? <X size={18} /> : <Menu size={18} />} Разделы вики
      </button>
      <div id="wiki-navigation" className={`wiki-navigation ${open ? 'is-open' : ''}`}>
        <label className="wiki-search">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            aria-label="Поиск по вики"
            placeholder="Поиск по вики"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {words.length > 0 && (
          <p className="wiki-search-status" role="status">
            Найдено статей: {matches.length}
          </p>
        )}
        <nav aria-label="Статьи вики">
          {!words.length && (
            <Link
              href="/wiki"
              aria-current={pathname === '/wiki' ? 'page' : undefined}
              onClick={() => setOpen(false)}
            >
              Обзор справки
            </Link>
          )}
          {wikiGroups.map((group) => {
            const articles = matches.filter(({ article }) => article.group === group);
            if (!articles.length) return null;
            return (
              <div className="wiki-nav-group" key={group}>
                <p>{group}</p>
                {articles.map(({ article }) => (
                  <Link
                    href={`/wiki/${article.slug}`}
                    key={article.slug}
                    aria-current={pathname === `/wiki/${article.slug}` ? 'page' : undefined}
                    onClick={() => setOpen(false)}
                  >
                    {article.title}
                    {words.length > 0 && <small>{article.summary}</small>}
                  </Link>
                ))}
              </div>
            );
          })}
        </nav>
        {words.length > 0 && !matches.length && (
          <p className="muted">
            Попробуйте другое слово, например «ракурс», «публикация» или «пароль».
          </p>
        )}
      </div>
    </aside>
  );
}
export function WikiTheme() {
  const [dark, setDark] = useState(false);
  useLayoutEffect(() => {
    let next = window.matchMedia('(prefers-color-scheme: dark)').matches;
    try {
      const saved = localStorage.getItem('maket:wiki:theme');
      if (saved === 'dark' || saved === 'light') next = saved === 'dark';
    } catch {
      /* Reading the wiki must work without browser storage. */
    }
    setDark(next);
    document.documentElement.dataset.theme = next ? 'dark' : 'light';
    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, []);
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={dark ? 'Включить светлую тему вики' : 'Включить тёмную тему вики'}
      title={dark ? 'Светлая тема' : 'Тёмная тема'}
      onClick={() => {
        const next = !dark;
        setDark(next);
        document.documentElement.dataset.theme = next ? 'dark' : 'light';
        try {
          localStorage.setItem('maket:wiki:theme', next ? 'dark' : 'light');
        } catch {
          /* Keep the theme usable without storage. */
        }
      }}
    >
      {dark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
