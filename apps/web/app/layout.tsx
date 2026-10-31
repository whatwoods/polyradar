import type { Metadata } from 'next';
import { Geist, Geist_Mono, Noto_Sans_SC } from 'next/font/google';
import { Header } from './components/Header';
import './globals.css';

const geist = Geist({ subsets: ['latin'], variable: '--font-geist' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });
const notoSc = Noto_Sans_SC({ weight: ['400', '500', '600', '700'], preload: false, variable: '--font-noto-sc' });

export const metadata: Metadata = {
  title: { default: '三维雷达 Polyradar', template: '%s · 三维雷达' },
  description: 'Web 实时 3D 与 AI 游戏创作的可验证情报库，给开发者和 AI Agent。',
  alternates: { types: { 'application/feed+json': '/feed.json' } },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className={`${geist.variable} ${geistMono.variable} ${notoSc.variable}`}>
      <body>
        <Header />
        <main className="frame">{children}</main>
      </body>
    </html>
  );
}
