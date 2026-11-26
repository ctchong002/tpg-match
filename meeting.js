(function () {
  var TPG = window.TPG, sb = TPG.sb;
  var $ = function (id) { return document.getElementById(id); };
  var form = $("meeting-form"), results = $("meeting-results"), filters = $("meeting-filters");
  var bucket = sb.storage.from("meeting-hub-posters");
  var formats = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  var statusLabels = { unconfirmed: "Availability unconfirmed", available: "Confirmed available", closed: "Closed" };
  var section = "stock", rows = [], minutes = [], generation = 0, listingSearch = 0, saving = false;
  var posterURLs = new Set();
  var awardTypes = [["Top 5", "Top Sales · Top 5"], ["Rookie", "Top Rookies · Top 5"],
    ["Project Performance", "Project Performance"]];
  var posterDialog = $("meeting-poster-dialog");

  function monthLabel(month) {
    return new Intl.DateTimeFormat("en-MY", { month: "long", year: "numeric", timeZone: "UTC" })
      .format(new Date(month + "-01T00:00:00Z"));
  }

  function staff() {
    return TPG.access && ["owner", "admin", "editor"].includes(TPG.access.role) && TPG.access.status === "active";
  }

  function el(tag, content, className) {
    var node = document.createElement(tag);
    if (content != null) node.textContent = content;
    if (className) node.className = className;
    return node;
  }

  function button(text, fn) {
    var node = el("button", text, "btn sm");
    node.type = "button";
    node.addEventListener("click", fn);
    return node;
  }

  function message(text) { $("meeting-message").textContent = text; }
  function today() { return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Kuala_Lumpur" }); }

  function field(label, name, type, options) {
    var wrapper = el("label", label), input = el(type === "textarea" || type === "select" ? type : "input");
    input.name = name;
    if (input.tagName === "INPUT") input.type = type;
    if (options) options.forEach(function (choice) { input.add(new Option(choice[1], choice[0])); });
    wrapper.appendChild(input);
    return wrapper;
  }

  function value(name) { return form.elements[name].value.trim(); }

  function clearPosters() {
    if (posterDialog.open) posterDialog.close();
    posterDialog.querySelector("img").removeAttribute("src");
    posterURLs.forEach(function (url) { URL.revokeObjectURL(url); });
    posterURLs.clear();
  }

  function makeFilters() {
    filters.replaceChildren();
    if (section === "stock") {
      filters.append(field("Search listing or recommendation", "search", "search"), field("Status", "status", "select",
        [["", "All active and unconfirmed"], ["available", "Confirmed available"], ["unconfirmed", "Unconfirmed"], ["closed", "Closed"]]));
    } else {
      var months = Array.from(new Set(rows.map(function (r) { return r.event_date.slice(0, 7); })));
      var choices = months.map(function (m) { return [m, monthLabel(m)]; });
      if (section !== "awards" || !choices.length) choices.unshift(["", "All months"]);
      filters.appendChild(field("Month", "month", "select", choices));
      if (section === "awards" && months.length) filters.querySelector("select").value = months[0];
    }
  }

  function openListing(row) { TPG.openMeetingListing(row.listing_category, row.listing_id); }

  function render() {
    clearPosters();
    results.replaceChildren();
    var search = (filters.querySelector("[name='search']")?.value || "").toLowerCase().trim();
    var status = filters.querySelector("[name='status']")?.value;
    var month = filters.querySelector("[name='month']")?.value;
    var visible = rows.filter(function (r) {
      if (section === "stock") {
        return (!search || (r.title + " " + r.body).toLowerCase().includes(search))
          && (status ? r.stock_status === status : r.stock_status !== "closed");
      }
      return !month || r.event_date.startsWith(month);
    });
    results.classList.toggle("meeting-awards-grid", section === "awards" && visible.length > 0);
    if (section === "awards") {
      var order = awardTypes.map(function (type) { return type[0]; });
      visible.sort(function (a, b) { return order.indexOf(a.award_type) - order.indexOf(b.award_type); });
    }
    if (!visible.length) results.appendChild(el("p", "No entries to show.", "muted"));
    visible.forEach(function (row) {
      var card = el("article", null, "item meeting-entry");
      var title = section === "awards"
        ? (awardTypes.find(function (type) { return type[0] === row.award_type; }) || [null, row.award_type])[1]
        : row.title;
      card.append(el("h3", title, "t"), el("p", section === "awards" ? monthLabel(row.event_date.slice(0, 7)) : row.event_date, "muted"));
      if (row.body) card.appendChild(el("p", row.body, "meeting-copy"));
      if (row.kind === "stock") {
        var bits = [statusLabels[row.stock_status]];
        if (row.meeting_price) bits.push("Meeting price: " + row.meeting_price);
        if (row.checked_on) bits.push("Last checked: " + row.checked_on);
        card.append(el("p", bits.join(" · "), "muted"), button("Open listing", function () { openListing(row); }));
        if (staff()) {
          var statusField = field("Update status", "new-status", "select", Object.entries(statusLabels));
          statusField.querySelector("select").value = row.stock_status;
          var saveStatus = button("Save status", async function () {
            saveStatus.disabled = true;
            var response = await sb.from("meeting_hub_entries").update({
              stock_status: statusField.querySelector("select").value, checked_on: today()
            }).eq("id", row.id).select("id").single();
            saveStatus.disabled = false;
            if (response.error) message("Status could not be saved. Check your access and try again.");
            else load();
          });
          var statusTools = el("div", null, "meeting-fields");
          statusTools.append(statusField, saveStatus);
          card.appendChild(statusTools);
        }
      } else if (row.kind === "minutes") {
        (row.stocks || []).forEach(function (stock) {
          card.appendChild(button("AAA Stock · " + stock.title, function () { openListing(stock); }));
        });
      } else {
        var loadNote = el("p", "Loading poster…", "muted");
        card.appendChild(loadNote);
        function loadPoster() {
          bucket.download(row.poster_path).then(function (response) {
            if (!card.isConnected) return;
            if (response.error) {
              loadNote.replaceChildren(button("Retry poster", loadPoster));
              return;
            }
            var url = URL.createObjectURL(response.data);
            posterURLs.add(url);
            var trigger = el("button", null, "meeting-poster-trigger");
            trigger.type = "button";
            trigger.setAttribute("aria-label", "Enlarge " + row.title);
            var thumbnail = el("img", null, "meeting-poster");
            thumbnail.alt = row.title;
            thumbnail.src = url;
            trigger.appendChild(thumbnail);
            trigger.addEventListener("click", function () {
              $("meeting-poster-title").textContent = row.title;
              var large = posterDialog.querySelector("img");
              large.alt = row.title;
              large.src = url;
              posterDialog.showModal();
            });
            loadNote.replaceWith(trigger);
          });
        }
        loadPoster();
      }
      results.appendChild(card);
    });
  }

  async function findListings() {
    var current = ++listingSearch;
    var cat = value("listing_category"), target = form.elements.listing_id;
    var query = value("listing_search").toLowerCase();
    target.replaceChildren(new Option("Loading listings…", ""));
    try {
      var data = await TPG.getData(cat);
      if (current !== listingSearch) return;
      var catalog = data.FDATA || data.RES;
      var words = query.split(/\s+/);
      var choices = [];
      catalog.L.some(function (row, index) {
        var area = catalog.areas[data.FDATA ? row.a : row[17]];
        if (Array.isArray(area)) area = area.filter(Boolean).join(" ");
        var heading = data.FDATA ? [area, row.loc].filter(Boolean).join(" · ") : (row[18] || area || "Residential");
        var details = data.FDATA ? [row.t, row.bu ? row.bu + " sf BU" : "", row.amp ? row.amp + "A" : ""]
          : [catalog.types[row[2]], row[14] ? "Sale RM" + row[14] : "", row[15] ? "Rent RM" + row[15] : ""];
        var label = [heading].concat(details.filter(Boolean)).join(" · ");
        if (words.every(function (word) { return label.toLowerCase().includes(word); })) {
          choices.push(new Option(label + " · #" + data.listingIds[index], data.listingIds[index]));
        }
        return choices.length >= 30;
      });
      target.replaceChildren(new Option(choices.length ? "Select a listing" : "No listings found", ""), ...choices);
    } catch (_) {
      if (current === listingSearch) target.replaceChildren(new Option("Listings could not be loaded", ""));
    }
  }

  function makeForm() {
    ++listingSearch;
    form.replaceChildren();
    if (!staff()) return;
    var title = field("Title", "title", "text");
    title.querySelector("input").required = true;
    title.querySelector("input").maxLength = 160;
    var date = field(section === "awards" ? "Award month" : "Meeting date", "event_date", section === "awards" ? "month" : "date");
    date.querySelector("input").value = section === "awards" ? today().slice(0, 7) : today();
    date.querySelector("input").required = true;
    form.append(title, date);
    if (section !== "awards") {
      var body = field(section === "stock" ? "Why this listing is recommended" : "Decisions and follow-up", "body", "textarea");
      body.querySelector("textarea").maxLength = 12000;
      const requireBody = body.querySelector("textarea");
      requireBody.required = true;
      form.appendChild(body);
    }
    if (section === "stock") {
      var search = field("Find existing listing", "listing_search", "search");
      var picker = field("Listing", "listing_id", "select", [["", "Search to select a listing"]]);
      picker.querySelector("select").required = true;
      var category = field("Listing category", "listing_category", "select", [["industry", "Industry"], ["residential", "Residential"]]);
      function resetPicker() {
        ++listingSearch;
        form.elements.listing_id.replaceChildren(new Option("Search to select a listing", ""));
      }
      search.querySelector("input").addEventListener("input", resetPicker);
      category.querySelector("select").addEventListener("change", resetPicker);
      var price = field("Price shared at the meeting", "meeting_price", "text");
      price.querySelector("input").maxLength = 100;
      form.append(category, search, button("Find listings", findListings), picker, price,
        field("Link to Meeting Minutes", "meeting_id", "select", [["", "Select later / none"]].concat(minutes.map(function (m) {
          return [m.id, m.event_date + " · " + m.title];
        }))));
    } else if (section === "awards") {
      var poster = field("Poster (JPG, PNG or WebP, up to 5 MB)", "poster", "file");
      poster.querySelector("input").accept = Object.keys(formats).join(",");
      poster.querySelector("input").required = true;
      form.append(field("Award", "award_type", "select", awardTypes), poster, field("Source or update note (optional)", "award_note", "text"));
    }
    var publish = el("button", "Publish", "btn");
    publish.type = "submit";
    form.appendChild(publish);
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (saving || !staff()) return;
    var current = generation;
    var row = { kind: section, title: value("title"), event_date: value("event_date"), body: "" };
    if (section !== "awards") {
      row.body = value("body");
      if (!row.body) return message("Enter the meeting notes or recommendation.");
    }
    if (section === "stock") {
      row.meeting_id = value("meeting_id") || null;
      row.meeting_price = value("meeting_price") || null;
      row.listing_category = value("listing_category");
      row.listing_id = value("listing_id");
      row.stock_status = "unconfirmed";
    }
    var image;
    if (section === "awards") {
      row.event_date += "-01";
      row.award_type = value("award_type");
      row.body = value("award_note");
      image = form.elements.poster.files[0];
      if (!image || !(image.type in formats) || image.size > 5242880) return message("Choose a JPG, PNG or WebP image up to 5 MB.");
    }
    saving = true;
    var publish = form.querySelector("[type='submit']");
    publish.disabled = true;
    var uploaded = false, published = false;
    try {
      if (image) {
        var user = await sb.auth.getUser();
        if (user.error || !user.data.user) throw new Error("Access expired.");
        row.poster_path = user.data.user.id + "/" + crypto.randomUUID() + "." + formats[image.type];
        var upload = await bucket.upload(row.poster_path, image, { contentType: image.type, upsert: false });
        if (upload.error) throw upload.error;
        uploaded = true;
      }
      var response = await sb.from("meeting_hub_entries").insert(row);
      if (response.error) throw response.error;
      published = true;
      if (current === generation) {
        $("meeting-editor").open = false;
        await load();
        message("Published.");
      }
    } catch (error) {
      if (uploaded && !published && error.code) await bucket.remove([row.poster_path]);
      if (current === generation) message(error.code === "23505"
        ? "This award already has a poster for that month." : "Could not confirm publication. Refresh the list before trying again.");
    } finally {
      saving = false;
      publish.disabled = false;
    }
  });

  async function load() {
    var current = ++generation;
    clearPosters();
    rows = [];
    minutes = [];
    results.replaceChildren();
    results.classList.remove("meeting-awards-grid");
    filters.replaceChildren();
    $("meeting-editor").hidden = true;
    $("meeting-checkin").hidden = section !== "checkin";
    if (section === "checkin") {
      message("");
      TPG.checkin.load();
      return;
    }
    TPG.checkin.clear();
    message("Loading…");
    var query = sb.from("meeting_hub_entries").select("*").eq("kind", section).order("event_date", { ascending: false }).order("created_at", { ascending: false });
    var extra = section === "stock" && staff()
      ? sb.from("meeting_hub_entries").select("id,title,event_date").eq("kind", "minutes").order("event_date", { ascending: false })
      : section === "minutes"
        ? sb.from("meeting_hub_entries").select("title,meeting_id,listing_category,listing_id").eq("kind", "stock").not("meeting_id", "is", null)
        : Promise.resolve({ data: [] });
    var responses = await Promise.all([query.limit(500), Promise.resolve(extra)]);
    if (current !== generation) return;
    if (responses.some(function (r) { return r.error; })) return message("Meeting Hub is unavailable. Please contact an administrator.");
    rows = responses[0].data || [];
    if (section === "stock") minutes = responses[1].data || [];
    if (section === "minutes") {
      var byMeeting = new Map();
      (responses[1].data || []).forEach(function (stock) {
        if (!byMeeting.has(stock.meeting_id)) byMeeting.set(stock.meeting_id, []);
        byMeeting.get(stock.meeting_id).push(stock);
      });
      rows.forEach(function (row) { row.stocks = byMeeting.get(row.id); });
    }
    makeFilters();
    makeForm();
    $("meeting-editor").hidden = !staff();
    message("");
    render();
  }

  $("meeting-tabs").addEventListener("click", function (event) {
    var item = event.target.closest("[data-section]");
    if (!item || item.dataset.section === section) return;
    section = item.dataset.section;
    Array.from($("meeting-tabs").children).forEach(function (node) { node.classList.toggle("on", node === item); });
    $("meeting-editor").open = false;
    load();
  });
  filters.addEventListener("input", render);
  TPG.loadMeetingHub = function (token) {
    if (token) {
      section = "checkin";
      TPG.checkin.useToken(token);
      Array.from($("meeting-tabs").children).forEach(function (node) {
        node.classList.toggle("on", node.dataset.section === section);
      });
    }
    load();
  };
  TPG.clearMeetingHub = function () {
    ++generation;
    ++listingSearch;
    TPG.checkin.clear();
    rows = [];
    minutes = [];
    clearPosters();
    form.replaceChildren();
    filters.replaceChildren();
    results.replaceChildren();
    $("meeting-editor").open = false;
    message("");
  };
})();
