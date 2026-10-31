import Link from 'next/link';
import type { FeedEvent } from '@polyradar/db/queries/entities';
import { md, mediaUrl } from '@/lib/format';

export interface CardInsight { claim: string; level: string; source: string }

export function EventCard({ ev, insight, author }: { ev: FeedEvent; insight?: CardInsight; author?: string | null }) {
  const href = ev.entity_slug ? `/e/${ev.entity_slug}` : (ev.source_url ?? '#');
  const img = mediaUrl(ev.media_path);
  return (
    <article className="card">
      <Link href={href} className={`card-media${img ? '' : ' empty'}`}>
        {img && <img src={img} alt={ev.entity_name ?? ev.title} />}
      </Link>
      <div className="card-body">
        <div className="path">{ev.capabilities.slice(0, 3).join(' · ')}</div>
        <h3 className="card-title"><Link href={href}>{ev.title_zh ?? ev.title}</Link></h3>
        {ev.summary_zh && <p className="muted" style={{ margin: 0 }}>{ev.summary_zh}</p>}
        {insight && (
          <div className="insight">
            <div className="insight-head"><span>洞见</span><span>{insight.level} · {insight.source}</span></div>
            <p>{insight.claim}</p>
          </div>
        )}
        <div className="card-foot">
          <span className="mono" style={{ fontSize: 13 }}>
            {author ? `${author} · ` : ''}{md(new Date(ev.occurred_at))}
          </span>
          <span className="pills">
            {ev.source_url && <a className="tag" href={ev.source_url} target="_blank" rel="noreferrer">原帖</a>}
            {ev.evidence_level && <span className="tag mono">{ev.evidence_level}</span>}
          </span>
        </div>
      </div>
    </article>
  );
}
