// main.js (AuthToolkit frontend) — full, corrected

function emailApp() {
  const FUNCTIONS_BASE = "https://jmnpfdqxzilbobffqhda.supabase.co/functions/v1";
  const STORAGE_ACTIVE = "tempInbox";
  const STORAGE_SESSION = "session_id";

  // slower polling reduces 429s a lot
  const POLL_MS = 45000;
  const FETCH_TIMEOUT_MS = 30000;

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

    // backoff for 429
    backoffUntilMs: 0,

    // UI state for 429
    isRateLimited: false,
    rateLimitUntil: 0,

    // reduce accidental burst calls
    lastFetchAtMs: 0,

    // cursor support
    lastSeenCreatedAt: null,

    toast: { show: false, text: "" },

    init() {
      // helpful marker so you know the correct JS loaded
      console.log("[AuthToolkit] main.js loaded (full UI build)");
      this.restoreInbox();

      // Pause polling in background tabs to reduce 429s
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
          clearInterval(this.refreshInterval);
          this.refreshInterval = null;
        } else {
          // resume polling + do a single refresh
          if (this.inboxId && this.sessionId && !this.refreshInterval) {
            this.refreshInterval = setInterval(() => this.fetchEmails(), POLL_MS);
          }
          this.fetchEmails();
        }
      });
    },

    showToast(text) {
      this.toast.text = text;
      this.toast.show = true;
      setTimeout(() => (this.toast.show = false), 5000);
    },

    getErrorMessage(respJson, fallback = "Request failed") {
      if (!respJson) return fallback;

      // New error shape: { ok:false, error:{ code, message, ... } }
      const msg = respJson?.error?.message;
      if (typeof msg === "string" && msg.trim()) return msg;

      // Old shape: { error: "..." }
      const old = respJson?.error;
      if (typeof old === "string" && old.trim()) return old;

      return fallback;
    },

    async fetchWithTimeout(url, opts = {}, timeoutMs = FETCH_TIMEOUT_MS) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        return await fetch(url, {
          ...opts,
          signal: ctrl.signal,
          cache: "no-store",
          headers: {
            Accept: "application/json",
            ...(opts.headers || {}),
          },
        });
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

        let raw = {};
        try {
          raw = await res.json();
        } catch (_) {}

        // Support both shapes:
        // old: { session_id, inbox_id, email_address, expires_at }
        // new: { ok:true, data:{ session_id, inbox_id, email_address, expires_at } }
        const payload = (raw && raw.ok === true && raw.data) ? raw.data : raw;

        if (!res.ok || (raw && raw.ok === false)) {
          alert(this.getErrorMessage(raw, "Failed to create inbox"));
          return;
        }

        // Contract: { session_id, inbox_id, email_address, expires_at }
        this.sessionId = payload.session_id;
        this.inboxId = payload.inbox_id;
        this.currentEmail = payload.email_address;
        this.expiresAt = payload.expires_at;

        // reset cursor for polling
        this.lastSeenCreatedAt = null;

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

        // reset guards/states
        this.pollInFlight = false;
        this.backoffUntilMs = 0;
        this.isRateLimited = false;
        this.rateLimitUntil = 0;
        this.lastFetchAtMs = 0;

        // clear previous emails in UI so it doesn't show old inbox content
        this.emails = [];

        // fetch once immediately, then start timers
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

      // minimum spacing between calls (prevents accidental bursts)
      const minGapMs = 5000;
      if (now - this.lastFetchAtMs < minGapMs) return;

      // respect backoff
      if (now < this.backoffUntilMs) return;

      // avoid overlap
      if (this.pollInFlight) return;
      this.pollInFlight = true;

      // mark attempt time immediately to avoid rapid loops
      this.lastFetchAtMs = now;

      try {
        const url = new URL(`${FUNCTIONS_BASE}/get-emails`);
        url.searchParams.set("inbox_id", this.inboxId);
        url.searchParams.set("session_id", this.sessionId);

        // Optional cursor support: ask only for new emails since last seen
        // If your backend doesn't implement `since`, it will just ignore it.
        if (this.lastSeenCreatedAt) {
          url.searchParams.set("since", this.lastSeenCreatedAt);
        }

        const res = await this.fetchWithTimeout(url.toString(), {}, FETCH_TIMEOUT_MS);

        // invalid/expired session
        if (res.status === 401 || res.status === 403) {
          console.warn("get-emails unauthorized; clearing session");
          this.clearSession();
          return;
        }

        // 429 backoff (cap + jitter) + UI banner
        if (res.status === 429) {
          const retryAfterHeader = res.headers.get("Retry-After");
          let retrySec = 15;

          if (retryAfterHeader) {
            const parsed = parseInt(retryAfterHeader, 10);
            if (!Number.isNaN(parsed) && parsed > 0) retrySec = parsed;
          } else {
            // try JSON body fallback (optional)
            try {
              const body = await res.json();
              const ra = body?.error?.retry_after_seconds ?? body?.retry_after_seconds;
              if (ra) retrySec = Number(ra) || retrySec;
            } catch (_) {}
          }

          retrySec = Math.min(retrySec, 120);
          const jitterMs = Math.floor(Math.random() * 1000);
          const backoffMs = retrySec * 1000 + jitterMs;

          this.backoffUntilMs = Date.now() + backoffMs;

          this.isRateLimited = true;
          this.rateLimitUntil = this.backoffUntilMs;

          // auto-clear banner after backoff
          setTimeout(() => {
            if (Date.now() >= this.rateLimitUntil) this.isRateLimited = false;
          }, backoffMs);

          console.warn("get-emails 429: backing off for", retrySec, "seconds");
          return;
        }

        let raw = {};
        try {
          raw = await res.json();
        } catch (e) {
          console.error("get-emails: failed to parse JSON:", e);
          return;
        }

        // Your real contract:
        // { ok:true, data:{ emails:[...], newest_created_at:"..." } }
        if (!res.ok) {
          console.error("get-emails HTTP failed:", res.status, raw);
          return;
        }
        if (raw && raw.ok === false) {
          console.error("get-emails ok:false:", raw);
          return;
        }

        const list = Array.isArray(raw?.data?.emails) ? raw.data.emails : [];
        const newest = raw?.data?.newest_created_at || null;

        // dedupe by id
        const seen = new Set();
        const deduped = [];
        for (const m of list) {
          const id = m?.id;
          if (!id || seen.has(id)) continue;
          seen.add(id);
          deduped.push(m);
        }

        // If we used cursor `since`, backend may return only *new* emails.
        // Merge by placing new emails at the top, then dedupe.
        if (this.lastSeenCreatedAt) {
          const merged = [...deduped, ...(this.emails || [])];
          const seen2 = new Set();
          const mergedDeduped = [];
          for (const m of merged) {
            const id = m?.id;
            if (!id || seen2.has(id)) continue;
            seen2.add(id);
            mergedDeduped.push(m);
          }
          this.emails = mergedDeduped;
        } else {
          this.emails = deduped;
        }

        // sort newest first
        this.emails.sort((a, b) => {
          const ta = new Date(a?.created_at || 0).getTime();
          const tb = new Date(b?.created_at || 0).getTime();
          return tb - ta;
        });

        // Update cursor if backend provides it
        if (newest) {
          this.lastSeenCreatedAt = newest;
        } else if (this.emails.length > 0 && this.emails[0]?.created_at) {
          this.lastSeenCreatedAt = this.emails[0].created_at;
        }

        // clear banner after success
        this.isRateLimited = false;
        this.rateLimitUntil = 0;
      } catch (e) {
        if (e?.name === "AbortError") {
          console.warn("get-emails timed out");
        } else {
          console.error("Fetch emails error:", e);
        }
      } finally {
        this.pollInFlight = false;
      }
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

    copyBodyLatest() {
      const m = (this.emails && this.emails.length > 0) ? this.emails[0] : null;
      const text = (m && (m.body || m.html || m.text || m.preview || m.snippet)) || "";
      if (!text) {
        this.showToast("No body to copy");
        return;
      }

      navigator.clipboard
        .writeText(text)
        .then(() => this.showToast("Body copied!"))
        .catch(() => {
          try {
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
            this.showToast("Body copied!");
          } catch (e) {
            console.error("Copy body failed:", e);
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

      // only poll if tab is visible
      if (!document.hidden) {
        this.refreshInterval = setInterval(() => this.fetchEmails(), POLL_MS);
      }
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

          // reset cursor
          this.lastSeenCreatedAt = null;

          if (this.sessionId) localStorage.setItem(STORAGE_SESSION, this.sessionId);

          this.pollInFlight = false;
          this.backoffUntilMs = 0;
          this.isRateLimited = false;
          this.rateLimitUntil = 0;
          this.lastFetchAtMs = 0;

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

      // reset cursor
      this.lastSeenCreatedAt = null;

      clearInterval(this.countdownInterval);
      clearInterval(this.refreshInterval);

      this.pollInFlight = false;
      this.backoffUntilMs = 0;
      this.isRateLimited = false;
      this.rateLimitUntil = 0;
      this.lastFetchAtMs = 0;

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
