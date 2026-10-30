import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowUpRight, BookOpen } from 'lucide-react';
import { WikiNavigation, WikiTheme } from '@/components/wiki-navigation';
import './wiki.css';
export const metadata: Metadata = {
  title: { default: 'Вики — maket', template: '%s — Вики maket' },
  description:
    'Руководство maket: объекты, диаграммы, нотации, ракурсы, совместная работа и развёртывание.',
};
export default function WikiLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="wiki-shell">
      <a className="skip-link" href="#wiki-content">
        К статье
      </a>
      <header className="wiki-header">
        <Link className="wiki-brand" href="/wiki" aria-label="Вики maket — главная">
          <span className="brand-icon">
            <BookOpen size={22} />
          </span>
          <strong>
            maket<span className="brand-dot">.</span>
          </strong>
          <span className="wiki-brand-label">Вики</span>
        </Link>
        <div className="wiki-header-actions">
          <WikiTheme />
          <Link className="secondary" href="/library">
            В приложение <ArrowUpRight size={16} />
          </Link>
        </div>
      </header>
      <div className="wiki-layout">
        <WikiNavigation />
        <main id="wiki-content" tabIndex={-1} className="wiki-main">
          {children}
        </main>
      </div>
      <footer className="wiki-footer">
        <span>maket · Руководство по текущей версии</span>
        <Link href="/wiki/troubleshooting">Помощь с ошибками</Link>
      </footer>
    </div>
  );
}
