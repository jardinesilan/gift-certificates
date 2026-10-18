// Public gift certificate purchase app — Unida Massage.
// Standalone Node/Express server (no artifact SDK).
//
// Flow (card):
//   POST /api/purchases            -> creates pending purchase + SumUp hosted checkout
//   buyer pays on SumUp (new tab)  -> SumUp redirects to /return?purchase_id=<id>
//   POST /api/purchases/:id/verify -> server verifies PAID with SumUp, then issues
// Flow (venmo): POST /api/venmo/issue (trust-based, same as the private app).
// Sync for Owner Tools: GET /api/v1/certificates?since=<ISO8601> (Bearer SYNC_TOKEN).

import crypto from "node:crypto";
import express from "express";
import path from "node:path";
import rateLimit from "express-rate-limit";
import {
  db,
  codeExists,
  insertCertificate,
  getCertificateById,
  createPendingPurchase,
  getPurchase,
  listStuckPurchases,
  updatePurchase,
  insertEmailDelivery,
  updateEmailDelivery,
  getEmailDeliveries,
  listCertificatesSince,
  certificatePublicView,
  purchasePublicView,
} from "./db.js";
import { uniqueCode, makeCode } from "./codes.js";
import {
  recipientEmailHtml,
  buyerReceiptHtml,
  recipientSubject,
  buyerSubject,
} from "./emails.js";
import { createCheckout, getCheckout } from "./sumup.js";
import { sendMail } from "./mailer.js";

const SERVICE_IDS = ["30_min", "foot_massage", "60_min", "90_min", "90_min_cupping"];
const CARD_PRICES = { "30_min": 4000, foot_massage: 5000, "60_min": 8000, "90_min": 11000, "90_min_cupping": 12000 };
const VENMO_PRICES = { "30_min": 4000, foot_massage: 5000, "60_min": 7000, "90_min": 10500, "90_min_cupping": 11000 };
const MERCHANT_CODE = process.env.SUMUP_MERCHANT_CODE || "MCSUELG2";
const APP_BASE_URL = (process.env.APP_BASE_URL || "").replace(/\/+$/, "");

function servicePrice(serviceId, paymentMethod) {
  return paymentMethod === "venmo" ? VENMO_PRICES[serviceId] : CARD_PRICES[serviceId];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validatePurchaseInput(body) {
  const errors = [];
  const b = body ?? {};
  if (!SERVICE_IDS.includes(b.service_id)) errors.push("Choose a massage.");
  const tip = b.tip_amount_cents;
  if (!Number.isInteger(tip) || tip < 0 || tip > 100000) errors.push("Enter a tip from $0 to $1,000.");
  const str = (v, min, max) => typeof v === "string" && v.trim().length >= min && v.trim().length <= max;
  if (!str(b.buyer_name, 1, 100)) errors.push("Enter the buyer name.");
  if (typeof b.buyer_email !== "string" || !EMAIL_RE.test(b.buyer_email.trim()) || b.buyer_email.trim().length > 200)
    errors.push("Enter a valid buyer email.");
  if (!str(b.recipient_name, 1, 100)) errors.push("Enter the recipient name.");
  if (typeof b.recipient_email !== "string" || !EMAIL_RE.test(b.recipient_email.trim()) || b.recipient_email.trim().length > 200)
    errors.push("Enter a valid recipient email.");
  if (b.message !== undefined && (typeof b.message !== "string" || b.message.length > 500))
    errors.push("The message is too long (500 characters max).");
  if (errors.length) return { errors };
  return {
    value: {
      service_id: b.service_id,
      tip_amount_cents: tip,
      buyer_name: b.buyer_name.trim(),
      buyer_email: b.buyer_email.trim(),
      recipient_name: b.recipient_name.trim(),
      recipient_email: b.recipient_email.trim(),
      message: (b.message ?? "").trim(),
    },
  };
}

async function issueCertificate({ serviceId, paymentMethod, input, paymentRef, sumupCheckoutId, sumupTransactionCode }) {
  const amountCents = servicePrice(serviceId, paymentMethod);
  const code = uniqueCode();
  const { id: certId, sale_number: saleNumber } = insertCertificate({
    code,
    original_amount_cents: amountCents,
    tip_amount_cents: input.tip_amount_cents,
    remaining_amount_cents: amountCents,
    buyer_name: input.buyer_name,
    buyer_email: input.buyer_email,
    recipient_name: input.recipient_name,
    recipient_email: input.recipient_email,
    message: input.message,
    payment_method: paymentMethod,
    payment_ref: paymentRef,
    sumup_checkout_id: sumupCheckoutId ?? null,
    sumup_transaction_code: sumupTransactionCode ?? null,
  });

  const emailArgs = {
    amountCents,
    tipAmountCents: input.tip_amount_cents,
    buyerName: input.buyer_name,
    recipientName: input.recipient_name,
    message: input.message,
    code,
    paymentMethod,
    saleNumber,
  };
  const jobs = [
    {
      recipient_type: "recipient",
      email: input.recipient_email,
      subject: recipientSubject({ amountCents, recipientName: input.recipient_name, paymentMethod }),
      html: recipientEmailHtml(emailArgs),
    },
    {
      recipient_type: "buyer",
      email: input.buyer_email,
      subject: buyerSubject({ paymentMethod }),
      html: buyerReceiptHtml({ ...emailArgs, paymentRef }),
    },
  ];
  for (const job of jobs) {
    const deliveryId = insertEmailDelivery({
      certificate_id: certId,
      recipient_type: job.recipient_type,
      email: job.email,
      status: "queued",
    });
    try {
      const result = await sendMail({ to: job.email, subject: job.subject, html: job.html });
      updateEmailDelivery(deliveryId, result.ok ? "sent" : "failed", result.ok ? null : result.detail);
    } catch (err) {
      updateEmailDelivery(deliveryId, "failed", String(err?.message ?? err).slice(0, 200));
    }
  }
  return getCertificateById(certId);
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

const apiLimiter = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false });
const createLimiter = rateLimit({ windowMs: 60_000, max: 12, standardHeaders: true, legacyHeaders: false });
app.use("/api/", apiLimiter);

