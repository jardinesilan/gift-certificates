// Email templates — ported verbatim from the private gift-certificate-app
// (server/src/actions.ts: emailHtml + buyerReceiptHtml). Certificates never
// expire (WA law), so no expiration language appears anywhere.

export function money(cents) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function recipientEmailHtml({ amountCents, tipAmountCents, buyerName, recipientName, message, code, paymentMethod, saleNumber }) {
  const note = message
    ? `<blockquote style="margin:20px 0 0;padding:16px 18px;background:#fff8f5;border-radius:10px;color:#244347;font:italic 16px/1.55 Georgia,serif">&ldquo;${escapeHtml(message)}&rdquo;</blockquote>`
    : "";
  const totalCents = amountCents + tipAmountCents;
  const notice = paymentMethod === "venmo" ? "VENMO PAYMENT MARKED PAID BY PURCHASER" : "SUMUP PAYMENT VERIFIED";
  const footerNote = paymentMethod === "venmo"
    ? "The purchaser confirmed that this gift was paid through Venmo before it was issued."
    : "SumUp confirmed the payment before this gift certificate was issued.";
  return `<div style="margin:0;padding:24px;background:#fff8f5;font-family:Arial,sans-serif;color:#244347"><div style="max-width:620px;margin:0 auto"><div style="margin-bottom:14px;padding:10px 14px;border:1px solid #e7c3ae;border-radius:8px;background:#f5e3d8;color:#60351f;font-size:12px;font-weight:700;letter-spacing:.08em">${notice}</div><div style="overflow:hidden;border-radius:8px 24px 8px 24px;background:#365e63;color:#fffaf7"><div style="padding:32px 28px;background:#f4867d;color:#244347"><div style="font:italic 26px Georgia,serif">Unidamassage</div><div style="margin-top:8px;font-size:13px">A restorative massage, given with care.</div></div><div style="padding:28px"><div style="display:flex;justify-content:space-between;gap:20px"><div><div style="color:#cfe0df;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase">Gift value</div><div style="margin-top:5px;font:36px Georgia,serif">${money(amountCents)}</div></div><div style="font:bold 17px monospace;letter-spacing:.12em">${escapeHtml(code)}</div></div><div style="margin-top:24px;font:23px Georgia,serif">For ${escapeHtml(recipientName)}</div><p style="margin:10px 0 0;color:#deebea;line-height:1.55">${escapeHtml(buyerName)} sent you time to rest, restore, and feel renewed.</p>${note}<div style="margin-top:24px;padding-top:16px;border-top:1px solid rgba(255,255,255,.22);color:#d8e7e5;font:italic 14px Georgia,serif">Show gift code <strong style="color:#fffaf7;font-family:monospace;letter-spacing:.1em">${escapeHtml(code)}</strong> when booking or at your appointment.<br><strong style="display:inline-block;margin-top:10px;color:#fffaf7">Book online @unidamassage.com</strong></div></div></div><div style="margin-top:14px;padding:18px;border:1px solid #e7ccc4;border-radius:10px;background:#fff;color:#244347"><div style="margin-bottom:10px;font:bold 14px Georgia,serif">Purchase breakdown</div><div style="display:flex;justify-content:space-between;padding:6px 0;color:#647679"><span>Gift certificate</span><strong style="color:#244347">${money(amountCents)}</strong></div><div style="display:flex;justify-content:space-between;padding:6px 0;color:#647679"><span>Tip</span><strong style="color:#244347">${money(tipAmountCents)}</strong></div><div style="display:flex;justify-content:space-between;margin-top:4px;padding:12px 0 0;border-top:1px solid #e7ccc4"><span>Total charged</span><strong>${money(totalCents)}</strong></div></div><p style="margin:16px 2px 0;color:#647679;font-size:12px;line-height:1.5">${footerNote}</p></div></div>`;
}

