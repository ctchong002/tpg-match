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
  var pendingCheckin = new URLSearchParams(location.hash.split("?")[1]).get("checkin");
  if (/^#meeting[?]/.test(location.hash) && /^[\da-f-]{36}$/i.test(pendingCheckin || "")) {
    sessionStorage.setItem("tpg-checkin", pendingCheckin);
  }
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
  var started = false, myRole = "";
  function enter() {
    TPG.checkAccess().then(function (a) {
      if (!a || a.status !== "active") { TPG.clearCache(); show("blocked"); return; }
      if (started) return; started = true;
      myRole = a.role;
      $("a-role").disabled = myRole !== "owner";
      $("who").textContent = (a.full_name || a.email) + " · " + a.role;
      $("tab-agents").hidden = !(a.role === "owner" || a.role === "admin");
      $("tab-announce").hidden = !(a.role === "owner" || a.role === "admin" || a.role === "editor");
      if (a.role === "owner" && !$("a-role").querySelector("option[value='editor']")) {
        var opt = document.createElement("option"); opt.value = "editor"; opt.textContent = "Editor"; $("a-role").appendChild(opt);
      }
      show("app");
      var route = (location.hash || "#industry").slice(1).split("?");
      var params = new URLSearchParams(route[1]);
      var checkinToken = sessionStorage.getItem("tpg-checkin");
      sessionStorage.removeItem("tpg-checkin");
      if (checkinToken) openTab("meeting", null, checkinToken);
      else openTab(route[0], params.get("listing"), params.get("checkin"));
      refreshInboxBadge();
      sb.from("profiles").update({ last_seen_at: new Date().toISOString() }).eq("email", a.email).then(function () {});
    }).catch(function (e) { $("blocked-msg").textContent = errText(e); show("blocked"); });
  }

  // ---------- tabs ----------
  function openTab(t, listingId, checkinToken) {
    if (["industry", "residential", "matches", "meeting", "announcements", "agents"].indexOf(t) < 0
        || (t === "agents" && $("tab-agents").hidden)
        || (t === "announcements" && $("tab-announce").hidden)) t = "industry";
    [].forEach.call($("tabs").children, function (b) { b.classList.toggle("on", b.dataset.tab === t); });
    listingId = /^(industry|residential)$/.test(t) && /^\d+$/.test(listingId || "") ? listingId : null;
    ["industry", "residential"].forEach(function (c) {
      var frame = $("fr-" + c);
      frame.hidden = c !== t;
      if (c === t) {
        var source = c + "/" + (listingId ? "?listing=" + listingId : "");
        if (frame.getAttribute("src") !== source) frame.src = source;
      }
    });
    $("pane-meeting").hidden = t !== "meeting";
    if (t === "meeting") TPG.loadMeetingHub(checkinToken);
    else TPG.clearMeetingHub();
    $("pane-matches").hidden = t !== "matches"; $("pane-agents").hidden = t !== "agents";
    $("pane-announcements").hidden = t !== "announcements";
    if (t === "matches") loadMatches();
    if (t === "agents") loadAgents();
    if (t === "announcements" && TPG.loadAnnouncements) TPG.loadAnnouncements();
    history.replaceState(null, "", "#" + t + (listingId ? "?listing=" + listingId : ""));
  }
  TPG.openMeetingListing = openTab;
  $("tabs").addEventListener("click", function (e) { var b = e.target.closest("button[data-tab]"); if (b) openTab(b.dataset.tab); });

  // ---------- My Matches (matches.js) ----------
  function loadMatches() { if (TPG.loadMatches) TPG.loadMatches(); }

  // ---------- Agents (owner/admin) ----------
  var agents = [], editingAgent = null;
  function resetAgentForm() {
    editingAgent = null;
    $("f-agent").reset();
    $("a-email").readOnly = false;
    var own = $("a-role").querySelector("option[value='owner']"); if (own) own.remove();
    $("a-role").disabled = myRole !== "owner";
    if (myRole !== "owner") $("a-role").value = "agent";
    $("a-save").textContent = "Add";
    $("a-cancel").hidden = true;
    $("a-email-hint").hidden = true;
    msg("agent-msg", "");
  }
  function renderAgents() {
    var f = $("a-filter").value.trim().toLowerCase();
    $("agents").innerHTML = agents.filter(function (a) { return !f || (a.email + " " + (a.full_name || "")).toLowerCase().indexOf(f) >= 0; }).map(function (a) {
      var on = a.status === "active";
      var acts = "<button class='btn sm grey' data-edit='" + esc(a.email) + "'>Edit</button>";
      if (a.role !== "owner" && (myRole === "owner" || a.role === "agent")) {
        acts += "<button class='btn sm " + (on ? "grey" : "") + "' data-toggle='" + esc(a.email) + "' data-to='" + (on ? "inactive" : "active") + "'>" + (on ? "Set Inactive" : "Restore Active") + "</button>";
      }
      return "<div class='item'><div class='t'>" + esc(a.full_name || "-") + " <span class='tag'>" + a.role + "</span><span class='tag " + (on ? "" : "off") + "'>" + (on ? "active" : "inactive") + "</span></div>" +
        "<div class='muted'>" + esc(a.email) + (a.phone ? " · " + esc(a.phone) : "") + "</div>" +
        "<div class='acts' style='margin-top:6px'>" + acts + "</div></div>";
    }).join("") || "<p class='muted'>No agents yet.</p>";
  }
  function loadAgents() {
    sb.from("allowlist").select("email,full_name,phone,note,role,status,created_at").order("created_at").then(function (r) {
      if (r.error) return msg("agent-msg", errText(r.error)); agents = r.data; renderAgents();
    });
  }
  $("a-filter").addEventListener("input", renderAgents);
  $("a-cancel").addEventListener("click", resetAgentForm);
  $("agents").addEventListener("click", function (e) {
    var ed = e.target.closest("button[data-edit]");
    if (ed) {
      var a = agents.filter(function (x) { return x.email === ed.dataset.edit; })[0];
      if (!a) return;
      editingAgent = a;
      $("a-email").value = a.email;
      $("a-email").readOnly = true;
      $("a-name").value = a.full_name || "";
      $("a-phone").value = a.phone || "";
      $("a-note").value = a.note || "";
      var own = $("a-role").querySelector("option[value='owner']");
      if (a.role === "owner") {
        if (!own) { own = document.createElement("option"); own.value = "owner"; own.textContent = "Owner"; $("a-role").appendChild(own); }
      } else if (own) own.remove();
      $("a-role").value = a.role;
      $("a-role").disabled = myRole !== "owner" || a.role === "owner";
      $("a-save").textContent = "Save";
      $("a-cancel").hidden = false;
      $("a-email-hint").hidden = false;
      msg("agent-msg", "");
      $("f-agent").scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    var b = e.target.closest("button[data-toggle]"); if (!b) return;
    sb.from("allowlist").update({ status: b.dataset.to }).eq("email", b.dataset.toggle).then(function (r) { if (r.error) alert(errText(r.error)); loadAgents(); });
  });
  $("f-agent").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var name = $("a-name").value.trim() || null, phone = $("a-phone").value.trim() || null, note = $("a-note").value.trim() || null;
    if (editingAgent) {
      var patch = { full_name: name, phone: phone, note: note };
      if (myRole === "owner" && editingAgent.role !== "owner" && !$("a-role").disabled) patch.role = $("a-role").value;
      sb.from("allowlist").update(patch).eq("email", editingAgent.email).then(function (r) {
        if (r.error) return msg("agent-msg", errText(r.error));
        msg("agent-msg", "Updated ✓ " + editingAgent.email, true);
        resetAgentForm();
        loadAgents();
      });
      return;
    }
    var row = { email: $("a-email").value.trim().toLowerCase(), full_name: name, phone: phone, note: note, role: myRole === "owner" ? $("a-role").value : "agent" };
    sb.from("allowlist").insert(row).then(function (r) {
      if (r.error) return msg("agent-msg", /duplicate/i.test(r.error.message) ? "This email is already on the list." : errText(r.error));
      msg("agent-msg", "Added ✓ " + row.email, true); resetAgentForm(); loadAgents();
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
        (n.body ? "<div class='ann-body'>" + esc(n.body) + "</div>" : "") +
        "<small class='muted'>" + esc(whenTxt(n.created_at)) + "</small></div>";
    }).join("");
    [].forEach.call(el.querySelectorAll(".item"), function (item) {
      var body = item.querySelector(".ann-body");
      if (!body) return;
      var lh = parseFloat(window.getComputedStyle(body).lineHeight) || 21;
      if (body.scrollHeight <= lh * 12 + 4) return;
      body.classList.add("is-clamp");
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "link inbox-more";
      btn.setAttribute("data-expand", "");
      btn.textContent = "Show more";
      body.insertAdjacentElement("afterend", btn);
    });
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
  $("inbox").addEventListener("click", function (e) {
    var item = e.target.closest(".item"); if (!item) return;
    var body = item.querySelector(".ann-body");
    var btn = item.querySelector("[data-expand]");
    if (!body || !btn) return;
    if (!(e.target === btn || e.target === body || body.contains(e.target))) return;
    var open = body.classList.contains("is-clamp");
    body.classList.toggle("is-clamp", !open);
    btn.textContent = open ? "Show less" : "Show more";
  });
  $("inbox-btn").addEventListener("click", function (e) { e.stopPropagation(); if (inboxOpen) closeInbox(); else openInbox(); });
  $("inbox-close").addEventListener("click", closeInbox);
  $("inbox-backdrop").addEventListener("click", closeInbox);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeInbox(); });
  window.addEventListener("resize", function () { if (inboxOpen) placeInboxPanel(); });
  TPG.refreshInboxBadge = refreshInboxBadge;
  inboxTimer = setInterval(function () { if (!$("app").hidden) refreshInboxBadge(); }, 60000);

  // ---------- boot ----------
  sb.auth.onAuthStateChange(function (ev, session) { if (ev === "SIGNED_IN" && session) setTimeout(enter, 0); });
  sb.auth.getSession().then(function (r) { if (r.data.session) enter(); else show("login"); });
})();
