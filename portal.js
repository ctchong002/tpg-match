// TPG Pillar's AI portal core: auth, access check, cached incremental listing sync.
(function () {
  var C = window.TPG_CONFIG;
  var sb = window.supabase.createClient(C.url, C.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" }
  });
  var TPG = window.TPG = { sb: sb, access: null, data: {} };

  // ---------- tiny IndexedDB cache (per device; wiped on logout / inactive) ----------
  var DBN = "tpg-match-cache";
  function idb() { return new Promise(function (res, rej) { var r = indexedDB.open(DBN, 1);
    r.onupgradeneeded = function () { r.result.createObjectStore("kv"); }; r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); }
  function kvGet(k) { return idb().then(function (db) { return new Promise(function (res) { var q = db.transaction("kv").objectStore("kv").get(k); q.onsuccess = function () { res(q.result); }; q.onerror = function () { res(undefined); }; }); }).catch(function () { return undefined; }); }
  function kvSet(k, v) { return idb().then(function (db) { return new Promise(function (res) { var t = db.transaction("kv", "readwrite"); t.objectStore("kv").put(v, k); t.oncomplete = res; t.onerror = res; }); }).catch(function () {}); }
  TPG.clearCache = function () { TPG.data = {}; return new Promise(function (res) { var r = indexedDB.deleteDatabase(DBN); r.onsuccess = r.onerror = r.onblocked = function () { res(); }; }); };

  TPG.checkAccess = function () {
    return sb.rpc("my_access").then(function (r) {
      if (r.error) throw r.error;
      TPG.access = (r.data && r.data[0]) || null;
      return TPG.access;
    });
  };

  // ---------- incremental sync ----------
  function syncCategory(cat, progress) {
    var key = "cat:" + cat;
    return Promise.all([kvGet(key), sb.from("listing_catalogs").select("lookups,version,updated_at").eq("category", cat).single()])
      .then(function (a) {
        var cache = a[0], cr = a[1];
        if (cr.error) throw cr.error;
        if (!cache || !cache.rows) cache = { rows: {}, since: null, afterId: 0 };
        var full = !cache.since;
        function page(since, afterId, n) {
          return sb.rpc("listing_sync", { p_category: cat, p_since: since, p_after_id: afterId, p_limit: 1000 }).then(function (r) {
            if (r.error) throw r.error;
            var rows = r.data || [];
            rows.forEach(function (x) {
              if (x.deleted) delete cache.rows[x.id];
              else cache.rows[x.id] = { id: x.id, rec: x.rec, original_text: x.original_text };
              if (!cache.maxTs || x.updated_at > cache.maxTs || (x.updated_at === cache.maxTs && x.id > cache.maxId)) { cache.maxTs = x.updated_at; cache.maxId = x.id; }
            });
            n += rows.length; progress && progress(cat, n);
            if (rows.length === 1000) {
              var last = rows[rows.length - 1];
              return full ? page(null, last.id, n) : page(last.updated_at, last.id, n);
            }
          });
        }
        return page(cache.since, cache.afterId, 0).then(function () {
          if (cache.maxTs) { cache.since = cache.maxTs; cache.afterId = cache.maxId; }
          return kvSet(key, cache).then(function () { return { lookups: cr.data.lookups, version: cr.data.version, rows: cache.rows }; });
        });
      });
  }

  // returns compiled data in the exact shape the original search pages use
  TPG.getData = function (cat, progress) {
    if (TPG.data[cat]) return TPG.data[cat];
    var p = syncCategory(cat, progress).then(function (d) {
      var rows = Object.keys(d.rows).map(function (k) { return d.rows[k]; }).sort(function (a, b) { return a.id - b.id; });
      var result = cat === "industry" ? { FDATA: TPGCompile.compileIndustry(d.lookups, rows) } : TPGCompile.compileResidential(d.lookups, rows);
      result.listingIds = rows.map(function (row) { return String(row.id); });
      return result;
    });
    p.catch(function () { delete TPG.data[cat]; });
    return (TPG.data[cat] = p);
  };

  TPG.signOut = function () { return TPG.clearCache().then(function () { return sb.auth.signOut(); }).then(function () { location.reload(); }); };
})();
