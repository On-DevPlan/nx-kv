// 孤儿文档（无任何 ref_bindings 归属的 ref）的判定、预演与到期清理。
//
// 口径（2026-11-15 用户拍板）：
//   · 孤儿 = `deleted_at IS NULL` 且 ref_bindings 里没有任何一行的 ref；
//   · 失绑起算时间落 refs.orphan_since（0 = 未计时）；由绑变无绑时写入，
//     已在计时中的孤儿在重建索引时不刷新（否则倒计时永远重置）；
//   · 到期清理**只软删** refs 行（deleted_at），ref_bodies 保留；
//   · **只清空正文孤儿**。有正文的到期孤儿只进清单（skippedWithBody），
//     不静默删——正文是用户资产，人工处置走 `docs delete`；
//   · 每次清理在 ref_gc_log 留一条不可变记录，删除后可按 ref / 时间回查。
import { getDb } from '../../core/db/index.js';
import { tx } from '../../core/db/tx.js';
import { nowMs } from '../../core/db/time.js';
import { loadConfig, DEFAULT_ORPHAN_TTL_DAYS } from '../../core/config.js';

export const DAY_MS = 24 * 60 * 60 * 1000;
/** 「即将到期」窗口：剩余不超过 1 天。 */
export const DUE_SOON_MS = DAY_MS;
const TTL_MIN_DAYS = 1;
const TTL_MAX_DAYS = 3650;

/** 一条孤儿 ref 的展示 / 判定行。 */
export interface OrphanRefRow {
  refId: string;
  desc: string;
  origin: string;
  locator: string;
  /** 失绑起算时刻；null = 未计时（下次例行维护起算） */
  unboundAt: number | null;
  ageMs: number;
  remainingMs: number;
  /** 剩余天数（保留 1 位小数；已到期为负数） */
  remainingDays: number;
  due: boolean;
  hasBody: boolean;
  bodyBytes: number;
}

/** ref_gc_log 的一行（删除留痕）。 */
export interface RefGcLogRow {
  refId: string;
  desc: string;
  origin: string;
  bodyBytes: number;
  unboundAt: number;
  deletedAt: number;
  ttlDays: number;
  reason: string;
  source: string;
}

/** 只读清单。 */
export interface OrphanListResult {
  status: string;
  ttlDays: number;
  now: number;
  total: number;
  /** 到期总数（含只列清单、不自动删的有正文孤儿） */
  due: number;
  /** 到期且空正文：会被/已被清理 */
  dueEmpty: number;
  /** 到期但有正文：只列清单，需人工处置 */
  dueWithBody: number;
  /** 24 小时内到期（尚未到期） */
  dueSoon: number;
  /** 尚未起算的孤儿（orphan_since = 0） */
  untimed: number;
  orphans: OrphanRefRow[];
  recentDeletions: RefGcLogRow[];
}

/** 预演 / 执行结果。 */
export interface OrphanSweepResult extends OrphanListResult {
  dryRun: boolean;
  /** 本次会被软删 / 已软删的 refId（只含空正文到期孤儿） */
  eligible: string[];
  deleted: RefGcLogRow[];
  skippedWithBody: OrphanRefRow[];
}

function resolveTtlDays(raw: unknown, fallback?: number): number {
  const n = Math.trunc(Number(raw));
  if (Number.isFinite(n) && n >= TTL_MIN_DAYS && n <= TTL_MAX_DAYS) return n;
  const f = Math.trunc(Number(fallback));
  if (Number.isFinite(f) && f >= TTL_MIN_DAYS && f <= TTL_MAX_DAYS) return f;
  return DEFAULT_ORPHAN_TTL_DAYS;
}

async function ttlDaysOf(raw?: unknown): Promise<number> {
  if (raw !== undefined && raw !== null && String(raw).trim() !== '') return resolveTtlDays(raw);
  const cfg = await loadConfig();
  return resolveTtlDays(cfg.orphanTtlDays, DEFAULT_ORPHAN_TTL_DAYS);
}

