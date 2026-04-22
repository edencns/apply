/**
 * Turso (LibSQL) 클라이언트 + 스키마 관리
 *
 * 전략: JSON blob 중심. LocalAnnouncement / LocalCustomer 구조를 그대로 data 컬럼에 저장.
 * 자주 조회하는 필드(site_id, announcement_id, name, rrn_front, is_standby)만 별도 컬럼으로
 * 꺼내서 인덱싱. 나중에 필요하면 정규화 가능.
 */

import { createClient, type Client } from "@libsql/client";

let _client: Client | null = null;

export function getDb(): Client {
  if (_client) return _client;
  const url = process.env.TURSO_URL;
  const authToken = process.env.TURSO_TOKEN || process.env.TURSO_API_KEY;
  if (!url) throw new Error("TURSO_URL 환경변수가 필요합니다");
  _client = createClient({ url, authToken });
  return _client;
}

/** 스키마 DDL — 멱등. migrate API가 매번 호출 */
export const SCHEMA_DDL = [
  // 사용자 계정 (여러 담당자 격리용)
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`,
  // 공고·고객 등은 user_id로 격리
  `CREATE TABLE IF NOT EXISTS sites (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sites_user ON sites(user_id)`,
  `CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    site_id INTEGER,
    title TEXT NOT NULL,
    announcement_no TEXT,
    status TEXT,
    original_file_url TEXT,
    data TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_announcements_user ON announcements(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_announcements_site ON announcements(site_id)`,
  `CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    announcement_id INTEGER NOT NULL,
    site_id INTEGER,
    name TEXT NOT NULL,
    rrn_front TEXT,
    rrn_back TEXT,
    is_standby INTEGER DEFAULT 0,
    supply_type TEXT,
    unit_type TEXT,
    superseded INTEGER DEFAULT 0,
    verification_verdict TEXT,
    data TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_customers_user ON customers(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_customers_announcement ON customers(announcement_id)`,
  `CREATE INDEX IF NOT EXISTS idx_customers_rrn ON customers(rrn_front)`,
  `CREATE TABLE IF NOT EXISTS contracts (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    customer_id INTEGER,
    announcement_id INTEGER,
    data TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_contracts_user ON contracts(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_contracts_customer ON contracts(customer_id)`,
  // 업로드된 원본 파일 메타 (Vercel Blob)
  `CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    announcement_id INTEGER,
    kind TEXT NOT NULL,
    filename TEXT NOT NULL,
    content_type TEXT,
    size INTEGER,
    url TEXT NOT NULL,
    uploaded_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_files_user ON files(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_files_ann ON files(announcement_id)`,
];

export async function ensureSchema(): Promise<void> {
  const db = getDb();
  for (const sql of SCHEMA_DDL) {
    await db.execute(sql);
  }
}

/** data 컬럼(JSON 문자열) → 객체 */
export function parseRowData<T>(row: any): T {
  const raw = row?.data;
  if (typeof raw !== "string") return raw as T;
  try { return JSON.parse(raw) as T; } catch { return {} as T; }
}

/** 객체 → data 컬럼용 JSON 문자열 */
export function stringifyData(obj: any): string {
  return JSON.stringify(obj);
}
