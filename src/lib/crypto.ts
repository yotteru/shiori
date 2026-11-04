// 自動バックアップの暗号化（指示書 §4.1）
// PBKDF2（SHA-256、310,000回、16バイトの salt）で鍵を作り、AES-GCM（12バイトの IV）で暗号化する。
// 合言葉そのものは保存しない。エラーメッセージにも合言葉や中身を含めない

export const PBKDF2_ITERATIONS = 310_000;
export const SALT_BYTES = 16;
export const IV_BYTES = 12;

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** 合言葉と salt から AES-GCM の鍵を作る（取り出し不可の CryptoKey） */
export async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptText(key: CryptoKey, text: string): Promise<{ ciphertext: string; iv: string }> {
  const iv = randomBytes(IV_BYTES);
  const buf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
  return { ciphertext: toBase64(new Uint8Array(buf)), iv: toBase64(iv) };
}

export class DecryptError extends Error {
  constructor() {
    super('復号できませんでした。合言葉が違う可能性があります。');
    this.name = 'DecryptError';
  }
}

export async function decryptText(key: CryptoKey, ciphertext: string, iv: string): Promise<string> {
  try {
    const buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv) }, key, fromBase64(ciphertext));
    return new TextDecoder().decode(buf);
  } catch {
    throw new DecryptError();
  }
}
