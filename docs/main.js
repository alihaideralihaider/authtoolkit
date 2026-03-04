/* main.js — AuthToolkit frontend logic (Alpine component)
   Works with: <div x-data="emailApp" x-init="init()">
*/

(() => {
  // ========= CONFIG (set these) =========
  // Your Supabase project URL (no trailing slash)
  const SUPABASE_URL = "https://YOUR_PROJECT_REF.supabase.co";
  // Your Supabase anon public key
  const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";

  // Edge function names (as deployed in Supabase)
  const FN_CREATE_INBOX = "create-inbox";
  const FN_GET_EMAILS = "get-emails";

  // Polling interval (ms)
  const POLL_MS = 6000;

  // ========= Helpers =========
  function nowMs() { return Date.now(); }

  async function safeJson(res) {
    const text = await res.text();
    try { return JSON.parse(text); } catch { return { raw: text }; }
  }

  function toastify(ctx, msg, ms = 1800) {
    ctx.toast.text = msg;
    ctx.toast.show = true;
    clearTimeout(ctx._toastT);
    ctx._toastT = setTimeout(() => (ctx.toast.show = false), ms);
  }

  function isConfigured() {
    return (
      SUPABASE_URL.startsWith("http") &&
      SUPABASE_ANON_KEY &&
      !SUPABASE_ANON_KEY.includes("YOUR_SUPABASE")
    );
  }

  function fnUrl(fnName) {
    return `${SUPABASE_URL}/functions/v1/${fnName}`;
  }

  // ========= Alpine component =========
  document.addEventListener("alpine:init", () => {
    Alpine.data("emailApp", () => ({
      // State
      inboxId: "",
      sessionId: "",
      currentEmail: "",
      expiresAt: "",

      emails: [],
      countdown: "--:--",

      isRateLimited: false,
      rateLimitUntil: 0,

      toast: { show: false, text: "" },

      _pollT: null,
      _countT: null,
      _toastT: null,

      init() {
        // Basic config guard
        if (!isConfigured()) {
          console.warn("Supabase config missing in main.js");
          toastify(this, "Set SUPABASE_URL and SUPABASE_ANON_KEY in main.js", 4000);
        }

        // Restore session
        try {
          const saved = JSON.parse(localStorage.getItem("atk_session") || "null");
          if (saved?.inboxId && saved?.sessionId && saved?.currentEmail) {
            this.inboxId = saved.inboxId;
            this.sessionId = saved.sessionId;
            this.currentEmail = saved.currentEmail;
            this.expiresAt = saved.expiresAt || "";
            this.emails = Array.isArray(saved.emails) ? saved.emails : [];
          }
        } catch {}

        this._startCountdown();
        this._startPolling();

        // If we already have an inbox, do an initial fetch
        if (this.inboxId) this.fetchEmails();
      },

      _persist() {
        const payload = {
          inboxId: this.inboxId,
          sessionId: this.sessionId,
          currentEmail: this.currentEmail,
          expiresAt: this.expiresAt,
          emails: this.emails,
        };
        localStorage.setItem("atk_session", JSON.stringify(payload));
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
        localStorage.removeItem("atk_session");
        toastify(this, "Cleared.");
      },

      async createInbox() {
        if (!isConfigured()) {
          toastify(this, "Missing Supabase config in main.js", 3500);
          return;
        }

        // If rate limited, don’t spam
        if (this.isRateLimited && nowMs() < this.rateLimitUntil) {
          toastify(this, "Rate limited — wait a moment.");
          return;
        }

        try {
          const res = await fetch(fnUrl(FN_CREATE_INBOX), {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "apikey": SUPABASE_ANON_KEY,
              "authorization": `Bearer ${SUPABASE_ANON_KEY}`,
            },
            body: JSON.stringify({}),
          });

          if (res.status === 429) {
            this._handle429(res);
            return;
          }

          if (!res.ok) {
            const j = await safeJson(res);
            console.error("create-inbox failed:", res.status, j);
            toastify(this, `Create inbox failed (${res.status})`);
            return;
          }

          const data = await res.json();
          // Expect: {session_id,inbox_id,email_address,expires_at}
          this.sessionId = data.session_id || "";
          this.inboxId = data.inbox_id || "";
          this.currentEmail = data.email_address || "";
          this.expiresAt = data.expires_at || "";
          this.emails = [];

          this._persist();
          this._startCountdown();

          toastify(this, "Inbox created.");
          // Fetch immediately after creation
          await this.fetchEmails();
        } catch (e) {
          console.error(e);
          toastify(this, "Network error creating inbox");
        }
      },

      async fetchEmails() {
        if (!this.inboxId || !this.sessionId) return;
        if (!isConfigured()) return;

        // Respect rate limit window
        if (this.isRateLimited && nowMs() < this.rateLimitUntil) return;

        try {
          const url = new URL(fnUrl(FN_GET_EMAILS));
          url.searchParams.set("inbox_id", this.inboxId);
          url.searchParams.set("session_id", this.sessionId);

          const res = await fetch(url.toString(), {
            method: "GET",
            headers: {
              "apikey": SUPABASE_ANON_KEY,
              "authorization": `Bearer ${SUPABASE_ANON_KEY}`,
            },
          });

          if (res.status === 429) {
            this._handle429(res);
            return;
          }

          if (!res.ok) {
            const j = await safeJson(res);
            console.error("get-emails failed:", res.status, j);
            return;
          }

          const data = await res.json();

          // Accept either {emails:[...]} or just [...]
          const list = Array.isArray(data) ? data : (data.emails || []);
          // Sort newest first just in case
          list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

          // Only toast if new mail arrived
          const prevTopId = this.emails?.[0]?.id;
          const newTopId = list?.[0]?.id;

          this.emails = list;
          this._persist();

          if (newTopId && newTopId !== prevTopId) {
            toastify(this, "New email received.");
          }
        } catch (e) {
          console.error(e);
        }
      },

      copyEmail() {
        if (!this.currentEmail) return;
        navigator.clipboard.writeText(this.currentEmail).then(
          () => toastify(this, "Email copied."),
          () => toastify(this, "Copy failed (browser blocked).")
        );
      },

      copyBodyLatest() {
        if (!this.emails || this.emails.length === 0) return;
        const body = this.emails[0]?.body || "";
        if (!body) {
          toastify(this, "No body to copy.");
          return;
        }
        navigator.clipboard.writeText(body).then(
          () => toastify(this, "Body copied."),
          () => toastify(this, "Copy failed (browser blocked).")
        );
      },

      formatTime(iso) {
        if (!iso) return "";
        try {
          const d = new Date(iso);
          return d.toLocaleString();
        } catch {
          return iso;
        }
      },

      _handle429(res) {
        // If server gives Retry-After, use it; else default to 8s.
        const ra = Number(res.headers.get("retry-after") || "8");
        const waitMs = Math.max(3, ra) * 1000;

        this.isRateLimited = true;
        this.rateLimitUntil = nowMs() + waitMs;

        // Auto-clear after window
        setTimeout(() => {
          if (nowMs() >= this.rateLimitUntil) {
            this.isRateLimited = false;
          }
        }, waitMs + 50);
      },

      _startPolling() {
        clearInterval(this._pollT);
        this._pollT = setInterval(() => {
          if (this.inboxId && this.sessionId) this.fetchEmails();
        }, POLL_MS);
      },

      _startCountdown() {
        clearInterval(this._countT);

        const tick = () => {
          if (!this.expiresAt) {
            this.countdown = "--:--";
            return;
          }
          const end = new Date(this.expiresAt).getTime();
          const diff = Math.max(0, end - nowMs());
          const s = Math.floor(diff / 1000);
          const mm = String(Math.floor(s / 60)).padStart(2, "0");
          const ss = String(s % 60).padStart(2, "0");
          this.countdown = `${mm}:${ss}`;

          if (diff <= 0) {
            // Expired — don’t auto-clear; just inform
            toastify(this, "Inbox expired. Create a new one.", 2500);
          }
        };

        tick();
        this._countT = setInterval(tick, 1000);
      },
    }));
  });
})();
