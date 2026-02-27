// main.js (updated / hardened)

function emailApp() {
  const FUNCTIONS_BASE = "https://jmnpfdqxzilbobffqhda.supabase.co/functions/v1";
  const STORAGE_ACTIVE = "tempInbox";
  const STORAGE_SESSION = "session_id";

  const POLL_MS = 20000;

  // network timeouts
  const FETCH_TIMEOUT_MS = 12000;

  return {
    currentEmail: "",
    emails: [],
    countdown: "",
    inboxId: null,
    sessionId: null,
    expiresAt: null,

    refreshInterval: null,
    countdownInterval: null,

    // prevents overlapping requests
    pollInFlight: false,
    // if we get 429, we back off instead of spamming logs
    backoffUntilMs: 0,

    toast: { show: false, text: "" },

    init() {
      this.restoreInbox();
    },

    showToast(text) {
      this.toast.text = text;
      this.toast.show = true;
      setTimeout(() => (this.toast.show = false), 20000);
    },

    // ✅ AbortController timeout wrapper (prevents hanging fetch)
    async fetchWithTimeout(url, opts = {}, timeoutMs = FETCH_TIMEOUT_MS) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        return await fetch(url, { ...opts, signal: ctrl.signal });
      } finally {
        clearTimeout(t);
      }
    },

    async createInbox() {
      try {
        const url = new URL(`${FUNCTIONS_BASE}/create-inbox`);
        const existingSession = localStorage.getItem(STORAGE_SESSION);
        if (existingSession) url.searchParams.set("session_id", existingSession);

        const res = await this.fetchWithTimeout(url.toString(), { method: "POST" });

        // Try json but don’t crash if it’s not json
        let data = {};
        try {
          data = await res.json();
        } catch (_) {}

        if (!res.ok) {
          alert(data.error || "Failed to create inbox");
          return;
        }

        // Contract: { session_id, inbox_id, email_address, expires_at }
        this.sessionId = data.session_id;
        this.inboxId = data.inbox_id;
        this.currentEmail = data.email_address;
        this.expiresAt = data.expires_at;

        localStorage.setItem(STORAGE_SESSION, this.sessionId);
        localStorage.setItem(
          STORAGE_ACTIVE,
          JSON.stringify({
            session_id: this.sessionId,
            inbox_id: this.inboxId,
            email_address: this.currentEmail,
            expires_at: this.expiresAt,
          })
        );

        // Reset guards for a brand new inbox
        this.pollInFlight = false;
        this.backoffUntilMs = 0;

        // ✅ First fetch immediately, then start timers (reduces “double fetch” feel)
        await this.fetchEmails();
        this.startTimers();

        this.showToast("Inbox created");
      } catch (e) {
        console.error("Create inbox error:", e);
        alert("Create inbox error. Check console.");
      }
    },

    async fetchEmails() {
      if (!this.inboxId || !this.sessionId) return;

      const now = Date.now();

      // Respect backoff window
      if (now < this.backoffUntilMs) return;

      // Prevent overlapping calls (timer + manual + restore)
      if (this.pollInFlight) return;
      this.pollInFlight = true;

      try {
        const url = new URL(`${FUNCTIONS_BASE}/get-emails`);
        url.searchParams.set("inbox_id", this.inboxId);
        url.searchParams.set("session_id", this.sessionId);

        const res = await this.fetchWithTimeout(url.toString(), {}, FETCH_TIMEOUT_MS);

        // ✅ Auto-clear if session is invalid/expired
        if (res.status === 401 || res.status === 403) {
          console.warn("get-emails unauthorized; clearing session");
          this.clearSession();
          return;
        }

        // ✅ Handle 429 cleanly (cap + jitter)
        if (res.status === 429) {
          const retryAfterHeader = res.headers.get("Retry-After");
          let retrySec = 20;

          if (retryAfterHeader) {
            const parsed = parseInt(retryAfterHeader, 10);
            if (!Number.isNaN(parsed) && parsed > 0) retrySec = parsed;
          } else {
            // fallback to JSON body field if present
            try {
              const body = await res.json();
              if (body?.retry_after_seconds) retrySec = Number(body.retry_after_seconds) || retrySec;
            } catch (_) {}
          }

          retrySec = Math.min(retrySec, 120); // cap at 2 minutes
          const jitterMs = Math.floor(Math.random() * 1500); // up to 1.5s jitter

          this.backoffUntilMs = Date.now() + retrySec * 1000 + jitterMs;
          console.warn("get-emails 429: backing off for", retrySec, "seconds");
          return;
        }

        // Parse JSON safely
        let data = {};
        try {
          data = await res.json();
        } catch (e) {
          console.error("get-emails: failed to parse JSON:", e);
          return;
        }

        if (!res.ok) {
          console.error("get-emails failed:", data);
          return;
        }

        const list = Array.isArray(data.emails) ? data.emails : [];

        // ✅ Dedupe by id to reduce UI churn
        const seen = new Set();
        const deduped = [];
        for (const m of list) {
          const id = m?.id;
          if (!id || seen.has(id)) continue;
          seen.add(id);
          deduped.push(m);
        }

        // preserve open state
        const openMap = new Map(this.emails.map((m) => [m.id, m._open]));
        this.emails = deduped.map((m) => ({ ...m, _open: openMap.get(m.id) || false }));
      } catch (e) {
        // AbortError is expected on timeout; keep log minimal
        if (e?.name === "AbortError") {
          console.warn("get-emails timed out");
        } else {
          console.error("Fetch emails error:", e);
        }
      } finally {
        this.pollInFlight = false;
      }
    },

    toggleOpen(m) {
      m._open = !m._open;
    },

    copyEmail() {
      if (!this.currentEmail) return;

      navigator.clipboard
        .writeText(this.currentEmail)
        .then(() => this.showToast("Copied!"))
        .catch(() => {
          try {
            const ta = document.createElement("textarea");
            ta.value = this.currentEmail;
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
            this.showToast("Copied!");
          } catch (e) {
            console.error("Copy failed:", e);
            alert("Copy failed. Please copy manually.");
          }
        });
    },

    startTimers() {
      if (!this.expiresAt) return;

      clearInterval(this.countdownInterval);
      clearInterval(this.refreshInterval);

      this.updateCountdown();
      this.countdownInterval = setInterval(() => this.updateCountdown(), 1000);

      // single poll interval
      this.refreshInterval = setInterval(() => this.fetchEmails(), POLL_MS);
    },

    updateCountdown() {
      if (!this.expiresAt) return;

      const now = Date.now();
      const expiry = new Date(this.expiresAt).getTime();
      const diff = expiry - now;

      if (diff <= 0) {
        this.clearSession();
        return;
      }

      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      this.countdown = `${m}m ${s}s`;
    },

    restoreInbox() {
      const saved = localStorage.getItem(STORAGE_ACTIVE);
      const savedSession = localStorage.getItem(STORAGE_SESSION);

      if (!saved) return;

      try {
        const data = JSON.parse(saved);
        const now = Date.now();
        const expiry = new Date(data.expires_at).getTime();

        if (expiry > now) {
          this.currentEmail = data.email_address || "";
          this.inboxId = data.inbox_id || null;
          this.sessionId = data.session_id || savedSession || null;
          this.expiresAt = data.expires_at || null;

          if (this.sessionId) localStorage.setItem(STORAGE_SESSION, this.sessionId);

          // Reset guards on restore too
          this.pollInFlight = false;
          this.backoffUntilMs = 0;

          // ✅ immediate fetch, then timers
          this.fetchEmails();
          this.startTimers();
        } else {
          localStorage.removeItem(STORAGE_ACTIVE);
        }
      } catch (e) {
        console.error("restoreInbox failed:", e);
        localStorage.removeItem(STORAGE_ACTIVE);
      }
    },

    clearSession() {
      localStorage.removeItem(STORAGE_ACTIVE);

      this.currentEmail = "";
      this.inboxId = null;
      this.sessionId = null;
      this.emails = [];
      this.countdown = "";
      this.expiresAt = null;

      clearInterval(this.countdownInterval);
      clearInterval(this.refreshInterval);

      this.pollInFlight = false;
      this.backoffUntilMs = 0;

      this.showToast("Cleared");
    },

    formatTime(ts) {
      if (!ts) return "-";
      const d = new Date(ts);
      if (Number.isNaN(d.getTime())) return "-";
      return d.toLocaleString();
    },
  };
}