/** 把失绑 / 复绑漂移修回（写；只在清理动作里调用）。 */
function normalizeOrphanClocks(conn: any, at: number): void {
  // 有归属却还留着计时 → 清掉
  conn.run(
    `UPDATE refs SET state = '', orphan_since = 0, updated_at = :at
      WHERE deleted_at IS NULL AND orphan_since <> 0
        AND id IN (SELECT ref_id FROM ref_bindings)`,
    { at }
  );
  // 无归属、未计时 → 从当前时刻起算（不刷新已在计时中的孤儿）
  conn.run(
    `UPDATE refs SET state = 'orphan', orphan_since = :at, updated_at = :at
      WHERE deleted_at IS NULL AND orphan_since = 0
        AND id NOT IN (SELECT ref_id FROM ref_bindings)`,
    { at }
  );
  // 无归属但 state 残留 → 归位（不动计时）
  conn.run(
    `UPDATE refs SET state = 'orphan', updated_at = :at
      WHERE deleted_at IS NULL AND state <> 'orphan'
        AND id NOT IN (SELECT ref_id FROM ref_bindings)`,
    { at }
  );
}

function readOrphanRows(conn: any, ttlDays: number, at: number): OrphanRefRow[] {
  const rows: any[] = conn.all(
    `SELECT r.id, r."desc" AS desc, r.origin, r.locator, r.orphan_since,
            CASE WHEN rb.ref_id IS NOT NULL AND trim(COALESCE(rb.body, '')) <> '' THEN 1 ELSE 0 END AS has_body,
            CASE WHEN rb.ref_id IS NULL THEN 0 ELSE COALESCE(rb.body_bytes, 0) END AS body_bytes
       FROM refs r
       LEFT JOIN ref_bodies rb ON rb.ref_id = r.id
      WHERE r.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM ref_bindings b WHERE b.ref_id = r.id)
      ORDER BY (r.orphan_since = 0), r.orphan_since, r.id`
  );
  const ttlMs = ttlDays * DAY_MS;
  return rows.map((r) => {
    const since = Number(r.orphan_since) || 0;
    const unboundAt = since > 0 ? since : null;
    const ageMs = unboundAt === null ? 0 : Math.max(0, at - unboundAt);
    const remainingMs = unboundAt === null ? ttlMs : ttlMs - ageMs;
    return {
      refId: String(r.id),
      desc: String(r.desc || ''),
      origin: String(r.origin || ''),
      locator: String(r.locator || ''),
      unboundAt,
      ageMs,
      remainingMs,
      remainingDays: Math.round((remainingMs / DAY_MS) * 10) / 10,
      due: unboundAt !== null && remainingMs <= 0,
      hasBody: Number(r.has_body) === 1,
      bodyBytes: Number(r.body_bytes) || 0,
    };
  });
}

function readRecentDeletions(conn: any, limit = 20): RefGcLogRow[] {
  const rows: any[] = conn.all(
    `SELECT ref_id, ref_desc, origin, body_bytes, unbound_at, deleted_at, ttl_days, reason, source
       FROM ref_gc_log ORDER BY deleted_at DESC, id DESC LIMIT :limit`,
    { limit }
  );
  return rows.map((r) => ({
    refId: String(r.ref_id || ''),
    desc: String(r.ref_desc || ''),
    origin: String(r.origin || ''),
    bodyBytes: Number(r.body_bytes) || 0,
    unboundAt: Number(r.unbound_at) || 0,
    deletedAt: Number(r.deleted_at) || 0,
    ttlDays: Number(r.ttl_days) || 0,
    reason: String(r.reason || ''),
    source: String(r.source || ''),
  }));
}

function summarize(rows: OrphanRefRow[], ttlDays: number, at: number, recent: RefGcLogRow[]): OrphanListResult {
  const dueRows = rows.filter((r) => r.due);
  return {
    status: 'ok',
    ttlDays,
    now: at,
    total: rows.length,
    due: dueRows.length,
    dueEmpty: dueRows.filter((r) => !r.hasBody).length,
    dueWithBody: dueRows.filter((r) => r.hasBody).length,
    dueSoon: rows.filter((r) => !r.due && r.unboundAt !== null && r.remainingMs <= DUE_SOON_MS).length,
    untimed: rows.filter((r) => r.unboundAt === null).length,
    orphans: rows,
    recentDeletions: recent,
  };
}

