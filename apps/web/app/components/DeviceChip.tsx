'use client';

import { useEffect, useState } from 'react';

type Support = { api: 'WebGPU' | 'WebGL2' | '无 GPU'; adapter: string | null };

/** Detects what this browser can run, so demo badges can say "runs here". */
export function DeviceChip() {
  const [s, setS] = useState<Support | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ info?: { vendor?: string; architecture?: string } } | null> } }).gpu;
      if (gpu) {
        try {
          const adapter = await gpu.requestAdapter();
          if (adapter && !cancelled) {
            const info = adapter.info;
            setS({ api: 'WebGPU', adapter: [info?.vendor, info?.architecture].filter(Boolean).join(' ') || null });
            return;
          }
        } catch {
          // fall through to WebGL2
        }
      }
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!cancelled) setS({ api: gl ? 'WebGL2' : '无 GPU', adapter: null });
    })();
    return () => { cancelled = true; };
  }, []);

  const color = s?.api === 'WebGPU' ? 'var(--blue)' : s?.api === 'WebGL2' ? 'var(--warn)' : 'var(--line-strong)';
  return (
    <span
      className="btn mono"
      style={{ fontSize: 13, cursor: 'default', borderColor: 'var(--line)' }}
      title={s?.adapter ?? undefined}
      aria-label={s ? `你的设备：${s.api}` : '正在检测设备'}
    >
      <span className="dot" style={{ background: color }} />
      {s?.api ?? '检测中'}
    </span>
  );
}
