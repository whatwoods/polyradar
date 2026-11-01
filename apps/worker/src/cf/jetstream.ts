// One Durable Object per Bluesky source holds the Jetstream WebSocket. An alarm
// every FLUSH_MS stores matches, and reconnects if the socket dropped or the
// object was evicted; the cursor in source.state makes that lossless for up to
// 15 minutes. The cron tick (re)arms the alarm, so a lost object comes back.
import { DurableObject } from 'cloudflare:workers';
import { recordError } from '../poll.ts';
import { FLUSH_MS, JetstreamListener, loadStreamSource } from '../streams/jetstream.ts';
import { bindEnv, type Env } from './env.ts';

export class JetstreamStream extends DurableObject<Env> {
  private listener: JetstreamListener | null = null;

  async start(slug: string): Promise<void> {
    await this.ctx.storage.put('slug', slug);
    if ((await this.ctx.storage.getAlarm()) == null) await this.ctx.storage.setAlarm(Date.now());
  }

  async alarm(): Promise<void> {
    bindEnv(this.env);
    const slug = await this.ctx.storage.get<string>('slug');
    const source = slug ? await loadStreamSource(slug) : null;
    if (!source?.enabled) {
      this.listener?.close();
      this.listener = null;
      return; // not re-armed; the cron tick restarts it if re-enabled
    }
    // Config changed (keywords, accounts): start over with the new filter, keeping the cursor.
    if (this.listener && JSON.stringify(this.listener.source.config) !== JSON.stringify(source.config)) {
      await this.listener.flush().catch(() => {});
      this.listener.close();
      this.listener = null;
    }
    this.listener ??= new JetstreamListener(source, async (ids) => { await this.env.JOBS.send({ task: 'normalize', ids }); });
    try {
      if (!this.listener.active) this.listener.connect();
      await this.listener.flush();
    } catch (err) {
      await recordError(source.id, err).catch(() => {});
    }
    await this.ctx.storage.setAlarm(Date.now() + FLUSH_MS);
  }
}
