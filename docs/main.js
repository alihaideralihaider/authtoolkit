(() => {
  // ====== CONFIG (PUT YOUR REAL VALUES HERE) ======
  // NOTE: For now we keep it simple: browser calls edge functions directly.
  const SUPABASE_URL = "https://jmnpfdqxzilbobffqhda.supabase.co";
  const SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImptbnBmZHF4emlsYm9iZmZxaGRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAwNzc5MDAsImV4cCI6MjA4NTY1MzkwMH0.nR_yqz66PnXGZVm4s-b4UzooKPzCaIwwEdYkuN9XLVo";

  // Your edge function names (as deployed)
  const FN_CREATE = "create-inbox";
  const FN_GET = "get-emails";
  const FN_EXTEND = "extend-inbox"; // optional; if you don't have it, button will toast an error

  const LS_KEY = "atk_inbox_v1";

  function nowISO() {
    return new Date().toISOString();
  }

  function saveState(state) {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function clearState() {
    try {
      localStorage.removeItem(LS_KEY);
    } catch {}
  }

  function parseExpiryMs(expires_at) {
    if (!expires_at) return 0;
    const ms = Date.parse(expires_at);
    return Number.isFinite(ms) ? ms : 0;
  }

  async function callFn(
    name,
    { method = "GET", query = {}, body = null } = {},
  ) {
    const qs = new URLSearchParams(query).toString();
    const url = `${SUPABASE_URL}/functions/v1/${name}${qs ? `?${qs}` : ""}`;

    const headers = {
      apikey: SUPABASE_ANON_KEY,
      authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "content-type": "application/json",
    };

    let res;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : null,
      });
    } catch (err) {
      // network error
      throw new Error(`NETWORK_ERROR: ${err?.message || String(err)}`);
    }

    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }

    if (!res.ok) {
      // Attach HTTP status so caller can react (410 -> stop polling)
      const msg =
        data?.error?.message ||
        data?.message ||
        data?.error ||
        (text ? text : "Unknown error");

      const e = new Error(`${res.status} ${res.statusText}: ${msg}`);
      e.status = res.status;
      e.data = data;
      throw e;
    }

    return data;
  }

  function shortId(s) {
    if (!s) return "—";
    return String(s).slice(0, 8);
  }

  function copyToClipboard(text) {
    if (!text) return Promise.resolve(false);
    return navigator.clipboard
      .writeText(text)
      .then(() => true)
      .catch(() => false);
  }

  // ====== ALPINE COMPONENT ======
  window.emailApp = function emailApp() {
    return {
      build: "201",
      statusText: "Ready",
      toast: { show: false, text: "" },

      session_id: null,
      inbox_id: null,
      email_address: null,
      expires_at: null,

      // NEW: local expiry / expired state
      expiryMs: 0,
      isExpired: false,

      emails: [],
      currentEmail: null,
      loadingEmails: false,
      hydrated: false,
      timerInterval: null,

      pollTimer: null,
      pollEveryMs: 5000,

      get sessionShort() {
        return shortId(this.session_id);
      },

      toastShow(text) {
        this.toast.text = text;
        this.toast.show = true;
        setTimeout(() => (this.toast.show = false), 1400);
      },

      formatTime(iso) {
        if (!iso) return "";
        const d = new Date(iso);
        return d.toLocaleString();
      },

      formatISO(iso) {
        if (!iso) return "";
        try {
          return new Date(iso).toLocaleString();
        } catch {
          return String(iso);
        }
      },

      setStatus(s) {
        this.statusText = s;
      },

      hydrateFromStorage() {
        const st = loadState();
        if (!st) return;

        this.session_id = st.session_id || null;
        this.inbox_id = st.inbox_id || null;
        this.email_address = st.email_address || null;
        this.expires_at = st.expires_at || null;

        this.expiryMs = parseExpiryMs(this.expires_at);
        this.isExpired = this.expiryMs ? Date.now() >= this.expiryMs : false;
      },

      persist() {
        // Keep expires_at in sync
        this.expiryMs = parseExpiryMs(this.expires_at);

        saveState({
          session_id: this.session_id,
          inbox_id: this.inbox_id,
          email_address: this.email_address,
          expires_at: this.expires_at,
          saved_at: nowISO(),
        });
      },

      isInboxExpiredNow() {
        return this.expiryMs && Date.now() >= this.expiryMs;
      },

      stopPolling() {
        if (this.pollTimer) clearInterval(this.pollTimer);
        this.pollTimer = null;
      },

      startPolling() {
        this.stopPolling();

        // Don’t poll if we have no inbox, or it’s expired
        if (!this.inbox_id || !this.session_id) return;
        if (this.isExpired || this.isInboxExpiredNow()) {
          this.markExpired(false);
          return;
        }

        this.pollTimer = setInterval(() => {
          // Time-based stop (handles expiry without needing a 410)
          if (this.isInboxExpiredNow()) {
            this.markExpired(true);
            return;
          }
          this.refreshEmails(false);
        }, this.pollEveryMs);
      },

      markExpired(showToast = true) {
        this.isExpired = true;
        this.stopPolling();

        // Clear stored inbox so refresh won’t re-poll
        clearState();

        // Clear current inbox state in memory
        this.session_id = null;
        this.inbox_id = null;
        this.email_address = null;
        this.expires_at = null;
        this.expiryMs = 0;

        // UI reset (optional but avoids showing stale emails)
        this.emails = [];
        this.currentEmail = null;

        this.setStatus("Expired");
        if (showToast) this.toastShow("Inbox expired — create a new one");
      },

      async init() {
        this.hydrateFromStorage();
        this.startTimer();
      
        // If expired on load, DO NOT poll
        if (this.inbox_id && this.session_id) {
          if (this.isExpired || this.isInboxExpiredNow()) {
            this.markExpired(false);
            return;
          }
      
          // Fetch immediately and then start polling
          await this.refreshEmails(false);
          this.startPolling();
        }
      },
      async createInbox() {
        try {
          this.setStatus("Creating…");
          this.currentEmail = null;
          this.emails = [];

          // reset expired flag
          this.isExpired = false;

          // Keep it super simple: create-inbox returns {session_id,inbox_id,email_address,expires_at}
          const data = await callFn(FN_CREATE, { method: "POST", body: {} });

          this.session_id = data.session_id;
          this.inbox_id = data.inbox_id;
          this.email_address = data.email_address;
          this.expires_at = data.expires_at;

          this.expiryMs = parseExpiryMs(this.expires_at);
          this.isExpired = this.isInboxExpiredNow();

          this.persist();

          if (this.isExpired) {
            this.markExpired(false);
            return;
          }

          this.setStatus("Inbox ready");
          this.toastShow("Inbox created");

          // Fetch messages and start polling
          await this.refreshEmails(false);
          this.startPolling();
        } catch (e) {
          console.error("createInbox failed:", e);
          this.setStatus("Error");
          this.toastShow("Create failed (see console)");
        }
      },

          startTimer() {
        if (!this.expiryMs) {
          this.statusText = "—";
          return;
        }
      
        if (this.timerInterval) {
          clearInterval(this.timerInterval);
        }
      
        const updateTimer = () => {
          const remaining = this.expiryMs - Date.now();
      
          if (remaining <= 0) {
            clearInterval(this.timerInterval);
            this.statusText = "00:00";
            this.markExpired(false);
            return;
          }
      
          const sec = Math.floor(remaining / 1000);
          const m = Math.floor(sec / 60);
          const s = sec % 60;
          const h = Math.floor(m / 60);
          const mm = m % 60;
      
          const hh = String(h).padStart(2, "0");
          const mms = String(mm).padStart(2, "0");
          const ss = String(s).padStart(2, "0");
      
          this.statusText = h > 0 ? `${hh}:${mms}:${ss}` : `${mms}:${ss}`;
        };
      
        updateTimer();
        this.timerInterval = setInterval(updateTimer, 1000);
      },

      async refreshEmails(showToast = true) {
        if (!this.inbox_id || !this.session_id) {
          if (showToast) this.toastShow("Create an inbox first");
          return;
        }

        if (this.isExpired || this.isInboxExpiredNow()) {
          this.markExpired(showToast);
          return;
        }

        try {
          this.setStatus("Syncing…");
          const data = await callFn(FN_GET, {
            method: "GET",
            query: { inbox_id: this.inbox_id, session_id: this.session_id },
          });

          // Expecting { emails: [...] } OR [...] — handle both
          const list = Array.isArray(data) ? data : data?.emails || [];
          this.emails = list;

          // Keep currentEmail object fresh if still exists
          if (this.currentEmail?.id) {
            const fresh = this.emails.find((x) => x.id === this.currentEmail.id);
            if (fresh) this.currentEmail = fresh;
          }

          this.setStatus("Ready");
          if (showToast) this.toastShow("Refreshed");
        } catch (e) {
          // If backend says expired, STOP polling and clear state
          if (e?.status === 410) {
            console.warn("Inbox expired (410). Stopping polling.");
            this.markExpired(showToast);
            return;
          }

          console.error("get-emails failed:", e);
          this.setStatus("Error");
          if (showToast) this.toastShow("Refresh failed (see console)");
        }
      },

      openEmail(e) {
        this.currentEmail = e;
      },

      async copyEmail() {
        if (!this.email_address) return this.toastShow("No inbox yet");
        const ok = await copyToClipboard(this.email_address);
        this.toastShow(ok ? "Copied" : "Copy failed");
      },

      async copyBody() {
        if (!this.currentEmail?.body) return this.toastShow("No body");
        const ok = await copyToClipboard(this.currentEmail.body);
        this.toastShow(ok ? "Body copied" : "Copy failed");
      },

      async extendInbox() {
        // Optional: only works if you deployed extend-inbox.
        if (!this.inbox_id || !this.session_id) return this.toastShow("No inbox yet");

        try {
          this.setStatus("Extending…");
          const data = await callFn(FN_EXTEND, {
            method: "POST",
            body: { inbox_id: this.inbox_id, session_id: this.session_id },
          });

          if (data?.expires_at) {
            this.expires_at = data.expires_at;
            this.expiryMs = parseExpiryMs(this.expires_at);
            this.isExpired = this.isInboxExpiredNow();
          }

          this.persist();

          if (this.isExpired) {
            this.markExpired(false);
            return;
          }

          this.setStatus("Ready");
          this.toastShow("Extended");

          // Make sure polling resumes (if it had been stopped)
          this.startPolling();
        } catch (e) {
          console.error("extend failed:", e);
          this.setStatus("Ready");
          this.toastShow("Extend not available");
        }
      },

      resetAll() {
        this.stopPolling();
        clearState();

        this.session_id = null;
        this.inbox_id = null;
        this.email_address = null;
        this.expires_at = null;

        this.expiryMs = 0;
        this.isExpired = false;

        this.emails = [];
        this.currentEmail = null;

        this.setStatus("Reset");
        this.toastShow("Reset done");
      },
    };
  };

  // ====== Compatibility helpers (so Alpine expressions never break) ======
  // If you ever call createInbox() from raw HTML onclick or old Alpine snippets, this keeps it working.
  window.createInbox = () => {
    try {
      const root = document.querySelector("[x-data]");
      const x = root && root.__x;
      const state = x && x.$data;
      if (state && typeof state.createInbox === "function") return state.createInbox();
    } catch {}
  };
})();
