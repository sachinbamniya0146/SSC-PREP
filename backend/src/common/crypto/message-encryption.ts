import * as crypto from 'crypto';

/**
 * message-encryption.ts — encryption-at-rest for chat message content
 * (ReportMessage.content* and SupportMessage.content* fields).
 *
 * WHAT THIS IS: every chat message body is AES-256-GCM encrypted before
 * being written to Postgres, and decrypted only in memory when the server
 * needs to return it to an authorized viewer (the student who sent/receives
 * it, or an admin). Combined with the app already being served over HTTPS
 * (transit encryption — see nginx/conf.d/sscprephub.conf's ssl_certificate
 * block), this means a message is encrypted both in transit and at rest:
 * a stolen DB backup, a compromised disk, or a raw `SELECT * FROM
 * report_messages` is useless without MESSAGE_ENCRYPTION_KEY, which lives
 * only in the server's .env, never in the database itself.
 *
 * WHAT THIS IS NOT: true end-to-end encryption. The backend process holds
 * the key and can decrypt any message — this is what lets the admin panel
 * actually display report/support chats at all (Sachin confirmed this
 * tradeoff explicitly: "Transit + at-rest encryption — admin dekh sakta
 * hai, industry standard" over literal E2E, which would make admin
 * moderation impossible). This is the same model virtually every real
 * support-chat product uses (Intercom, Zendesk, etc.) — not a compromise
 * specific to this app.
 *
 * Algorithm: AES-256-GCM (authenticated encryption — a tampered ciphertext
 * fails to decrypt rather than silently returning corrupted plaintext).
 * Each message gets its own random 12-byte IV (never reused with the same
 * key, which is the one hard rule of GCM) plus a 16-byte auth tag, both
 * stored alongside the ciphertext so decryption doesn't depend on anything
 * but the ciphertext row itself + the server-side key.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12; // 96-bit IV is the GCM-recommended size
const KEY_LENGTH_BYTES = 32; // AES-256

let cachedKey: Buffer | null = null;

/**
 * Resolves MESSAGE_ENCRYPTION_KEY from env into a 32-byte key buffer.
 * Accepts either a 64-char hex string or a base64 string that decodes to
 * exactly 32 bytes — whichever was used to generate it (see the setup
 * comment in env.validation.ts). Throws at first use (not at module load)
 * so the rest of the app can still boot / other modules' tests can still
 * run even if chat isn't configured yet in a given environment.
 */
function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = (process.env.MESSAGE_ENCRYPTION_KEY || '').trim();
  if (!raw) {
    throw new Error(
      'MESSAGE_ENCRYPTION_KEY is not set. Generate one with: ' +
        `openssl rand -hex 32 — then add MESSAGE_ENCRYPTION_KEY=<value> to backend/.env. ` +
        `This key encrypts chat messages at rest; losing/rotating it makes previously ` +
        `stored messages permanently undecryptable, so back it up like any other secret.`,
    );
  }

  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, 'hex');
  } else {
    key = Buffer.from(raw, 'base64');
  }

  if (key.length !== KEY_LENGTH_BYTES) {
    throw new Error(
      `MESSAGE_ENCRYPTION_KEY must decode to exactly 32 bytes (got ${key.length}). ` +
        `Generate a valid one with: openssl rand -hex 32`,
    );
  }

  cachedKey = key;
  return cachedKey;
}

export interface EncryptedMessageFields {
  contentEncrypted: string; // base64
  contentIv: string; // base64
  contentAuthTag: string; // base64
}

/** Encrypts plaintext message content for storage. */
export function encryptMessageContent(plaintext: string): EncryptedMessageFields {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    contentEncrypted: encrypted.toString('base64'),
    contentIv: iv.toString('base64'),
    contentAuthTag: authTag.toString('base64'),
  };
}

/**
 * Decrypts a stored message back to plaintext. Throws if the ciphertext,
 * IV, or auth tag is malformed/tampered — callers should treat a thrown
 * error as "this message is unreadable" rather than crash the whole
 * request; see report-error.service.ts / support-chat.service.ts for how
 * list endpoints guard each message individually so one bad row can't take
 * down an entire thread's listing.
 */
export function decryptMessageContent(fields: EncryptedMessageFields): string {
  const key = getKey();
  const iv = Buffer.from(fields.contentIv, 'base64');
  const authTag = Buffer.from(fields.contentAuthTag, 'base64');
  const encrypted = Buffer.from(fields.contentEncrypted, 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}
