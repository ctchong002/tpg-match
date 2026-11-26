(function () {
  var TPG = window.TPG;
  var panel = document.getElementById("meeting-checkin");
  var token = null, version = 0, refreshTimer, notice = "";
  var dateTime = new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kuala_Lumpur"
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

  async function perform(button, rpc, params, onSuccess, fallback) {
    var current = version;
    clearTimeout(refreshTimer);
    button.disabled = true;
    try {
      var response = await TPG.sb.rpc(rpc, params);
      if (current !== version) return;
      if (response.error) {
        notice = response.error.code === "23505" ? "A check-in session already exists for today. Refresh to see it." : fallback;
      } else {
        notice = onSuccess(response.data);
      }
      await load();
    } catch (_) {
      if (current === version) panel.prepend(element("p", fallback, "msg"));
    } finally {
      button.disabled = false;
    }
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
    panel.append(element("p", "To check in, scan the QR code displayed by your meeting host.", "muted"), heading, grid, element("p",
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

  function showHost(session) {
    var host = element("section", null, "item attendance-host");
    host.appendChild(element("h3", "Host check-in"));
    if (!session) {
      var form = element("form", null, "attendance-host-form");
      var title = element("label", "Meeting title");
      var titleInput = element("input");
      titleInput.value = "Weekly Team Meeting";
      titleInput.maxLength = 120;
      titleInput.required = true;
      title.appendChild(titleInput);
      var duration = element("label", "Open for (minutes)");
      var durationInput = element("input");
      Object.assign(durationInput, { type: "number", required: true, min: 5, max: 60, value: 15 });
      duration.appendChild(durationInput);
      var open = element("button", "Open check-in", "btn sm");
      open.type = "submit";
      form.append(title, duration, open);
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        perform(open, "open_meeting_checkin", { p_title: titleInput.value.trim(), p_minutes: durationInput.valueAsNumber },
          function () { return "Check-in is open."; }, "Could not open check-in. Try refreshing.");
      });
      host.appendChild(form);
    } else {
      var checkedIn = session.roster.filter(function (member) { return member.checked_in_at; }).length;
      host.append(element("strong", session.title),
        element("p", checkedIn + " of " + session.roster.length + " checked in", "muted"));
      if (session.token) {
        var link = checkinURL(session.token);
        host.append(element("p", "Open until " + dateTime.format(new Date(session.closes_at)), "muted"), makeQR(link));
        host.append(action("Close check-in", function (event) {
          perform(event.currentTarget, "close_meeting_checkin", { p_session: session.id },
            function () { return "Check-in closed."; }, "Could not close check-in.");
        }));
      } else {
        host.appendChild(element("p", "Check-in closed", "muted"));
      }
      var roster = element("details");
      roster.appendChild(element("summary", "View today's roster"));
      var list = element("ul", null, "attendance-history");
      session.roster.forEach(function (member) {
        var row = element("li");
        var state = member.checked_in_at ? dateTime.format(new Date(member.checked_in_at))
          : session.token ? "Waiting" : "Absent";
        row.textContent = member.name + " · " + state;
        list.appendChild(row);
      });
      roster.appendChild(list);
      host.appendChild(roster);
    }
    host.appendChild(action("Refresh attendance", load));
    panel.appendChild(host);
  }

  async function submitScannedCode(current, feedback) {
    if (!token) return;
    feedback.textContent = "Checking in…";
    try {
      var response = await TPG.sb.rpc("submit_meeting_checkin", { p_token: token });
      if (current !== version) return;
      if (response.error) throw response.error;
      token = null;
      var result = response.data;
      if (result.status === "checked_in" || result.status === "already_checked_in") {
        notice = (result.status === "checked_in" ? "Checked in · " : "Already checked in · ") +
          dateTime.format(new Date(result.at));
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
    panel.replaceChildren();
    var feedback = element("p", notice, "msg");
    feedback.setAttribute("role", "status");
    panel.appendChild(feedback);
    await submitScannedCode(current, feedback);
    if (current !== version) return;
    try {
      var response = await TPG.sb.rpc("my_meeting_attendance");
      if (current !== version) return;
      if (response.error) throw response.error;
      showSummary(response.data);
      if (TPG.access && ["owner", "admin"].includes(TPG.access.role)) showHost(response.data.host_session);
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
      token = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value) ? value : null;
    },
    clear: function () {
      ++version;
      clearTimeout(refreshTimer);
      token = null;
      notice = "";
      panel.replaceChildren();
    }
  };
})();
