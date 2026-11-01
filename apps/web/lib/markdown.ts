import type { EntityDetail } from '@polyradar/db/queries/entities';
import { ATTR_ZH, factValue, ymd } from './format';

/** Plain-text entity page for agents (`/e/{slug}.md`). English keys, Chinese summary included. */
export function entityMarkdown(e: EntityDetail, origin: string): string {
  const lines: string[] = [];
  lines.push(`# ${e.name}`, '');
  lines.push(`type: ${e.type} · status: ${e.status} · evidence: ${e.evidence_level ?? 'n/a'}`);
  if (e.keys.length) lines.push(`keys: ${e.keys.map((k) => `${k.key_type}:${k.key}`).join(', ')}`);
  if (e.capabilities.length) lines.push(`capabilities: ${e.capabilities.map((c) => c.slug).join(', ')}`);
  lines.push('');
  if (e.summary_en) lines.push(e.summary_en, '');
  if (e.summary_zh) lines.push(e.summary_zh, '');

  const open = e.facts.filter((f) => !f.valid_to);
  if (open.length) {
    lines.push('## Facts', '');
    for (const f of open) {
      const label = f.method === 'llm_extract' ? 'author claim, unverified' : f.method;
      const quote = f.evidence_quote ? ` "${f.evidence_quote}"` : '';
      const src = f.evidence_url ? ` ([${label}](${f.evidence_url})${quote})` : ` (${label})`;
      lines.push(`- ${f.attribute} (${ATTR_ZH[f.attribute] ?? f.attribute}): ${factValue(f.attribute, f.value)} — since ${ymd(new Date(f.valid_from))}${src}`);
    }
    const history = e.facts.filter((f) => f.valid_to);
    if (history.length) {
      lines.push('', 'Superseded values:');
      for (const f of history) {
        lines.push(`- ${f.attribute}: ${factValue(f.attribute, f.value)} (${ymd(new Date(f.valid_from))} – ${ymd(new Date(f.valid_to!))})`);
      }
    }
    lines.push('');
  }
  if (e.insights.length) {
    lines.push('## Insights', '', 'Self-reported by the author unless the evidence level is above E0.', '');
    for (const i of e.insights) lines.push(`- [${i.evidence_level}] ${i.claim_en}${i.evidence_url ? ` — ${i.evidence_url}` : ''}`);
    lines.push('');
  }
  if (e.relations.length) {
    lines.push('## Relations', '');
    for (const r of e.relations) lines.push(`- ${r.direction === 'out' ? r.type : `${r.type} (from)`}: ${r.name} — ${origin}/e/${r.slug}.md`);
    lines.push('');
  }
  if (e.demos.length) {
    lines.push('## Demos', '');
    for (const d of e.demos) lines.push(`- ${d.url} (requires: ${d.requires.join(', ') || 'unknown'}; checked: ${d.last_checked_at ? ymd(new Date(d.last_checked_at)) : 'never'})`);
    lines.push('');
  }
  if (e.events.length) {
    lines.push('## Timeline', '');
    for (const ev of e.events.slice(0, 20)) lines.push(`- ${ymd(new Date(ev.occurred_at))} ${ev.type}: ${ev.title}`);
    lines.push('');
  }
  return lines.join('\n');
}