app.get("/api/health", (req, res) => res.json({ ok: true }));

// ---- Card purchase: create pending purchase + SumUp hosted checkout ----
app.post("/api/purchases", createLimiter, async (req, res) => {
  const { errors, value } = validatePurchaseInput(req.body);
  if (errors) return res.status(400).json({ error: errors[0] });
  const amountCents = servicePrice(value.service_id, "card");
  const totalCents = amountCents + value.tip_amount_cents;
  const checkoutReference = `GC-${Date.now().toString(36).toUpperCase()}-${makeCode(8)}`;
  let purchaseId;
  try {
    purchaseId = createPendingPurchase({ checkout_reference: checkoutReference, ...value, amount_cents: amountCents, total_cents: totalCents });
  } catch (err) {
    console.error("createPendingPurchase failed", err?.message);
    return res.status(500).json({ error: "The secure checkout could not be started." });
  }
  const redirectUrl = APP_BASE_URL ? `${APP_BASE_URL}/return?purchase_id=${purchaseId}` : undefined;
  if (!redirectUrl) console.warn("APP_BASE_URL is not set; SumUp redirect_url omitted.");
  try {
    const co = await createCheckout({
      reference: checkoutReference,
      totalCents,
      redirectUrl,
      description: `Unida Massage gift certificate ${checkoutReference}`,
    });
    updatePurchase(purchaseId, {
      status: "pending",
      sumup_checkout_id: co.id,
      hosted_checkout_url: co.hosted_checkout_url,
      sumup_status: co.status || "PENDING",
      failure_reason: null,
    });
  } catch (err) {
    console.error("SumUp createCheckout failed", err?.message);
    updatePurchase(purchaseId, { status: "failed", failure_reason: "SumUp did not return a valid hosted checkout." });
    return res.status(502).json({ error: "The SumUp checkout could not be created. Please try again.", purchase: purchasePublicView(getPurchase(purchaseId)) });
  }
  return res.status(201).json({ purchase: purchasePublicView(getPurchase(purchaseId)) });
});

app.get("/api/purchases/:id", (req, res) => {
  const purchase = getPurchase(Number(req.params.id));
  if (!purchase) return res.status(404).json({ error: "That checkout could not be found." });
  const certificate = purchase.certificate_id ? certificatePublicView(getCertificateById(purchase.certificate_id)) : null;
  return res.json({ purchase: purchasePublicView(purchase), certificate });
});

// ---- Verify a SumUp checkout and issue the certificate (idempotent) ----
// Shared core used by both the buyer-facing verify endpoint and the background
// reconciler (which catches payments where the buyer never returned to the tab).
const verifying = new Set();

