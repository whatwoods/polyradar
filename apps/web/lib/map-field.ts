// Layout of the domain map, shared by the server (labels, entities) and the
// client (the halftone field, drawn on a canvas).

// Where each top-level capability sits on the map (percent of width/height).
export const CLUSTERS: Record<string, { x: number; y: number; zh: string }> = {
  render: { x: 22, y: 62, zh: '渲染' },
  procgen: { x: 46, y: 76, zh: '程序化生成' },
  asset: { x: 70, y: 40, zh: 'AI 资产' },
  gamecreation: { x: 86, y: 74, zh: '游戏创作' },
  interaction: { x: 52, y: 40, zh: '交互' },
  benchmark: { x: 34, y: 86, zh: '基准测试' },
};

/** Lattice dots whose size grows with the number of tracked entities in nearby clusters. x/y in percent, s in px. */
export function halftoneField(counts: Record<string, number>): { x: number; y: number; s: number; c: string }[] {
  const field: { x: number; y: number; s: number; c: string }[] = [];
  for (let gx = 1; gx < 60; gx++) {
    for (let gy = 6; gy < 25; gy++) {
      const x = gx * (100 / 60);
      const y = gy * 4;
      let v = 0;
      for (const [top, c] of Object.entries(CLUSTERS)) {
        const n = counts[top] ?? 0;
        const d2 = ((x - c.x) / 14) ** 2 + ((y - c.y) / 22) ** 2;
        v += (0.35 + Math.log1p(n)) * Math.exp(-d2);
      }
      if (v < 0.12) continue;
      const s = Math.min(6, 1.5 + v * 2.4);
      field.push({ x, y, s, c: v > 1.4 ? '#8E8A82' : v > 0.6 ? '#B3AFA6' : '#D2CEC6' });
    }
  }
  return field;
}
