/*
 * Transcode Downloader — web client.
 * Hijacks Jellyfin's native Download action (toolbar button .btnDownload and the
 * "..." menu item) on movie/episode detail pages and opens a quality picker:
 * "Original" (direct download) or a server-side transcoded, smaller MP4.
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
  function currentItemId() {
    var m = (location.hash || "").match(/[?&]id=([a-f0-9]{32})/i);
    return m ? m[1] : null;
  }

  // ---- server-driven options (per item, cached) ----------------------------
  var optionsCache = {};
  function getOptions(itemId) {
    if (optionsCache[itemId]) { return Promise.resolve(optionsCache[itemId]); }
    return fetch(svc("/Options?itemId=" + itemId))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (o) { if (o) { optionsCache[itemId] = o; } return o; })
      .catch(function () { return null; });
  }

  // ---- hijack native download ----------------------------------------------
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

  function hijack(el, isSheetItem, isAll) {
    if (!el || el.dataset.tdHijacked) { return; }
    el.dataset.tdHijacked = "1";
    el.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      var open = isAll ? openAllDialog : openDialog;
      if (isSheetItem) { closeSheet(el); setTimeout(open, 90); } else { open(); }
    }, true);
  }

  function scan() {
    var itemId = currentItemId();
    if (!itemId) { return; }
    getOptions(itemId).then(function (o) {
      if (!o || !o.downloadable) { return; }
      var isAll = o.kind === "folder";
      var bars = document.querySelectorAll(".btnDownload");
      for (var i = 0; i < bars.length; i++) {
        if (bars[i].offsetParent !== null) { hijack(bars[i], false, isAll); }
      }
      var single = document.querySelector('.actionSheetMenuItem[data-id="download"]');
      if (single) { hijack(single, true, false); }
      var all = document.querySelector('.actionSheetMenuItem[data-id="downloadall"]');
      if (all) { hijack(all, true, true); }
    });
  }

  var scanPending = null;
  function scheduleScan() {
    if (scanPending) { return; }
    scanPending = setTimeout(function () { scanPending = null; scan(); }, 150);
  }
  new MutationObserver(scheduleScan).observe(document.body, { childList: true, subtree: true });
  window.addEventListener("hashchange", scheduleScan);
  scheduleScan();

  // ---- dialog --------------------------------------------------------------
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
    b.innerHTML = '<span style="font-weight:600;">' + title + '</span>' + (sub ? '<span style="opacity:.55;font-size:.8em;">' + sub + "</span>" : "");
    return b;
  }

  function openDialog() {
    var itemId = currentItemId();
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
      cancel.addEventListener("click", function () { document.body.removeChild(ov); });
      c.appendChild(cancel);
      ov.appendChild(c);
      ov.addEventListener("click", function (e) { if (e.target === ov) { document.body.removeChild(ov); } });
      document.body.appendChild(ov);
    });
  }

  function downloadOriginal(itemId, tok, ov) {
    var url = base() + "/Items/" + itemId + "/Download?api_key=" + encodeURIComponent(tok);
    triggerDownload(url);
    if (ov && ov.parentNode) { ov.parentNode.removeChild(ov); }
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
      .then(function (j) { showProgress(j.jobId, ov, c); })
      .catch(function (err) { fail(c, "Start failed: " + err.message); });
  }

  function showProgress(jobId, ov, c) {
    c.innerHTML =
      '<div style="font-size:1.05em;font-weight:600;margin-bottom:1em;">Transcoding…</div>' +
      '<div style="background:#1b2128;border-radius:6px;height:10px;overflow:hidden;margin-bottom:.6em;"><div id="td-bar" style="height:100%;width:0;background:' + ACCENT + ';transition:width .3s;"></div></div>' +
      '<div id="td-status" style="opacity:.7;font-size:.85em;margin-bottom:1em;">Working…</div>';
    var bar = c.querySelector("#td-bar");
    var status = c.querySelector("#td-status");
    var timer = setInterval(function () {
      fetch(svc("/Jobs/" + jobId))
        .then(function (r) { return r.json(); })
        .then(function (s) {
          if (s.state === "running" || s.state === "queued") {
            if (bar) { bar.style.width = (s.progress || 0) + "%"; }
            if (status) { status.textContent = s.state === "queued" ? "Queued…" : "Transcoding… " + (s.progress || 0) + "%"; }
          } else if (s.state === "done") {
            clearInterval(timer); if (bar) { bar.style.width = "100%"; } done(c, jobId, s.filename);
          } else if (s.state === "error") {
            clearInterval(timer); fail(c, "Transcode failed: " + (s.error || "unknown"));
          } else if (s.state === "cancelled") {
            clearInterval(timer);
          }
        })
        .catch(function () { /* keep polling */ });
    }, 1500);

    var cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.style.cssText = "width:100%;background:#1b2128;color:#fff;border:0;border-radius:8px;padding:.6em;cursor:pointer;";
    cancel.addEventListener("click", function () {
      clearInterval(timer);
      fetch(svc("/Jobs/" + jobId), { method: "DELETE" }).catch(function () { /* noop */ });
      if (ov && ov.parentNode) { ov.parentNode.removeChild(ov); }
    });
    c.appendChild(cancel);
  }

  function done(c, jobId, filename) {
    c.innerHTML =
      '<div style="font-size:1.05em;font-weight:600;margin-bottom:.3em;">Ready ✓</div>' +
      '<div style="opacity:.7;font-size:.85em;margin-bottom:1em;word-break:break-all;">' + (filename || "file") + "</div>";
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
    close.addEventListener("click", function () { var ov = c.parentNode; if (ov && ov.parentNode) { ov.parentNode.removeChild(ov); } });
    c.appendChild(close);
    // Auto-start in browsers; in the native app wait for an explicit tap (openUrl switches apps).
    if (!isNativeApp()) { triggerDownload(url, filename); }
  }

  function fail(c, msg) {
    c.innerHTML = '<div style="color:#ff6b6b;font-weight:600;margin-bottom:.8em;">' + msg + "</div>";
    var close = document.createElement("button");
    close.textContent = "Close";
    close.style.cssText = "width:100%;background:#1b2128;color:#fff;border:0;border-radius:8px;padding:.6em;cursor:pointer;";
    close.addEventListener("click", function () { var ov = c.parentNode; if (ov && ov.parentNode) { ov.parentNode.removeChild(ov); } });
    c.appendChild(close);
  }

  // ---- download all (series / season) --------------------------------------
  function openAllDialog() {
    var itemId = currentItemId();
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

      (o.presets || []).forEach(function (p) {
        var b = optionButton(p.label, o.children.length + " episodes, transcoded");
        b.addEventListener("click", function () { startAllJobs(o.children, p.height, ov, c); });
        c.appendChild(b);
      });

      var cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = "Cancel";
      cancel.style.cssText = "width:100%;margin-top:.3em;background:transparent;color:#9aa;border:0;padding:.6em;cursor:pointer;";
      cancel.addEventListener("click", function () { document.body.removeChild(ov); });
      c.appendChild(cancel);
      ov.appendChild(c);
      document.body.appendChild(ov);
    });
  }

  function startAllJobs(children, height, ov, c) {
    c.innerHTML =
      '<div style="font-size:1.05em;font-weight:600;margin-bottom:.2em;">Transcoding ' + children.length + ' episodes…</div>' +
      '<div style="opacity:.6;font-size:.8em;margin-bottom:.6em;">Queued on the server; a download link appears as each one finishes.</div>';

    var list = document.createElement("div");
    list.style.cssText = "max-height:48vh;overflow:auto;margin-bottom:.6em;";
    c.appendChild(list);

    var finished = [];
    var tracked = [];
    var batch = { stopped: false };
    children.forEach(function (ch) {
      var row = document.createElement("div");
      row.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:.6em;padding:.45em 0;border-top:1px solid rgba(255,255,255,.07);font-size:.82em;";
      var name = document.createElement("span");
      name.textContent = ch.name;
      name.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      var state = document.createElement("span");
      state.textContent = "queued";
      state.style.cssText = "flex:none;opacity:.6;min-width:5.5em;text-align:right;";
      row.appendChild(name);
      row.appendChild(state);
      list.appendChild(row);
      var rec = { jobId: null, timer: null, finished: false };
      tracked.push(rec);
      runEpisodeJob(ch.id, height, row, state, finished, rec, batch);
    });

    // Stop polling and cancel anything still running/queued, so closing the dialog frees the server.
    function stopAll() {
      batch.stopped = true;
      tracked.forEach(function (r) {
        if (r.timer) { clearInterval(r.timer); r.timer = null; }
        if (r.jobId && !r.finished) { fetch(svc("/Jobs/" + r.jobId), { method: "DELETE" }).catch(function () { /* noop */ }); }
      });
    }

    var footer = document.createElement("div");
    footer.style.cssText = "display:flex;gap:.5em;";
    if (!isNativeApp()) {
      var all = document.createElement("button");
      all.type = "button";
      all.textContent = "Download finished";
      all.style.cssText = "flex:1;background:" + ACCENT + ";color:#fff;border:0;border-radius:8px;padding:.6em;cursor:pointer;font-weight:600;";
      all.addEventListener("click", function () {
        finished.forEach(function (d, i) { setTimeout(function () { triggerDownload(d.url, d.filename); }, i * 800); });
      });
      footer.appendChild(all);
    }

    var close = document.createElement("button");
    close.type = "button";
    close.textContent = "Close";
    close.style.cssText = "flex:none;background:#1b2128;color:#fff;border:0;border-radius:8px;padding:.6em 1em;cursor:pointer;";
    close.addEventListener("click", function () { stopAll(); if (ov && ov.parentNode) { ov.parentNode.removeChild(ov); } });
    footer.appendChild(close);
    c.appendChild(footer);
  }

  function runEpisodeJob(itemId, height, row, state, finished, rec, batch) {
    fetch(svc("/Jobs"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: itemId, height: height })
    })
      .then(function (r) { if (!r.ok) { return r.text().then(function (t) { throw new Error(t || r.status); }); } return r.json(); })
      .then(function (j) {
        rec.jobId = j.jobId;
        if (batch.stopped) { rec.finished = true; fetch(svc("/Jobs/" + j.jobId), { method: "DELETE" }).catch(function () { /* noop */ }); return; }
        pollEpisode(j.jobId, j.filename, row, state, finished, rec);
      })
      .catch(function (err) { rec.finished = true; state.textContent = "failed"; state.title = err.message; state.style.color = "#ff6b6b"; });
  }

  function pollEpisode(jobId, filename, row, state, finished, rec) {
    var url = svc("/Jobs/" + jobId + "/File");
    rec.timer = setInterval(function () {
      fetch(svc("/Jobs/" + jobId))
        .then(function (r) { return r.json(); })
        .then(function (s) {
          if (s.state === "queued") { state.textContent = "queued"; }
          else if (s.state === "running") { state.textContent = (s.progress || 0) + "%"; }
          else if (s.state === "done") {
            clearInterval(rec.timer); rec.timer = null; rec.finished = true;
            finished.push({ url: url, filename: filename });
            var dl = document.createElement("a");
            dl.href = url;
            dl.setAttribute("download", filename || "");
            dl.textContent = "download";
            dl.style.cssText = "flex:none;color:" + ACCENT + ";text-decoration:none;font-weight:600;min-width:5.5em;text-align:right;";
            dl.addEventListener("click", function (e) { e.preventDefault(); triggerDownload(url, filename); });
            row.replaceChild(dl, state);
          }
          else if (s.state === "error") { clearInterval(rec.timer); rec.timer = null; rec.finished = true; state.textContent = "error"; state.title = s.error || ""; state.style.color = "#ff6b6b"; }
          else if (s.state === "cancelled") { clearInterval(rec.timer); rec.timer = null; rec.finished = true; state.textContent = "cancelled"; }
        })
        .catch(function () { /* keep polling */ });
    }, 2000);
  }

  console.log("[TranscodeDownloader] client loaded");
})();
