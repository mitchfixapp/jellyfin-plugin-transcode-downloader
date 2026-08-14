/*
 * Transcode Downloader — web client.
 * Hijacks Jellyfin's native Download action (toolbar button .btnDownload and the
 * "..." menu item) on movie/episode detail pages and opens a quality picker:
 * "Original" (direct download) or a server-side transcoded, smaller MP4.
 * A running transcode can be minimised to a button in Jellyfin's header and reopened from there.
 * Served by the plugin at /TranscodeDownloader/ClientScript and injected into index.html.
 */
(function () {
  "use strict";

  var ACCENT = "#00a4dc"; // Jellyfin accent blue

  function api() {
    return window.ApiClient || (window.connectionManager && window.connectionManager.currentApiClient && window.connectionManager.currentApiClient());
  }
  function token() {
    try { return api() && api().accessToken(); } catch (e) { return null; }
  }
  function base() {
    var a = api();
    try { if (a && a.serverAddress) { return a.serverAddress(); } } catch (e) { /* noop */ }
    return location.origin;
  }
  function svc(path) {
    return base() + "/TranscodeDownloader" + path + (path.indexOf("?") >= 0 ? "&" : "?") + "api_key=" + encodeURIComponent(token() || "");
  }
  function urlItemId() {
    var m = (location.hash || "").match(/[?&]id=([a-f0-9]{32})/i);
    return m ? m[1] : null;
  }

  // ---- server-driven options (per item, cached) ----------------------------
  var optionsCache = {};
  var OPTIONS_TTL = 60000; // re-fetch options after a minute so preset/source changes show up
  function getOptions(itemId) {
    var hit = optionsCache[itemId];
    if (hit && (Date.now() - hit.t) < OPTIONS_TTL) { return Promise.resolve(hit.o); }
    return fetch(svc("/Options?itemId=" + itemId))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (o) { if (o) { optionsCache[itemId] = { o: o, t: Date.now() }; } return o; })
      .catch(function () { return null; });
  }

  // ---- intercept native download -------------------------------------------
  function closeSheet(fromEl) {
    // Jellyfin's action sheet is a div-based dialog (.dialog.actionSheet.opened) inside a
    // .dialogContainer, with a separate .dialogBackdrop. It is NOT a native <dialog> and it
    // ignores synthetic Escape, backdrop clicks and history.back(). Removing the container and
    // backdrop from the DOM is the reliable way to dismiss it (verified on Jellyfin 10.11).
    var dlg = (fromEl && fromEl.closest) ? fromEl.closest("dialog, .dialog, .actionSheet") : null;
    if (!dlg) { dlg = document.querySelector(".actionSheet.opened") || document.querySelector(".dialog.opened"); }
    if (!dlg) { return; }
    if (dlg.tagName === "DIALOG" && typeof dlg.close === "function") {
      try { dlg.close(); } catch (e) { /* noop */ }
    }
    try { dlg.classList.remove("opened"); } catch (e) { /* noop */ }
    var container = dlg.closest ? dlg.closest(".dialogContainer") : null;
    var toRemove = container || dlg;
    if (toRemove && toRemove.parentNode) { try { toRemove.parentNode.removeChild(toRemove); } catch (e) { /* noop */ } }
    var bds = document.querySelectorAll(".dialogBackdrop");
    for (var i = 0; i < bds.length; i++) {
      if (bds[i].parentNode) { try { bds[i].parentNode.removeChild(bds[i]); } catch (e) { /* noop */ } }
    }
  }

  // One delegated, capture-phase click listener handles every entry point: the detail-page toolbar
  // button and the "⋮" action-sheet items on the detail, home and library pages. No DOM scanning,
  // marking or MutationObserver — the click tells us what was pressed.
  //
  // The item id comes from the URL (detail pages) or, for an action sheet spawned by a card, from
  // that card: the sheet itself holds no id (Jellyfin keeps it in a JS closure), so we note which
  // card's menu was last opened. To decide synchronously whether to take over a click — and
  // otherwise let Jellyfin's own download proceed — we warm the per-item Options cache the moment a
  // menu opens or the page changes, then read it without awaiting inside the handler.
  var ID_RE = /^[a-f0-9]{32}$/i;
  var DOWNLOAD_SELECTOR = '.btnDownload, .actionSheetMenuItem[data-id="download"], .actionSheetMenuItem[data-id="downloadall"]';
  var pendingMenuId = null;

  function warm(id) { if (id) { getOptions(id); } }   // populate optionsCache ahead of a click

  document.addEventListener("click", function (e) {
    var node = e.target;
    if (!node || !node.closest) { return; }

    // Opening a context menu: remember which item the sheet it builds will act on. A card's "⋮"
    // ([data-action="menu"]) carries the item id on its nearest [data-id] ancestor; the detail-page
    // header "⋮" (.btnMoreCommands) has none, so it clears the pending id and a sheet download falls
    // back to the page (URL) item. Not a download click, so let it through for Jellyfin to build the
    // sheet.
    var menuBtn = node.closest('[data-action="menu"], .btnMoreCommands');
    if (menuBtn) {
      var holder = menuBtn.closest("[data-id]");
      var mid = holder && holder.getAttribute("data-id");
      pendingMenuId = (mid && ID_RE.test(mid)) ? mid : null;
      if (pendingMenuId) { warm(pendingMenuId); }
      return;
    }

    var trigger = node.closest(DOWNLOAD_SELECTOR);
    if (!trigger) { return; }
    // Jellyfin core's subtitle-search results are also .btnDownload — those are not ours.
    if (trigger.hasAttribute("data-subid") || trigger.closest(".subtitleEditorDialog")) { return; }

    // A click inside an action sheet belongs to the card whose menu opened it — on a detail page the
    // URL still points at the page item, which must not shadow it. The detail-page toolbar button
    // (.btnDownload, not in a sheet) is the page item itself, so it keeps using the URL id.
    var isSheetItem = !!trigger.closest(".actionSheet");
    var itemId = isSheetItem ? (pendingMenuId || urlItemId()) : (urlItemId() || pendingMenuId);
    if (!itemId) { return; }   // can't resolve the item — let Jellyfin's native download run

    // Take this click on a known download control now, then resolve the options asynchronously. The
    // options may not have finished warming (a fast click right after opening the menu) or the cached
    // entry may be older than the TTL (a long-open menu); deciding synchronously off a possibly-empty
    // cache is what made the picker silently fall through to the native download.
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    getOptions(itemId).then(function (o) {
      if (!o || !o.downloadable) { return; }   // genuinely not downloadable — nothing to offer
      var isAll = trigger.matches('[data-id="downloadall"]') || (!isSheetItem && o.kind === "folder");
      var open = function () { if (isAll) { openAllDialog(itemId); } else { openDialog(itemId); } };
      if (isSheetItem) { closeSheet(trigger); setTimeout(open, 90); } else { open(); }
    });
  }, true);

  window.addEventListener("hashchange", function () { pendingMenuId = null; warm(urlItemId()); });
  warm(urlItemId());

  // ---- dialog --------------------------------------------------------------
  function overlay() {
    var o = document.createElement("div");
    o.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px);";
    return o;
  }
  function closeOverlay(ov) {
    // Single exit for every dialog: run any registered cleanup (stop polling, cancel jobs), then
    // remove the overlay. So closing via the backdrop is as safe as the Cancel/Close buttons.
    if (!ov) { return; }
    forget(ov);
    dropStored(ov);
    if (ov._tdCleanup) { try { ov._tdCleanup(); } catch (e) { /* noop */ } ov._tdCleanup = null; }
    if (ov.parentNode) { ov.parentNode.removeChild(ov); }
  }

  // ---- minimize + header indicator -----------------------------------------
  // Minimising must NOT run the overlay's cleanup — that is what cancels the jobs. The panel is
  // hidden (display:none), never removed, so every poll timer, progress bar and per-episode row
  // keeps running and restoring is just a display flip. The server side needs nothing: jobs run
  // detached from the client and only stop on an explicit DELETE.
  //
  // While something is minimised a button sits in Jellyfin's header with a progress/ready badge.
  // Jellyfin re-renders its header on navigation, so a 1s ticker re-attaches the button when it
  // disappears and repaints the badge — cheaper and more predictable than a MutationObserver, and
  // it only runs while there is actually something minimised.
  var minimized = [];       // most recently minimised last
  var headerBtn = null;
  var headerBadge = null;
  var headerTimer = null;

  function minimize(ov) {
    if (!ov || ov._tdMinimized) { return; }
    ov._tdMinimized = true;
    ov.style.display = "none";
    minimized.push(ov);
    tick();
  }

  function restore(ov) {
    if (!ov) { return; }
    forget(ov);
    ov.style.display = "flex";
    // A transcode that finished while minimised deliberately did not auto-download (the browser
    // would block a download with no user gesture behind it). Reopening IS that gesture, so the
    // file starts now.
    if (ov._tdOnRestore) {
      var run = ov._tdOnRestore;
      ov._tdOnRestore = null;
      try { run(); } catch (e) { /* noop */ }
    }
  }

  function forget(ov) {
    if (!ov || !ov._tdMinimized) { return; }
    ov._tdMinimized = false;
    var i = minimized.indexOf(ov);
    if (i >= 0) { minimized.splice(i, 1); }
    tick();
  }

  // Aggregate of every minimised panel. A panel without jobs (the "Original" list) reports nothing
  // and simply counts as one ready item.
  function summary() {
    var out = { running: 0, ready: 0, failed: 0, percent: 0 };
    var parts = 0;
    minimized.forEach(function (ov) {
      var s = ov._tdStatus ? ov._tdStatus() : null;
      if (!s) { out.ready++; out.percent += 100; parts++; return; }
      out.running += s.running;
      out.ready += s.ready;
      out.failed += s.failed;
      out.percent += s.percent;
      parts++;
    });
    out.percent = parts ? Math.round(out.percent / parts) : 0;
    return out;
  }

  function headerHost() {
    return document.querySelector(".headerRight")
      || document.querySelector(".skinHeader .headerButtons")
      || document.querySelector(".skinHeader");
  }

  function isVisible(el) {
    return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  }

  var HEADER_STYLE = "position:relative;display:inline-flex;align-items:center;justify-content:center;background:transparent;border:0;color:inherit;cursor:pointer;padding:.4em;";
  var FLOAT_STYLE = "position:fixed;right:1.2em;bottom:1.2em;z-index:2147483646;display:inline-flex;align-items:center;justify-content:center;background:#101418;color:#fff;border:1px solid rgba(255,255,255,.12);border-radius:999px;padding:.6em;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.5);";

  // Jellyfin hides .headerRight on some screens (it carries a "noHeaderRight" header) and the
  // player has no header at all. Losing the only way back to a running transcode there would be
  // worse than an out-of-place button, so the indicator falls back to a floating pill and hops
  // back into the header as soon as one is visible again.
  function place() {
    var host = headerHost();
    if (isVisible(host)) {
      if (headerBtn.parentNode !== host) {
        headerBtn.style.cssText = HEADER_STYLE;
        host.insertBefore(headerBtn, host.firstChild);
      }
    } else if (headerBtn.parentNode !== document.body) {
      headerBtn.style.cssText = FLOAT_STYLE;
      document.body.appendChild(headerBtn);
    }
  }

  function buildHeaderButton() {
    var b = document.createElement("button");
    b.type = "button";
    // Jellyfin's own header-button classes give the right size/hover; the inline styles keep it
    // sane on skins that do not define them.
    b.className = "paper-icon-button-light headerButton headerButtonRight";
    b.setAttribute("data-td-header", "1");
    b.style.cssText = HEADER_STYLE;
    b.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="' + ICON_DOWNLOAD + '"/></svg>';
    var badge = document.createElement("span");
    badge.style.cssText = "position:absolute;top:0;right:0;min-width:1.5em;height:1.5em;padding:0 .3em;border-radius:1em;background:" + ACCENT + ";color:#fff;font-size:.6em;font-weight:700;line-height:1.5em;text-align:center;box-sizing:border-box;";
    b.appendChild(badge);
    b.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      // Panels are stacked overlays, so bring back the most recent one; the badge count tells the
      // user how many are still hidden behind it.
      if (minimized.length) { restore(minimized[minimized.length - 1]); }
    });
    headerBadge = badge;
    return b;
  }

  function tick() {
    if (!minimized.length) {
      if (headerTimer) { clearInterval(headerTimer); headerTimer = null; }
      if (headerBtn && headerBtn.parentNode) { headerBtn.parentNode.removeChild(headerBtn); }
      headerBtn = null;
      headerBadge = null;
      return;
    }

    if (!headerBtn) { headerBtn = buildHeaderButton(); }
    place();

    var s = summary();
    if (headerBadge) {
      if (s.running > 0) {
        headerBadge.textContent = s.percent + "%";
        headerBadge.style.background = ACCENT;
      } else if (s.failed > 0 && s.ready === 0) {
        headerBadge.textContent = "!";
        headerBadge.style.background = "#ff6b6b";
      } else {
        headerBadge.textContent = "✓";
        headerBadge.style.background = "#3ecf6d";
      }
    }

    var bits = [];
    if (s.running > 0) { bits.push(s.running + " transcoding (" + s.percent + "%)"); }
    if (s.ready > 0) { bits.push(s.ready + " ready"); }
    if (s.failed > 0) { bits.push(s.failed + " failed"); }
    if (minimized.length > 1) { bits.push(minimized.length + " panels minimized"); }
    headerBtn.title = "Transcode Downloader — " + (bits.join(", ") || "working") + ". Click to reopen.";

    if (!headerTimer) { headerTimer = setInterval(tick, 1000); }
  }

  // ---- surviving a page reload ---------------------------------------------
  // Minimising survives navigation because the overlay lives on <body>, but a hard reload throws
  // the panel — and with it the job ids — away, while the transcode keeps running on the server
  // and its finished file sits in the cache for days. So every panel that owns jobs writes its ids
  // to localStorage and picks them up again on the next load. Only ids and display names are
  // stored, no tokens.
  var STORE_KEY = "tdTranscodePanels";
  var STORE_TTL = 2 * 24 * 3600 * 1000;   // well inside the server's default 7-day retention
  var uidSeq = 0;

  function readStore() {
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      var o = raw ? JSON.parse(raw) : null;
      return (o && typeof o === "object") ? o : {};
    } catch (e) { return {}; }
  }

  // Read-modify-write, so a second tab's panels are not clobbered, and drop stale entries.
  function writeStore(uid, entry) {
    try {
      var all = readStore();
      if (entry) { all[uid] = entry; } else { delete all[uid]; }
      var cutoff = Date.now() - STORE_TTL;
      Object.keys(all).forEach(function (k) { if (!all[k] || !(all[k].t > cutoff)) { delete all[k]; } });
      window.localStorage.setItem(STORE_KEY, JSON.stringify(all));
    } catch (e) { /* private mode / quota — persistence is best effort */ }
  }

  function panelUid(ov) {
    if (!ov._tdUid) { ov._tdUid = "p" + (++uidSeq) + "-" + Date.now(); }
    return ov._tdUid;
  }

  function dropStored(ov) {
    if (ov && ov._tdUid) { writeStore(ov._tdUid, null); ov._tdUid = null; }
  }

  // Clicking the backdrop dismisses the quality picker, but once work is under way (the panel
  // reports a status) it minimises instead — a stray click must never throw away a transcode.
  function backdrop(ov) {
    return function (e) {
      if (e.target !== ov) { return; }
      if (ov._tdStatus) { minimize(ov); } else { closeOverlay(ov); }
    };
  }

  function minimizeButton(ov, wide) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = "Minimize";
    b.title = "Keep transcoding in the background — reopen from the icon in the header";
    b.style.cssText = (wide ? "flex:1;" : "flex:none;") + "background:#1b2128;color:#fff;border:0;border-radius:8px;padding:.6em 1em;cursor:pointer;";
    b.addEventListener("click", function () { minimize(ov); });
    return b;
  }
  function card() {
    var c = document.createElement("div");
    c.style.cssText = "background:#101418;color:#fff;border-radius:12px;padding:1.4em 1.4em 1.1em;min-width:300px;max-width:90vw;box-shadow:0 10px 40px rgba(0,0,0,.6);font-family:inherit;border:1px solid rgba(255,255,255,.08);";
    return c;
  }
  function optionButton(title, sub) {
    var b = document.createElement("button");
    b.type = "button";
    b.style.cssText = "display:flex;flex-direction:column;align-items:flex-start;width:100%;text-align:left;background:#1b2128;color:#fff;border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:.7em .9em;margin-bottom:.5em;cursor:pointer;transition:background .15s;";
    b.onmouseenter = function () { b.style.background = "#232b34"; };
    b.onmouseleave = function () { b.style.background = "#1b2128"; };
    var t = document.createElement("span");
    t.style.cssText = "font-weight:600;";
    t.textContent = title;
    b.appendChild(t);
    if (sub) {
      var s = document.createElement("span");
      s.style.cssText = "opacity:.55;font-size:.8em;";
      s.textContent = sub;
      b.appendChild(s);
    }
    return b;
  }

  function openDialog(itemId) {
    var tok = token();
    if (!itemId || !tok) { alert("Could not determine the item or session. Open a movie/episode first."); return; }
    getOptions(itemId).then(function (o) {
      if (!o || !o.downloadable) { alert("This item cannot be downloaded."); return; }
      var ov = overlay();
      var c = card();
      c.innerHTML =
        '<div style="font-size:1.1em;font-weight:600;margin-bottom:.2em;">Download</div>' +
        '<div style="opacity:.6;font-size:.85em;margin-bottom:1em;">Original, or a smaller server-side transcode.</div>';

      if (o.showOriginal) {
        var orig = optionButton("Original", "full file, no transcode — largest");
        orig.addEventListener("click", function () { downloadOriginal(itemId, tok, ov); });
        c.appendChild(orig);
      }
      (o.presets || []).forEach(function (p) {
        var b = optionButton(p.label, "transcoded — smaller");
        b.addEventListener("click", function () { startJob(itemId, p.height, ov, c); });
        c.appendChild(b);
      });

      var cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = "Cancel";
      cancel.style.cssText = "width:100%;margin-top:.3em;background:transparent;color:#9aa;border:0;padding:.6em;cursor:pointer;";
      cancel.addEventListener("click", function () { closeOverlay(ov); });
      c.appendChild(cancel);
      ov.appendChild(c);
      ov.addEventListener("click", backdrop(ov));
      document.body.appendChild(ov);
    });
  }

  function downloadOriginal(itemId, tok, ov) {
    var url = base() + "/Items/" + itemId + "/Download?api_key=" + encodeURIComponent(tok);
    triggerDownload(url);
    closeOverlay(ov);
  }

  function isNativeApp() {
    return !!(window.NativeShell && typeof window.NativeShell.openUrl === "function");
  }

  function triggerDownload(url, filename) {
    // The native Jellyfin apps (Android/iOS WebView) ignore the <a download> trick, and their
    // NativeShell.downloadFiles only re-fetches the ORIGINAL by itemId (it cannot reach our
    // transcoded file). Route the download through NativeShell.openUrl so the device browser /
    // download manager handles it: the server sends Content-Disposition: attachment and the
    // api_key travels in the URL, so it downloads directly. Browsers keep the <a download> path.
    if (isNativeApp()) {
      try { window.NativeShell.openUrl(url, "_blank"); return; } catch (e) { /* fall through */ }
    }
    var a = document.createElement("a");
    a.href = url;
    a.setAttribute("download", filename || "");
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // ---- job + progress ------------------------------------------------------
  function startJob(itemId, height, ov, c) {
    c.innerHTML = '<div style="font-size:1.05em;font-weight:600;">Preparing (' + height + "p)…</div>";
    fetch(svc("/Jobs"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: itemId, height: height })
    })
      .then(function (r) { if (!r.ok) { return r.text().then(function (t) { throw new Error(t || r.status); }); } return r.json(); })
      .then(function (j) { showProgress(j.jobId, ov, c, { item: itemId, h: height, file: j.filename }); })
      .catch(function (err) { fail(c, "Start failed: " + err.message); });
  }

  function showProgress(jobId, ov, c, meta) {
    c.innerHTML =
      '<div style="font-size:1.05em;font-weight:600;margin-bottom:1em;">Transcoding…</div>' +
      '<div style="background:#1b2128;border-radius:6px;height:10px;overflow:hidden;margin-bottom:.6em;"><div id="td-bar" style="height:100%;width:0;background:' + ACCENT + ';transition:width .3s;"></div></div>' +
      '<div id="td-status" style="opacity:.7;font-size:.85em;margin-bottom:1em;">Working…</div>';
    var bar = c.querySelector("#td-bar");
    var status = c.querySelector("#td-status");

    // What the header badge shows while this panel is minimised.
    var st = { running: 1, ready: 0, failed: 0, percent: 0 };
    ov._tdStatus = function () { return st; };

    // Remember the job so a page reload can pick it back up.
    if (meta) {
      writeStore(panelUid(ov), {
        t: Date.now(),
        height: meta.h,
        jobs: [{ id: jobId, name: meta.file, file: meta.file, item: meta.item }]
      });
    }

    var timer = setInterval(function () {
      fetch(svc("/Jobs/" + jobId))
        .then(function (r) { return r.json(); })
        .then(function (s) {
          if (s.state === "running" || s.state === "queued") {
            st.percent = Math.round(s.progress || 0);
            if (bar) { bar.style.width = (s.progress || 0) + "%"; }
            if (status) { status.textContent = s.state === "queued" ? "Queued…" : "Transcoding… " + (s.progress || 0) + "%"; }
          } else if (s.state === "done") {
            clearInterval(timer); ov._tdCleanup = null;
            st.running = 0; st.ready = 1; st.percent = 100;
            if (bar) { bar.style.width = "100%"; } done(ov, c, jobId, s.filename);
          } else if (s.state === "error") {
            clearInterval(timer); ov._tdCleanup = null;
            st.running = 0; st.failed = 1;
            fail(c, "Transcode failed: " + (s.error || "unknown"));
          } else if (s.state === "cancelled") {
            clearInterval(timer); ov._tdCleanup = null;
            st.running = 0; st.failed = 1;
            fail(c, "Cancelled.");
          }
        })
        .catch(function () { /* keep polling */ });
    }, 1500);

    // Closing the dialog any way (Cancel button or backdrop click) stops the poll and cancels the
    // job; cleared above once the job reaches a terminal state so a finished download is not undone.
    ov._tdCleanup = function () {
      clearInterval(timer);
      fetch(svc("/Jobs/" + jobId), { method: "DELETE" }).catch(function () { /* noop */ });
    };

    // Minimize keeps the transcode running and parks the panel in the header; Cancel is the only
    // thing that still stops the job.
    var footer = document.createElement("div");
    footer.style.cssText = "display:flex;gap:.5em;";
    footer.appendChild(minimizeButton(ov, true));
    var cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.style.cssText = "flex:none;background:transparent;color:#9aa;border:0;border-radius:8px;padding:.6em 1em;cursor:pointer;";
    cancel.addEventListener("click", function () { closeOverlay(ov); });
    footer.appendChild(cancel);
    c.appendChild(footer);
  }

  function done(ov, c, jobId, filename) {
    c.innerHTML = '<div style="font-size:1.05em;font-weight:600;margin-bottom:.3em;">Ready ✓</div>';
    var fn = document.createElement("div");
    fn.style.cssText = "opacity:.7;font-size:.85em;margin-bottom:1em;word-break:break-all;";
    fn.textContent = filename || "file";
    c.appendChild(fn);
    var url = svc("/Jobs/" + jobId + "/File");
    var dl = document.createElement("a");
    dl.href = url;
    dl.setAttribute("download", filename || "");
    dl.textContent = "Start download";
    dl.style.cssText = "display:block;text-align:center;background:" + ACCENT + ";color:#fff;text-decoration:none;border-radius:8px;padding:.7em;font-weight:600;margin-bottom:.4em;";
    dl.addEventListener("click", function (e) { e.preventDefault(); triggerDownload(url, filename); });
    c.appendChild(dl);
    var close = document.createElement("button");
    close.textContent = "Close";
    close.style.cssText = "width:100%;background:transparent;color:#9aa;border:0;padding:.5em;cursor:pointer;";
    close.addEventListener("click", function () { closeOverlay(c.parentNode); });
    c.appendChild(close);
    // Auto-start in browsers; in the native app wait for an explicit tap (openUrl switches apps).
    // While minimised there is no user gesture behind this, which browsers block — so the header
    // badge turns green instead and the download starts the moment the panel is reopened.
    if (isNativeApp()) { return; }
    if (ov && ov._tdMinimized) { ov._tdOnRestore = function () { triggerDownload(url, filename); }; }
    else { triggerDownload(url, filename); }
  }

  function fail(c, msg) {
    c.innerHTML = "";
    var m = document.createElement("div");
    m.style.cssText = "color:#ff6b6b;font-weight:600;margin-bottom:.8em;";
    m.textContent = msg;
    c.appendChild(m);
    var close = document.createElement("button");
    close.textContent = "Close";
    close.style.cssText = "width:100%;background:#1b2128;color:#fff;border:0;border-radius:8px;padding:.6em;cursor:pointer;";
    close.addEventListener("click", function () { closeOverlay(c.parentNode); });
    c.appendChild(close);
  }

  // ---- download all (series / season) --------------------------------------
  function openAllDialog(itemId) {
    var tok = token();
    if (!itemId || !tok) { alert("Could not determine the item or session. Open a series or season first."); return; }
    getOptions(itemId).then(function (o) {
      if (!o || !o.downloadable || o.kind !== "folder" || !o.children || !o.children.length) {
        alert("No downloadable episodes were found here.");
        return;
      }
      var ov = overlay();
      var c = card();
      c.innerHTML =
        '<div style="font-size:1.1em;font-weight:600;margin-bottom:.2em;">Download all</div>' +
        '<div style="opacity:.6;font-size:.85em;margin-bottom:1em;">' + o.children.length + ' episodes. Pick a quality for the whole set.</div>';

      if (o.showOriginal) {
        var orig = optionButton("Original", o.children.length + " episodes, full files — no transcode");
        orig.addEventListener("click", function () { startAllOriginals(o.children, tok, ov, c); });
        c.appendChild(orig);
      }

      (o.presets || []).forEach(function (p) {
        var b = optionButton(p.label, o.children.length + " episodes, transcoded");
        b.addEventListener("click", function () { startAllJobs(o.children, p.height, ov, c); });
        c.appendChild(b);
      });

      var cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = "Cancel";
      cancel.style.cssText = "width:100%;margin-top:.3em;background:transparent;color:#9aa;border:0;padding:.6em;cursor:pointer;";
      cancel.addEventListener("click", function () { closeOverlay(ov); });
      c.appendChild(cancel);
      ov.appendChild(c);
      ov.addEventListener("click", backdrop(ov));
      document.body.appendChild(ov);
    });
  }

  // "Download all" -> Original: every episode's original file, no transcode. Each row gets a
  // download icon; in a browser a single button grabs them all (staggered). On the native apps
  // the bulk button is hidden because each openUrl switches apps, so the per-episode icons are used.
  function startAllOriginals(children, tok, ov, c) {
    c.innerHTML =
      '<div style="font-size:1.05em;font-weight:600;margin-bottom:.2em;">Download all — Original</div>' +
      '<div style="opacity:.6;font-size:.8em;margin-bottom:.6em;">The full original file of each episode, no transcode. Use an icon per episode, or grab them all.</div>';

    var list = document.createElement("div");
    list.style.cssText = "max-height:48vh;overflow-y:auto;padding-right:12px;margin-bottom:.7em;";
    c.appendChild(list);

    var urls = [];
    children.forEach(function (ch) {
      var url = base() + "/Items/" + ch.id + "/Download?api_key=" + encodeURIComponent(tok);
      urls.push(url);
      var row = document.createElement("div");
      row.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:1em;padding:.45em 0;border-top:1px solid rgba(255,255,255,.07);font-size:.82em;";
      var name = document.createElement("span");
      name.textContent = ch.name;
      name.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      row.appendChild(name);
      list.appendChild(row);
      setStatus(row, statusEl(ICON_DOWNLOAD, "Download original", ACCENT, function () { triggerDownload(url); }));
    });

    var footer = document.createElement("div");
    footer.style.cssText = "display:flex;gap:.5em;";
    if (!isNativeApp()) {
      var allBtn = document.createElement("button");
      allBtn.type = "button";
      allBtn.textContent = "Download all (" + urls.length + ")";
      allBtn.style.cssText = "flex:1;background:" + ACCENT + ";color:#fff;border:0;border-radius:8px;padding:.6em;cursor:pointer;font-weight:600;";
      allBtn.addEventListener("click", function () {
        urls.forEach(function (u, i) { setTimeout(function () { triggerDownload(u); }, i * 800); });
      });
      footer.appendChild(allBtn);
    }

    // Nothing is transcoding here (these are the original files), but the list is still worth
    // parking in the header so the episodes can be grabbed one by one later.
    ov._tdStatus = function () { return { running: 0, ready: 1, failed: 0, percent: 100 }; };
    footer.appendChild(minimizeButton(ov, false));

    var close = document.createElement("button");
    close.type = "button";
    close.textContent = "Close";
    close.style.cssText = "flex:none;background:#1b2128;color:#fff;border:0;border-radius:8px;padding:.6em 1em;cursor:pointer;";
    close.addEventListener("click", function () { closeOverlay(ov); });
    footer.appendChild(close);
    c.appendChild(footer);
  }

  function statusEl(svgPath, title, color, onClick) {
    var a = document.createElement("a");
    a.href = "#";
    a.title = title;
    a.style.cssText = "flex:none;display:inline-flex;align-items:center;justify-content:flex-end;min-width:4.5em;color:" + color + ";cursor:pointer;";
    a.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="' + svgPath + '"/></svg>';
    a.addEventListener("click", function (e) { e.preventDefault(); onClick(); });
    return a;
  }

  var ICON_DOWNLOAD = "M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z";
  var ICON_RETRY = "M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z";

  function setStatus(row, el) {
    if (row.tdStatus && row.tdStatus.parentNode === row) { row.replaceChild(el, row.tdStatus); }
    else { row.appendChild(el); }
    row.tdStatus = el;
  }

  function statusText(text) {
    var s = document.createElement("span");
    s.textContent = text;
    s.style.cssText = "flex:none;opacity:.6;min-width:4.5em;text-align:right;";
    return s;
  }

  // Starts a transcode for every episode of a "Download all" batch.
  function startAllJobs(children, height, ov, c) {
    jobPanel(
      ov,
      c,
      "Transcoding " + children.length + " episodes…",
      "A download icon appears as each one finishes; a failed episode shows a retry icon.",
      children.map(function (ch) { return { item: ch.id, name: ch.name }; }),
      height);
  }

  // One list panel for a set of transcode jobs. An entry is either fresh (an item still to start)
  // or an already-running job picked up from localStorage after a reload, so the batch download
  // and the restored panel run through the same code.
  function jobPanel(ov, c, title, sub, entries, height) {
    c.innerHTML =
      '<div style="font-size:1.05em;font-weight:600;margin-bottom:.2em;"></div>' +
      '<div style="opacity:.6;font-size:.8em;margin-bottom:.6em;"></div>';
    c.children[0].textContent = title;
    c.children[1].textContent = sub;

    var list = document.createElement("div");
    list.style.cssText = "max-height:48vh;overflow-y:auto;padding-right:12px;margin-bottom:.7em;";
    c.appendChild(list);

    var total = entries.length;
    var finished = [];
    var tracked = [];
    var batch = { stopped: false };
    var allBtn = null;
    var uid = panelUid(ov);

    // Only job ids and display names are stored, never the token.
    function persist() {
      var jobs = [];
      tracked.forEach(function (r) {
        if (r.jobId && !r.failed) { jobs.push({ id: r.jobId, name: r.name, file: r.file, item: r.item }); }
      });
      writeStore(uid, jobs.length ? { t: Date.now(), height: height, jobs: jobs } : null);
    }

    // "Download all" stays locked until every episode has transcoded successfully.
    function updateButton() {
      if (!allBtn) { return; }
      var done = finished.length === total;
      allBtn.textContent = total > 1
        ? "Download all (" + finished.length + "/" + total + ")"
        : (done ? "Download" : "Transcoding…");
      allBtn.disabled = !done;
      allBtn.style.opacity = done ? "1" : ".45";
      allBtn.style.cursor = done ? "pointer" : "default";
    }

    function onFail(rec) {
      rec.done = false;
      rec.failed = true;
      // A job restored from storage without its item id cannot be re-submitted, so it just reads
      // as failed instead of offering a retry that would go nowhere.
      if (rec.item) {
        setStatus(rec.row, statusEl(ICON_RETRY, "Transcode failed — retry", "#ff6b6b", function () { startOne(rec); }));
      } else {
        setStatus(rec.row, statusText("failed"));
      }

      updateButton();
      persist();
    }

    function poll(rec) {
      var url = svc("/Jobs/" + rec.jobId + "/File");
      var st = statusText("queued");
      setStatus(rec.row, st);
      function check() {
        fetch(svc("/Jobs/" + rec.jobId))
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (s) {
            if (!s) { return; }
            if (s.state === "queued") { st.textContent = "queued"; }
            else if (s.state === "running") { st.textContent = (s.progress || 0) + "%"; }
            else if (s.state === "done") {
              clearInterval(rec.timer); rec.timer = null; rec.done = true;
              rec.file = s.filename || rec.file;
              finished.push({ url: url, filename: rec.file });
              setStatus(rec.row, statusEl(ICON_DOWNLOAD, "Download", ACCENT, function () { triggerDownload(url, rec.file); }));
              updateButton();
            }
            else if (s.state === "error") { clearInterval(rec.timer); rec.timer = null; onFail(rec); }
            else if (s.state === "cancelled") { clearInterval(rec.timer); rec.timer = null; }
          })
          .catch(function () { /* keep polling */ });
      }

      rec.timer = setInterval(check, 2000);
      check();   // a restored job that already finished shows its download icon straight away
    }

    function startOne(rec) {
      if (rec.timer) { clearInterval(rec.timer); rec.timer = null; }
      rec.done = false; rec.failed = false; rec.jobId = null;
      setStatus(rec.row, statusText("queued"));
      fetch(svc("/Jobs"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: rec.item, height: height, bulk: total > 1 })
      })
        .then(function (r) { if (!r.ok) { return r.text().then(function (t) { throw new Error(t || r.status); }); } return r.json(); })
        .then(function (j) {
          rec.jobId = j.jobId;
          rec.file = j.filename;
          if (batch.stopped) { fetch(svc("/Jobs/" + j.jobId), { method: "DELETE" }).catch(function () { /* noop */ }); return; }
          poll(rec);
          persist();
        })
        .catch(function () { onFail(rec); });
    }

    entries.forEach(function (en) {
      var row = document.createElement("div");
      row.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:1em;padding:.45em 0;border-top:1px solid rgba(255,255,255,.07);font-size:.82em;";
      var label = en.name || en.file || "video";
      var name = document.createElement("span");
      name.textContent = label;
      name.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      row.appendChild(name);
      list.appendChild(row);
      var rec = {
        item: en.item || null,
        name: label,
        file: en.file || "",
        jobId: en.jobId || null,
        timer: null,
        done: false,
        failed: false,
        row: row
      };
      tracked.push(rec);
      if (rec.jobId) { poll(rec); } else { startOne(rec); }
    });

    // Stop polling and cancel anything still running/queued, so closing the dialog frees the server.
    function stopAll() {
      batch.stopped = true;
      tracked.forEach(function (r) {
        if (r.timer) { clearInterval(r.timer); r.timer = null; }
        if (r.jobId && !r.done) { fetch(svc("/Jobs/" + r.jobId), { method: "DELETE" }).catch(function () { /* noop */ }); }
      });
    }

    var footer = document.createElement("div");
    footer.style.cssText = "display:flex;gap:.5em;";
    if (!isNativeApp()) {
      allBtn = document.createElement("button");
      allBtn.type = "button";
      allBtn.disabled = true;
      allBtn.style.cssText = "flex:1;background:" + ACCENT + ";color:#fff;border:0;border-radius:8px;padding:.6em;cursor:default;font-weight:600;opacity:.45;transition:opacity .2s;";
      allBtn.addEventListener("click", function () {
        if (allBtn.disabled) { return; }
        finished.forEach(function (d, i) { setTimeout(function () { triggerDownload(d.url, d.filename); }, i * 800); });
      });
      footer.appendChild(allBtn);
    }
    updateButton();

    ov._tdCleanup = stopAll;
    // What the header badge shows for this batch while it is minimised.
    ov._tdStatus = function () {
      var failed = 0;
      tracked.forEach(function (r) { if (r.failed) { failed++; } });
      return {
        running: Math.max(0, total - finished.length - failed),
        ready: finished.length,
        failed: failed,
        percent: total ? Math.round(finished.length / total * 100) : 0
      };
    };
    footer.appendChild(minimizeButton(ov, false));

    var close = document.createElement("button");
    close.type = "button";
    close.textContent = "Close";
    close.style.cssText = "flex:none;background:#1b2128;color:#fff;border:0;border-radius:8px;padding:.6em 1em;cursor:pointer;";
    close.addEventListener("click", function () { closeOverlay(ov); });
    footer.appendChild(close);
    c.appendChild(footer);
  }

  // ---- pick panels back up after a reload -----------------------------------
  function openRestored(uid, entry, jobs) {
    var ov = overlay();
    var c = card();
    ov._tdUid = uid;                 // keep the same storage entry instead of creating a second one
    ov.style.display = "none";       // set before it is attached, so nothing flashes on load
    ov.appendChild(c);
    ov.addEventListener("click", backdrop(ov));
    document.body.appendChild(ov);
    jobPanel(
      ov,
      c,
      jobs.length > 1 ? jobs.length + " downloads" : "Download",
      "Picked up again after the page reloaded.",
      jobs.map(function (j) { return { item: j.item, name: j.name, file: j.file, jobId: j.id }; }),
      entry.height);
    minimize(ov);                    // never take over the screen on load; the badge is the signal
  }

  function rehydrate() {
    var all = readStore();
    Object.keys(all).forEach(function (uid) {
      var entry = all[uid];
      if (!entry || !entry.jobs || !entry.jobs.length) { writeStore(uid, null); return; }
      Promise.all(entry.jobs.map(function (j) {
        return fetch(svc("/Jobs/" + j.id))
          .then(function (r) { return r.ok ? r.json() : null; })
          .catch(function () { return null; });
      })).then(function (states) {
        var alive = [];
        states.forEach(function (s, i) {
          if (s && (s.state === "done" || s.state === "running" || s.state === "queued")) { alive.push(entry.jobs[i]); }
        });
        // The server no longer knows any of them (restart, cleanup, cancelled): forget the panel.
        if (!alive.length) { writeStore(uid, null); return; }
        openRestored(uid, entry, alive);
      });
    });
  }

  // The script is injected into index.html and can run before Jellyfin has a session, so wait for
  // a token before asking the server about our jobs. Gives up quietly after ~30s (login screen).
  (function whenSignedIn() {
    var tries = 0;
    (function wait() {
      if (token()) { rehydrate(); return; }
      if (++tries > 60) { return; }
      setTimeout(wait, 500);
    })();
  })();

  console.log("[TranscodeDownloader] client loaded");
})();
