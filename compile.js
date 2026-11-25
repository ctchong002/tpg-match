// Shared by the import script (for verification) and the portal (browser).
// Turns self-contained DB records back into the exact data shape the existing search pages expect.
(function (root) {
  function Idx(init) { this.arr = []; this.map = new Map(); (init || []).forEach(v => this.get(v)); }
  Idx.prototype.get = function (v) { var k = JSON.stringify(v); if (!this.map.has(k)) { this.map.set(k, this.arr.length); this.arr.push(v); } return this.map.get(k); };

  // ---------- industry ----------
  function resolveIndustry(x, D) {
    var r = Object.assign({}, x); delete r.txt;
    r.a = D.areas[x.a] || ["?", ""];
    var G = D.meta.groups;
    r.ag = x.ag.map(a => [D.agents[a[0]] || ["", ""], a[1], G.filter((g, i) => a[2] & (1 << i))]);
    if (x.pp) { r.pp = {}; Object.keys(x.pp).forEach(k => r.pp[k] = x.pp[k].map(e => [e[0], D.agents[e[1]] || ["", ""], e[2]])); }
    return r;
  }
  function compileIndustry(lookups, rows) {
    var meta = JSON.parse(JSON.stringify(lookups.meta));
    var areas = new Idx(lookups.areas), agents = new Idx(), G = meta.groups;
    function gi(name) { var i = G.indexOf(name); if (i < 0) { G.push(name); i = G.length - 1; } return i; }
    var L = rows.map(function (row) {
      var r = Object.assign({}, row.rec);
      r.a = areas.get(r.a);
      r.ag = r.ag.map(a => [agents.get(a[0]), a[1], a[2].reduce((m, g) => m | (1 << gi(g)), 0)]);
      if (r.pp) { var pp = {}; Object.keys(r.pp).forEach(k => pp[k] = r.pp[k].map(e => [e[0], agents.get(e[1]), e[2]])); r.pp = pp; }
      r.txt = row.original_text || "";
      return r;
    });
    meta.count = L.length;
    return { meta: meta, areas: areas.arr, agents: agents.arr, L: L };
  }

  // ---------- residential ----------
  function resolveResidential(r, D) {
    var x = r.slice();
    x[2] = D.types[r[2]];
    x[17] = r[17] >= 0 ? D.areas[r[17]] : null;
    x[27] = (r[27] || []).map(i => D.areas[i]);
    x[19] = D.agents[r[19]] || ["", ""];
    x[21] = D.groups[r[21]];
    x[22] = (r[22] || []).map(a => [D.agents[a[0]] || ["", ""], a[1], D.groups[a[2]]]);
    return x;
  }
  function compileResidential(lookups, rows) {
    var meta = JSON.parse(JSON.stringify(lookups.meta));
    var types = new Idx(lookups.types), groups = new Idx(lookups.groups), areas = new Idx(lookups.areas), agents = new Idx();
    var RAW = [];
    var L = rows.map(function (row) {
      var x = row.rec.slice();
      x[2] = types.get(x[2]);
      x[17] = x[17] == null ? -1 : areas.get(x[17]);
      x[27] = (x[27] || []).map(a => areas.get(a));
      x[19] = agents.get(x[19]);
      x[21] = groups.get(x[21]);
      x[22] = (x[22] || []).map(a => [agents.get(a[0]), a[1], groups.get(a[2])]);
      RAW.push(row.original_text || "");
      return x;
    });
    meta.n = L.length;
    var LMC = {}; (lookups.lmc || []).forEach(id => LMC[id] = 1);
    return { RES: { meta: meta, types: types.arr, groups: groups.arr, areas: areas.arr, agents: agents.arr, L: L }, RAW: RAW, LMC: LMC };
  }

  var api = { resolveIndustry, compileIndustry, resolveResidential, compileResidential };
  if (typeof module !== "undefined") module.exports = api; else root.TPGCompile = api;
})(this);
