/*
 * Transcode Downloader — web client.
 * Hijacks Jellyfin's native Download action (toolbar button .btnDownload and the
 * "..." menu item) on movie/episode detail pages and opens a quality picker:
 * "Original" (direct download) or a server-side transcoded, smaller MP4.
 * Everything that is started lands in one "Downloads" panel — one group per movie, series or
 * season — which can be minimised to a button in Jellyfin's header and reopened from there.
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

  // ---- shared bits ---------------------------------------------------------
  function overlay() {
    var o = document.createElement("div");
    o.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px);";
    return o;
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
  function textButton(label, kind) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.style.cssText = (kind === "primary"
      ? "flex:1;background:" + ACCENT + ";color:#fff;font-weight:600;"
      : "flex:none;background:#1b2128;color:#fff;") + "border:0;border-radius:8px;padding:.6em 1em;cursor:pointer;";
    return b;
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
  function statusText(text) {
    var s = document.createElement("span");
    s.textContent = text;
    s.style.cssText = "flex:none;opacity:.6;min-width:4.5em;text-align:right;";
    return s;
  }
  function setStatus(row, el) {
    if (row.tdStatus && row.tdStatus.parentNode === row) { row.replaceChild(el, row.tdStatus); }
    else { row.appendChild(el); }
    row.tdStatus = el;
  }

  var ICON_DOWNLOAD = "M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z";
  var ICON_RETRY = "M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z";

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

  // ---- storage: survive a page reload ---------------------------------------
  // A hard reload throws the panel away while the transcodes keep running on the server and their
  // finished files stay in the cache for days, so every group writes its job ids to localStorage
  // and picks them up on the next load. Only ids and display names are stored, never the token.
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

  // Read-modify-write, so a second tab's groups are not clobbered, and drop stale entries.
  function writeStore(uid, entry) {
    try {
      var all = readStore();
      if (entry) { all[uid] = entry; } else { delete all[uid]; }
      var cutoff = Date.now() - STORE_TTL;
      Object.keys(all).forEach(function (k) { if (!all[k] || !(all[k].t > cutoff)) { delete all[k]; } });
      window.localStorage.setItem(STORE_KEY, JSON.stringify(all));
    } catch (e) { /* private mode / quota — persistence is best effort */ }
  }

  // ---- minimise + header indicator ------------------------------------------
  // Minimising must NOT cancel anything: the panel is hidden (display:none), never removed, so
  // every poll timer and row keeps working and restoring is a display flip. While it is hidden a
  // button with a progress badge sits in Jellyfin's header. Jellyfin re-renders its header on
  // navigation, so a 1s ticker re-attaches the button and repaints the badge — simpler and more
  // predictable than a MutationObserver, and it only runs while the panel is actually minimised.
  var minimizedPanel = null;
  var headerBtn = null;
  var headerBadge = null;
  var headerTimer = null;

  function minimize(ov) {
    if (!ov || minimizedPanel === ov) { return; }
    ov.style.display = "none";
    minimizedPanel = ov;
    tick();
  }

  function restore() {
    var ov = minimizedPanel;
    if (!ov) { return; }
    minimizedPanel = null;
    ov.style.display = "flex";
    tick();
    // Transcodes that finished while the panel was hidden deliberately did not auto-download: with
    // no user gesture behind them the browser blocks that. Reopening IS the gesture.
    if (ov._tdFlush) { try { ov._tdFlush(); } catch (e) { /* noop */ } }
  }

  function forget(ov) {
    if (minimizedPanel === ov) { minimizedPanel = null; tick(); }
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

  // Jellyfin hides .headerRight on some screens (they carry a "noHeaderRight" header) and the
  // player has none at all. Losing the only way back to a running transcode there would be worse
  // than an out-of-place button, so it falls back to a floating pill and hops back into the header
  // as soon as one is visible again.
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
    // Jellyfin's own header-button classes give the right size and hover; the inline styles keep
    // it sane on skins that do not define them.
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
      restore();
    });
    headerBadge = badge;
    return b;
  }

  function tick() {
    if (!minimizedPanel) {
      if (headerTimer) { clearInterval(headerTimer); headerTimer = null; }
      if (headerBtn && headerBtn.parentNode) { headerBtn.parentNode.removeChild(headerBtn); }
      headerBtn = null;
      headerBadge = null;
      return;
    }

    if (!headerBtn) { headerBtn = buildHeaderButton(); }
    place();

    var s = minimizedPanel._tdStatus ? minimizedPanel._tdStatus() : { running: 0, ready: 0, failed: 0, percent: 100 };
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
    headerBtn.title = "Transcode Downloader — " + (bits.join(", ") || "working") + ". Click to open.";

    if (!headerTimer) { headerTimer = setInterval(tick, 1000); }
  }

  // ---- the quality pickers ---------------------------------------------------
  function closePicker(ov) {
    if (ov && ov.parentNode) { ov.parentNode.removeChild(ov); }
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
        orig.addEventListener("click", function () {
          triggerDownload(base() + "/Items/" + itemId + "/Download?api_key=" + encodeURIComponent(tok));
          closePicker(ov);
        });
        c.appendChild(orig);
      }
      (o.presets || []).forEach(function (p) {
        var b = optionButton(p.label, "transcoded — smaller");
        b.addEventListener("click", function () {
          closePicker(ov);
          addGroup({
            label: (o.name || "Download") + " · " + p.label,
            height: p.height,
            auto: true,                       // a single pick downloads itself when it is ready
            entries: [{ item: itemId, name: o.name || "video" }]
          });
        });
        c.appendChild(b);
      });

      var cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = "Cancel";
      cancel.style.cssText = "width:100%;margin-top:.3em;background:transparent;color:#9aa;border:0;padding:.6em;cursor:pointer;";
      cancel.addEventListener("click", function () { closePicker(ov); });
      c.appendChild(cancel);
      ov.appendChild(c);
      ov.addEventListener("click", function (e) { if (e.target === ov) { closePicker(ov); } });
      document.body.appendChild(ov);
    });
  }

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
        '<div style="font-size:1.1em;font-weight:600;margin-bottom:.2em;"></div>' +
        '<div style="opacity:.6;font-size:.85em;margin-bottom:1em;"></div>';
      c.children[0].textContent = "Download all";
      c.children[1].textContent = (o.name ? o.name + " — " : "") + o.children.length + " episodes. Pick a quality for the whole set.";

      if (o.showOriginal) {
        var orig = optionButton("Original", o.children.length + " episodes, full files — no transcode");
        orig.addEventListener("click", function () {
          closePicker(ov);
          addOriginalsGroup(o.name || "Originals", o.children, tok);
        });
        c.appendChild(orig);
      }

      (o.presets || []).forEach(function (p) {
        var b = optionButton(p.label, o.children.length + " episodes, transcoded");
        b.addEventListener("click", function () {
          closePicker(ov);
          addGroup({
            label: (o.name || "Episodes") + " · " + p.label,
            height: p.height,
            entries: o.children.map(function (ch) { return { item: ch.id, name: ch.name }; })
          });
        });
        c.appendChild(b);
      });

      var cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = "Cancel";
      cancel.style.cssText = "width:100%;margin-top:.3em;background:transparent;color:#9aa;border:0;padding:.6em;cursor:pointer;";
      cancel.addEventListener("click", function () { closePicker(ov); });
      c.appendChild(cancel);
      ov.appendChild(c);
      ov.addEventListener("click", function (e) { if (e.target === ov) { closePicker(ov); } });
      document.body.appendChild(ov);
    });
  }

  // ---- the downloads panel ---------------------------------------------------
  // One panel holds every batch: a group per movie, series or season, stacked under each other.
  // So a second "Download all" while the first is still running does not hide the first — both are
  // in the same list, and the header badge reflects the whole queue.
  var dock = null;

  function ensureDock() {
    if (dock && dock.ov.parentNode) { return dock; }

    var ov = overlay();
    var c = card();
    c.style.minWidth = "24em";
    c.innerHTML = '<div style="font-size:1.1em;font-weight:600;margin-bottom:.1em;">Downloads</div>' +
      '<div style="opacity:.6;font-size:.8em;margin-bottom:.8em;"></div>';
    var sub = c.children[1];

    var groupList = document.createElement("div");
    groupList.style.cssText = "max-height:56vh;overflow-y:auto;padding-right:12px;margin-bottom:.8em;";
    c.appendChild(groupList);

    var footer = document.createElement("div");
    footer.style.cssText = "display:flex;gap:.5em;";
    var minBtn = textButton("Minimize", "primary");
    minBtn.title = "Keep transcoding in the background — reopen from the icon in the header";
    minBtn.addEventListener("click", function () { minimize(ov); });
    footer.appendChild(minBtn);
    var closeBtn = textButton("Cancel all");
    closeBtn.addEventListener("click", function () { closeDock(); });
    footer.appendChild(closeBtn);
    c.appendChild(footer);

    ov.appendChild(c);
    ov.addEventListener("click", function (e) { if (e.target === ov) { minimize(ov); } });
    // Attached hidden: a group restored after a reload must not flash the panel on screen before
    // it is minimised. showDock() is what makes it visible.
    ov.style.display = "none";
    document.body.appendChild(ov);

    dock = { ov: ov, card: c, sub: sub, list: groupList, closeBtn: closeBtn, groups: [], pending: [] };
    ov._tdStatus = dockStatus;
    ov._tdFlush = function () {
      var q = dock.pending;
      dock.pending = [];
      q.forEach(function (d, i) { setTimeout(function () { triggerDownload(d.url, d.filename); }, i * 800); });
    };
    return dock;
  }

  function showDock() {
    var d = ensureDock();
    if (minimizedPanel === d.ov) { restore(); }
    else { d.ov.style.display = "flex"; }
    return d;
  }

  function closeDock() {
    if (!dock) { return; }
    // Claim the panel before tearing groups down: removing the last group closes the panel too,
    // and that must not re-enter this function.
    var d = dock;
    dock = null;
    forget(d.ov);
    d.groups.forEach(function (g) { if (g.stop) { g.stop(); } });
    d.groups.length = 0;
    if (d.ov.parentNode) { d.ov.parentNode.removeChild(d.ov); }
  }

  function dockStatus() {
    var out = { running: 0, ready: 0, failed: 0, percent: 0, jobs: 0 };
    if (!dock) { return out; }
    var sum = 0;
    dock.groups.forEach(function (g) {
      var s = g.status();
      out.running += s.running;
      out.ready += s.ready;
      out.failed += s.failed;
      sum += s.percent * s.jobs;
      out.jobs += s.jobs;
    });
    out.percent = out.jobs ? Math.round(sum / out.jobs) : 0;
    return out;
  }

  // The whole queue in one line, plus an exit button that says what it does: it cancels.
  function refreshDock() {
    if (!dock) { return; }
    var s = dockStatus();
    var bits = [];
    if (s.running > 0) { bits.push(s.running + " transcoding · " + s.percent + "%"); }
    if (s.ready > 0) { bits.push(s.ready + " ready"); }
    if (s.failed > 0) { bits.push(s.failed + " failed"); }
    dock.sub.textContent = bits.join("  ·  ") || "nothing running";
    dock.closeBtn.textContent = s.running > 0 ? "Cancel all" : "Close";
    dock.closeBtn.title = s.running > 0 ? "Stops every transcode that is still running" : "";
    dock.groups.forEach(function (g) { g.refresh(); });
  }

  function groupBox(label) {
    var box = document.createElement("div");
    box.style.cssText = "border-top:1px solid rgba(255,255,255,.09);padding:.6em 0 .3em;";
    var head = document.createElement("div");
    head.style.cssText = "display:flex;align-items:baseline;gap:.6em;margin-bottom:.3em;";
    var name = document.createElement("span");
    name.textContent = label;
    name.style.cssText = "font-weight:600;font-size:.92em;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    var stat = document.createElement("span");
    stat.style.cssText = "flex:none;opacity:.55;font-size:.78em;";
    var kill = document.createElement("button");
    kill.type = "button";
    kill.textContent = "✕";
    kill.title = "Remove this batch";
    kill.style.cssText = "flex:none;background:transparent;color:#9aa;border:0;padding:0 .2em;cursor:pointer;font-size:.9em;";
    head.appendChild(name);
    head.appendChild(stat);
    head.appendChild(kill);
    box.appendChild(head);
    return { box: box, stat: stat, kill: kill };
  }

  // A group of original-file downloads: no transcode, so every row is ready at once.
  function addOriginalsGroup(label, children, tok) {
    var d = showDock();
    var ui = groupBox(label + " · Original");
    var urls = [];

    children.forEach(function (ch) {
      var url = base() + "/Items/" + ch.id + "/Download?api_key=" + encodeURIComponent(tok);
      urls.push({ url: url, filename: null });
      var row = document.createElement("div");
      row.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:1em;padding:.35em 0;font-size:.82em;";
      var name = document.createElement("span");
      name.textContent = ch.name;
      name.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      row.appendChild(name);
      ui.box.appendChild(row);
      setStatus(row, statusEl(ICON_DOWNLOAD, "Download original", ACCENT, function () { triggerDownload(url); }));
    });

    if (!isNativeApp() && urls.length > 1) {
      var allBtn = textButton("Download all (" + urls.length + ")", "primary");
      allBtn.style.marginTop = ".4em";
      allBtn.addEventListener("click", function () {
        urls.forEach(function (u, i) { setTimeout(function () { triggerDownload(u.url); }, i * 800); });
      });
      ui.box.appendChild(allBtn);
    }

    var g = {
      label: label,
      status: function () { return { running: 0, ready: children.length, failed: 0, percent: 100, jobs: children.length }; },
      refresh: function () { ui.stat.textContent = children.length + " ready"; },
      remove: function () { removeGroup(g, ui.box); }
    };
    ui.kill.addEventListener("click", function () { g.remove(); });
    d.list.appendChild(ui.box);
    d.groups.push(g);
    refreshDock();
    return g;
  }

  function removeGroup(g, box) {
    if (!dock) { return; }
    if (g.stop) { g.stop(); }
    var i = dock.groups.indexOf(g);
    if (i >= 0) { dock.groups.splice(i, 1); }
    if (box && box.parentNode) { box.parentNode.removeChild(box); }
    if (!dock.groups.length) { closeDock(); return; }
    refreshDock();
  }

  // A group of transcode jobs. Entries are either fresh (an item still to start) or already-running
  // jobs picked up from localStorage after a reload, so a batch and a restored group are the same
  // thing here.
  function addGroup(spec) {
    // A group restored from storage lands in the panel without opening it (spec.silent).
    var wasOpen = !!(dock && dock.ov.parentNode && dock.ov.style.display !== "none");
    var d = spec.silent ? ensureDock() : showDock();
    if (spec.silent && !wasOpen) { minimize(d.ov); }
    var entries = spec.entries || [];
    var total = entries.length;
    var uid = spec.uid || ("g" + (++uidSeq) + "-" + Date.now());
    var height = spec.height;
    var ui = groupBox(spec.label);
    var tracked = [];
    var finished = [];
    var stopped = false;
    var allBtn = null;

    function persist() {
      var jobs = [];
      tracked.forEach(function (r) {
        if (r.jobId && !r.failed) { jobs.push({ id: r.jobId, name: r.name, file: r.file, item: r.item }); }
      });
      writeStore(uid, jobs.length ? { t: Date.now(), height: height, label: spec.label, auto: !!spec.auto, jobs: jobs } : null);
    }

    function deliver(url, filename) {
      // Auto-start only for a single pick, and only with the panel in view: a download fired while
      // the panel is hidden has no user gesture behind it and browsers block it. Otherwise it waits
      // for the reopen, or for the row's own icon.
      if (!spec.auto || isNativeApp()) { return; }
      if (minimizedPanel === d.ov) { d.pending.push({ url: url, filename: filename }); }
      else { triggerDownload(url, filename); }
    }

    function updateAll() {
      if (allBtn) {
        var done = finished.length === total;
        allBtn.textContent = "Download all (" + finished.length + "/" + total + ")";
        allBtn.disabled = !done;
        allBtn.style.opacity = done ? "1" : ".45";
        allBtn.style.cursor = done ? "pointer" : "default";
      }

      refreshDock();
    }

    function onFail(rec) {
      rec.done = false;
      rec.failed = true;
      // A job restored without its item id cannot be re-submitted, so it just reads as failed
      // instead of offering a retry that would go nowhere.
      if (rec.item) {
        setStatus(rec.row, statusEl(ICON_RETRY, "Transcode failed — retry", "#ff6b6b", function () { startOne(rec); }));
      } else {
        setStatus(rec.row, statusText("failed"));
      }

      updateAll();
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
            else if (s.state === "running") {
              rec.progress = s.progress || 0;
              st.textContent = (s.progress || 0) + "%";
              updateAll();
            }
            else if (s.state === "done") {
              clearInterval(rec.timer); rec.timer = null; rec.done = true; rec.progress = 100;
              rec.file = s.filename || rec.file;
              finished.push({ url: url, filename: rec.file });
              setStatus(rec.row, statusEl(ICON_DOWNLOAD, "Download", ACCENT, function () { triggerDownload(url, rec.file); }));
              updateAll();
              deliver(url, rec.file);
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
      rec.done = false; rec.failed = false; rec.progress = 0; rec.jobId = null;
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
          if (stopped) { fetch(svc("/Jobs/" + j.jobId), { method: "DELETE" }).catch(function () { /* noop */ }); return; }
          poll(rec);
          persist();
        })
        .catch(function () { onFail(rec); });
    }

    entries.forEach(function (en) {
      var row = document.createElement("div");
      row.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:1em;padding:.35em 0;font-size:.82em;";
      var label = en.name || en.file || "video";
      var name = document.createElement("span");
      name.textContent = label;
      name.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      row.appendChild(name);
      ui.box.appendChild(row);
      var rec = {
        item: en.item || null,
        name: label,
        file: en.file || "",
        jobId: en.jobId || null,
        timer: null,
        done: false,
        failed: false,
        progress: 0,
        row: row
      };
      tracked.push(rec);
      if (rec.jobId) { poll(rec); } else { startOne(rec); }
    });

    if (!isNativeApp() && total > 1) {
      allBtn = textButton("Download all (0/" + total + ")", "primary");
      allBtn.style.marginTop = ".4em";
      allBtn.disabled = true;
      allBtn.style.opacity = ".45";
      allBtn.addEventListener("click", function () {
        if (allBtn.disabled) { return; }
        finished.forEach(function (f, i) { setTimeout(function () { triggerDownload(f.url, f.filename); }, i * 800); });
      });
      ui.box.appendChild(allBtn);
    }

    var g = {
      label: spec.label,
      status: function () {
        var failed = 0;
        var sum = 0;
        tracked.forEach(function (r) {
          if (r.failed) { failed++; }
          sum += r.done ? 100 : (r.progress || 0);
        });
        return {
          running: Math.max(0, total - finished.length - failed),
          ready: finished.length,
          failed: failed,
          percent: total ? Math.round(sum / total) : 0,
          jobs: total
        };
      },
      refresh: function () {
        var s = g.status();
        var bits = [];
        if (s.running > 0) { bits.push(s.running + " left · " + s.percent + "%"); }
        if (s.ready > 0) { bits.push(s.ready + "/" + total + " ready"); }
        if (s.failed > 0) { bits.push(s.failed + " failed"); }
        ui.stat.textContent = bits.join(" · ");
      },
      // Stop polling and cancel whatever is still running, so dropping a group frees the server.
      stop: function () {
        stopped = true;
        tracked.forEach(function (r) {
          if (r.timer) { clearInterval(r.timer); r.timer = null; }
          if (r.jobId && !r.done) { fetch(svc("/Jobs/" + r.jobId), { method: "DELETE" }).catch(function () { /* noop */ }); }
        });
        writeStore(uid, null);
      },
      remove: function () { removeGroup(g, ui.box); }
    };
    ui.kill.title = "Cancel this batch";
    ui.kill.addEventListener("click", function () { g.remove(); });
    d.list.appendChild(ui.box);
    d.groups.push(g);
    refreshDock();
    return g;
  }

  // ---- pick groups back up after a reload ------------------------------------
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
        // The server no longer knows any of them (restart, cleanup, cancelled): forget the group.
        if (!alive.length) { writeStore(uid, null); return; }
        addGroup({
          uid: uid,
          label: entry.label || (alive.length > 1 ? alive.length + " downloads" : alive[0].name),
          height: entry.height,
          auto: false,                      // never fire a download on its own after a reload
          silent: true,                     // land in the header badge, not on top of the page
          entries: alive.map(function (j) { return { item: j.item, name: j.name, file: j.file, jobId: j.id }; })
        });
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
