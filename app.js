(function () {
  var TPG = window.TPG, sb = TPG.sb, $ = function (i) { return document.getElementById(i); };
  function show(id) { ["boot", "login", "blocked", "app"].forEach(function (x) { $(x).hidden = x !== id; }); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function msg(id, t, ok) { var e = $(id); e.textContent = t || ""; e.className = "msg" + (ok ? " ok" : ""); }
  function errText(e) {
    var m = (e && (e.message || e.msg)) || String(e);
    if (/Database error saving new user|not authori[sz]ed|42501/i.test(m)) return "This email is not authorised. Please contact an admin.";
    if (/rate limit|too many|security purposes/i.test(m)) return "Too many requests. Please wait and try again. (" + m + ")";
    return m;
  }

  // ---------- login ----------
  var email = "";
  $("f-email").addEventListener("submit", function (ev) {
    ev.preventDefault(); email = $("email").value.trim().toLowerCase(); msg("login-msg", "Sending…", true);
    sb.auth.signInWithOtp({ email: email, options: { shouldCreateUser: true, emailRedirectTo: location.origin + location.pathname } }).then(function (r) {
      if (r.error) return msg("login-msg", errText(r.error));
      $("sent-to").textContent = email; $("f-email").hidden = true; $("f-code").hidden = false; msg("login-msg", ""); $("code").focus();
    });
  });
  $("f-code").addEventListener("submit", function (ev) {
    ev.preventDefault(); msg("login-msg", "Verifying…", true);
    sb.auth.verifyOtp({ email: email, token: $("code").value.trim(), type: "email" }).then(function (r) {
      if (r.error) return msg("login-msg", errText(r.error));
      msg("login-msg", ""); enter();
    });
  });
  $("back").addEventListener("click", function () { $("f-email").hidden = false; $("f-code").hidden = true; msg("login-msg", ""); });
  $("out").addEventListener("click", TPG.signOut); $("out2").addEventListener("click", TPG.signOut);

  // ---------- after login ----------
  var started = false;
  function enter() {
    TPG.checkAccess().then(function (a) {
      if (!a || a.status !== "active") { TPG.clearCache(); show("blocked"); return; }
      if (started) return; started = true;
      $("who").textContent = (a.full_name || a.email) + " · " + a.role;
      $("tab-agents").hidden = !(a.role === "owner" || a.role === "admin");
      show("app");
      openTab((location.hash || "#industry").slice(1));
      refreshInboxBadge();
      sb.from("profiles").update({ last_seen_at: new Date().toISOString() }).eq("email", a.email).then(function () {});
    }).catch(function (e) { $("blocked-msg").textContent = errText(e); show("blocked"); });
  }

  // ---------- tabs ----------
  function openTab(t) {
    if (["industry", "residential", "matches", "agents"].indexOf(t) < 0 || (t === "agents" && $("tab-agents").hidden)) t = "industry";
    [].forEach.call($("tabs").children, function (b) { b.classList.toggle("on", b.dataset.tab === t); });
    ["industry", "residential"].forEach(function (c) { var f = $("fr-" + c); f.hidden = c !== t; if (c === t && !f.src) f.src = c + "/"; });
    $("pane-matches").hidden = t !== "matches"; $("pane-agents").hidden = t !== "agents";
    if (t === "matches") loadMatches();
    if (t === "agents") loadAgents();
    history.replaceState(null, "", "#" + t);
  }
  $("tabs").addEventListener("click", function (e) { var b = e.target.closest("button[data-tab]"); if (b) openTab(b.dataset.tab); });

  // ---------- My Matches (matches.js) ----------
  function loadMatches() { if (TPG.loadMatches) TPG.loadMatches(); }

  // ---------- Agents (owner/admin) ----------
  var agents = [];
  function renderAgents() {
    var f = $("a-filter").value.trim().toLowerCase();
    $("agents").innerHTML = agents.filter(function (a) { return !f || (a.email + " " + (a.full_name || "")).toLowerCase().indexOf(f) >= 0; }).map(function (a) {
      var on = a.status === "active";
      return "<div class='item'><div class='t'>" + esc(a.full_name || "-") + " <span class='tag'>" + a.role + "</span><span class='tag " + (on ? "" : "off") + "'>" + (on ? "active" : "inactive") + "</span></div>" +
        "<div class='muted'>" + esc(a.email) + (a.phone ? " · " + esc(a.phone) : "") + "</div>" +
        (a.role === "owner" ? "" : "<div style='margin-top:6px'><button class='btn sm " + (on ? "grey" : "") + "' data-toggle='" + esc(a.email) + "' data-to='" + (on ? "inactive" : "active") + "'>" + (on ? "Set Inactive" : "Restore Active") + "</button></div>") + "</div>";
    }).join("") || "<p class='muted'>No agents yet.</p>";
  }
  function loadAgents() {
    sb.from("allowlist").select("email,full_name,phone,role,status,created_at").order("created_at").then(function (r) {
      if (r.error) return msg("agent-msg", errText(r.error)); agents = r.data; renderAgents();
    });
  }
  $("a-filter").addEventListener("input", renderAgents);
  $("agents").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-toggle]"); if (!b) return;
    sb.from("allowlist").update({ status: b.dataset.to }).eq("email", b.dataset.toggle).then(function (r) { if (r.error) alert(errText(r.error)); loadAgents(); });
  });
  $("f-agent").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var row = { email: $("a-email").value.trim().toLowerCase(), full_name: $("a-name").value.trim() || null, phone: $("a-phone").value.trim() || null, role: $("a-role").value };
    sb.from("allowlist").insert(row).then(function (r) {
      if (r.error) return msg("agent-msg", /duplicate/i.test(r.error.message) ? "This email is already on the list." : errText(r.error));
      msg("agent-msg", "Added ✓ " + row.email, true); $("f-agent").reset(); loadAgents();
    });
  });


  // ---------- header inbox (match alerts + company announcements) ----------
  var inboxOpen = false, inboxTimer = null, inboxItems = [];
  var KIND_LAB = { match_digest: "Match", broadcast: "Notice", expiry_reminder: "Reminder", system: "System" };
  function setBadge(n) {
    var b = $("inbox-badge");
    if (!b) return;
    if (n > 0) { b.hidden = false; b.textContent = n > 99 ? "99+" : String(n); }
    else { b.hidden = true; b.textContent = ""; }
    $("inbox-btn").setAttribute("aria-label", n > 0 ? ("Inbox, " + n + " unread") : "Inbox");
  }
  function whenTxt(iso) {
    try { return new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Kuala_Lumpur", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }); }
    catch (e) { return iso; }
  }
  function renderInbox() {
    var el = $("inbox");
    if (!inboxItems.length) { el.innerHTML = "<p class='empty-note'>No notifications yet.</p>"; return; }
    el.innerHTML = inboxItems.map(function (n) {
      var kind = KIND_LAB[n.kind] || n.kind || "";
      return "<div class='item" + (n.read_at ? "" : " unread") + "'><div class='t'>" +
        (kind ? "<span class='tag kind'>" + esc(kind) + "</span>" : "") +
        esc(n.title || "") + "</div>" +
        (n.body ? "<div class='muted'>" + esc(n.body) + "</div>" : "") +
        "<small class='muted'>" + esc(whenTxt(n.created_at)) + "</small></div>";
    }).join("");
  }
  function refreshInboxBadge() {
    return sb.rpc("my_inbox_unread").then(function (r) {
      if (r.error) return;
      var n = r.data;
      if (Array.isArray(n)) n = n[0] && (n[0].my_inbox_unread != null ? n[0].my_inbox_unread : n[0]);
      setBadge(n == null || n === "" ? 0 : +n);
    });
  }
  function loadInboxPanel() {
    return sb.rpc("my_inbox", { p_limit: 50 }).then(function (r) {
      if (r.error) { $("inbox").innerHTML = "<p class='msg'>" + esc(errText(r.error)) + "</p>"; return; }
      inboxItems = r.data || [];
      renderInbox();
      var unread = inboxItems.filter(function (n) { return !n.read_at; }).length;
      if (!unread) { setBadge(0); return; }
      return sb.rpc("mark_inbox_read").then(function (m) {
        if (m.error) return;
        inboxItems.forEach(function (n) { if (!n.read_at) n.read_at = new Date().toISOString(); });
        renderInbox();
        setBadge(0);
      });
    });
  }
  function placeInboxPanel() {
    var panel = $("inbox-panel"), btn = $("inbox-btn");
    if (window.innerWidth < 760) { panel.style.top = ""; panel.style.right = ""; return; }
    var r = btn.getBoundingClientRect();
    panel.style.top = Math.round(r.bottom + 6) + "px";
    panel.style.right = Math.round(Math.max(8, window.innerWidth - r.right)) + "px";
  }
  function closeInbox() {
    if (!inboxOpen) return;
    inboxOpen = false;
    $("inbox-panel").hidden = true;
    $("inbox-backdrop").hidden = true;
    $("inbox-btn").setAttribute("aria-expanded", "false");
  }
  function openInbox() {
    inboxOpen = true;
    $("inbox-backdrop").hidden = false;
    $("inbox-panel").hidden = false;
    $("inbox-btn").setAttribute("aria-expanded", "true");
    placeInboxPanel();
    loadInboxPanel();
    $("inbox-close").focus();
  }
  $("inbox-btn").addEventListener("click", function (e) { e.stopPropagation(); if (inboxOpen) closeInbox(); else openInbox(); });
  $("inbox-close").addEventListener("click", closeInbox);
  $("inbox-backdrop").addEventListener("click", closeInbox);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeInbox(); });
  window.addEventListener("resize", function () { if (inboxOpen) placeInboxPanel(); });
  inboxTimer = setInterval(function () { if (!$("app").hidden) refreshInboxBadge(); }, 60000);

  // ---------- boot ----------
  sb.auth.onAuthStateChange(function (ev, session) { if (ev === "SIGNED_IN" && session) setTimeout(enter, 0); });
  sb.auth.getSession().then(function (r) { if (r.data.session) enter(); else show("login"); });
})();
