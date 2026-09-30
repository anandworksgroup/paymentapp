/*!
 * PaymentApp embedded checkout — v1, no dependencies.
 *
 *   <script src="https://YOUR-CHECKOUT-HOST/embed.js" async></script>
 *
 *   PaymentApp.open({
 *     session: "cs_...",                  // id of a checkout session you created on your server
 *     onSuccess: function (e) {},         // { session, payment, livemode } once the payment succeeds
 *     onClose: function (e) {},           // { session, completed, reason } when the modal closes
 *     closeOnSuccess: false               // keep the receipt visible until the buyer closes it (default)
 *   });
 *
 * Or without writing JavaScript:
 *   <button data-paymentapp-session="cs_..." data-paymentapp-success-url="/thanks">Buy now</button>
 * Bound elements also receive bubbling "paymentapp:success" and "paymentapp:close" DOM events.
 *
 * Security: messages are only accepted from the checkout's own origin and from the iframe this
 * script created; the checkout only posts back to the page origin it was opened from.
 */
(function (w, d) {
  "use strict";
  if (w.PaymentApp && w.PaymentApp.version) return;

  var script = d.currentScript;
  if (!script) {
    var all = d.getElementsByTagName("script");
    for (var i = all.length - 1; i >= 0; i--) if (/\/embed\.js(\?|#|$)/.test(all[i].src)) { script = all[i]; break; }
  }
  var ORIGIN = script && script.src ? new URL(script.src, w.location.href).origin : w.location.origin;
  var SESSION = /^cs_[A-Za-z0-9_]{4,80}$/;
  var STYLE_ID = "paymentapp-embed-style";
  var current = null;

  function css() {
    if (d.getElementById(STYLE_ID)) return;
    var s = d.createElement("style");
    s.id = STYLE_ID;
    s.textContent =
      ".pa-embed-backdrop{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;" +
      "background:rgba(29,31,30,.28);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);opacity:0;transition:opacity .18s ease}" +
      ".pa-embed-backdrop.pa-open{opacity:1}" +
      ".pa-embed-dialog{position:relative;width:min(1040px,100%);height:min(880px,100%);border-radius:28px;overflow:hidden;background:#EEF1EC;" +
      "box-shadow:0 18px 48px rgba(30,40,30,.18);transform:translateY(8px);transition:transform .18s ease;outline:none}" +
      ".pa-embed-backdrop.pa-open .pa-embed-dialog{transform:none}" +
      ".pa-embed-frame{display:block;width:100%;height:100%;border:0;background:transparent}" +
      ".pa-embed-close{position:absolute;top:12px;right:12px;z-index:2;width:36px;height:36px;border-radius:999px;border:0;cursor:pointer;" +
      "background:#fff;color:#2D2E30;font:500 16px/36px Inter,system-ui,sans-serif;box-shadow:0 1px 2px rgba(20,30,20,.08),0 6px 16px rgba(30,40,30,.10)}" +
      ".pa-embed-close:hover{background:#F6F7F4}.pa-embed-close:focus-visible{outline:2px solid #4E8F55;outline-offset:2px}" +
      ".pa-embed-loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:10px;color:#4B504C;" +
      "font:400 14px Inter,system-ui,sans-serif}" +
      ".pa-embed-spin{width:18px;height:18px;border-radius:999px;border:2px solid #A9D59E;border-top-color:transparent;animation:pa-spin .8s linear infinite}" +
      "@keyframes pa-spin{to{transform:rotate(360deg)}}" +
      ".pa-embed-lock{overflow:hidden!important}" +
      "@media (max-width:640px){.pa-embed-backdrop{padding:0}.pa-embed-dialog{width:100%;height:100%;border-radius:0}}" +
      "@media (prefers-reduced-motion:reduce){.pa-embed-backdrop,.pa-embed-dialog{transition:none}.pa-embed-spin{animation-duration:2s}}";
    (d.head || d.documentElement).appendChild(s);
  }

  function call(fn, arg) {
    if (typeof fn !== "function") return;
    try { fn(arg); } catch (e) { setTimeout(function () { throw e; }); }
  }

  function open(opts) {
    opts = opts || {};
    var session = String(opts.session || "");
    if (!SESSION.test(session)) throw new Error("PaymentApp.open: `session` must be a checkout session id (cs_...).");
    if (current) current.close("replaced");
    css();

    var previousFocus = d.activeElement;
    var completed = false;
    var closed = false;

    var backdrop = d.createElement("div");
    backdrop.className = "pa-embed-backdrop";
    var dialog = d.createElement("div");
    dialog.className = "pa-embed-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", opts.title || "Secure checkout");
    dialog.tabIndex = -1;

    var closeBtn = d.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "pa-embed-close";
    closeBtn.setAttribute("aria-label", "Close checkout");
    closeBtn.textContent = "✕";

    var loading = d.createElement("div");
    loading.className = "pa-embed-loading";
    loading.setAttribute("role", "status");
    loading.innerHTML = '<span class="pa-embed-spin" aria-hidden="true"></span><span>Loading secure checkout…</span>';

    var frame = d.createElement("iframe");
    frame.className = "pa-embed-frame";
    frame.title = "Secure checkout";
    frame.setAttribute("allow", "payment");
    frame.referrerPolicy = "origin";
    frame.src = ORIGIN + "/checkout/" + encodeURIComponent(session) + "?embed=1&parent_origin=" + encodeURIComponent(w.location.origin);

    dialog.appendChild(closeBtn);
    dialog.appendChild(loading);
    dialog.appendChild(frame);
    backdrop.appendChild(dialog);
    d.body.appendChild(backdrop);
    d.documentElement.classList.add("pa-embed-lock");
    d.body.classList.add("pa-embed-lock");
    void backdrop.offsetWidth; // commit the closed state first so the fade-in runs (rAF would stall in background tabs)
    backdrop.classList.add("pa-open");
    closeBtn.focus();

    function hideLoading() { if (loading.parentNode) loading.parentNode.removeChild(loading); }
    frame.addEventListener("load", function () { setTimeout(hideLoading, 400); });

    function onMessage(e) {
      // Strict: only the checkout origin, only our own iframe, only our session.
      if (e.origin !== ORIGIN || e.source !== frame.contentWindow) return;
      var m = e.data;
      if (!m || m.source !== "paymentapp-checkout" || m.session !== session) return;
      if (m.type === "ready") hideLoading();
      else if (m.type === "completed" && !completed) {
        completed = true;
        call(opts.onSuccess, { session: session, payment: m.payment || null, livemode: !!m.livemode });
        if (opts.closeOnSuccess) setTimeout(function () { close("completed"); }, 1200);
      } else if (m.type === "canceled") close("canceled");
      else if (m.type === "expired") call(opts.onExpired, { session: session });
      else if (m.type === "close_requested") close(completed ? "completed" : "dismissed");
    }

    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); close(completed ? "completed" : "dismissed"); }
      else if (e.key === "Tab") {
        // Two focus stops in the host page (close button, iframe); keep Tab inside the dialog.
        if (e.shiftKey && d.activeElement === closeBtn) { e.preventDefault(); frame.focus(); }
        else if (!e.shiftKey && d.activeElement === frame) { e.preventDefault(); closeBtn.focus(); }
      }
    }

    function onFocusIn(e) {
      if (!dialog.contains(e.target)) closeBtn.focus();
    }

    function close(reason) {
      if (closed) return;
      closed = true;
      w.removeEventListener("message", onMessage);
      d.removeEventListener("keydown", onKey, true);
      d.removeEventListener("focusin", onFocusIn, true);
      backdrop.classList.remove("pa-open");
      d.documentElement.classList.remove("pa-embed-lock");
      d.body.classList.remove("pa-embed-lock");
      setTimeout(function () { if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop); }, 200);
      if (previousFocus && typeof previousFocus.focus === "function" && d.contains(previousFocus)) previousFocus.focus();
      if (current && current.session === session) current = null;
      call(opts.onClose, { session: session, completed: completed, reason: typeof reason === "string" ? reason : "dismissed" });
    }

    closeBtn.addEventListener("click", function () { close(completed ? "completed" : "dismissed"); });
    backdrop.addEventListener("mousedown", function (e) { if (e.target === backdrop) close(completed ? "completed" : "dismissed"); });
    w.addEventListener("message", onMessage);
    d.addEventListener("keydown", onKey, true);
    d.addEventListener("focusin", onFocusIn, true);

    current = { session: session, close: close };
    return { close: function () { close("dismissed"); } };
  }

  // ───────── data-attribute auto-binding (event delegation, so late-added buttons work too) ─────────
  function bound(target) {
    return target && target.closest ? target.closest("[data-paymentapp-session]") : null;
  }

  function safeUrl(u) {
    try {
      var url = new URL(u, w.location.href);
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
    } catch {
      return null;
    }
  }

  function launch(el) {
    var successUrl = el.getAttribute("data-paymentapp-success-url");
    open({
      session: el.getAttribute("data-paymentapp-session"),
      closeOnSuccess: el.hasAttribute("data-paymentapp-close-on-success"),
      onSuccess: function (detail) {
        el.dispatchEvent(new CustomEvent("paymentapp:success", { bubbles: true, detail: detail }));
      },
      onClose: function (detail) {
        el.dispatchEvent(new CustomEvent("paymentapp:close", { bubbles: true, detail: detail }));
        var next = successUrl && detail.completed ? safeUrl(successUrl) : null;
        if (next) w.location.assign(next);
      },
    });
  }

  function prepare(root) {
    var els = (root || d).querySelectorAll("[data-paymentapp-session]");
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      el.setAttribute("aria-haspopup", "dialog");
      if (!/^(BUTTON|A|INPUT)$/.test(el.tagName)) {
        if (!el.hasAttribute("role")) el.setAttribute("role", "button");
        if (!el.hasAttribute("tabindex")) el.tabIndex = 0;
      }
    }
  }

  d.addEventListener("click", function (e) {
    var el = bound(e.target);
    if (!el || e.defaultPrevented) return;
    e.preventDefault();
    try { launch(el); } catch (err) { if (w.console) w.console.error(err); }
  });
  d.addEventListener("keydown", function (e) {
    var el = bound(e.target);
    if (!el || current || (e.key !== "Enter" && e.key !== " ") || /^(BUTTON|A|INPUT)$/.test(el.tagName)) return;
    e.preventDefault();
    try { launch(el); } catch (err) { if (w.console) w.console.error(err); }
  });
  if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", function () { prepare(); });
  else prepare();

  w.PaymentApp = {
    version: "1",
    origin: ORIGIN,
    open: open,
    close: function () { if (current) current.close("dismissed"); },
    bind: prepare,
  };
})(window, document);