/** 只读：孤儿清单（失绑时间 / 剩余天数 / 是否到期 / 是否有正文）+ 最近清理留痕。 */
export async function listOrphans({
  ttlDays,
  now = nowMs(),
}: { ttlDays?: unknown; now?: number } = {}): Promise<OrphanListResult> {
  const days = await ttlDaysOf(ttlDays);
  const conn = getDb();
  const rows = readOrphanRows(conn, days, now);
  return summarize(rows, days, now, readRecentDeletions(conn));
}

/**
 * 预演 / 执行到期清理。
 * 默认只预演；`apply=true` 才软删空正文且到期的孤儿。
 */
export async function sweepOrphans({
  apply = false,
  ttlDays,
  now = nowMs(),
  source = 'cli',
}: {
  apply?: boolean;
  ttlDays?: unknown;
  now?: number;
  source?: 'cli' | 'serve';
} = {}): Promise<OrphanSweepResult> {
  const days = await ttlDaysOf(ttlDays);
  const db = getDb();

  if (apply) {
    tx((conn) => normalizeOrphanClocks(conn, now), { db, mode: 'IMMEDIATE' });
  }

  const rows = readOrphanRows(db, days, now);
  const base = summarize(rows, days, now, readRecentDeletions(db));
  const skippedWithBody = rows.filter((r) => r.due && r.hasBody);
  const candidates = rows.filter((r) => r.due && !r.hasBody);
  const eligible = candidates.map((r) => r.refId);

  if (!apply) {
    return { ...base, dryRun: true, eligible, deleted: [], skippedWithBody };
  }

  const deleted: RefGcLogRow[] = [];
  if (candidates.length) {
    tx(
      (conn) => {
        for (const c of candidates) {
          // 事务内复核：仍无归属、仍空正文、仍到期才删（并发复绑时跳过）
          const cur: any = conn.get(
            `SELECT r.id, r."desc" AS desc, r.origin, r.locator, r.orphan_since,
                    CASE WHEN rb.ref_id IS NOT NULL AND trim(COALESCE(rb.body, '')) <> '' THEN 1 ELSE 0 END AS has_body,
                    CASE WHEN rb.ref_id IS NULL THEN 0 ELSE COALESCE(rb.body_bytes, 0) END AS body_bytes
               FROM refs r
               LEFT JOIN ref_bodies rb ON rb.ref_id = r.id
              WHERE r.id = :id AND r.deleted_at IS NULL
                AND NOT EXISTS (SELECT 1 FROM ref_bindings b WHERE b.ref_id = r.id)`,
            { id: c.refId }
          );
          if (!cur || Number(cur.has_body) === 1) continue;
          const since = Number(cur.orphan_since) || 0;
          if (!since || now - since < days * DAY_MS) continue;

          const row: RefGcLogRow = {
            refId: String(cur.id),
            desc: String(cur.desc || ''),
            origin: String(cur.origin || ''),
            bodyBytes: Number(cur.body_bytes) || 0,
            unboundAt: since,
            deletedAt: now,
            ttlDays: days,
            reason: 'orphan-ttl-expired',
            source,
          };
          conn.run(
            `INSERT INTO ref_gc_log
               (ref_id, ref_desc, origin, body_bytes, unbound_at, deleted_at, ttl_days, reason, source, snapshot, created_at)
             VALUES
               (:ref, :desc, :origin, :bytes, :unbound, :deleted, :ttl, :reason, :source, :snapshot, :at)`,
            {
              ref: row.refId,
              desc: row.desc,
              origin: row.origin,
              bytes: row.bodyBytes,
              unbound: row.unboundAt,
              deleted: row.deletedAt,
              ttl: row.ttlDays,
              reason: row.reason,
              source: row.source,
              snapshot: JSON.stringify({ ...row, locator: String(cur.locator || '') }),
              at: now,
            }
          );
          const r = conn.run(
            `UPDATE refs SET deleted_at = :at, updated_at = :at
              WHERE id = :id AND deleted_at IS NULL`,
            { at: now, id: row.refId }
          );
          if (Number(r.changes) > 0) deleted.push(row);
        }
      },
      { db, mode: 'IMMEDIATE' }
    );
  }

  const after = readOrphanRows(db, days, now);
  return {
    ...summarize(after, days, now, readRecentDeletions(db)),
    dryRun: false,
    eligible,
    deleted,
    skippedWithBody,
  };
}

