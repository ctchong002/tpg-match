// Announcements tab: owner / admin / editor compose a notice that lands in every agent's Inbox.
// Emailing all agents is intentionally not wired up (Resend free tier is reserved for match alerts).
(function () {
  var TPG = window.TPG, sb = TPG.sb, $ = function (i) { return document.getElementById(i); };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function msg(t, ok) { var e = $("ann-msg"); e.textContent = t || ""; e.className = "msg" + (ok ? " ok" : ""); }
  function errText(e) { return (e && (e.message || e.msg)) || String(e); }
  function whenTxt(iso) {
    try { return new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Kuala_Lumpur", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }); }
    catch (e) { return iso; }
  }

  var items = [], editing = null;

  function renderPreview() {
    var title = $("ann-title").value.trim(), body = $("ann-body").value;
    var el = $("ann-preview");
    if (!title && !body.trim()) { el.innerHTML = "<p class='muted'>The preview will appear here.</p>"; return; }
    el.innerHTML = "<h3>" + esc(title || "(Untitled)") + "</h3>" +
      (body.trim() ? "<p class='ann-body'>" + esc(body) + "</p>" : "<p class='muted'>No message body.</p>");
  }
  $("ann-title").addEventListener("input", renderPreview);
  $("ann-body").addEventListener("input", renderPreview);

  function resetForm() {
    editing = null;
    $("f-ann").reset();
    $("ann-send").textContent = "Send to All";
    $("ann-cancel").hidden = true;
    renderPreview();
    msg("");
  }
  $("ann-cancel").addEventListener("click", resetForm);

  function loadList() {
    return sb.from("announcements").select("id,title,body,audience,created_at").eq("audience", "all").order("created_at", { ascending: false }).limit(100).then(function (r) {
      if (r.error) { $("ann-list").innerHTML = "<p class='msg'>" + esc(errText(r.error)) + "</p>"; return; }
      items = r.data || [];
      if (!items.length) { $("ann-list").innerHTML = "<p class='empty-note'>No announcements yet.</p>"; return; }
      $("ann-list").innerHTML = items.map(function (a) {
        return "<div class='item'><div class='t'>" + esc(a.title || "(Untitled)") + "</div>" +
          (a.body ? "<div class='ann-body'>" + esc(a.body) + "</div>" : "") +
          "<small class='muted'>" + esc(whenTxt(a.created_at)) + "</small>" +
          "<div class='acts'><button class='btn sm grey' data-edit='" + a.id + "'>Edit</button>" +
          "<button class='btn sm red' data-del='" + a.id + "'>Delete</button></div></div>";
      }).join("");
    });
  }

  $("ann-list").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    if (b.dataset.del) {
      if (!confirm("Delete this notice? It will disappear from everyone’s Inbox.")) return;
      sb.from("announcements").delete().eq("id", b.dataset.del).then(function (r) {
        if (r.error) return msg(errText(r.error));
        if (editing && String(editing) === String(b.dataset.del)) resetForm();
        msg("Deleted.", true); loadList(); if (TPG.refreshInboxBadge) TPG.refreshInboxBadge();
      });
    }
    if (b.dataset.edit) {
      var a = items.filter(function (x) { return String(x.id) === String(b.dataset.edit); })[0];
      if (!a) return;
      editing = a.id;
      $("ann-title").value = a.title || "";
      $("ann-body").value = a.body || "";
      $("ann-send").textContent = "Update";
      $("ann-cancel").hidden = false;
      renderPreview();
      $("f-ann").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });

  $("f-ann").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var title = $("ann-title").value.trim(), body = $("ann-body").value.trim() || null;
    if (!title) return msg("Please enter a title.");
    if (!editing && !confirm("Send this notice to all agents? It will appear in everyone’s Inbox.")) return;
    var row = { title: title, body: body, audience: "all", kind: "broadcast" };
    msg(editing ? "Saving…" : "Sending…", true);
    var q = editing ? sb.from("announcements").update({ title: title, body: body }).eq("id", editing)
                    : sb.from("announcements").insert(row);
    q.then(function (r) {
      if (r.error) return msg(errText(r.error));
      msg(editing ? "Updated ✓" : "Sent ✓  It is now in everyone’s Inbox.", true);
      resetForm();
      loadList();
      if (TPG.refreshInboxBadge) TPG.refreshInboxBadge();
    });
  });

  TPG.loadAnnouncements = function () { renderPreview(); return loadList(); };
})();
