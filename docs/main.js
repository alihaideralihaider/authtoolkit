// docs/main.js
console.log("✅ main.js loaded");

// ========= CONFIG =========
// 1) Put your Supabase anon key here:
const SUPABASE_ANON_KEY = "PASTE_YOUR_SUPABASE_ANON_KEY_HERE";

// 2) Your project URL is already correct:
const SUPABASE_URL = "https://jmnpfdqxzilbobffqhda.supabase.co";

// Edge functions
const FN_CREATE_INBOX = "create-inbox";
const FN_GET_EMAILS = "get-emails";

// Polling interval
const POLL_MS = 5000;

// ========= HELPERS =========
function nowMs() {
  return Date.now();
}

async function safeJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function fnUrl(name) {
  return `${SUPABASE_URL}/functions/v1/${name}`;
}

function hasKey() {
  return !!SUPABASE_ANON_KEY && !SUPABASE_ANON_KEY.includes("PASTE_YOUR");
}

function authHeaders(json = false) {
  const h = {
    apikey: SUPABASE_ANON_KEY,
    authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  };
  if (json) h["content-type"] = "application/json";
  return h;
}

// ========= ALPINE COMPONENT FACTORY =========
function emailApp() {
  return {
    // State expected by your index.html
    inboxId: "",
    sessionId: "",
    currentEmail: "",
    expiresAt: "",
    emails: [],
    countdown: "--:--",

    toast: { show: false, text: "" },

    isRateLimited: false,
    rateLimitUntil: 0,

    _pollTimer: null,
    _countdownTimer: null,
    _toastTimer: null,

    init() {
      if (!hasKey()) {
        console.warn("Missing SUPABASE_ANON_KEY in docs/main.js");
        this._toast("Set SUPABASE_ANON_KEY in main.js", 3500);
      }

      // Restore saved state
      const saved = this._safeJsonParse(localStorage.getItem("atk_state"));
      if (saved?.inboxId && saved?.sessionId) {
        this.inboxId = saved.inboxId;
        this.sessionId = saved.sessionId;
        this.currentEmail = saved.currentEmail || "";
        this.expiresAt = saved.expiresAt || "";
        this.emails = Array.isArray(saved.emails) ? saved.emails : [];
      }

      this._startCountdown();
      this._startPolling();

      if (this.inboxId) this.fetchEmails(true);

      this._toast("UI loaded");
    },

    // ---------- Storage ----------
    _safeJsonParse(v) {
      try {
        return JSON.parse(v);
      } catch {
        return null;
      }
    },

    _saveState() {
      localStorage.setItem(
        "atk_state",
        JSON.stringify({
          inboxId: this.inboxId,
          sessionId: this.sessionId,
          currentEmail: this.currentEmail,
          expiresAt: this.expiresAt,
          emails: this.emails,
        })
      );
    },

    _clearState() {
      localStorage.removeItem("atk_state");
    },

    // ---------- Toast ----------
    _toast(msg, ms = 2000) {
      this.toast = { show: true, text: msg };
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => (this.toast.show = false), ms);
    },

    // ---------- Time formatting ----------
    formatTime(ts) {
      if (!ts) return "—";
      const d = new Date(ts);
      if (Number.isNaN(d.getTime())) return "—";
      return d.toLocaleString();
    },

    // ---------- Polling ----------
    _startPolling() {
      if (this._pollTimer) return;
      this._pollTimer = setInterval(() => this.fetchEmails(false), POLL_MS);
    },

    _stopPolling() {
      if (this._pollTimer) {
        clearInterval(this._pollTimer);
        this._pollTimer = null;
      }
    },

    // ---------- Countdown ----------
    _startCountdown() {
      if (this._countdownTimer) return;
      this._countdownTimer = setInterval(() => this._updateCountdown(), 1000);
      this._updateCountdown();
    },

    _updateCountdown() {
      if (!this.expiresAt) {
        this.countdown = "--:--";
        return;
      }
      const exp = new Date(this.expiresAt).getTime();
      if (Number.isNaN(exp)) {
        this.countdown = "--:--";
        return;
      }

      const diff = exp - nowMs();
      if (diff <= 0) {
        this.countdown = "00:00";
        return;
      }

      const s = Math.floor(diff / 1000);
      const mm = String(Math.floor(s / 60)).padStart(2, "0");
      const ss = String(s % 60).padStart(2, "0");
      this.countdown = `${mm}:${ss}`;
    },

    // ---------- Rate limit ----------
    _handle429(res) {
      const retryAfter = Number(res.headers.get("retry-after") || "8");
      const waitMs = Math.max(3, retryAfter) * 1000;

      this.isRateLimited = true;
      this.rateLimitUntil = nowMs() + waitMs;

      this._toast(`Rate limited (429). Retrying in ${Math.ceil(waitMs / 1000)}s…`, 2200);

      setTimeout(() => {
        if (nowMs() >= this.rateLimitUntil) {
          this.isRateLimited = false;
        }
      }, waitMs + 50);
    },

    // ---------- Actions ----------
    clearSession() {
      this.inboxId = "";
      this.sessionId = "";
      this.currentEmail = "";
      this.expiresAt = "";
      this.emails = [];
      this.countdown = "--:--";

      this.isRateLimited = false;
      this.rateLimitUntil = 0;

      this._clearState();
      this._stopPolling();

      this._toast("Cleared");
    },

    async createInbox() {
      if (!hasKey()) {
        this._toast("Missing Supabase anon key in main.js", 3000);
        return;
      }

      if (this.isRateLimited && nowMs() < this.rateLimitUntil) return;

      try {
        const res = await fetch(fnUrl(FN_CREATE_INBOX), {
          method: "POST",
          headers: authHeaders(true),
          body: JSON.stringify({}),
        });

        if (res.status === 429) {
          this._handle429(res);
          return;
        }

        if (!res.ok) {
          const j = await safeJson(res);
          console.error("create-inbox failed:", res.status, j);
          const msg = j?.error?.message || j?.error || j?.message || `HTTP ${res.status}`;
          this._toast(`Create inbox failed: ${msg}`, 3500);
          return;
        }

        const data = await res.json();

        this.sessionId = data.session_id || "";
        this.inboxId = data.inbox_id || "";
        this.currentEmail = data.email_address || "";
        this.expiresAt = data.expires_at || "";

        if (!this.sessionId || !this.inboxId || !this.currentEmail) {
          console.error("Bad create-inbox payload:", data);
          this._toast("Create inbox returned incomplete data", 3500);
          return;
        }

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
      if (!hasKey()) return;

      if (!force && this.isRateLimited && nowMs() < this.rateLimitUntil) return;

      try {
        const url = new URL(fnUrl(FN_GET_EMAILS));
        url.searchParams.set("inbox_id", this.inboxId);
        url.searchParams.set("session_id", this.sessionId);
        url.searchParams.set("t", String(nowMs())); // cache buster

        const res = await fetch(url.toString(), { headers: authHeaders(false) });

        if (res.status === 429) {
          this._handle429(res);
          return;
        }

        if (!res.ok) {
          const j = await safeJson(res);
          console.error("get-emails failed:", res.status, j);
          if (force) {
            const msg = j?.error?.message || j?.error || j?.message || `HTTP ${res.status}`;
            this._toast(`Fetch failed: ${msg}`, 3000);
          }
          return;
        }

        const data = await res.json();

        // Accept either {emails:[...]} OR raw array
        const list = Array.isArray(data) ? data : (Array.isArray(data?.emails) ? data.emails : []);

        list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        this.emails = list;
        this._saveState();
      } catch (e) {
        console.error(e);
        if (force) this._toast(e?.message || "Fetch failed", 3000);
      }
    },

    async copyEmail() {
      if (!this.currentEmail) return;
      try {
        await navigator.clipboard.writeText(this.currentEmail);
        this._toast("Email copied");
      } catch {
        this._toast("Copy failed");
      }
    },

    async copyBodyLatest() {
      if (!this.emails?.length) return;
      const body = this.emails[0]?.body || "";
      if (!body) {
        this._toast("No body to copy");
        return;
      }
      try {
        await navigator.clipboard.writeText(body);
        this._toast("Body copied");
      } catch {
        this._toast("Copy failed");
      }
    },
  };
}

// ========= FIX A: Register component name for x-data="emailApp" =========
document.addEventListener("alpine:init", () => {
  Alpine.data("emailApp", emailApp);
  console.log("✅ Alpine.data('emailApp') registered");
});

console.log("✅ main.js finished loading");
