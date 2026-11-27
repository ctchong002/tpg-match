(function () {
  var TPG = window.TPG;
  var panel = document.getElementById("meeting-checkin");
  var token = null, version = 0, refreshTimer, notice = "";
  var activeScanner = null, decoderPromise;
  var tokenPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  var dateTime = new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kuala_Lumpur"
  });
  var checkinTime = new Intl.DateTimeFormat("en-MY", {
    hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true, timeZone: "Asia/Kuala_Lumpur"
  });
  var dateOnly = new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium", timeZone: "Asia/Kuala_Lumpur"
  });

  function element(tag, text, style) {
    var node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (style) node.className = style;
    return node;
  }

  function action(label, fn) {
    var button = element("button", label, "btn sm");
    button.type = "button";
    button.addEventListener("click", fn);
    return button;
  }

  function showSummary(data) {
    var summary = data.summary;
    var metrics = [
      ["Team meetings", data.team_total],
      ["My expected meetings", summary.total],
      ["Attended", summary.attended],
      ["Absent", summary.missed],
      ["Attendance rate", summary.percent == null ? "—" : summary.percent + "%"]
    ];
    var heading = element("h3", "My attendance");
    var grid = element("dl", null, "attendance-metrics");
    metrics.forEach(function (metric) {
      var card = element("div", null, "item");
      card.append(element("dt", metric[0]), element("dd", metric[1]));
      grid.appendChild(card);
    });
    panel.append(heading, grid, element("p",
      "Only closed meetings where you were on the active roster count in your attendance rate.", "muted"));

    panel.appendChild(element("h3", "Recent meetings"));
    if (!data.history.length) {
      panel.appendChild(element("p", "Your check-in history will appear here.", "muted"));
      return;
    }
    var history = element("ul", null, "attendance-history");
    data.history.forEach(function (row) {
      var item = element("li", null, "item");
      var state = row.checked_in_at ? "Attended · " + dateTime.format(new Date(row.checked_in_at))
        : Date.parse(row.closes_at) <= Date.now() ? "Absent" : "Check-in open";
      item.append(element("strong", row.title), element("div",
        dateOnly.format(new Date(row.meeting_day + "T00:00:00+08:00")) + " · " + state, "muted"));
      history.appendChild(item);
    });
    panel.appendChild(history);
  }

  function checkinURL(value) {
    var url = new URL(location.pathname, location.origin);
    url.hash = "meeting?checkin=" + encodeURIComponent(value);
    return url.href;
  }

  function loadDecoder() {
    if (!decoderPromise) {
      decoderPromise = new Promise(function (resolve, reject) {
        var script = document.createElement("script");
        script.src = "./meeting-qr-reader.js?v=1.4.0";
        script.onload = function () {
          if (typeof window.jsQR === "function") resolve(window.jsQR);
          else reject(new Error("QR decoder unavailable"));
        };
        script.onerror = function () { reject(new Error("QR decoder unavailable")); };
        document.head.appendChild(script);
      }).catch(function (error) {
        decoderPromise = null;
        throw error;
      });
    }
    return decoderPromise;
  }

  function stopScanner() {
    if (!activeScanner) return;
    var scanner = activeScanner;
    activeScanner = null;
    cancelAnimationFrame(scanner.frame);
    scanner.feedback.textContent = "";
    if (scanner.stream) scanner.stream.getTracks().forEach(function (track) { track.stop(); });
    scanner.video.srcObject = null;
    scanner.camera.remove();
    scanner.button.disabled = false;
  }

  function readCheckinToken(raw) {
    try {
      var url = new URL(raw);
      var home = new URL("./", location.href);
      if (url.origin !== home.origin || url.username || url.password ||
          (url.pathname !== home.pathname && url.pathname !== home.pathname + "index.html") ||
          !url.hash.startsWith("#meeting?")) return null;
      var value = new URLSearchParams(url.hash.slice("#meeting?".length)).get("checkin");
      return value === "weekly" || tokenPattern.test(value || "") ? value : null;
    } catch (_) {
      return null;
    }
  }

  async function openScanner(button, container, feedback) {
    if (activeScanner) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      feedback.textContent = "Camera access is unavailable here. Use your phone’s Camera app to scan the meeting QR.";
      return;
    }

    var camera = element("div", null, "checkin-camera");
    var video = element("video");
    video.autoplay = video.muted = video.playsInline = true;
    video.setAttribute("aria-label", "QR scanner camera preview");
    var cancel = action("Close camera", function () {
      stopScanner();
      button.focus();
    });
    camera.append(video, cancel);
    container.appendChild(camera);
    button.disabled = true;
    cancel.focus();
    feedback.textContent = "Opening camera…";
    var scanner = { button: button, camera: camera, video: video, feedback: feedback, stream: null, frame: 0 };
    activeScanner = scanner;

    try {
      var stream = await navigator.mediaDevices.getUserMedia({
        audio: false, video: { facingMode: { ideal: "environment" } }
      });
      if (activeScanner !== scanner) {
        stream.getTracks().forEach(function (track) { track.stop(); });
        return;
      }
      scanner.stream = stream;
      video.srcObject = stream;
      var ready = await Promise.all([loadDecoder(), video.play()]);
      if (activeScanner !== scanner) return;

      var decode = ready[0];
      var canvas = document.createElement("canvas");
      var context = canvas.getContext("2d", { willReadFrequently: true });
      var previous = -150;
      feedback.textContent = "Point your camera at the meeting QR.";
      function scanFrame(now) {
        if (activeScanner !== scanner) return;
        if (video.readyState >= 2 && video.videoWidth && now - previous >= 150) {
          previous = now;
          var scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
          var width = Math.round(video.videoWidth * scale);
          var height = Math.round(video.videoHeight * scale);
          if (canvas.width !== width) canvas.width = width;
          if (canvas.height !== height) canvas.height = height;
          context.drawImage(video, 0, 0, width, height);
          var pixels = context.getImageData(0, 0, width, height);
          var code = decode(pixels.data, width, height, { inversionAttempts: "dontInvert" });
          if (code) {
            var scannedToken = readCheckinToken(code.data);
            if (scannedToken) {
              stopScanner();
              token = scannedToken;
              load();
              return;
            }
            feedback.textContent = "Use the TPG meeting QR at the meeting entrance.";
          }
        }
        scanner.frame = requestAnimationFrame(scanFrame);
      }
      scanner.frame = requestAnimationFrame(scanFrame);
    } catch (error) {
      if (activeScanner !== scanner) return;
      stopScanner();
      feedback.textContent = error.name === "NotAllowedError"
        ? "Camera access was blocked. Allow the camera in your browser settings or scan with your phone’s Camera app."
        : "Could not start the QR scanner. Use your phone’s Camera app to scan the meeting QR.";
      button.focus();
    }
  }

  function showScanner() {
    var container = element("div", null, "item checkin-scan");
    var feedback = element("p", "", "msg");
    feedback.setAttribute("role", "status");
    var button = action("Scan QR", function () { openScanner(button, container, feedback); });
    container.append(button, element("p", "Scan the QR at the meeting entrance.", "muted"), feedback);
    panel.appendChild(container);
    return button;
  }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden && activeScanner) stopScanner();
  });
  window.addEventListener("pagehide", stopScanner);

  function makeQR(link) {
    var qr = new window.TPGMeetingQR(-1, 0); // QR error correction level M.
    qr.addData(link);
    qr.make();
    var count = qr.getModuleCount(), margin = 4, size = 6;
    var canvas = element("canvas", null, "attendance-qr");
    canvas.width = canvas.height = (count + margin * 2) * size;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "Scan this QR code to check in");
    var context = canvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#000";
    for (var row = 0; row < count; row++) {
      for (var col = 0; col < count; col++) {
        if (qr.isDark(row, col)) context.fillRect((col + margin) * size, (row + margin) * size, size, size);
      }
    }
    return canvas;
  }

  function downloadReport(report) {
    var rows = [
      ["Meeting date", report.day], ["Expected accounts", report.expected],
      ["Late", report.late], ["Absent", report.absent], ["Total (RM) to review", report.total_rm], [],
      ["Name", "Account", "Status", "Check-in time (MYT)", "Amount (RM) to review"]
    ];
    report.exceptions.forEach(function (row) {
      rows.push([row.name, row.email, row.status,
        row.checked_in_at ? checkinTime.format(new Date(row.checked_in_at)) : "", row.fine]);
    });
    var csv = rows.map(function (row) {
      return row.map(function (value) {
        var field = String(value);
        if (typeof value === "string" && (/^\s*[=+@-]/.test(field) || /^[\t\r\n]/.test(field))) field = "'" + field;
        return '"' + field.replaceAll('"', '""') + '"';
      }).join(",");
    }).join("\r\n");
    var url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    var link = element("a");
    link.href = url;
    link.download = "TPG-Check-in-" + report.day + ".csv";
    link.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function showAdmin(current) {
    var host = element("section", null, "item attendance-host");
    var door = element("details");
    var qr = makeQR(checkinURL("weekly"));
    var file = element("a", "Download door QR (PNG)", "btn sm");
    file.download = "TPG-Tuesday-Check-in-QR.png";
    file.href = qr.toDataURL("image/png");
    door.append(element("summary", "Permanent door QR"), qr, file);
    host.append(door, element("h3", "Tuesday attendance report"));
    var content = element("div");
    var feedback = element("p", "", "msg");
    feedback.setAttribute("role", "status");
    host.append(feedback, content);
    panel.appendChild(host);

    async function showReport(day) {
      feedback.textContent = "Loading…";
      try {
        var response = await TPG.sb.rpc("weekly_checkin_report", { p_day: day });
        if (current !== version) return;
        if (response.error) throw response.error;
        var data = response.data;
        var report = data.report;
        content.replaceChildren();
        feedback.textContent = "";
        if (!report) {
          content.appendChild(element("p", "The report is available after Tuesday at 12:00 PM (Malaysia time).", "muted"));
          return;
        }
        var label = element("label", "Meeting date ");
        var dates = element("select");
        data.dates.forEach(function (day) {
          var option = element("option", dateOnly.format(new Date(day + "T00:00:00+08:00")));
          option.value = day;
          dates.appendChild(option);
        });
        dates.value = report.day;
        dates.addEventListener("change", function () {
          dates.disabled = true;
          showReport(dates.value).finally(function () { dates.disabled = false; });
        });
        label.appendChild(dates);
        content.append(label, element("p", report.expected + " expected accounts · " +
          report.late + " late · " + report.absent + " absent · RM " + report.total_rm + " to review"));
        var list = element("ul", null, "attendance-history");
        report.exceptions.forEach(function (row) {
          var time = row.checked_in_at ? " · " + checkinTime.format(new Date(row.checked_in_at)) : "";
          list.appendChild(element("li", row.name + " · " + row.status + time + " · RM " + row.fine));
        });
        content.append(list, action("Download CSV for Excel", function () { downloadReport(report); }));
      } catch (_) {
        if (current === version) feedback.textContent = "Could not load the report.";
      }
    }
    host.appendChild(action("Refresh attendance", load));
    showReport(null);
  }

  async function submitScannedCode(current, feedback) {
    if (!token) return;
    feedback.textContent = "Checking in…";
    try {
      var response = token === "weekly"
        ? await TPG.sb.rpc("submit_weekly_checkin")
        : await TPG.sb.rpc("submit_meeting_checkin", { p_token: token });
      if (current !== version) return;
      if (response.error) throw response.error;
      token = null;
      var result = response.data;
      if (result.status === "checked_in" || result.status === "already_checked_in") {
        notice = checkinTime.format(new Date(result.at));
      } else {
        notice = result.status === "closed" ? "This meeting's check-in has closed." :
          "Check-in is unavailable for this account or code.";
      }
    } catch (_) {
      if (current !== version) return;
      token = null;
      notice = "Could not confirm check-in. Scan the meeting QR again if it is still open.";
    }
    feedback.textContent = notice;
  }

  async function load() {
    var current = ++version;
    clearTimeout(refreshTimer);
    stopScanner();
    panel.replaceChildren();
    var feedback = element("p", notice, "msg");
    feedback.setAttribute("role", "status");
    panel.appendChild(feedback);
    var scanButton = showScanner();
    scanButton.disabled = Boolean(token);
    await submitScannedCode(current, feedback);
    if (current !== version) return;
    if (!activeScanner) scanButton.disabled = false;
    try {
      var response = await TPG.sb.rpc("my_meeting_attendance");
      if (current !== version) return;
      if (response.error) throw response.error;
      showSummary(response.data);
      if (TPG.access && ["owner", "admin"].includes(TPG.access.role)) showAdmin(current);
      var expires = response.data.host_session?.closes_at || response.data.history[0]?.closes_at;
      var remaining = Date.parse(expires) - Date.now();
      if (remaining > 0) refreshTimer = setTimeout(function () {
        if (!panel.querySelector("button:disabled")) load();
      }, remaining + 250);
    } catch (_) {
      if (current === version) {
        feedback.textContent = notice ? notice + " Attendance could not be loaded." : "Attendance could not be loaded.";
        panel.appendChild(action("Retry loading attendance", load));
      }
    }
  }

  TPG.checkin = {
    load: load,
    useToken: function (value) {
      token = value === "weekly" || tokenPattern.test(value || "") ? value : null;
    },
    clear: function () {
      ++version;
      clearTimeout(refreshTimer);
      stopScanner();
      token = null;
      notice = "";
      panel.replaceChildren();
    }
  };
})();
