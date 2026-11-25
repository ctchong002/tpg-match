(function () {
  var TPG = window.TPG, sb = TPG.sb, $ = function (i) { return document.getElementById(i); };
  function show(id) { ["boot", "login", "blocked", "app"].forEach(function (x) { $(x).hidden = x !== id; }); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function msg(id, t, ok) { var e = $(id); e.textContent = t || ""; e.className = "msg" + (ok ? " ok" : ""); }
  function errText(e) {
    var m = (e && (e.message || e.msg)) || String(e);
    if (/Database error saving new user|not authori[sz]ed|42501/i.test(m)) return "这个 email 没有被授权，请联系管理员。This email is not authorised.";
    if (/rate limit|too many|security purposes/i.test(m)) return "请求太频繁，请稍后再试。Too many requests, please wait and retry. (" + m + ")";
    return m;
  }

  // ---------- login ----------
  var email = "";
  $("f-email").addEventListener("submit", function (ev) {
    ev.preventDefault(); email = $("email").value.trim().toLowerCase(); msg("login-msg", "发送中… Sending…", true);
    sb.auth.signInWithOtp({ email: email, options: { shouldCreateUser: true, emailRedirectTo: location.origin + location.pathname } }).then(function (r) {
      if (r.error) return msg("login-msg", errText(r.error));
      $("sent-to").textContent = email; $("f-email").hidden = true; $("f-code").hidden = false; msg("login-msg", ""); $("code").focus();
    });
  });
  $("f-code").addEventListener("submit", function (ev) {
    ev.preventDefault(); msg("login-msg", "验证中… Verifying…", true);
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
        (a.role === "owner" ? "" : "<div style='margin-top:6px'><button class='btn sm " + (on ? "grey" : "") + "' data-toggle='" + esc(a.email) + "' data-to='" + (on ? "inactive" : "active") + "'>" + (on ? "设为 Inactive" : "恢复 Active") + "</button></div>") + "</div>";
    }).join("") || "<p class='muted'>没有资料</p>";
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
      if (r.error) return msg("agent-msg", /duplicate/i.test(r.error.message) ? "这个 email 已经在名单里。Already on the list." : errText(r.error));
      msg("agent-msg", "已添加 Added ✓ " + row.email, true); $("f-agent").reset(); loadAgents();
    });
  });

  // ---------- boot ----------
  sb.auth.onAuthStateChange(function (ev, session) { if (ev === "SIGNED_IN" && session) setTimeout(enter, 0); });
  sb.auth.getSession().then(function (r) { if (r.data.session) enter(); else show("login"); });
})();