export function buyerReceiptHtml({ amountCents, tipAmountCents, buyerName, recipientName, code, paymentRef, paymentMethod }) {
  const totalCents = amountCents + tipAmountCents;
  const notice = paymentMethod === "venmo" ? "VENMO PAYMENT MARKED PAID BY PURCHASER" : "SUMUP PAYMENT VERIFIED";
  const referenceLabel = paymentMethod === "venmo" ? "Venmo confirmation" : "SumUp payment reference";
  const footerNote = paymentMethod === "venmo"
    ? "You confirmed this Venmo payment before the certificate was issued."
    : "SumUp confirmed this payment before the certificate was issued.";
  return `<div style="margin:0;padding:24px;background:#fff8f5;font-family:Arial,sans-serif;color:#244347"><div style="max-width:620px;margin:0 auto"><div style="margin-bottom:14px;padding:10px 14px;border:1px solid #e7c3ae;border-radius:8px;background:#f5e3d8;color:#60351f;font-size:12px;font-weight:700;letter-spacing:.08em">${notice}</div><div style="overflow:hidden;border-radius:8px 24px 8px 24px;background:#365e63;color:#fffaf7"><div style="padding:32px 28px;background:#f4867d;color:#244347"><div style="font:italic 26px Georgia,serif">Thank you, ${escapeHtml(buyerName)}.</div><div style="margin-top:8px;font-size:13px">Your Unidamassage gift certificate is ready.</div></div><div style="padding:28px"><p style="margin:0;color:#deebea;line-height:1.6">You gave ${escapeHtml(recipientName)} time to rest, restore, and feel renewed.</p><div style="margin-top:24px;padding-top:18px;border-top:1px solid rgba(255,255,255,.22)"><div style="color:#cfe0df;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase">Gift code</div><div style="margin-top:6px;font:bold 22px monospace;letter-spacing:.12em">${escapeHtml(code)}</div></div></div></div><div style="margin-top:14px;padding:18px;border:1px solid #e7ccc4;border-radius:10px;background:#fff;color:#244347"><div style="margin-bottom:10px;font:bold 17px Georgia,serif">Your receipt</div><div style="display:flex;justify-content:space-between;padding:6px 0;color:#647679"><span>Gift certificate for ${escapeHtml(recipientName)}</span><strong style="color:#244347">${money(amountCents)}</strong></div><div style="display:flex;justify-content:space-between;padding:6px 0;color:#647679"><span>Tip</span><strong style="color:#244347">${money(tipAmountCents)}</strong></div><div style="display:flex;justify-content:space-between;margin-top:4px;padding:12px 0 0;border-top:1px solid #e7ccc4"><span>Total charged</span><strong>${money(totalCents)}</strong></div><div style="display:flex;justify-content:space-between;padding:12px 0 0;color:#647679;font-size:12px"><span>${referenceLabel}</span><strong style="color:#244347">${escapeHtml(paymentRef)}</strong></div></div><p style="margin:16px 2px 0;color:#647679;font-size:12px;line-height:1.5">${footerNote}</p></div></div>`;
}

export function recipientSubject({ amountCents, recipientName, paymentMethod }) {
  const prefix = paymentMethod === "venmo" ? "[VENMO] " : "";
  return `${prefix}A ${money(amountCents)} Unidamassage gift for ${String(recipientName).replace(/[\r\n]+/g, " ").trim()}`;
}

export function buyerSubject({ paymentMethod }) {
  return `${paymentMethod === "venmo" ? "[VENMO RECEIPT] " : ""}Thank you for your Unidamassage gift purchase`;
}

export function ownerSubject({ amountCents, buyerName, code }) {
  const safeName = String(buyerName).replace(/[\r\n]+/g, " ").trim();
  return `Gift sale ${money(amountCents)} — ${safeName} (code ${code})`;
}

export function ownerEmailHtml({ amountCents, tipAmountCents, buyerName, buyerEmail, recipientName, recipientEmail, message, code, paymentMethod, paymentRef, saleNumber }) {
  const totalCents = amountCents + tipAmountCents;
  const row = (k, v) => `<div style="display:flex;justify-content:space-between;gap:16px;padding:7px 0;border-bottom:1px solid #eee"><span style="color:#647679">${k}</span><strong style="color:#244347;text-align:right">${v}</strong></div>`;
  const note = message
    ? `<div style="margin-top:12px;padding:12px 14px;background:#fff8f5;border-radius:8px;color:#244347;font-style:italic">&ldquo;${escapeHtml(message)}&rdquo;</div>`
    : "";
  const paymentLabel = paymentMethod === "venmo" ? "Venmo (buyer confirmed)" : "SumUp card (verified)";
  return `<div style="margin:0;padding:24px;background:#f7f7f7;font-family:Arial,sans-serif;color:#244347"><div style="max-width:620px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px"><div style="font:bold 18px Georgia,serif">New gift certificate sale</div><div style="margin:6px 0 16px;color:#647679;font-size:13px">Your store just sold a gift certificate. Details for your records:</div>${row("Gift code", `<span style="font-family:monospace;letter-spacing:.1em">${escapeHtml(code)}</span>`)}${row("Gift value", money(amountCents))}${row("Tip", money(tipAmountCents))}${row("Total charged", money(totalCents))}${row("Payment", paymentLabel)}${row("Reference", escapeHtml(paymentRef || "—"))}${row("Buyer", `${escapeHtml(buyerName)} &lt;${escapeHtml(buyerEmail)}&gt;`)}${row("Recipient", `${escapeHtml(recipientName)} &lt;${escapeHtml(recipientEmail)}&gt;`)}${row("Sale #", escapeHtml(String(saleNumber ?? "—")))}${note}<p style="margin:16px 0 0;color:#647679;font-size:12px">Use the gift code above to register this sale in Owner Tools.</p></div></div>`;
}
