/**
 * 필드 수준 암호화 (AES-256-GCM)
 *
 * 목적:
 *  - Turso DB가 유출되더라도 주민번호 뒷자리 등 최고 민감 필드를 평문으로 노출하지 않음
 *  - 암호화 키는 FIELD_ENCRYPTION_KEY 환경변수 (32바이트 hex = 64 chars)
 *  - 포맷: v1:<nonce_hex>:<ciphertext_hex>:<tag_hex>
 *
 * 원칙:
 *  - "keyOrUnset" 방식: 키가 설정 안 되어 있으면 암호화 우회 (배포 중단 없음, 경고만)
 *  - 운영 배포 시 반드시 키 설정 + 기존 데이터 마이그레이션
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";
const VERSION = "v1";

function getKey(): Buffer | null {
  const hex = process.env.FIELD_ENCRYPTION_KEY;
  if (!hex) return null;
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    console.warn("[field-crypto] FIELD_ENCRYPTION_KEY는 64 hex chars (32 bytes)여야 합니다");
    return null;
  }
  return Buffer.from(hex, "hex");
}

export function isEncryptionAvailable(): boolean {
  return getKey() !== null;
}

/** 평문 → 암호화 문자열. 키 없으면 원문 반환(경고). */
export function encryptField(plain: string | null | undefined): string | null {
  if (plain == null || plain === "") return plain ?? null;
  const key = getKey();
  if (!key) return String(plain); // 키 없으면 평문 통과 (개발 환경 대응)
  const nonce = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, nonce);
  const enc = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${nonce.toString("hex")}:${enc.toString("hex")}:${tag.toString("hex")}`;
}

/** 암호화 문자열 → 평문. 이미 평문이거나 키 없으면 그대로 반환. */
export function decryptField(stored: string | null | undefined): string | null {
  if (stored == null || stored === "") return (stored as any) ?? null;
  const s = String(stored);
  if (!s.startsWith(`${VERSION}:`)) return s; // 암호화 안 된 레거시 데이터
  const key = getKey();
  if (!key) return s; // 키 없으면 그대로 (오류보다 degrade 우선)
  try {
    const [, nonceHex, encHex, tagHex] = s.split(":");
    if (!nonceHex || !encHex || !tagHex) return s;
    const nonce = Buffer.from(nonceHex, "hex");
    const enc = Buffer.from(encHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const decipher = createDecipheriv(ALGO, key, nonce);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return dec.toString("utf8");
  } catch (e: any) {
    console.warn("[field-crypto] decrypt failed:", e?.message);
    return null;
  }
}

/** 32바이트 랜덤 키 hex 생성 — 최초 배포 시 한 번 실행해 환경변수로 저장 */
export function generateKey(): string {
  return randomBytes(32).toString("hex");
}
