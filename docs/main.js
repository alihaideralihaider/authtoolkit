(() => {
  // ====== CONFIG (PUT YOUR REAL VALUES HERE) ======
  // NOTE: For now we keep it simple: browser calls edge functions directly.
const SUPABASE_URL = "https://jmnpfdqxzilbobffqhda.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImptbnBmZHF4emlsYm9iZmZxaGRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAwNzc5MDAsImV4cCI6MjA4NTY1MzkwMH0.nR_yqz66PnXGZVm4s-b4UzooKPzCaIwwEdYkuN9XLVo";

  // Your edge function names (as deployed)
  const FN_CREATE = "create-inbox";
  const FN_GET = "get-emails";
  const FN_EXTEND = "extend-inbox"; // optional; if you don't have it, button will toast an error

  const LS_KEY = "atk_inbox_v1";

  function nowISO() { return new Date().toISOString(); }

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

  async function callFn(name, { method = "GET", query = {}, body = null } = {}) {
    const qs = new URLSearchParams(query).toString();
    const url = `${SUPABASE_URL}/functions/v1/${name}${qs ? `?${qs}` : ""}`;

    const headers = {
      "apikey": SUPABASE_ANON_KEY,
      "authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "content-type": "application/json",
    };

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : null,
    });

    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : null; }
    catch { data = { raw: text }; }

    if (!res.ok) {
      const msg = data?.error?.message || data?.message || data?.error || JSON.stringify(data);
      throw new Error(`${res.status} ${res.statusText}: ${msg}`);
    }
    return data;
  }

  function shortId(s) {
    if (!s) return "—";
    return String(s).slice(0, 8);
  }

  function copyToClipboard(text) {
    if (!text) return Promise.resolve(false);
    return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
  }

  // ====== ALPINE COMPONENT ======
  window.emailApp = function emailApp() {
    return {
      build: "200",
      statusText: "Ready",
      toast: { show: false, text: "" },

      session_id: null,
      inbox_id: null,
      email_address: null,
      expires_at: null,

      emails: [],
      currentEmail: null,

      pollTimer: null,
      pollEveryMs: 5000,

      get sessionShort() { return shortId(this.session_id); },

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
        try { return new Date(iso).toLocaleString(); } catch { return String(iso); }
      },

      setStatus(s) { this.statusText = s; },

      hydrateFromStorage() {
        const st = loadState();
        if (!st) return;

        this.session_id = st.session_id || null;
        this.inbox_id = st.inbox_id || null;
        this.email_address = st.email_address || null;
        this.expires_at = st.expires_at || null;
      },

      persist() {
        saveState({
          session_id: this.session_id,
          inbox_id: this.inbox_id,
          email_address: this.email_address,
          expires_at: this.expires_at,
          saved_at: nowISO(),
        });
      },

      startPolling() {
        if (this.pollTimer) clearInterval(this.pollTimer);
        this.pollTimer = setInterval(() => {
          if (this.inbox_id && this.session_id) this.refreshEmails(false);
        }, this.pollEveryMs);
      },

      stopPolling() {
        if (this.pollTimer) clearInterval(this.pollTimer);
        this.pollTimer = null;
      },

      async init() {
        this.hydrateFromStorage();
        this.startPolling();

        // If we already have an inbox, fetch emails immediately
        if (this.inbox_id && this.session_id) {
          this.refreshEmails(false);
        }
      },

      async createInbox() {
        try {
          this.setStatus("Creating…");
          this.currentEmail = null;
          this.emails = [];

          // Keep it super simple: create-inbox returns {session_id,inbox_id,email_address,expires_at}
          const data = await callFn(FN_CREATE, { method: "POST", body: {} });

          this.session_id = data.session_id;
          this.inbox_id = data.inbox_id;
          this.email_address = data.email_address;
          this.expires_at = data.expires_at;

          this.persist();
          this.setStatus("Inbox ready");
          this.toastShow("Inbox created");

          // Fetch messages
          await this.refreshEmails(false);
        } catch (e) {
          console.error("createInbox failed:", e);
          this.setStatus("Error");
          this.toastShow("Create failed (see console)");
        }
      },

      async refreshEmails(showToast = true) {
        if (!this.inbox_id || !this.session_id) {
          if (showToast) this.toastShow("Create an inbox first");
          return;
        }

        try {
          this.setStatus("Syncing…");
          const data = await callFn(FN_GET, {
            method: "GET",
            query: { inbox_id: this.inbox_id, session_id: this.session_id },
          });

          // Expecting { emails: [...] } OR [...] — handle both
          const list = Array.isArray(data) ? data : (data.emails || []);
          this.emails = list;

          // Keep currentEmail object fresh if still exists
          if (this.currentEmail?.id) {
            const fresh = this.emails.find(x => x.id === this.currentEmail.id);
            if (fresh) this.currentEmail = fresh;
          }

          this.setStatus("Ready");
          if (showToast) this.toastShow("Refreshed");
        } catch (e) {
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
          if (data?.expires_at) this.expires_at = data.expires_at;
          this.persist();
          this.setStatus("Ready");
          this.toastShow("Extended");
        } catch (e) {
          console.error("extend failed:", e);
          this.setStatus("Ready");
          this.toastShow("Extend not available");
        }
      },

      resetAll() {
        this.stopPolling();
        localStorage.removeItem(LS_KEY);

        this.session_id = null;
        this.inbox_id = null;
        this.email_address = null;
        this.expires_at = null;

        this.emails = [];
        this.currentEmail = null;

        this.setStatus("Reset");
        this.toastShow("Reset done");
        this.startPolling();
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