async function verifyAndIssuePurchase(id) {
  // Returns { outcome, purchase, certificate? }.
  // Outcomes: "issued" | "already_issued" | "not_ready" | "in_progress" |
  //           "not_found" | "sumup_unreachable" | "mismatch" |
  //           "not_paid" | "no_transaction_ref"
  const purchase = getPurchase(id);
  if (!purchase) return { outcome: "not_found", purchase: null };
  if (purchase.certificate_id) {
    return { outcome: "already_issued", purchase, certificate: getCertificateById(purchase.certificate_id) };
  }
  if (!purchase.sumup_checkout_id || purchase.status === "creating") {
    return { outcome: "not_ready", purchase };
  }
  if (verifying.has(id)) {
    return { outcome: "in_progress", purchase };
  }
  verifying.add(id);
  try {
    updatePurchase(id, { status: "verifying", failure_reason: null });
    let co;
    try {
      co = await getCheckout(purchase.sumup_checkout_id);
    } catch (err) {
      console.error("SumUp getCheckout failed", err?.message);
      updatePurchase(id, { status: "pending", failure_reason: "SumUp could not be reached. Please try again." });
      return { outcome: "sumup_unreachable", purchase: getPurchase(id) };
    }
    const matches =
      co.id === purchase.sumup_checkout_id &&
      co.checkout_reference === purchase.checkout_reference &&
      co.amount_cents === purchase.total_cents &&
      co.currency === "USD" &&
      co.merchant_code === MERCHANT_CODE;
    if (!matches) {
      updatePurchase(id, { status: "failed", failure_reason: "SumUp verification did not match this purchase." });
      return { outcome: "mismatch", purchase: getPurchase(id) };
    }
    if (co.status !== "PAID") {
      const next = co.status === "EXPIRED" ? "expired" : co.status === "FAILED" ? "failed" : "pending";
      const reason =
        co.status === "FAILED" ? "SumUp reports that the payment failed or was cancelled. You can start a new checkout."
        : co.status === "EXPIRED" ? "This SumUp checkout expired. You can start a new checkout."
        : null;
      updatePurchase(id, { status: next, sumup_status: co.status, failure_reason: reason });
      return { outcome: "not_paid", purchase: getPurchase(id), sumupStatus: co.status };
    }
    if (!co.transaction_code) {
      updatePurchase(id, { status: "failed", failure_reason: "SumUp marked the checkout paid but did not return a payment reference." });
      return { outcome: "no_transaction_ref", purchase: getPurchase(id) };
    }
    // Double-check nobody issued while we were verifying (duplicate-issuance guard).
    const fresh = getPurchase(id);
    if (fresh.certificate_id) {
      return { outcome: "already_issued", purchase: fresh, certificate: getCertificateById(fresh.certificate_id) };
    }
    updatePurchase(id, { status: "paid", sumup_status: "PAID", sumup_transaction_code: co.transaction_code });
    const cert = await issueCertificate({
      serviceId: purchase.service_id,
      paymentMethod: "card",
      input: {
        tip_amount_cents: purchase.tip_amount_cents,
        buyer_name: purchase.buyer_name,
        buyer_email: purchase.buyer_email,
        recipient_name: purchase.recipient_name,
        recipient_email: purchase.recipient_email,
        message: purchase.message,
      },
      paymentRef: co.transaction_code,
      sumupCheckoutId: co.id,
      sumupTransactionCode: co.transaction_code,
    });
    updatePurchase(id, { status: "issued", certificate_id: cert.id });
    return { outcome: "issued", purchase: getPurchase(id), certificate: cert };
  } finally {
    verifying.delete(id);
  }
}

