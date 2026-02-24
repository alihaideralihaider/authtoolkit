<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>AuthToolkit — Privacy-first disposable inbox for testing</title>

  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
  <script defer src="./main.js"></script>

  <style>
    :root{
      --bg:#0b1220;
      --card:#121a2b;
      --card2:#0f1730;
      --border:#24304a;
      --muted:#9fb0cc;
      --text:#e6edf7;
      --blue:#2563eb;
      --blue2:#1d4ed8;
      --danger:#b91c1c;
      --adH:96px; /* 1 inch approx on common displays */
    }
    *{ box-sizing:border-box; }
    body{ margin:0; font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial; background:var(--bg); color:var(--text); }

    /* Layout: fixed ad, everything else fits above it */
    .page{
      height: calc(100vh - var(--adH));
      display:flex;
      flex-direction:column;
    }

    /* Top bar */
    .topbar{
      padding:14px 18px;
      border-bottom:1px solid var(--border);
      background: rgba(18,26,43,.75);
      backdrop-filter: blur(8px);
    }
    .topbar .row{ display:flex; gap:12px; align-items:center; justify-content:space-between; flex-wrap:wrap; }
    .brand{ display:flex; gap:10px; align-items:center; }
    .logo{
      width:34px;height:34px;border-radius:10px;
      background:linear-gradient(135deg,var(--blue),#22c55e);
      box-shadow:0 10px 22px rgba(0,0,0,.35);
    }
    .title{ font-weight:800; letter-spacing:.2px; }
    .subtitle{ color:var(--muted); font-size:13px; margin-top:2px; }

    .pills{ display:flex; gap:8px; flex-wrap:wrap; }
    .pill{
      display:inline-flex; padding:6px 10px; border-radius:999px;
      border:1px solid var(--border); background:var(--card2);
      color:var(--muted); font-size:12px;
    }

    /* Content area */
    .content{
      flex:1;
      display:grid;
      grid-template-columns: 320px 1fr;
      gap:14px;
      padding:14px 18px;
      overflow:hidden; /* important: no full-page scroll; inner panes scroll */
    }

    /* Left services menu */
    .side{
      border:1px solid var(--border);
      background:var(--card);
      border-radius:14px;
      padding:12px;
      overflow:auto;
      box-shadow: 0 10px 26px rgba(0,0,0,.25);
    }
    .side h3{ margin:4px 0 10px; font-size:14px; }
    .side .hint{ color:var(--muted); font-size:12px; margin-bottom:10px; }
    .svc{
      border:1px solid var(--border);
      background:var(--card2);
      border-radius:12px;
      padding:10px;
      margin-bottom:10px;
    }
    .svc .name{ font-weight:700; font-size:13px; }
    .svc .desc{ color:var(--muted); font-size:12px; margin-top:4px; line-height:1.35; }
    .tag{ display:inline-flex; margin-top:8px; font-size:11px; color:#b6c5df;
      border:1px solid var(--border); background:rgba(37,99,235,.10);
      padding:3px 8px; border-radius:999px;
    }

    /* Main */
    .main{
      overflow:auto;
      padding-right:4px;
    }
    .card{
      border:1px solid var(--border);
      background:var(--card);
      border-radius:14px;
      padding:14px;
      box-shadow: 0 10px 26px rgba(0,0,0,.25);
      margin-bottom:14px;
    }
    .hero{
      display:grid;
      grid-template-columns: 1.1fr .9fr;
      gap:14px;
      align-items:start;
    }
    .hero h1{ margin:0; font-size:22px; }
    .hero p{ margin:10px 0 0; color:var(--muted); line-height:1.5; }

    .btnRow{ display:flex; gap:10px; flex-wrap:wrap; margin-top:12px; }
    .btn{
      border:1px solid #2f3c5a; background:#1a2440; color:var(--text);
      padding:10px 12px; border-radius:12px; cursor:pointer;
    }
    .btn:hover{ background:#202c4f; }
    .btnPrimary{ background:var(--blue); border-color:var(--blue); }
    .btnPrimary:hover{ background:var(--blue2); }
    .btnDanger{ background:var(--danger); border-color:var(--danger); }
    .btnDanger:hover{ background:#991b1b; }

    .input{
      width:100%;
      padding:10px 12px;
      border-radius:12px;
      border:1px solid #2f3c5a;
      background:var(--card2);
      color:var(--text);
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono";
    }
    .muted{ color:var(--muted); }
    .mono{ font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono"; }
    .hr{ height:1px; background:var(--border); margin:12px 0; }

    .mailItem{
      border:1px solid var(--border);
      background:var(--card2);
      border-radius:12px;
      padding:12px;
      margin-bottom:10px;
      cursor:pointer;
    }
    .mailItem:hover{ border-color:#3b4a6d; }

    /* Toast */
    .toast{
      position:fixed;
      right:18px;
      top:18px;
      background:var(--card2);
      border:1px solid #2f3c5a;
      padding:10px 12px;
      border-radius:12px;
      z-index:50;
      box-shadow: 0 10px 26px rgba(0,0,0,.35);
    }

    /* Fixed bottom ad */
    .adbar{
      position:fixed;
      left:0; right:0; bottom:0;
      height:var(--adH);
      border-top:1px solid var(--border);
      background:#0a1020;
      display:flex;
      align-items:center;
      justify-content:center;
      z-index:60;
    }
    .adInner{
      width:min(1100px, 100%);
      padding:0 18px;
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:12px;
      color:var(--muted);
      font-size:13px;
    }
    .adBox{
      flex:1;
      height:64px;
      border:1px dashed #2f3c5a;
      border-radius:12px;
      display:flex;
      align-items:center;
      justify-content:center;
      color:#8ea2c6;
      background:rgba(18,26,43,.35);
    }

    @media (max-width: 980px){
      .content{ grid-template-columns: 1fr; }
      .hero{ grid-template-columns: 1fr; }
    }
  </style>
</head>

<body>
  <div x-data="emailApp()" x-init="init()">
    <template x-if="toast.show">
      <div class="toast" x-text="toast.text"></div>
    </template>

    <div class="page">
      <!-- Top bar -->
      <div class="topbar">
        <div class="row">
          <div class="brand">
            <div class="logo"></div>
            <div>
              <div class="title">AuthToolkit</div>
              <div class="subtitle">Privacy-first disposable inbox for testing & automation</div>
            </div>
          </div>

          <div class="pills">
            <span class="pill">✅ Privacy</span>
            <span class="pill">✅ No signup</span>
            <span class="pill">✅ Testing-ready</span>
            <span class="pill">✅ Micro-infrastructure</span>
          </div>
        </div>
      </div>

      <!-- Main content -->
      <div class="content">
        <!-- Left menu -->
        <aside class="side">
          <h3>Services (Roadmap)</h3>
          <div class="hint">We’re building a suite of micro-infrastructure tools for QA, auth testing, and privacy. These are shown here as a roadmap.</div>

          <div class="svc">
            <div class="name">Text-to-Verify Service</div>
            <div class="desc">Generate disposable inbox + verification flow for testing signup forms.</div>
            <span class="tag">Coming soon</span>
          </div>

          <div class="svc">
            <div class="name">OTP Testing Sandbox</div>
            <div class="desc">Simulate OTP verification, retries, throttling, and edge cases.</div>
            <span class="tag">Coming soon</span>
          </div>

          <div class="svc">
            <div class="name">Simple API Service</div>
            <div class="desc">Minimal endpoints for inbox creation, fetch, retention policies.</div>
            <span class="tag">Planned</span>
          </div>

          <div class="svc">
            <div class="name">Webhook Forwarding</div>
            <div class="desc">Forward received email/SMS events to your staging webhooks.</div>
            <span class="tag">Planned</span>
          </div>

          <div class="svc">
            <div class="name">Dedicated Inbox for Testing</div>
            <div class="desc">Stable inboxes with controls: retention, allowlist, API keys.</div>
            <span class="tag">Planned</span>
          </div>

          <div class="svc">
            <div class="name">Temp Phone Number</div>
            <div class="desc">Disposable numbers for signup testing and QA flows.</div>
            <span class="tag">Future</span>
          </div>

          <div class="svc">
            <div class="name">SMS OTP Capture</div>
            <div class="desc">Capture inbound OTPs and expose via API + webhook.</div>
            <span class="tag">Future</span>
          </div>

          <div class="svc">
            <div class="name">Generate OTP</div>
            <div class="desc">Generate time-based OTPs and verification simulators.</div>
            <span class="tag">Future</span>
          </div>

          <div class="svc">
            <div class="name">Simulate Email Delivery</div>
            <div class="desc">Deliverability simulations for staging and integration tests.</div>
            <span class="tag">Future</span>
          </div>

          <div class="svc">
            <div class="name">Simulate SMS Delivery</div>
            <div class="desc">Simulated SMS provider responses and failure modes.</div>
            <span class="tag">Future</span>
          </div>

          <div class="svc">
            <div class="name">API Access Service</div>
            <div class="desc">Keys, quotas, usage logs, and billing controls.</div>
            <span class="tag">Future</span>
          </div>

          <div class="svc">
            <div class="name">Metadata Remover for Images</div>
            <div class="desc">Strip EXIF/location metadata before sharing.</div>
            <span class="tag">Future</span>
          </div>
        </aside>

        <!-- Right main -->
        <main class="main">
          <!-- Hero + Inbox panel -->
          <div class="card hero">
            <!-- Hero copy (paste your previously built text here) -->
            <div>
              <h1>Private, disposable inboxes — built for testing.</h1>

              <!-- Replace this paragraph with your long copy from earlier threads -->
              <p>
                Use a temporary inbox to verify emails in staging, test signups, capture OTP links, and
                avoid leaking your real address. We don’t ask for your name. We don’t need your account.
                Create an inbox, copy it, and receive mail instantly.
              </p>

              <div class="btnRow">
                <button class="btn btnPrimary" @click="createInbox()">Create Inbox</button>
                <button class="btn" @click="fetchEmails()" :disabled="!inboxId">Refresh</button>
                <button class="btn btnDanger" @click="clearSession()" :disabled="!inboxId">Clear</button>
              </div>

              <div class="muted" style="font-size:12px; margin-top:10px;">
                Tip: This landing page is intentionally simple and fast. The services menu is our roadmap.
              </div>
            </div>

            <!-- Inbox box -->
            <div class="card" style="margin:0; background:var(--card2);">
              <div style="font-weight:800; margin-bottom:8px;">Your Inbox</div>

              <template x-if="!inboxId">
                <div class="muted" style="font-size:13px;">
                  No inbox yet. Click <b>Create Inbox</b> to generate an address.
                </div>
              </template>

              <template x-if="inboxId">
                <div>
                  <div class="muted" style="font-size:12px; margin-bottom:6px;">Email address</div>
                  <input class="input" readonly :value="currentEmail" />

                  <div class="btnRow" style="margin-top:10px;">
                    <button class="btn" @click="copyEmail()">Copy</button>
                    <span class="pill">Expires in <span class="mono" x-text="countdown"></span></span>
                  </div>

                  <div class="muted" style="font-size:12px; margin-top:10px;">
                    Session: <span class="mono" x-text="sessionId || '-'"></span>
                  </div>
                </div>
              </template>
            </div>
          </div>

          <!-- Mailbox -->
          <div class="card">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
              <div style="font-weight:800;">Mailbox</div>
              <div class="pill"><span x-text="emails.length"></span> messages</div>
            </div>

            <div class="hr"></div>

            <template x-if="!inboxId">
              <div class="muted">Create an inbox first to start receiving mail.</div>
            </template>

            <template x-if="inboxId">
              <div>
                <template x-for="m in emails" :key="m.id">
                  <div class="mailItem" @click="toggleOpen(m)">
                    <div style="display:flex; justify-content:space-between; gap:12px;">
                      <div style="font-weight:800;" x-text="m.subject || '(no subject)'"></div>
                      <div class="muted mono" style="font-size:12px;" x-text="formatTime(m.created_at)"></div>
                    </div>
                    <div class="muted" style="font-size:13px; margin-top:4px;">
                      From: <span class="mono" x-text="m.from_address || '-'"></span>
                    </div>

                    <template x-if="m._open">
                      <div style="margin-top:10px;">
                        <div class="hr"></div>
                        <div class="mono" style="white-space:pre-wrap; font-size:13px;" x-text="m.body || '(no body)'"></div>
                      </div>
                    </template>
                  </div>
                </template>

                <div class="muted" x-show="emails.length === 0">
                  No emails yet. Send a message to your inbox address above.
                </div>
              </div>
            </template>
          </div>
        </main>
      </div>
    </div>

    <!-- Fixed ad banner (always visible) -->
    <div class="adbar">
      <div class="adInner">
        <div class="muted">Ad</div>
        <div class="adBox">1" Fixed Banner Area (Google Ads later)</div>
        <div class="muted">Never disappears</div>
      </div>
    </div>
  </div>
</body>
</html>