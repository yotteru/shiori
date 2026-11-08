import { afterEach, describe, expect, it } from 'vitest';
import { markDone } from './actions';
import { setPassphrase } from './backup';
import { setDebugNow } from './clock';
import { getMeta, ShioriDB } from './db';
import {
  enableSync,
  joinSync,
  rekeySync,
  SyncPassphraseError,
  syncNow,
  type OutgoingRow,
  type RemoteRow,
  type SyncKeys,
  type SyncServer,
} from './syncEngine';
import type { Plan } from './types';

// メモリ上の偽サーバー。本物（Supabase の push_records）と同じく、古い変更は受け付けない（同じ時刻は上書き）
class FakeServer implements SyncServer {
  rows = new Map<string, RemoteRow>();
  keys: SyncKeys | null = null;
  private tick = Date.parse('2030-01-01T00:00:00Z');
  private now() {
    this.tick += 1000;
    return new Date(this.tick).toISOString();
  }
  async getKeys() {
    return this.keys;
  }
  async putKeys(k: SyncKeys) {
    this.keys = k;
  }
  async push(rows: OutgoingRow[]) {
    const rejected: RemoteRow[] = [];
    for (const r of rows) {
      const k = `${r.kind}:${r.record_id}`;
      const cur = this.rows.get(k);
      if (cur && r.client_updated_at < cur.client_updated_at) {
        rejected.push(cur);
        continue;
      }
      this.rows.set(k, { ...r, server_updated_at: this.now() });
    }
    return rejected;
  }
  async pull(since: string | null, limit: number) {
    return [...this.rows.values()]
      .filter((r) => !since || r.server_updated_at > since)
      .sort((a, b) => a.server_updated_at.localeCompare(b.server_updated_at))
      .slice(0, limit);
  }
}

let n = 0;
const fresh = () => new ShioriDB(`sync-${n++}`);
/** 書き込みの後、outbox への記録（トランザクション完了後）を待つ */
const settle = () => new Promise((r) => setTimeout(r, 30));
afterEach(() => setDebugNow(null));

async function seedPhone(d: ShioriDB) {
  await d.tracks.bulkPut([
    { id: 'p', name: 'アドイン', type: 'project', createdAt: '2026-10-01T00:00:00Z' },
    { id: 'h', name: '筋トレ', type: 'habit', createdAt: '2026-10-02T00:00:00Z' },
  ]);
  await d.steps.put({ id: 's1', trackId: 'p', order: 1, title: '検証', minutes: 45, firstStep: '', status: 'todo' });
  const plan: Plan = {
    lifeDate: '2026-11-08',
    window: { start: '19:00', end: '22:30' },
    createdAt: '2026-11-07T14:00:00Z',
    source: 'night',
    items: [
      { id: 'A', trackId: 'p', stepId: 's1', title: '検証', minutes: 45, firstStep: '', status: 'planned' },
      { id: 'B', trackId: 'h', title: '筋トレ', minutes: 60, firstStep: '', status: 'planned' },
    ],
  };
  await d.plans.put(plan);
  await d.journals.put({ lifeDate: '2026-11-07', text: '日記：秘密の内容', updatedAt: 'x' });
}

async function pair() {
  const server = new FakeServer();
  const phone = fresh();
  const pad = fresh();
  await seedPhone(phone);
  await setPassphrase('正しい合言葉です', phone);
  await settle();
  expect(await enableSync(server, phone)).toBe('ok');
  await joinSync(server, '正しい合言葉です', pad);
  return { server, phone, pad };
}

