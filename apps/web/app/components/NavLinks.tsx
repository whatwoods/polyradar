'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: '雷达' },
  { href: '/showcase', label: '展示' },
  { href: '/search', label: '浏览' },
  { href: '/api-changes/three', label: 'API 变更' },
  { href: '/agents', label: 'Agent 接入' },
  { href: '/sources', label: '来源' },
];

export function NavLinks() {
  const path = usePathname();
  const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href.split('/').slice(0, 2).join('/')));
  return (
    <nav aria-label="主导航" className="nav">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={active(l.href) ? 'page' : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
