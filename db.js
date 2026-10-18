// SQLite storage for the public gift certificate app.
// Uses better-sqlite3. To swap to Postgres, replace this module with a
// pg-based implementation exposing the same functions (see README).
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "data", "gc.db");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS certificates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  original_amount_cents INTEGER NOT NULL,
  tip_amount_cents INTEGER NOT NULL DEFAULT 0,
  remaining_amount_cents INTEGER NOT NULL,
  buyer_name TEXT NOT NULL,
  buyer_email TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  payment_method TEXT NOT NULL,
  payment_ref TEXT NOT NULL,
  sumup_checkout_id TEXT,
  sumup_transaction_code TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pending_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checkout_reference TEXT NOT NULL UNIQUE,
  service_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  tip_amount_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL,
  buyer_name TEXT NOT NULL,
  buyer_email TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'creating',
  sumup_checkout_id TEXT,
  hosted_checkout_url TEXT,
  sumup_status TEXT,
  sumup_transaction_code TEXT,
  failure_reason TEXT,
  certificate_id INTEGER REFERENCES certificates(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS email_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  certificate_id INTEGER NOT NULL REFERENCES certificates(id) ON DELETE CASCADE,
  recipient_type TEXT NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  failure_reason TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_certificates_created ON certificates(created_at);
CREATE INDEX IF NOT EXISTS idx_purchases_checkout ON pending_purchases(sumup_checkout_id);
-- Sequential sale numbers for transaction reference (continues Ela's receipt sequence)
CREATE TABLE IF NOT EXISTS counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
INSERT OR IGNORE INTO counters (name, value) VALUES ('sale_number', 5775);
-- Add sale_number to existing certificates tables (idempotent)
`);
try { db.exec("ALTER TABLE certificates ADD COLUMN sale_number INTEGER"); } catch (e) { /* already exists */ }
try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_certificates_sale_number ON certificates(sale_number)"); } catch (e) { /* ignore */ }
// Backfill sale numbers for the first two live certificates (Oct 13, 2026)
try {
  const c1 = db.prepare("SELECT id, sale_number FROM certificates WHERE code = '9X4D2'").get();
  if (!c1) {
    // Restore Corey's certificate (was wiped before persistent volume)
    db.prepare(`INSERT INTO certificates (code, sale_number, original_amount_cents, tip_amount_cents, remaining_amount_cents, buyer_name, buyer_email, recipient_name, recipient_email, message, status, payment_method, payment_ref, created_at) VALUES ('9X4D2', 5776, 4000, 0, 4000, 'Corey packwood', 'cjprospectors@gmail.com', 'Corey', 'cjprospectors@gmail.com', '', 'active', 'venmo', 'VENMO-CONFIRMED-CBLEPPFL', '2026-10-14T04:14:28.542Z')`).run();
  } else if (!c1.sale_number) {
    db.prepare("UPDATE certificates SET sale_number = 5776 WHERE id = ?").run(c1.id);
  }
  const c2 = db.prepare("SELECT id, sale_number FROM certificates WHERE code = 'N7A6C'").get();
  if (!c2) {
    // Restore Ela's certificate (was wiped before persistent volume)
    db.prepare(`INSERT INTO certificates (code, sale_number, original_amount_cents, tip_amount_cents, remaining_amount_cents, buyer_name, buyer_email, recipient_name, recipient_email, message, status, payment_method, payment_ref, sumup_transaction_code, created_at) VALUES ('N7A6C', 5777, 4000, 0, 4000, 'Ela silan', 'jardinesilan@gmail.com', 'Ela s', 'jardinesilan@gmail.com', '', 'active', 'card', 'TAAA6VYTPKC', 'TAAA6VYTPKC', '2026-10-14T04:25:46.932Z')`).run();
  } else if (!c2.sale_number) {
    db.prepare("UPDATE certificates SET sale_number = 5777 WHERE id = ?").run(c2.id);
  }
  db.prepare("UPDATE counters SET value = 5777 WHERE name = 'sale_number' AND value < 5777").run();
} catch (e) { /* backfill best-effort */ }

export function nextSaleNumber() {
  const txn = db.transaction(() => {
    const row = db.prepare("SELECT value FROM counters WHERE name = 'sale_number'").get();
    const next = (row ? row.value : 5775) + 1;
    db.prepare("UPDATE counters SET value = ? WHERE name = 'sale_number'").run(next);
    return next;
  });
  return txn();
}

const nowIso = () => new Date().toISOString();

export function codeExists(code) {
  const row = db.prepare("SELECT id FROM certificates WHERE code = ?").get(code);
  return Boolean(row);
}

export function insertCertificate(cert) {
  const saleNumber = cert.sale_number || nextSaleNumber();
  const stmt = db.prepare(`
    INSERT INTO certificates
      (code, sale_number, original_amount_cents, tip_amount_cents, remaining_amount_cents,
       buyer_name, buyer_email, recipient_name, recipient_email, message,
       status, payment_method, payment_ref, sumup_checkout_id, sumup_transaction_code, created_at)
    VALUES
      (@code, @sale_number, @original_amount_cents, @tip_amount_cents, @remaining_amount_cents,
       @buyer_name, @buyer_email, @recipient_name, @recipient_email, @message,
       'active', @payment_method, @payment_ref, @sumup_checkout_id, @sumup_transaction_code, @created_at)
  `);
  const info = stmt.run({ ...cert, sale_number: saleNumber, created_at: nowIso() });
  return { id: Number(info.lastInsertRowid), sale_number: saleNumber };
}

export function getCertificateById(id) {
  return db.prepare("SELECT * FROM certificates WHERE id = ?").get(id) ?? null;
}

export function createPendingPurchase(p) {
  const stmt = db.prepare(`
    INSERT INTO pending_purchases
      (checkout_reference, service_id, amount_cents, tip_amount_cents, total_cents,
       buyer_name, buyer_email, recipient_name, recipient_email, message,
       status, created_at, updated_at)
    VALUES
      (@checkout_reference, @service_id, @amount_cents, @tip_amount_cents, @total_cents,
       @buyer_name, @buyer_email, @recipient_name, @recipient_email, @message,
       'creating', @now, @now)
  `);
  const t = nowIso();
  const info = stmt.run({ ...p, now: t });
  return Number(info.lastInsertRowid);
}

export function getPurchase(id) {
  return db.prepare("SELECT * FROM pending_purchases WHERE id = ?").get(id) ?? null;
}

export function getPurchaseByReference(ref) {
  return db.prepare("SELECT * FROM pending_purchases WHERE checkout_reference = ?").get(ref) ?? null;
}

export function updatePurchase(id, fields) {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  const set = keys.map((k) => `${k} = @${k}`).join(", ");
  db.prepare(`UPDATE pending_purchases SET ${set}, updated_at = @now WHERE id = @id`)
    .run({ ...fields, id, now: nowIso() });
}

// Purchases that look stuck: a SumUp checkout exists, no certificate was issued,
// and the purchase is still in a pre-issuance state. The created_at grace period
// keeps the reconciler from racing a buyer who is still on SumUp's payment page.
// Pass afterIso to skip purchases created before a cutoff (e.g. ones already
// resolved manually), avoiding duplicate issuance.
export function listStuckPurchases(afterIso = null) {
  return db.prepare(`
    SELECT * FROM pending_purchases
    WHERE certificate_id IS NULL
      AND sumup_checkout_id IS NOT NULL
      AND status IN ('pending', 'verifying')
      AND datetime(created_at) < datetime('now', '-5 minutes')
      AND (? IS NULL OR created_at > ?)
    ORDER BY created_at ASC
  `).all(afterIso, afterIso);
}

export function insertEmailDelivery({ certificate_id, recipient_type, email, status, failure_reason }) {
  const stmt = db.prepare(`
    INSERT INTO email_deliveries
      (certificate_id, recipient_type, email, status, failure_reason, sent_at, created_at)
    VALUES (@certificate_id, @recipient_type, @email, @status, @failure_reason, @sent_at, @created_at)
  `);
  const t = nowIso();
  const info = stmt.run({
    certificate_id, recipient_type, email, status,
    failure_reason: failure_reason ?? null,
    sent_at: status === "sent" ? t : null,
    created_at: t,
  });
  return Number(info.lastInsertRowid);
}

export function updateEmailDelivery(id, status, failureReason) {
  db.prepare("UPDATE email_deliveries SET status = @status, failure_reason = @failure_reason, sent_at = @sent_at WHERE id = @id")
    .run({ id, status, failure_reason: failureReason ?? null, sent_at: status === "sent" ? nowIso() : null });
}

export function getEmailDeliveries(certificateId) {
  return db.prepare("SELECT * FROM email_deliveries WHERE certificate_id = ? ORDER BY id").all(certificateId);
}

export function listCertificatesSince(sinceIso, limit = 500) {
  return db.prepare(`
    SELECT code, sale_number, original_amount_cents AS amount_cents, tip_amount_cents AS tip_cents,
           buyer_name, buyer_email, recipient_name, recipient_email,
           payment_method, payment_ref,
           COALESCE(sumup_checkout_id, payment_ref) AS checkout_reference,
           created_at AS issued_at
    FROM certificates
    WHERE created_at >= ?
    ORDER BY created_at ASC
    LIMIT ?
  `).all(sinceIso, limit);
}

export function certificatePublicView(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    original_amount_cents: row.original_amount_cents,
    tip_amount_cents: row.tip_amount_cents,
    remaining_amount_cents: row.remaining_amount_cents,
    buyer_name: row.buyer_name,
    buyer_email: row.buyer_email,
    recipient_name: row.recipient_name,
    recipient_email: row.recipient_email,
    message: row.message,
    status: row.status,
    payment_method: row.payment_method,
    payment_ref: row.payment_ref,
    sumup_checkout_id: row.sumup_checkout_id,
    sumup_transaction_code: row.sumup_transaction_code,
    created_at: row.created_at,
    email_deliveries: getEmailDeliveries(row.id).map((d) => ({
      recipient_type: d.recipient_type,
      email: d.email,
      status: d.status,
      failure_reason: d.failure_reason,
      sent_at: d.sent_at,
    })),
  };
}

export function purchasePublicView(row) {
  if (!row) return null;
  return {
    id: row.id,
    checkout_reference: row.checkout_reference,
    amount_cents: row.amount_cents,
    tip_amount_cents: row.tip_amount_cents,
    total_cents: row.total_cents,
    status: row.status,
    sumup_checkout_id: row.sumup_checkout_id,
    hosted_checkout_url: row.hosted_checkout_url,
    sumup_status: row.sumup_status,
    failure_reason: row.failure_reason,
    buyer_name: row.buyer_name,
    buyer_email: row.buyer_email,
    recipient_name: row.recipient_name,
    recipient_email: row.recipient_email,
  };
}