/**
 * serve 的例行维护：启动后延迟跑一次，此后每 intervalMs 一次。
 * 定时器 `unref()`，不阻塞进程退出；上一轮未结束时跳过本轮。
 */
export function startOrphanGcTimer({
  intervalMs = 60 * 60 * 1000,
  initialDelayMs = 10 * 1000,
}: { intervalMs?: number; initialDelayMs?: number } = {}): () => void {
  let stopped = false;
  let running = false;
  const tick = async (): Promise<void> => {
    if (stopped || running) return;
    running = true;
    try {
      const r = await sweepOrphans({ apply: true, source: 'serve' });
      if (r.deleted.length) {
        console.log(
          `[孤儿文档] 已清理 ${r.deleted.length} 篇空壳（TTL ${r.ttlDays} 天）` +
            (r.skippedWithBody.length ? `；跳过有正文 ${r.skippedWithBody.length} 篇，待人工处置` : '')
        );
      }
    } catch (e) {
      console.error('[孤儿文档] 例行维护失败: ' + String((e as Error)?.message || e));
    } finally {
      running = false;
    }
  };
  const first = setTimeout(() => void tick(), initialDelayMs);
  const timer = setInterval(() => void tick(), intervalMs);
  first.unref?.();
  timer.unref?.();
  return () => {
    stopped = true;
    clearTimeout(first);
    clearInterval(timer);
  };
}

/** 人读时间（本地时区，精确到分钟）。 */
export function formatAt(ms: number | null): string {
  if (!ms) return '—';
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** CLI 渲染：清单 / 预演 / 执行共用。 */
export function renderOrphans(d: OrphanListResult | OrphanSweepResult): string {
  const dryRun = 'dryRun' in d ? d.dryRun : true;
  const lines: string[] = [
    `孤儿文档（无归属 ref）：${d.total} 篇 · TTL ${d.ttlDays} 天` +
      ` · 到期 ${d.due}（空壳 ${d.dueEmpty} / 有正文 ${d.dueWithBody}）` +
      (d.dueSoon ? ` · 24h 内到期 ${d.dueSoon}` : '') +
      (d.untimed ? ` · 未计时 ${d.untimed}` : ''),
  ];
  for (const o of d.orphans) {
    const state = o.due ? '已到期' : o.unboundAt === null ? '未计时' : `剩 ${o.remainingDays} 天`;
    lines.push(
      `  ${o.refId}  ${state}  失绑 ${formatAt(o.unboundAt)}  ` +
        (o.hasBody ? `有正文 ${o.bodyBytes}B` : '空壳') +
        (o.desc ? `  ${o.desc}` : '') +
        (o.origin === 'external' && o.locator ? `  ${o.locator}` : '')
    );
  }
  const skippedWithBody = 'skippedWithBody' in d ? d.skippedWithBody : [];
  if (skippedWithBody.length) {
    lines.push(`跳过（有正文，不自动删；人工处置走 docs delete <refId>）：`);
    for (const o of skippedWithBody) {
      lines.push(`  ${o.refId}  ${formatAt(o.unboundAt)}  ${o.bodyBytes}B  ${o.desc}`.trimEnd());
    }
  }
  if ('deleted' in d) {
    lines.push(
      dryRun
        ? `预演：将软删 ${d.eligible.length} 篇空壳（未落盘；加 --apply 执行）`
        : `已软删 ${d.deleted.length} 篇空壳（ref_bodies 保留，可在 ref_gc_log 回查）`
    );
  }
  if (d.recentDeletions.length) {
    lines.push('最近清理：');
    for (const r of d.recentDeletions) {
      lines.push(`  ${formatAt(r.deletedAt)}  ${r.refId}  ${r.reason}  TTL ${r.ttlDays} 天  ${r.desc}`.trimEnd());
    }
  }
  return lines.join('\n');
}
