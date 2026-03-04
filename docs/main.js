// docs/main.js
console.log("✅ main.js loaded");

// ✅ Put your SUPABASE ANON key here (NOT service_role)
const SUPABASE_ANON_KEY = "PASTE_SUPABASE_ANON_KEY_HERE";

function emailApp() {
  return {
    SUPABASE_URL: "https://jmnpfdqxzilbobffqhda.supabase.co",
    CREATE_INBOX_PATH: "/functions/v1/create-inbox",
    GET_EMAILS_PATH: "/functions/v1/get-emails",

    inboxId: "",
    sessionId: "",
    currentEmail: "",
    expiresAt: "",
    emails: [],
    countdown: "--:--",

    toast: { show: false, text: "" },
    isRateLimited: false,

    _pollTimer: null,
    _countdownTimer: null,
    _toastTimer: null,

    init() {
      console.log("✅ init() ran, Alpine scope ready");

      const saved = this._safeJsonParse(localStorage.getItem("atk_state"));
      if (saved?.inboxId && saved?.sessionId) {
        this.inboxId = saved.inboxId;
        this.sessionId = saved.sessionId;
        this.currentEmail = saved.currentEmail || "";
        this.expiresAt = saved.expiresAt || "";
        this._startPolling();
        this.fetchEmails(true);
      }

      this._startCountdown();
      this._toast("UI loaded");
    },

    _safeJsonParse(v) { try { return JSON.parse(v); } catch { return null; } },

    _saveState() {
      localStorage.setItem("atk_state", JSON.stringify({
        inboxId: this.inboxId,
        sessionId: this.sessionId,
        currentEmail: this.currentEmail,
        expiresAt: this.expiresAt
      }));
    },

    _toast(msg, ms = 2200) {
      this.toast = { show: true, text: msg };
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => (this.toast.show = false), ms);
    },

    _authHeaders(json = false) {
      const h = {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      };
      if (json) h["content-type"] = "application/json";
      return h;
    },

    _startPolling() {
      if (this._pollTimer) return;
      this._pollTimer = setInterval(() => this.fetchEmails(false), 4000);
    },

    _startCountdown() {
      if (this._countdownTimer) return;
      this._countdownTimer = setInterval(() => this._updateCountdown(), 1000);
      this._updateCountdown();
    },

    _updateCountdown() {
      if (!this.expiresAt) { this.countdown = "--:--"; return; }
      const exp = new Date(this.expiresAt).getTime();
      if (Number.isNaN(exp)) { this.countdown = "--:--"; return; }
      const diff = exp - Date.now();
      if (diff <= 0) { this.countdown = "00:00"; return; }
      const s = Math.floor(diff / 1000);
      const mm = String(Math.floor(s / 60)).padStart(2, "0");
      const ss = String(s % 60).padStart(2, "0");
      this.countdown = `${mm}:${ss}`;
    },

    formatTime(ts) {
      if (!ts) return "—";
      const d = new Date(ts);
      if (Number.isNaN(d.getTime())) return "—";
      return d.toLocaleString();
    },

    async createInbox() {
      console.log("✅ createInbox() clicked");

      if (!SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.includes("PASTE_")) {
        this._toast("Missing SUPABASE_ANON_KEY in main.js", 3500);
        return;
      }

      try {
        const url = this.SUPABASE_URL + this.CREATE_INBOX_PATH;
        const res = await fetch(url, {
          method: "POST",
          headers: this._authHeaders(true),
          body: JSON.stringify({})
        });

        const data = await res.json().catch(() => ({}));
        console.log("create-inbox status:", res.status, data);

        if (!res.ok) {
          this._toast(data?.error?.message || data?.error || data?.message || `HTTP ${res.status}`, 4000);
          return;
        }

        this.sessionId = data.session_id || "";
        this.inboxId = data.inbox_id || "";
        this.currentEmail = data.email_address || "";
        this.expiresAt = data.expires_at || "";
        this.emails = [];

        this._saveState();
        this._toast("Inbox created");
        await this.fetchEmails(true);

      } catch (e) {
        console.error(e);
        this._toast(e?.message || "Create inbox failed", 3500);
      }
    },

    async fetchEmails(force = false) {
      if (!this.inboxId || !this.sessionId) return;

      try {
        const qs = new URLSearchParams({
          inbox_id: this.inboxId,
          session_id: this.sessionId,
          t: String(Date.now())
        });

        const url = this.SUPABASE_URL + this.GET_EMAILS_PATH + "?" + qs.toString();
        const res = await fetch(url, { headers: this._authHeaders(false) });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) return;

        const list = Array.isArray(data?.emails) ? data.emails : [];
        list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        this.emails = list;

      } catch (e) {
        console.error(e);
        if (force) this._toast(e?.message || "Fetch failed", 3000);
      }
    },

    async copyEmail() {
      if (!this.currentEmail) return;
      try { await navigator.clipboard.writeText(this.currentEmail); this._toast("Email copied"); }
      catch { this._toast("Copy failed"); }
    },

    async copyBodyLatest() {
      if (!this.emails?.length) return;
      try { await navigator.clipboard.writeText(this.emails[0]?.body || ""); this._toast("Body copied"); }
      catch { this._toast("Copy failed"); }
    },

    clearSession() {
      this.inboxId = "";
      this.sessionId = "";
      this.currentEmail = "";
      this.expiresAt = "";
      this.emails = [];
      this.countdown = "--:--";
      localStorage.removeItem("atk_state");
      this._toast("Cleared");
    }
  };
}

// ✅ Make global (so x-data="emailApp()" always works)
window.emailApp = emailApp;
console.log("✅ window.emailApp ready");

// ✅ Also register for x-data="emailApp" if Alpine catches it
document.addEventListener("alpine:init", () => {
  Alpine.data("emailApp", emailApp);
  console.log("✅ Alpine.data('emailApp') registered");
});

console.log("✅ main.js finished loading");