app.post("/api/purchases/:id/verify", async (req, res) => {
  const id = Number(req.params.id);
  const r = await verifyAndIssuePurchase(id);
  switch (r.outcome) {
    case "not_found":
      return res.status(404).json({ error: "That checkout could not be found." });
    case "already_issued":
      return res.json({ purchase: purchasePublicView(r.purchase), certificate: certificatePublicView(r.certificate), issued: true });
    case "not_ready":
      return res.status(409).json({ error: "The SumUp checkout is not ready yet.", purchase: purchasePublicView(r.purchase) });
    case "in_progress":
      return res.status(409).json({ error: "Verification already in progress.", purchase: purchasePublicView(r.purchase) });
    case "sumup_unreachable":
      return res.status(502).json({ error: "SumUp could not be reached. Please try again.", purchase: purchasePublicView(r.purchase) });
    case "mismatch":
      return res.status(422).json({ error: "SumUp verification did not match this purchase.", purchase: purchasePublicView(r.purchase) });
    case "not_paid":
      return res.json({ purchase: purchasePublicView(r.purchase), certificate: null, issued: false });
    case "no_transaction_ref":
      return res.status(422).json({ error: "SumUp did not return a payment reference.", purchase: purchasePublicView(r.purchase) });
    case "issued":
      return res.json({ purchase: purchasePublicView(r.purchase), certificate: certificatePublicView(r.certificate), issued: true });
    default:
      return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ---- Background reconciler: rescue stuck card payments ----
// Catches purchases where SumUp was paid but the buyer never returned to the
// tab, so /verify was never called. Runs every 15 minutes in-process.
let reconciling = false;

async function reconcileStuckPurchases() {
  if (reconciling) return;
  reconciling = true;
  try {
    // RECONCILE_AFTER (ISO timestamp, optional): skip purchases created before
    // this cutoff — used once at rollout to avoid re-issuing purchases that were
    // already resolved manually (e.g. May Jamshedi's $95 on 2026-10-17).
    const after = process.env.RECONCILE_AFTER || null;
    const stuck = listStuckPurchases(after);
    if (stuck.length > 0) console.log(`[reconcile] checking ${stuck.length} stuck purchase(s)`);
    for (const p of stuck) {
      try {
        const r = await verifyAndIssuePurchase(p.id);
        if (r.outcome === "issued") {
          console.log(`[reconcile] issued certificate ${r.certificate.code} for stuck purchase ${p.id} (${p.buyer_email})`);
        } else if (r.outcome !== "not_paid" && r.outcome !== "in_progress") {
          console.log(`[reconcile] purchase ${p.id}: ${r.outcome}`);
        }
      } catch (err) {
        console.error(`[reconcile] purchase ${p.id} error:`, err?.message);
      }
    }
  } finally {
    reconciling = false;
  }
}

const RECONCILE_INTERVAL_MS = 15 * 60 * 1000;
function startReconciler() {
  // First run shortly after startup (catches anything stuck across a restart),
  // then every 15 minutes.
  setTimeout(() => {
    reconcileStuckPurchases().catch((err) => console.error("[reconcile] startup run failed:", err?.message));
  }, 2 * 60 * 1000);
  setInterval(() => {
    reconcileStuckPurchases().catch((err) => console.error("[reconcile] run failed:", err?.message));
  }, RECONCILE_INTERVAL_MS);
  console.log("[reconcile] background reconciler started (every 15 min)");
}

// ---- Venmo: trust-based issuance (same as the private app) ----
app.post("/api/venmo/issue", createLimiter, async (req, res) => {
  const { errors, value } = validatePurchaseInput(req.body);
  if (errors) return res.status(400).json({ error: errors[0] });
  const paymentRef = `VENMO-CONFIRMED-${makeCode(8)}`;
  try {
    const cert = await issueCertificate({
      serviceId: value.service_id,
      paymentMethod: "venmo",
      input: value,
      paymentRef,
    });
    return res.status(201).json({ certificate: certificatePublicView(cert) });
  } catch (err) {
    console.error("venmo issue failed", err?.message);
    return res.status(500).json({ error: "The certificate could not be created. Please try again." });
  }
});

// ---- Sync API for the private Muse side (Owner Tools import) ----
function syncAuth(req, res, next) {
  const token = process.env.SYNC_TOKEN;
  if (!token) return res.status(503).json({ error: "Sync is not configured on this server." });
  const header = req.headers.authorization || "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(provided);
  const b = Buffer.from(token);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "Unauthorized." });
  }
  next();
}

app.get("/api/v1/certificates", syncAuth, (req, res) => {
  const since = String(req.query.since ?? "");
  const ms = since ? Date.parse(since) : 0;
  if (since && Number.isNaN(ms)) return res.status(400).json({ error: "since must be an ISO8601 timestamp." });
  const sinceIso = since ? new Date(ms).toISOString() : "1970-01-01T00:00:00.000Z";
  return res.json({ certificates: listCertificatesSince(sinceIso) });
});

// ---- Static client ----
const publicDir = path.join(process.cwd(), "public");
app.get("/return", (req, res) => res.sendFile(path.join(publicDir, "index.html")));
app.use(express.static(publicDir, { extensions: ["html"] }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("Unhandled error", err?.message);
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`Gift certificate app listening on port ${PORT}`);
  if (!process.env.SUMUP_API_KEY) console.warn("SUMUP_API_KEY not set — card checkout creation will fail until configured.");
  if (!APP_BASE_URL) console.warn("APP_BASE_URL not set — SumUp buyer redirect will be omitted.");
  if (!process.env.RESEND_API_KEY) console.warn("RESEND_API_KEY not set — emails will be logged to console only.");
  if (!process.env.SYNC_TOKEN) console.warn("SYNC_TOKEN not set — /api/v1/certificates is disabled.");
  startReconciler();
});

// Export for tests.
export { app, validatePurchaseInput, servicePrice, verifyAndIssuePurchase, reconcileStuckPurchases };
export { db };
