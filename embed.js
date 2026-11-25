// Used inside /industry/ and /residential/: gets data from the portal (parent window), then starts the original page script.
(function () {
  var cat = document.currentScript.getAttribute("data-cat");
  document.documentElement.classList.add("in-portal");
  if (document.body) document.body.classList.add("in-portal");
  var P = null; try { P = window.parent !== window && window.parent.TPG ? window.parent.TPG : null; } catch (e) {}
  if (!P) { location.replace("../#" + cat); return; }
  var cover = document.getElementById("cover");
  function start() { var s = document.createElement("script"); s.textContent = document.getElementById("app").textContent; document.body.appendChild(s); }
  P.getData(cat, function (c, n) { if (cover) cover.textContent = "Loading… " + n.toLocaleString("en-US"); }).then(function (d) {
    Object.keys(d).forEach(function (k) { window[k] = d[k]; });
    start();
  }).catch(function (e) {
    if (cover) cover.textContent = "Data failed to load: " + (e && e.message || e);
  });
})();
