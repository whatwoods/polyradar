import Link from 'next/link';
import { DeviceChip } from './DeviceChip';
import { NavLinks } from './NavLinks';

export function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="#111111" />
      <path d="M12 6.5a5.5 5.5 0 0 1 5.5 5.5" stroke="#F3F2EE" strokeWidth="1.6" />
      <path d="M12 12 17.5 6.5" stroke="#F26B1D" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="1.8" fill="#F26B1D" />
    </svg>
  );
}

export function Header() {
  return (
    <header className="header">
      <div className="frame header-inner">
        <Link href="/" className="logo">
          <Logo />
          三维雷达
        </Link>
        <span className="vsep" aria-hidden="true" />
        <NavLinks />
        <div className="header-tools">
          <form role="search" action="/search" className="search">
            <label htmlFor="q" className="sr-only">搜索</label>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6B6862" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input id="q" name="q" type="search" placeholder="搜索" />
          </form>
          <DeviceChip />
        </div>
      </div>
    </header>
  );
}
