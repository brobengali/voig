import crypto from "node:crypto";

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;

export interface EncryptedBlob {
  iv: string;
  tag: string;
  data: string;
}

export function deriveKey(passphrase: string, saltHex: string): Buffer {
  const salt = Buffer.from(saltHex, "hex");
  return crypto.scryptSync(passphrase, salt, 32, SCRYPT_PARAMS);
}

export function hashPassphraseVerifier(passphrase: string, saltHex: string): string {
  const derived = deriveKey(passphrase, saltHex);
  return crypto.createHash("sha256").update(derived).digest("hex");
}

export function verifyPassphrase(
  passphrase: string,
  saltHex: string,
  expectedVerifierHex: string
): boolean {
  const candidate = Buffer.from(hashPassphraseVerifier(passphrase, saltHex), "hex");
  const expected = Buffer.from(expectedVerifierHex, "hex");
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

export function encryptBuffer(plaintext: Buffer, key: Buffer): Buffer {
  const iv = crypto.randomBytes(GCM_IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

export function decryptBuffer(packed: Buffer, key: Buffer): Buffer {
  if (packed.length < GCM_IV_BYTES + GCM_TAG_BYTES) {
    throw new Error("Encrypted buffer is malformed or truncated.");
  }
  const iv = packed.subarray(0, GCM_IV_BYTES);
  const tag = packed.subarray(GCM_IV_BYTES, GCM_IV_BYTES + GCM_TAG_BYTES);
  const ciphertext = packed.subarray(GCM_IV_BYTES + GCM_TAG_BYTES);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function encryptJson(value: unknown, key: Buffer): string {
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const iv = crypto.randomBytes(GCM_IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload: EncryptedBlob = {
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: encrypted.toString("base64"),
  };
  return JSON.stringify(payload);
}

export function decryptJson<T>(serialized: string, key: Buffer): T {
  const payload = JSON.parse(serialized) as EncryptedBlob;
  const iv = Buffer.from(payload.iv, "base64");
  const tag = Buffer.from(payload.tag, "base64");
  const data = Buffer.from(payload.data, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}

export function deriveSubKey(secret: string, context: string): Buffer {
  return crypto.createHmac("sha256", secret).update(context).digest();
}

export function signToken(payload: Record<string, unknown>, secret: string): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

export function verifyToken<T extends Record<string, unknown>>(
  token: string,
  secret: string
): T | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encoded, providedSig] = parts;
  if (!encoded || !providedSig) return null;

  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(encoded)
    .digest("base64url");

  const a = Buffer.from(providedSig, "utf8");
  const b = Buffer.from(expectedSig, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as T;
    if (typeof parsed.exp === "number" && Date.now() > parsed.exp) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