describe('端末間の同期', () => {
  it('2台目は合言葉を入れるだけで同じデータになり、初回案内を飛ばす', async () => {
    const { server, pad } = await pair();
    expect((await pad.tracks.toArray()).map((t) => t.name).sort()).toEqual(['アドイン', '筋トレ']);
    expect((await pad.plans.get('2026-11-08'))?.items).toHaveLength(2);
    expect((await pad.journals.get('2026-11-07'))?.text).toBe('日記：秘密の内容');
    expect((await getMeta(pad)).onboarded).toBe(true);
    // サーバーには中身が読めない形でしか置かれていない
    const all = JSON.stringify([...server.rows.values()]);
    expect(all).not.toContain('秘密');
    expect(all).not.toContain('筋トレ');
  });

  it('合言葉が違うと加われず、端末のデータも変わらない', async () => {
    const { server } = await pair();
    const other = fresh();
    await expect(joinSync(server, 'ちがう合言葉です', other)).rejects.toBeInstanceOf(SyncPassphraseError);
    expect(await other.tracks.count()).toBe(0);
    expect((await getMeta(other)).syncEnabled).toBeFalsy();
  });

  it('iPhone で A に済、iPad で B に済をつけても、両方残る', async () => {
    const { server, phone, pad } = await pair();
    await markDone('2026-11-08', 'A', '次は配管から', phone);
    await settle();
    await markDone('2026-11-08', 'B', '', pad);
    await settle();
    await syncNow(server, phone);
    await syncNow(server, pad);
    await syncNow(server, phone);
    for (const d of [phone, pad]) {
      const plan = await d.plans.get('2026-11-08');
      expect(plan?.items.map((i) => [i.id, i.status])).toEqual([
        ['A', 'done'],
        ['B', 'done'],
      ]);
      expect((await d.tracks.get('p'))?.lastNote?.text).toBe('次は配管から');
      expect((await d.steps.get('s1'))?.status).toBe('done');
    }
  });

  it('同じ項目を両方で変えたら、後から変えた方が残る', async () => {
    const { server, phone, pad } = await pair();
    const t = (await phone.tracks.get('h'))!;
    await phone.tracks.put({ ...t, name: '筋トレ（iPhone）' });
    await settle();
    await new Promise((r) => setTimeout(r, 5));
    await pad.tracks.put({ ...(await pad.tracks.get('h'))!, name: '筋トレ（iPad・後）' });
    await settle();
    await syncNow(server, phone);
    await syncNow(server, pad);
    await syncNow(server, phone);
    expect((await phone.tracks.get('h'))?.name).toBe('筋トレ（iPad・後）');
    expect((await pad.tracks.get('h'))?.name).toBe('筋トレ（iPad・後）');
  });

  it('いつもの固定も同期される', async () => {
    const { server, phone, pad } = await pair();
    await phone.routines.put({ id: 'r1', title: '仕事', start: 540, min: 540, days: [1, 2, 3, 4, 5], createdAt: '2026-11-08T00:00:00Z' });
    await settle();
    await syncNow(server, phone);
    await syncNow(server, pad);
    expect((await pad.routines.get('r1'))?.title).toBe('仕事');
  });

  it('削除も伝わる', async () => {
    const { server, phone, pad } = await pair();
    await pad.steps.delete('s1');
    await settle();
    await syncNow(server, pad);
    await syncNow(server, phone);
    expect(await phone.steps.get('s1')).toBeUndefined();
  });

  it('開発用の日時上書きをしていても、後から変えた方の判定は本物の時刻で行う', async () => {
    const { server, phone, pad } = await pair();
    setDebugNow('2020-01-01T00:00:00Z');
    await pad.tracks.put({ ...(await pad.tracks.get('h'))!, name: '上書き中の変更' });
    await settle();
    await syncNow(server, pad);
    await syncNow(server, phone);
    expect((await phone.tracks.get('h'))?.name).toBe('上書き中の変更');
  });

  it('合言葉を変えると、もう片方は合言葉の入力待ちになり、入れ直すとまた同期できる', async () => {
    const { server, phone, pad } = await pair();
    await setPassphrase('新しい合言葉です', phone);
    await rekeySync(server, phone);
    expect(await syncNow(server, pad)).toBe('needs-passphrase');
    await joinSync(server, '新しい合言葉です', pad);
    expect(await syncNow(server, pad)).toBe('idle');
  });
});
