// main.js — works with your existing 470-line index.html (no changes needed)
// Expects Supabase Edge Functions:
// POST  /functions/v1/create-inbox  -> { session_id, inbox_id, email_address, expires_at }
// GET   /functions/v1/get-emails?inbox_id=...&session_id=... -> { emails:[...] } (or {ok:true, emails:[...]})

function emailApp() {
  return {
    // ===== CONFIG =====
    SUPABASE_URL: "https://jmnpfdqxzilbobffqhda.supabase.co",
    CREATE_INBOX_PATH: "/functions/v1/create-inbox",
    GET_EMAILS_PATH: "/functions/v1/get-emails",

    // ===== STATE (names must match your HTML) =====
    inboxId: "",
    sessionId: "",
    currentEmail: "",     // email address string displayed in input
    expiresAt: "",        // ISO timestamp if provided by backend

    emails: [],           // array used by UI, newest-first
    countdown: "--:--",   // UI shows this
    isRateLimited: false,
    rateLimitUntil: 0,

    toast: { show: false, text: "" },

    _pollTimer: null,
    _countdownTimer: null,

    // ===== INIT =====
    init() {
      // Restore session
      const saved = this._safeJsonParse(localStorage.getItem("atk_state"));
      if (saved?.inboxId && saved?.sessionId) {
        this.inboxId = saved.inboxId;
        this.sessionId = saved.sessionId;
        this.currentEmail = saved.currentEmail || "";
        this.expiresAt = saved.expiresAt || "";

        this._startPolling();
        this.fetchEmails(true);
      }

      this._startCountdownLoop();
    },

    // ===== HELPERS =====
    _safeJsonParse(v) {
      try { return JSON.parse(v); } catch { return null; }
    },

    _saveState() {
      localStorage.setItem("atk_state", JSON.stringify({
        inboxId: this.inboxId,
        sessionId: this.sessionId,
        currentEmail: this.currentEmail,
        expiresAt: this.expiresAt
      }));
    },

    _clearState() {
      localStorage.removeItem("atk_state");
    },

    _toast(msg) {
      this.toast = { show: true, text: msg };
      setTimeout(() => { this.toast.show = false; }, 2000);
    },

    formatTime(ts) {
      if (!ts) return "—";
      const d = new Date(ts);
      if (Number.isNaN(d.getTime())) return "—";
      return d.toLocaleString();
    },

    _nowMs() { return Date.now(); },

    _setRateLimited(seconds = 8) {
      this.isRateLimited = true;
      this.rateLimitUntil = this._nowMs() + seconds * 1000;
    },

    _clearRateLimitedIfReady() {
      if (!this.isRateLimited) return;
      if (this._nowMs() >= this.rateLimitUntil) {
        this.isRateLimited = false;
        this.rateLimitUntil = 0;
      }
    },

    _startPolling() {
      if (this._pollTimer) return;

      // Poll every 4 seconds (lightweight)
      this._pollTimer = setInterval(() => {
        this.fetchEmails(false);
      }, 4000);
    },

    _stopPolling() {
      if (this._pollTimer) {
        clearInterval(this._pollTimer);
        this._pollTimer = null;
      }
    },

    _startCountdownLoop() {
      if (this._countdownTimer) return;

      this._countdownTimer = setInterval(() => {
        this._updateCountdown();
        this._clearRateLimitedIfReady();
      }, 1000);

      this._updateCountdown();
    },

    _updateCountdown() {
      // If backend provides expiresAt, show a real countdown.
      // If not, show "--:--" (won’t break UI).
      if (!this.expiresAt) {
        this.countdown = "--:--";
        return;
      }

      const exp = new Date(this.expiresAt).getTime();
      if (Number.isNaN(exp)) {
        this.countdown = "--:--";
        return;
      }

      const diff = exp - this._nowMs();
      if (diff <= 0) {
        this.countdown = "00:00";
        return;
      }

      const totalSec = Math.floor(diff / 1000);
      const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
      const ss = String(totalSec % 60).padStart(2, "0");
      this.countdown = `${mm}:${ss}`;
    },

    _normalizeEmails(list) {
      // Normalize common fields, keep body if present
      const arr = (Array.isArray(list) ? list : []).map(e => ({
        id: e.id,
        inbox_id: e.inbox_id,
        from_address: e.from_address,
        subject: e.subject,
        created_at: e.created_at,
        body: e.body
      }));

      // Sort newest first
      arr.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      return arr;
    },

    _mergeEmails(prev, incoming) {
      // Merge by id so when body arrives later it overwrites earlier null body
      const map = new Map();
      for (const e of prev) map.set(e.id, e);

      for (const e of incoming) {
        const old = map.get(e.id);
        if (!old) {
          map.set(e.id, e);
        } else {
          // Prefer new fields when present
          map.set(e.id, {
            ...old,
            ...e,
            body: (typeof e.body === "string" && e.body.trim() !== "") ? e.body : old.body
          });
        }
      }

      const merged = Array.from(map.values());
      merged.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      return merged;
    },

    // ===== ACTIONS (called by your HTML) =====

    async createInbox() {
      // Clear rate-limited banner when user takes action
      this.isRateLimited = false;
      this.rateLimitUntil = 0;

      try {
        const url = this.SUPABASE_URL + this.CREATE_INBOX_PATH;

        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}) // backend generates session_id if missing (your current behavior)
        });

        let data = null;
        try { data = await res.json(); } catch {}

        if (res.status === 429) {
          this._setRateLimited(10);
          this._toast("Rate limited. Retrying…");
          return;
        }

        if (!res.ok) {
          const msg = (data && (data.error || data.message)) ? (data.error || data.message) : `HTTP ${res.status}`;
          throw new Error(`create-inbox failed: ${msg}`);
        }

        // Flat JSON expected
        this.sessionId = data.session_id || "";
        this.inboxId = data.inbox_id || "";
        this.currentEmail = data.email_address || "";
        this.expiresAt = data.expires_at || "";

        if (!this.sessionId || !this.inboxId || !this.currentEmail) {
          throw new Error("create-inbox returned missing fields.");
        }

        this.emails = [];
        this._saveState();
        this._toast("Inbox created.");

        this._startPolling();
        await this.fetchEmails(true);
      } catch (err) {
        console.error(err);
        this._toast(err?.message || "Create inbox failed");
      }
    },

    async fetchEmails(force = false) {
      if (!this.inboxId || !this.sessionId) return;

      // If rate-limited, don’t spam unless force
      if (this.isRateLimited && !force) return;

      try {
        const qs = new URLSearchParams({
          inbox_id: this.inboxId,
          session_id: this.sessionId,
          t: String(Date.now()) // cache buster
        });

        const url = this.SUPABASE_URL + this.GET_EMAILS_PATH + "?" + qs.toString();
        const res = await fetch(url, { method: "GET" });

        let data = null;
        try { data = await res.json(); } catch {}

        if (res.status === 429) {
          this._setRateLimited(10);
          return;
        }

        if (!res.ok) {
          const msg = (data && (data.error || data.message)) ? (data.error || data.message) : `HTTP ${res.status}`;
          throw new Error(`get-emails failed: ${msg}`);
        }

        const list = Array.isArray(data?.emails) ? data.emails : (Array.isArray(data) ? data : []);
        const normalized = this._normalizeEmails(list);

        // Merge with existing so body can “fill in” later
        this.emails = this._mergeEmails(this.emails, normalized);

        // If latest email has no body yet, polling will keep updating
      } catch (err) {
        console.error(err);
        // Don’t toast constantly during polling; toast only if forced
        if (force) this._toast(err?.message || "Fetch emails failed");
      }
    },

    async copyEmail() {
      if (!this.currentEmail) return;
      try {
        await navigator.clipboard.writeText(this.currentEmail);
        this._toast("Email copied.");
      } catch {
        // fallback
        const ta = document.createElement("textarea");
        ta.value = this.currentEmail;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        this._toast("Email copied.");
      }
    },

    async copyBodyLatest() {
      if (!this.emails || this.emails.length === 0) return;

      const latest = this.emails[0];
      const body = (latest && typeof latest.body === "string") ? latest.body : "";
      const toCopy = body && body.trim() ? body : "(no body)";

      try {
        await navigator.clipboard.writeText(toCopy);
        this._toast("Body copied.");
      } catch {
        const ta = document.createElement("textarea");
        ta.value = toCopy;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        this._toast("Body copied.");
      }
    },

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
      this._toast("Cleared.");
    }
  };
}
