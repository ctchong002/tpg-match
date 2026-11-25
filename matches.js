// My Matches tab: WTB/WTR requirement form (strict matching), my requirements, my matches, inbox.
(function () {
  var TPG = window.TPG, sb = TPG.sb, $ = function (i) { return document.getElementById(i); };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function msg(t, ok) { var e = $("req-msg"); e.textContent = t || ""; e.className = "msg" + (ok ? " ok" : ""); }
  function errText(e) { return (e && (e.message || e.msg)) || String(e); }
  var AC = 43560;
  function fmt(v) { return Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 }); }
  function money(v) { if (v == null) return ""; v = +v; return v >= 1e6 ? "RM" + fmt(Math.round(v / 1e4) / 100) + "mil" : v >= 1e4 ? "RM" + fmt(Math.round(v / 100) / 10) + "k" : "RM" + fmt(v); }
  function landTxt(v) { return v >= AC ? fmt(Math.round(v / AC * 100) / 100) + " acre" : fmt(v) + " sf"; }
  function rng(a, b, f) { return a == null && b == null ? "" : a == null ? "≤ " + f(b) : b == null ? "≥ " + f(a) : f(a) + " – " + f(b); }
  var ZON = { L: "轻工业 Light", M: "中工业 Medium", H: "重工业 Heavy" }, FUR = { F: "全家私 Fully", P: "半家私 Partly", B: "空屋 Bare" },
      LOT = { N: "Non-Bumi", B: "Bumi lot" }, TEN = { freehold: "Freehold", leasehold: "Leasehold" },
      TYP = { Highrise: "Highrise 高楼", Landed: "Landed 有地", Industry: "Industry 工业", Commercial: "Commercial 商业", Land: "Land 地皮", "Business Takeover": "Business Takeover 生意出顶" };

  var st = { kind: "WTR", cat: "industry", types: [], areas: [], zon: [], fur: [], lot: [], editing: null };
  var opts = {};   // category -> {types, areas}
  function getOpts(cat) {
    if (opts[cat]) return Promise.resolve(opts[cat]);
    return sb.rpc("match_options", { p_category: cat }).then(function (r) { if (r.error) throw r.error; return (opts[cat] = r.data); });
  }

  // ---------- form rendering ----------
  function seg(id, val) { [].forEach.call($(id).children, function (b) { b.classList.toggle("on", b.dataset.v === val); }); }
  function chipsHtml(list, sel, label) {
    return list.map(function (o) { var v = o.v || o, lab = o.label || (label ? label[v] || v : v); return "<button type='button' class='chip" + (sel.indexOf(v) >= 0 ? " on" : "") + "' data-v='" + esc(v) + "'>" + esc(lab) + (o.n ? "<small>" + o.n + "</small>" : "") + "</button>"; }).join("");
  }
  function renderForm() {
    seg("r-kind", st.kind); seg("r-cat", st.cat);
    var ind = st.cat === "industry";
    $("fs-ind").hidden = !ind; $("fs-res").hidden = ind;
    $("l-price").firstElementChild.textContent = st.kind === "WTR" ? "月租 Monthly rent (RM)" : "售价 Sale price (RM)";
    $("r-zon").innerHTML = chipsHtml(["L", "M", "H"], st.zon, ZON);
    $("r-fur").innerHTML = chipsHtml(["F", "P", "B"], st.fur, FUR);
    $("r-lot").innerHTML = chipsHtml(["N", "B"], st.lot, LOT);
    $("r-areas-sel").innerHTML = st.areas.map(function (a) { return "<button type='button' class='chip on x' data-v='" + esc(a) + "'>" + esc(a) + "</button>"; }).join("") || "<span class='muted' style='font-size:13px'>还没选 none yet</span>";
    $("r-types").innerHTML = "<span class='muted'>载入中… loading</span>";
    getOpts(st.cat).then(function (o) {
      $("r-types").innerHTML = chipsHtml(o.types, st.types);
      renderSug();
    }).catch(function (e) { $("r-types").innerHTML = "<span class='msg'>" + esc(errText(e)) + "</span>"; });
  }
  function renderSug() {
    var o = opts[st.cat]; if (!o) return;
    var q = $("r-area-q").value.trim().toLowerCase();
    var list = o.areas.filter(function (a) { return st.areas.indexOf(a.v) < 0 && (!q || a.v.toLowerCase().indexOf(q) >= 0); });
    if (!q) list = list.slice().sort(function (a, b) { return b.n - a.n; });
    $("r-area-sug").innerHTML = list.slice(0, 40).map(function (a) { return "<button type='button' data-v='" + esc(a.v) + "'><span>" + esc(a.v) + "</span><small>" + a.n + " 盘</small></button>"; }).join("") || "<div class='muted' style='padding:8px 10px;font-size:13px'>没有这个地区 No such area</div>";
  }
  function toggle(arr, v) { var i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); }

  $("r-kind").addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) { st.kind = b.dataset.v; renderForm(); } });
  $("r-cat").addEventListener("click", function (e) { var b = e.target.closest("button"); if (b && b.dataset.v !== st.cat) { st.cat = b.dataset.v; st.types = []; st.areas = []; renderForm(); } });
  $("r-types").addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) { toggle(st.types, b.dataset.v); b.classList.toggle("on"); } });
  [["r-zon", "zon"], ["r-fur", "fur"], ["r-lot", "lot"]].forEach(function (p) {
    $(p[0]).addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) { toggle(st[p[1]], b.dataset.v); b.classList.toggle("on"); } });
  });
  $("r-area-q").addEventListener("input", renderSug);
  $("r-area-q").addEventListener("focus", function () { $("r-area-sug").hidden = false; renderSug(); });
  $("r-area-sug").addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; st.areas.push(b.dataset.v); $("r-area-q").value = ""; renderForm(); });
  $("r-areas-sel").addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; toggle(st.areas, b.dataset.v); renderForm(); });

  function num(id) { var v = $(id).value.trim(); return v === "" ? null : +v; }
  function landVal(id) { var v = num(id); return v == null ? null : $("r-lunit").value === "acre" ? Math.round(v * AC) : v; }
  function resetForm() {
    $("f-req").reset(); st.types = []; st.areas = []; st.zon = []; st.fur = []; st.lot = []; st.editing = null;
    $("req-save").textContent = "保存 Save"; $("req-cancel").hidden = true; $("new-req-title").textContent = "➕ 新增需求 New requirement"; renderForm();
  }
  $("req-cancel").addEventListener("click", function () { resetForm(); msg(""); });
  $("f-req").addEventListener("submit", function (ev) {
    ev.preventDefault();
    if (!st.types.length) return msg("请至少选一个物业类型 Choose at least one property type");
    if (!st.areas.length) return msg("请至少选一个地区 Choose at least one area");
    var ind = st.cat === "industry";
    var row = { kind: st.kind, category: st.cat, title: $("r-title").value.trim() || null, property_types: st.types.slice(), areas: st.areas.slice(),
      price_min: num("r-pmin"), price_max: num("r-pmax"), built_up_min: num("r-bmin"), built_up_max: num("r-bmax"),
      land_min: landVal("r-lmin"), land_max: landVal("r-lmax"), client_note: $("r-note").value.trim() || null,
      power_min: ind ? num("r-amp") : null, ceiling_min_m: ind ? num("r-ceil") : null, ceiling_min_ft: null, floor_load_min: ind ? num("r-fl") : null,
      zonings: ind ? st.zon.slice() : [], tenure: (ind ? $("r-ten-i").value : $("r-ten-r").value) || null,
      bedrooms_min: !ind && $("r-bed").value !== "" ? +$("r-bed").value : null, furnishings: ind ? [] : st.fur.slice(), lot_types: ind ? [] : st.lot.slice() };
    if ([row.price_min, row.price_max, row.built_up_min, row.built_up_max, row.land_min, row.land_max].some(function (v) { return v != null && (isNaN(v) || v < 0); })) return msg("数字不对 Invalid number");
    msg("保存中… Saving…", true);
    var q = st.editing ? sb.from("requirements").update(row).eq("id", st.editing) : sb.from("requirements").insert(row);
    q.then(function (r) {
      if (r.error) return msg(errText(r.error));
      msg(st.editing ? "已更新 Updated ✓" : "已保存 Saved ✓ 有新盘符合就会 email 你", true); resetForm(); loadReqs();
    });
  });

  // ---------- my requirements ----------
  var reqs = [], matchCount = {};
  function crit(q) {
    var rent = q.kind === "WTR", p = [q.property_types.map(function (t) { return TYP[t] || t; }).join(" / "), q.areas.join(", ")];
    var pr = rng(q.price_min, q.price_max, money); if (pr) p.push((rent ? "月租 " : "价钱 ") + pr);
    var bu = rng(q.built_up_min, q.built_up_max, fmt); if (bu) p.push("BU " + bu + " sf");
    var ld = rng(q.land_min, q.land_max, landTxt); if (ld) p.push("Land Area " + ld);
    if (q.power_min != null) p.push("≥ " + fmt(q.power_min) + "A");
    if (q.ceiling_min_m != null) p.push("Ceiling ≥ " + fmt(q.ceiling_min_m) + "m");
    if (q.floor_load_min != null) p.push("Floor ≥ " + fmt(q.floor_load_min) + "kN/m²");
    if (q.zonings && q.zonings.length) p.push(q.zonings.map(function (z) { return ZON[z]; }).join("/"));
    if (q.tenure) p.push(TEN[q.tenure]);
    if (q.bedrooms_min != null) p.push(q.bedrooms_min === 0 ? "Studio+" : "≥ " + q.bedrooms_min + " 房");
    if (q.furnishings && q.furnishings.length) p.push(q.furnishings.map(function (z) { return FUR[z]; }).join("/"));
    if (q.lot_types && q.lot_types.length) p.push(q.lot_types.map(function (z) { return LOT[z]; }).join("/"));
    return p.filter(Boolean).join(" · ");
  }
  function loadReqs() {
    return sb.auth.getSession().then(function (s) {
      var uid = s.data.session && s.data.session.user.id;
      return sb.from("requirements").select("*").eq("owner_id", uid).order("created_at", { ascending: false });
    }).then(function (r) {
      if (r.error) { $("reqs").innerHTML = "<p class='msg'>" + esc(errText(r.error)) + "</p>"; return; }
      reqs = r.data;
      if (!reqs.length) { $("reqs").innerHTML = "<p class='muted'>还没有需求，在下面新增一个。No requirements yet.</p>"; return; }
      $("reqs").innerHTML = reqs.map(function (q) {
        var dl = Math.ceil((new Date(q.expires_at) - Date.now()) / 864e5), off = q.status !== "active" || dl <= 0;
        var badge = q.status === "active" && dl > 0 ? "剩 " + dl + " 天" : q.status === "paused" ? "暂停 paused" : "已过期 expired";
        return "<div class='item req'><div class='t'><span class='tag'>" + q.kind + "</span><span class='tag'>" + (q.category === "industry" ? "工厂" : "住宅") + "</span>" + esc(q.title || "(无标题)") +
          " <span class='tag " + (off ? "off" : dl <= 5 ? "warn" : "") + "'>" + badge + "</span>" + (matchCount[q.id] ? " <span class='tag'>✨ " + matchCount[q.id] + " 配对</span>" : "") + "</div>" +
          "<div class='crit'>" + esc(crit(q)) + "</div>" + (q.client_note ? "<div><small>📝 " + esc(q.client_note) + "</small></div>" : "") +
          "<div class='acts'><button class='btn sm' data-renew='" + q.id + "'>续 30 天 Renew</button><button class='btn sm grey' data-edit='" + q.id + "'>修改 Edit</button><button class='btn sm red' data-del='" + q.id + "'>删除 Delete</button></div></div>";
      }).join("");
    });
  }
  $("reqs").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    if (b.dataset.del && confirm("删除这个需求？Delete this requirement?")) sb.from("requirements").delete().eq("id", b.dataset.del).then(loadReqs);
    if (b.dataset.renew) sb.from("requirements").update({ status: "active", expires_at: new Date(Date.now() + 30 * 864e5).toISOString() }).eq("id", b.dataset.renew).then(function (r) { if (r.error) alert(errText(r.error)); loadReqs(); });
    if (b.dataset.edit) {
      var q = reqs.filter(function (x) { return x.id === b.dataset.edit; })[0]; if (!q) return;
      st.kind = q.kind; st.cat = q.category; st.types = q.property_types.slice(); st.areas = q.areas.slice();
      st.zon = (q.zonings || []).slice(); st.fur = (q.furnishings || []).slice(); st.lot = (q.lot_types || []).slice(); st.editing = q.id;
      var set = function (id, v) { $(id).value = v == null ? "" : v; };
      set("r-title", q.title); set("r-pmin", q.price_min); set("r-pmax", q.price_max); set("r-bmin", q.built_up_min); set("r-bmax", q.built_up_max);
      $("r-lunit").value = "sf"; set("r-lmin", q.land_min); set("r-lmax", q.land_max); set("r-amp", q.power_min); set("r-ceil", q.ceiling_min_m != null ? q.ceiling_min_m : (q.ceiling_min_ft != null ? Math.round(q.ceiling_min_ft * 0.3048 * 10) / 10 : null)); set("r-fl", q.floor_load_min);
      set("r-ten-i", q.tenure); set("r-ten-r", q.tenure); set("r-bed", q.bedrooms_min); set("r-note", q.client_note);
      $("req-save").textContent = "更新 Update"; $("req-cancel").hidden = false; $("new-req-title").textContent = "✏️ 修改需求 Edit requirement";
      $("new-req-box").open = true; renderForm(); $("new-req-box").scrollIntoView({ behavior: "smooth" });
    }
  });

  // ---------- matches + inbox ----------
  function specs(l) {
    var s = [];
    if (l.built_up) s.push("BU " + fmt(l.built_up) + " sf"); if (l.land) s.push("Land Area " + landTxt(l.land));
    if (l.amp) s.push(fmt(l.amp) + "A"); var cm = l.ceiling_m != null ? l.ceiling_m : (l.ceiling_ft != null ? Math.round(l.ceiling_ft * 0.3048 * 10) / 10 : null); if (cm) s.push("Ceiling " + fmt(cm) + "m"); if (l.floor_load) s.push(fmt(l.floor_load) + "kN/m²");
    if (l.zoning) s.push(ZON[l.zoning]); if (l.bedrooms != null) s.push(l.bedrooms === 0 ? "Studio" : l.bedrooms + " 房");
    if (l.furnishing) s.push(FUR[l.furnishing]); if (l.tenure) s.push(TEN[l.tenure]); if (l.lot_type) s.push(LOT[l.lot_type]);
    return s.join(" · ");
  }
  function wa(p) { var d = String(p || "").replace(/\D/g, ""); return d ? (d.indexOf("60") === 0 ? d : d.charAt(0) === "0" ? "6" + d : "60" + d) : ""; }
  function loadMatchList() {
    return sb.rpc("my_matches", { p_limit: 100 }).then(function (r) {
      if (r.error) { $("match-list").innerHTML = "<p class='msg'>" + esc(errText(r.error)) + "</p>"; return; }
      matchCount = {}; (r.data || []).forEach(function (m) { matchCount[m.requirement_id] = (matchCount[m.requirement_id] || 0) + 1; });
      if (!r.data.length) { $("match-list").innerHTML = "<p class='muted'>还没有配对。每次资料更新后，库里以前没有的新盘完全符合你的需求，就会出现在这里并 email 给你。<br>No matches yet.</p>"; return; }
      $("match-list").innerHTML = r.data.map(function (m) {
        var l = m.listing, ph = wa(l.agent_phone), pr = m.req_kind === "WTR" ? (l.price_rent ? "租 " + money(l.price_rent) + "/月" : "") : (l.price_sale ? "卖 " + money(l.price_sale) : "");
        return "<div class='item mcard'><div class='t'>" + esc(l.type || "") + " · " + esc(l.area || "") + (l.deleted ? " <span class='tag off'>已下架 removed</span>" : "") + "</div>" +
          "<div class='p'>" + esc(pr) + "</div><div class='sp'>" + esc(specs(l)) + "</div>" +
          "<div class='sp'>👤 " + esc(l.agent_name || "-") + (ph ? " · " + esc(l.agent_phone) + " <a class='wa' target='_blank' rel='noopener' href='https://wa.me/" + ph + "'>WhatsApp</a>" : "") + "</div>" +
          "<div class='sp muted'>🎯 " + esc(m.req_title || m.req_kind) + " · " + new Date(m.created_at).toLocaleDateString() + " · " + esc(l.src_id) + "</div>" +
          (l.text ? "<details><summary>原帖 Original post</summary><pre>" + esc(l.text) + "</pre></details>" : "") + "</div>";
      }).join("");
    });
  }
  function loadInbox() {
    sb.from("notifications").select("id,kind,title,body,created_at,read_at").order("created_at", { ascending: false }).limit(30).then(function (r) {
      if (r.error || !r.data.length) return;
      $("inbox").innerHTML = r.data.map(function (n) { return "<div class='item'><div class='t'>" + (n.read_at ? "" : "🔵 ") + esc(n.title) + "</div><div class='muted'>" + esc(n.body) + "</div><small class='muted'>" + new Date(n.created_at).toLocaleString() + "</small></div>"; }).join("");
      var unread = r.data.filter(function (n) { return !n.read_at; }).map(function (n) { return n.id; });
      if (unread.length) sb.from("notifications").update({ read_at: new Date().toISOString() }).in("id", unread).then(function () {});
    });
  }
  var formReady = false;
  TPG.loadMatches = function () {
    if (!formReady) { formReady = true; renderForm(); }
    loadInbox(); loadMatchList().then(loadReqs, loadReqs);
  };
})();
