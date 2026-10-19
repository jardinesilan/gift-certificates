/* Public gift certificate purchase UI — vanilla JS port of the private
   gift-certificate-app BuyView. Same steps, same copy, same styling. */
(function () {
  "use strict";

  var PRESETS = [
    { id: "30_min", service: "30 min", standard: 40, venmo: 40 },
    { id: "foot_massage", service: "Foot massage", standard: 50, venmo: 50 },
    { id: "60_min", service: "60 min", standard: 80, venmo: 70 },
    { id: "90_min", service: "90 min", standard: 110, venmo: 105 },
    { id: "90_min_cupping", service: "90min w/ cupping", standard: 120, venmo: 110 }
  ];
  var VENMO_QR = "/assets/unida-massage-venmo-qr.jpg";
  var VOUCHER = "/assets/unidamassage-gift-voucher.webp";
  var VENMO_HANDLE = "@ManuelaJardine-Silan";

  var state = {
    step: "details",
    form: {
      serviceId: "30_min",
      paymentMethod: "card",
      tipAmount: "",
      buyerName: "",
      buyerEmail: "",
      recipientName: "",
      recipientEmail: "",
      message: ""
    },
    certificate: null,
    cardPurchase: null,
    returnPurchaseId: null,
    formError: "",
    busy: false,
    busyLabel: "",
    copied: false
  };

  function $(sel, el) { return (el || document).querySelector(sel); }
  function $all(sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); }

  function money(cents) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(cents / 100);
  }
  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }
  function preset() {
    for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === state.form.serviceId) return PRESETS[i];
    return PRESETS[0];
  }
  function giftCents() {
    var p = preset();
    return (state.form.paymentMethod === "venmo" ? p.venmo : p.standard) * 100;
  }
  function tipCents() {
    var n = Number(state.form.tipAmount);
    if (!isFinite(n) || n < 0) return 0;
    return Math.round(n * 100);
  }
  function isVenmo() { return state.form.paymentMethod === "venmo"; }

  function purchaseArgs() {
    return {
      service_id: state.form.serviceId,
      tip_amount_cents: tipCents(),
      buyer_name: state.form.buyerName.trim(),
      buyer_email: state.form.buyerEmail.trim(),
      recipient_name: state.form.recipientName.trim(),
      recipient_email: state.form.recipientEmail.trim(),
      message: state.form.message.trim()
    };
  }

  async function api(path, opts) {
    var res = await fetch(path, Object.assign({ headers: { "Content-Type": "application/json" } }, opts || {}));
    var data = null;
    try { data = await res.json(); } catch (e) { /* ignore */ }
    if (!res.ok) throw new Error((data && data.error) || "Something went wrong. Please try again.");
    return data;
  }

  /* ---------- shared pieces ---------- */

  function certificatePreviewHtml(code) {
    var f = state.form;
    return (
      '<section class="certificate-preview" aria-label="Unidamassage gift certificate preview">' +
        '<img class="voucher-art" src="' + VOUCHER + '" alt="Unidamassage gift voucher with a relaxing massage scene" />' +
        '<div class="voucher-details">' +
          '<div class="voucher-value-row"><div>' +
            '<span class="preview-kicker">Gift value</span>' +
            '<p class="preview-amount">' + money(giftCents()) + '</p>' +
          '</div><span class="preview-code">' + esc(code || "GIFT CODE") + '</span></div>' +
          '<p class="preview-to">For ' + esc(f.recipientName || "someone special") + '</p>' +
          '<p class="preview-message">' + esc(f.message || "Time to rest, restore, and feel renewed.") + '</p>' +
          '<div class="preview-footer"><span>With care from ' + esc(f.buyerName || "someone who cares") + '</span>' +
          '<strong class="preview-brand">Unidamassage</strong></div>' +
        '</div>' +
      '</section>'
    );
  }

  function deliveryPreviewHtml(code) {
    var f = state.form;
    var cert = giftCents(), tip = tipCents();
    return (
      '<section class="delivery-preview" aria-label="Email delivery preview">' +
        '<div class="delivery-heading"><div><span>Email preview</span><strong>To ' + esc(f.recipientName) + '</strong></div>' +
        '<span class="delivery-address">' + esc(f.recipientEmail) + '</span></div>' +
        '<img src="' + VOUCHER + '" alt="Unidamassage gift voucher included in the delivery email" />' +
        '<div class="delivery-body">' +
          '<p>' + esc(f.buyerName) + ' sent you a relaxing gift from <strong>Unidamassage</strong>.</p>' +
          '<div><span>' + money(cert) + '</span><code>' + esc(code) + '</code></div>' +
          '<p class="delivery-booking"><strong>Book online @unidamassage.com</strong></p>' +
          (f.message ? '<blockquote>\u201C' + esc(f.message) + '\u201D</blockquote>' : '') +
          '<dl class="email-breakdown">' +
            '<div><dt>Gift certificate</dt><dd>' + money(cert) + '</dd></div>' +
            '<div><dt>Tip</dt><dd>' + money(tip) + '</dd></div>' +
            '<div><dt>Total paid</dt><dd>' + money(cert + tip) + '</dd></div>' +
          '</dl>' +
        '</div>' +
      '</section>'
    );
  }

  /* ---------- details step ---------- */

  function detailsHtml() {
    var f = state.form, venmo = isVenmo();
    var methods =
      '<div class="payment-method-grid">' +
      ['card', 'venmo'].map(function (m) {
        var label = m === "card" ? "Card" : "Venmo";
        var sub = m === "card" ? "Secure SumUp checkout" : "In-person prices";
        return '<button class="' + (f.paymentMethod === m ? "payment-method selected" : "payment-method") + '" type="button" data-method="' + m + '" aria-pressed="' + (f.paymentMethod === m) + '"><strong>' + label + '</strong><span>' + sub + '</span></button>';
      }).join("") + '</div>';
    var presets = PRESETS.map(function (p) {
      var amount = venmo ? p.venmo : p.standard;
      var discounted = venmo && p.venmo < p.standard;
      return '<button class="' + (f.serviceId === p.id ? "amount-button selected" : "amount-button") + '" type="button" data-service="' + p.id + '" aria-pressed="' + (f.serviceId === p.id) + '" aria-label="$' + amount + ' for ' + esc(p.service) + (discounted ? ", discounted from $" + p.standard : "") + '">' +
        '<span class="price-line">' + (discounted ? '<del>$' + p.standard + '</del>' : '') + '<strong>$' + amount + '</strong></span>' +
        '<span>' + esc(p.service) + '</span></button>';
    }).join("");
    var total = giftCents() + tipCents();
    return (
      '<div class="buy-layout">' +
      '<form class="buy-form" id="buy-form" novalidate>' +
        '<div class="section-heading">' +
          '<p class="eyebrow">A gift from Unidamassage</p>' +
          '<h2>Give them time to exhale.</h2>' +
          '<p>Share a restorative massage with someone special, personalized with their name and your message.</p>' +
        '</div>' +
        '<fieldset class="field-group"><legend>How would you like to pay?</legend>' + methods +
        '</fieldset>' +
        '<fieldset class="field-group"><legend>Choose a massage</legend>' +
          '<div class="amount-grid">' + presets + '</div>' +
          '<label for="tipAmount">Add a tip <span class="optional">Optional</span></label>' +
          '<div class="money-input"><span aria-hidden="true">$</span>' +
          '<input id="tipAmount" inputmode="decimal" type="number" min="0" max="1000" step="0.01" placeholder="0.00" value="' + esc(f.tipAmount) + '" /></div>' +
        '</fieldset>' +
        '<fieldset class="field-group"><legend>From you</legend><div class="field-pair">' +
          '<div class="field-item"><label for="buyerName">Buyer name</label><input id="buyerName" required value="' + esc(f.buyerName) + '" /></div>' +
          '<div class="field-item"><label for="buyerEmail">Buyer email</label><input id="buyerEmail" required type="email" value="' + esc(f.buyerEmail) + '" /></div>' +
        '</div></fieldset>' +
        '<fieldset class="field-group"><legend>For them</legend><div class="field-pair">' +
          '<div class="field-item"><label for="recipientName">Recipient name</label><input id="recipientName" required value="' + esc(f.recipientName) + '" /></div>' +
          '<div class="field-item"><label for="recipientEmail">Recipient email</label><input id="recipientEmail" required type="email" value="' + esc(f.recipientEmail) + '" /></div>' +
        '</div>' +
        '<label for="message">Personal message <span class="optional">Optional</span></label>' +
        '<textarea id="message" maxlength="500" rows="4" placeholder="Wishing you a peaceful, restorative massage\u2026">' + esc(f.message) + '</textarea>' +
        '<span class="character-count"><span id="char-count">' + f.message.length + '</span>/500</span></fieldset>' +
        (state.formError ? '<p class="error-message">' + esc(state.formError) + '</p>' : '') +
        '<button class="primary-button full-button" type="submit">' + (venmo ? 'Continue to Venmo \u00B7 ' : 'Continue to secure checkout \u00B7 ') + money(total) + '</button>' +
      '</form>' +
      '<div class="preview-sticky">' + certificatePreviewHtml() + '</div>' +
      '</div>'
    );
  }

  function bindDetails() {
    $all("[data-method]").forEach(function (b) {
      b.addEventListener("click", function () { state.form.paymentMethod = b.getAttribute("data-method"); state.formError = ""; render(); });
    });
    $all("[data-service]").forEach(function (b) {
      b.addEventListener("click", function () { state.form.serviceId = b.getAttribute("data-service"); render(); });
    });
    $("#tipAmount").addEventListener("input", function (e) { state.form.tipAmount = e.target.value; renderTipOnly(); });
    ["buyerName", "buyerEmail", "recipientName", "recipientEmail"].forEach(function (id) {
      $("#" + id).addEventListener("input", function (e) { state.form[id] = e.target.value; });
    });
    $("#message").addEventListener("input", function (e) {
      state.form.message = e.target.value;
      $("#char-count").textContent = String(e.target.value.length);
    });
    $("#buy-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var tip = Number(state.form.tipAmount);
      if (state.form.tipAmount && (!isFinite(tip) || tip < 0 || tipCents() > 100000)) {
        state.formError = "Enter a tip from $0 to $1,000."; render(); return;
      }
      if (!state.form.buyerName.trim() || !state.form.buyerEmail.trim() || !state.form.recipientName.trim() || !state.form.recipientEmail.trim()) {
        state.formError = "Complete the buyer and recipient details."; render(); return;
      }
      state.formError = "";
      state.step = "checkout";
      state.cardPurchase = null;
      render();
    });
  }

  // Re-render only the tip-dependent bits so typing a tip doesn't lose focus.
  function renderTipOnly() {
    var total = giftCents() + tipCents(), venmo = isVenmo();
    var btn = $('#buy-form button[type="submit"]');
    if (btn) btn.textContent = (venmo ? "Continue to Venmo \u00B7 " : "Continue to secure checkout \u00B7 ") + money(total);
  }

  /* ---------- checkout step ---------- */

  function orderSummaryHtml(p) {
    // p: {amount_cents, tip_amount_cents, total_cents, recipient_name?}
    var name = p.recipient_name || state.form.recipientName;
    return (
      '<div class="order-summary">' +
        '<div><span>Gift certificate for ' + esc(name) + '</span><strong>' + money(p.amount_cents) + '</strong></div>' +
        '<div><span>Tip</span><strong>' + money(p.tip_amount_cents) + '</strong></div>' +
        '<div class="order-total"><span>' + (isVenmo() ? "Pay with Venmo" : "Total charged by SumUp") + '</span><strong>' + money(p.total_cents) + '</strong></div>' +
      '</div>'
    );
  }

  function checkoutHtml() {
    var venmo = isVenmo();
    var purchase = state.cardPurchase;
    var status = purchase && purchase.status;
    var busy = state.busy || status === "creating" || status === "verifying" || status === "paid";
    var failed = status === "failed" || status === "expired";
    var body = "";

    if (venmo) {
      var total = giftCents() + tipCents();
      body =
        '<div class="venmo-checkout" aria-label="Venmo payment instructions">' +
          '<div class="venmo-heading"><div><span>Pay Ela on Venmo</span><strong>' + VENMO_HANDLE + '</strong></div>' +
          '<span class="zero-fee">No processing fee</span></div>' +
          '<img class="venmo-qr" src="' + VENMO_QR + '" alt="Venmo QR code for ' + VENMO_HANDLE + '" />' +
          '<p class="venmo-total">Send exactly <strong>' + money(total) + '</strong></p>' +
          '<p class="venmo-help">Scan the QR with another phone, or save the image and open it from your Venmo app.</p>' +
          '<a class="secondary-button venmo-save-link" href="' + VENMO_QR + '" download="Unida-Massage-Venmo-QR.jpg">Save QR image</a>' +
        '</div>';
    } else {
      body =
        '<div class="sumup-checkout" aria-label="SumUp secure checkout">' +
          '<div class="sumup-heading"><div class="card-chip" aria-hidden="true"></div>' +
          '<div><strong>SumUp secure payment</strong></div></div>' +
          (!purchase ? '<button class="primary-button full-button" id="prepare-checkout" type="button" ' + (state.busy ? "disabled" : "") + '>' +
            (state.busy ? "Preparing secure checkout\u2026" : "Prepare SumUp checkout \u00B7 " + money(giftCents() + tipCents())) + '</button>' : '') +
          (status === "creating" ? '<p class="checkout-status" role="status">Creating your secure SumUp checkout\u2026</p>' : '') +
          (purchase && purchase.hosted_checkout_url && !failed ?
            '<a class="primary-button sumup-pay-link" id="pay-link" href="' + esc(purchase.hosted_checkout_url) + '" target="_blank" rel="noreferrer">Pay securely with SumUp \u00B7 ' + money(purchase.total_cents) + '</a>' +
            '<p class="sumup-help">SumUp opens in a secure tab. After paying, come back here and we\u2019ll confirm it automatically.</p>' +
            ((status === "verifying" || status === "paid" || state.busy) ? '<p class="checkout-status" role="status">Confirming your payment\u2026</p>' : '')
            : '') +
          (failed ? '<div class="checkout-failure" role="status"><p>' + esc(purchase.failure_reason || "The SumUp payment did not complete.") + '</p>' +
            '<button class="secondary-button" id="restart-checkout" type="button">Start a new checkout</button></div>' : '') +
        '</div>';
    }

    var summary = venmo
      ? orderSummaryHtml({ amount_cents: giftCents(), tip_amount_cents: tipCents(), total_cents: giftCents() + tipCents() })
      : purchase
        ? orderSummaryHtml(purchase)
        : orderSummaryHtml({ amount_cents: giftCents(), tip_amount_cents: tipCents(), total_cents: giftCents() + tipCents() });

    return (
      '<div class="checkout-layout"><section class="checkout-panel">' +
        '<button class="back-button" id="back-details" type="button">\u2190 Back to details</button>' +
        '<p class="eyebrow">' + (venmo ? "Venmo checkout" : "Secure card checkout") + '</p>' +
        '<h2>' + (venmo ? "Send the payment" : "Pay with SumUp") + '</h2>' +
        summary + body +
        (venmo ? '<p class="send-note">After sending the Venmo payment, tap <strong>I\u2019ve paid</strong>.</p>' : '') +
        (state.formError ? '<p class="error-message">' + esc(state.formError) + '</p>' : '') +
        (venmo ? '<button class="primary-button full-button" id="venmo-issue" type="button" ' + (state.busy ? "disabled" : "") + '>' +
          (state.busy ? "Creating & sending\u2026" : "I\u2019ve paid \u00B7 Issue gift \u00B7 " + money(giftCents() + tipCents())) + '</button>' : '') +
      '</section>' +
      '<div>' + certificatePreviewHtml() + '</div></div>'
    );
  }

  function bindCheckout() {
    $("#back-details").addEventListener("click", function () {
      stopPolling();
      state.step = "details";
      state.cardPurchase = null;
      state.returnPurchaseId = null;
      state.formError = "";
      if (window.history && window.history.replaceState) window.history.replaceState(null, "", "/");
      render();
    });
    var prepare = $("#prepare-checkout");
    if (prepare) prepare.addEventListener("click", createCardCheckout);
    bindAutoVerify();
    var restart = $("#restart-checkout");
    if (restart) restart.addEventListener("click", function () { state.cardPurchase = null; state.formError = ""; render(); });
    var issue = $("#venmo-issue");
    if (issue) issue.addEventListener("click", issueVenmoGift);
  }

  async function createCardCheckout() {
    state.busy = true; state.formError = ""; render();
    try {
      var data = await api("/api/purchases", { method: "POST", body: JSON.stringify(purchaseArgs()) });
      state.cardPurchase = data.purchase;
      state.busy = false;
      render();
      startPolling();
    } catch (err) {
      state.busy = false;
      state.formError = err.message;
      render();
    }
  }

  var pollTimer = null;
  function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
  function startPolling() {
    stopPolling();
    pollTimer = setInterval(async function () {
      var id = state.cardPurchase && state.cardPurchase.id;
      if (!id) { stopPolling(); return; }
      try {
        var data = await api("/api/purchases/" + id);
        state.cardPurchase = data.purchase;
        if (data.certificate) {
          stopPolling();
          state.certificate = data.certificate;
          state.step = "complete";
          render();
          return;
        }
        var s = data.purchase.status;
        if (s !== "creating" && s !== "verifying" && s !== "paid") stopPolling();
        render();
      } catch (e) { stopPolling(); }
    }, 2000);
  }

  /* Auto-verify: no "check payment" button. When the buyer comes back to this
     tab after paying on SumUp (or lands on /return), confirm automatically. */
  var autoVerifyBound = false;
  function maybeAutoVerify() {
    if (state.step !== "checkout" || state.certificate || state.busy) return;
    var p = state.cardPurchase;
    if (!p || !p.id || !p.hosted_checkout_url) return;
    var s = p.status;
    if (s === "failed" || s === "expired" || s === "creating") return;
    var now = Date.now();
    if (now - (state.lastAutoVerify || 0) < 10000) return; // at most once per 10s
    state.lastAutoVerify = now;
    verifyCardCheckout();
  }
  function bindAutoVerify() {
    if (autoVerifyBound) return;
    autoVerifyBound = true;
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") maybeAutoVerify();
    });
    window.addEventListener("focus", maybeAutoVerify);
  }

  async function verifyCardCheckout() {
    var id = state.cardPurchase && state.cardPurchase.id;
    if (!id) return;
    state.busy = true; state.formError = ""; render();
    try {
      var data = await api("/api/purchases/" + id + "/verify", { method: "POST" });
      state.cardPurchase = data.purchase;
      state.busy = false;
      if (data.certificate) {
        stopPolling();
        state.certificate = data.certificate;
        state.step = "complete";
      }
      render();
    } catch (err) {
      state.busy = false;
      // Another tab is already verifying — stay quiet, the poll will pick up the result.
      if (!/already in progress/i.test(err.message || "")) state.formError = err.message;
      render();
    }
  }

  async function issueVenmoGift() {
    state.busy = true; state.formError = ""; render();
    try {
      var data = await api("/api/venmo/issue", { method: "POST", body: JSON.stringify(purchaseArgs()) });
      state.busy = false;
      state.certificate = data.certificate;
      state.step = "complete";
      render();
    } catch (err) {
      state.busy = false;
      state.formError = err.message || "Could not create the certificate or start the emails. Please try again.";
      render();
    }
  }

  /* ---------- complete step ---------- */

  function deliveryLabel(status) {
    return status === "sent" ? "Sent" : status === "queued" ? "Sending\u2026" : status === "failed" ? "Could not send" : "Preview only";
  }

  function completeHtml() {
    var c = state.certificate;
    var venmo = c.payment_method === "venmo";
    var deliveries = c.email_deliveries || [];
    function statusOf(type) {
      for (var i = 0; i < deliveries.length; i++) if (deliveries[i].recipient_type === type) return deliveries[i];
      return null;
    }
    var rec = statusOf("recipient"), buy = statusOf("buyer");
    var recStatus = rec ? rec.status : "failed", buyStatus = buy ? buy.status : "failed";
    var bothSent = recStatus === "sent" && buyStatus === "sent";
    var eitherQueued = recStatus === "queued" || buyStatus === "queued";
    return (
      '<div class="complete-layout"><section class="success-panel">' +
        '<div class="success-mark" aria-hidden="true">\u2713</div>' +
        '<p class="eyebrow">' + (venmo ? "Venmo payment marked paid" : "SumUp payment verified") + '</p>' +
        '<h2>The gift is ready.</h2>' +
        '<p class="success-copy">' + (bothSent
          ? "The gift was emailed to " + esc(c.recipient_email) + ", and the receipt was emailed to " + esc(c.buyer_email) + "."
          : eitherQueued
            ? "The certificate is saved. The gift email and buyer receipt are being sent automatically."
            : "The certificate is saved, but one or more emails could not be sent.") + '</p>' +
        (recStatus === "failed" && rec && rec.failure_reason ? '<p class="error-message" role="status">Recipient email: ' + esc(rec.failure_reason) + '</p>' : '') +
        (buyStatus === "failed" && buy && buy.failure_reason ? '<p class="error-message" role="status">Buyer receipt: ' + esc(buy.failure_reason) + '</p>' : '') +
        '<div class="code-block"><span>Gift code</span><strong>' + esc(c.code) + '</strong>' +
        '<button class="text-button" id="copy-code" type="button">' + (state.copied ? "Copied" : "Copy code") + '</button></div>' +
        '<dl class="receipt-list">' +
          '<div><dt>Gift certificate</dt><dd>' + money(c.original_amount_cents) + '</dd></div>' +
          '<div><dt>Tip</dt><dd>' + money(c.tip_amount_cents) + '</dd></div>' +
          '<div class="receipt-total"><dt>Total paid</dt><dd>' + money(c.original_amount_cents + c.tip_amount_cents) + '</dd></div>' +
          '<div><dt>Payment method</dt><dd>' + (venmo ? "Venmo" : "SumUp card") + '</dd></div>' +
          '<div><dt>' + (venmo ? "Payment confirmation" : "SumUp payment reference") + '</dt><dd>' + esc(c.payment_ref) + '</dd></div>' +
          (!venmo && c.sumup_checkout_id ? '<div><dt>SumUp checkout</dt><dd>' + esc(c.sumup_checkout_id) + '</dd></div>' : '') +
          '<div><dt>Gift email</dt><dd>' + esc(c.recipient_email) + '</dd></div>' +
          '<div><dt>Gift delivery</dt><dd><span class="delivery-status ' + recStatus + '">' + deliveryLabel(recStatus) + '</span></dd></div>' +
          '<div><dt>Buyer receipt</dt><dd>' + esc(c.buyer_email) + '</dd></div>' +
          '<div><dt>Receipt delivery</dt><dd><span class="delivery-status ' + buyStatus + '">' + deliveryLabel(buyStatus) + '</span></dd></div>' +
          '<div><dt>Owner Tools</dt><dd><span class="delivery-status queued">Queued for sync</span></dd></div>' +
        '</dl>' +
        deliveryPreviewHtml(c.code) +
        '<div class="button-row single-action"><button class="primary-button" id="start-over" type="button">Create another gift</button></div>' +
      '</section>' +
      '<div>' + certificatePreviewHtml(c.code) + '</div></div>'
    );
  }

  function bindComplete() {
    $("#copy-code").addEventListener("click", async function () {
      try {
        await navigator.clipboard.writeText(state.certificate.code);
        state.copied = true; render();
        setTimeout(function () { state.copied = false; render(); }, 1600);
      } catch (e) { /* clipboard unavailable */ }
    });
    $("#start-over").addEventListener("click", function () {
      stopPolling();
      state.step = "details";
      state.certificate = null;
      state.cardPurchase = null;
      state.returnPurchaseId = null;
      state.formError = "";
      state.form.tipAmount = "";
      state.form.message = "";
      if (window.history && window.history.replaceState) window.history.replaceState(null, "", "/");
      render();
    });
  }

  /* ---------- render + init ---------- */

  function render() {
    stopPolling();
    var app = $("#app");
    window.scrollTo(0, 0);
    if (state.step === "complete" && state.certificate) {
      app.innerHTML = completeHtml();
      bindComplete();
    } else if (state.step === "checkout") {
      app.innerHTML = checkoutHtml();
      bindCheckout();
      if (state.cardPurchase && !state.certificate) {
        var s = state.cardPurchase.status;
        if (s === "creating" || s === "verifying") startPolling();
      }
    } else {
      app.innerHTML = detailsHtml();
      bindDetails();
    }
  }

  async function init() {
    var params = new URLSearchParams(window.location.search);
    var pid = params.get("purchase_id");
    if (pid) {
      // Buyer returned from SumUp: jump straight to the checkout step.
      try {
        var data = await api("/api/purchases/" + encodeURIComponent(pid));
        if (data.certificate) {
          state.certificate = data.certificate;
          state.step = "complete";
        } else {
          state.cardPurchase = data.purchase;
          state.returnPurchaseId = pid;
          state.form.paymentMethod = "card";
          if (data.purchase.recipient_email) state.form.recipientEmail = data.purchase.recipient_email;
          if (data.purchase.buyer_email) state.form.buyerEmail = data.purchase.buyer_email;
          if (data.purchase.recipient_name) state.form.recipientName = data.purchase.recipient_name;
          state.step = "checkout";
        }
      } catch (e) {
        state.formError = "That checkout could not be found.";
      }
    }
    render();
    // Buyer returned from SumUp: confirm the payment automatically, no button.
    if (pid && state.step === "checkout" && state.cardPurchase && !state.certificate) {
      maybeAutoVerify();
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
