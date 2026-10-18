// Mailer abstraction.
// - If RESEND_API_KEY is set, sends via the Resend API (with the voucher
//   image attached, like the Gmail flow in the private app).
// - Otherwise logs to the console (dev fallback). No real email is sent
//   unless a key is configured.
//
// Env:
//   RESEND_API_KEY  — Resend API key (re_...)
//   MAIL_FROM       — e.g. "Unida Massage <gifts@unidamassage.com>" (domain must be verified in Resend)

import fs from "node:fs";
import path from "node:path";

const VOUCHER_PATH = path.join(process.cwd(), "public", "assets", "unidamassage-gift-voucher.webp");

function voucherAttachment() {
  try {
    const buf = fs.readFileSync(VOUCHER_PATH);
    return [{ filename: "unidamassage-gift-voucher.webp", content: buf.toString("base64") }];
  } catch {
    return [];
  }
}

/**
 * @param {{to: string, subject: string, html: string}} mail
 * @returns {Promise<{ok: boolean, detail?: string}>}
 */
export async function sendMail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`[mail:console] to=${to} subject=${subject} html_bytes=${Buffer.byteLength(html)}`);
    return { ok: true, detail: "console-fallback" };
  }
  const from = process.env.MAIL_FROM || "Unida Massage <gifts@unidamassage.com>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html,
        attachments: voucherAttachment(),
      }),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200);
      return { ok: false, detail: `Resend ${res.status}: ${detail}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: String(err?.message ?? err).slice(0, 200) };
  }
}
