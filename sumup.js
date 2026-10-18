// SumUp Online Payments API client.
// Mirrors the workspace skill's CLI (~/workspace/skills/sumup/bin/sumup):
//   POST /v0.1/checkouts  {checkout_reference, amount (major units), currency,
//                          merchant_code, description, redirect_url, hosted_checkout}
//   GET  /v0.1/checkouts/{id}
//
// The API key is read from SUMUP_API_KEY at call time and is never logged,
// persisted, or included in error details.

const API_BASE = "https://api.sumup.com";

function apiKey() {
  const key = process.env.SUMUP_API_KEY;
  if (!key) throw new Error("SUMUP_API_KEY is not configured.");
  return key;
}

async function request(method, path, payload) {
  const res = await fetch(API_BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${apiKey()}`,
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    // Never include the key or raw provider payload in the thrown error.
    const detail = data && typeof data === "object"
      ? String(data.message ?? data.error ?? data.title ?? "").slice(0, 160)
      : "";
    throw new Error(`SumUp API error ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  return data;
}

/**
 * Create a hosted checkout. Amount is in integer cents; SumUp takes major units.
 * Returns { id, status, checkout_reference, hosted_checkout_url }.
 */
export async function createCheckout({ reference, totalCents, redirectUrl, description }) {
  const payload = {
    checkout_reference: reference,
    amount: Number((totalCents / 100).toFixed(2)),
    currency: "USD",
    merchant_code: process.env.SUMUP_MERCHANT_CODE || "MCSUELG2",
    description: description || `Unida Massage gift certificate ${reference}`,
    hosted_checkout: { enabled: true },
  };
  if (redirectUrl) payload.redirect_url = redirectUrl;
  const data = await request("POST", "/v0.1/checkouts", payload);
  const hostedUrl = data?.hosted_checkout_url ?? data?.hosted_checkout?.url ?? "";
  if (!data?.id || !hostedUrl.startsWith("https://checkout.sumup.com/")) {
    throw new Error("SumUp did not return a valid hosted checkout.");
  }
  return {
    id: String(data.id),
    status: String(data.status ?? ""),
    checkout_reference: String(data.checkout_reference ?? ""),
    hosted_checkout_url: hostedUrl,
  };
}

/** Extract the successful transaction code, tolerating nested shapes. */
function extractTransactionCode(data) {
  if (typeof data?.transaction_code === "string" && data.transaction_code) {
    return data.transaction_code;
  }
  const txns = Array.isArray(data?.transactions) ? data.transactions : [];
  for (const tx of txns) {
    const code = tx?.transaction_code ?? tx?.code ?? tx?.id;
    const okStatus = String(tx?.status ?? "").toUpperCase();
    if (code && (okStatus === "SUCCESSFUL" || okStatus === "PAID")) return String(code);
  }
  for (const tx of txns) {
    const code = tx?.transaction_code ?? tx?.code ?? tx?.id;
    if (code) return String(code);
  }
  return null;
}

/**
 * Retrieve a checkout (read-only). Returns a normalized shape:
 * { id, status, checkout_reference, amount_cents, currency, merchant_code, transaction_code }
 */
export async function getCheckout(checkoutId) {
  const data = await request("GET", `/v0.1/checkouts/${encodeURIComponent(checkoutId)}`);
  const amountMajor = Number(data?.amount);
  return {
    id: String(data?.id ?? ""),
    status: String(data?.status ?? "").toUpperCase(),
    checkout_reference: String(data?.checkout_reference ?? data?.checkoutReference ?? ""),
    amount_cents: Number.isFinite(amountMajor) ? Math.round(amountMajor * 100) : 0,
    currency: String(data?.currency ?? "").toUpperCase(),
    merchant_code: String(data?.merchant_code ?? data?.merchantCode ?? ""),
    transaction_code: extractTransactionCode(data),
  };
}
