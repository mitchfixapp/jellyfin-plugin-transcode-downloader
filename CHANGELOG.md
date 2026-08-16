# Changelog

All notable changes to this project are documented in this file.
The CI reads the section for each released version (`## vX.Y.Z`) into the release notes
and the plugin manifest.

## v1.2.3 - 2026-08-16
- **Downloads no longer hold the screen.** The progress dialog can be **minimized**: the transcode
  keeps running and a download icon with a progress badge appears in Jellyfin's header, so you can
  keep browsing or watching. Click the icon to come back — the badge turns green as soon as files
  are ready. Clicking outside the panel minimizes it too, so a stray click can no longer throw away
  a transcode.
- **One Downloads panel for everything.** Every download you start is a group in the same panel,
  headed with its movie, series or season, so starting a second batch no longer hides the first.
  Each group shows its own progress and can be cancelled on its own with **✕**, while the header
  badge reflects the whole queue.
- **Reloading the page no longer loses a download.** After a refresh — or when you come back to
  Jellyfin later — running and finished downloads are picked up again behind that same icon, so a
  file that finished while you were away is still one click away.
- **Clearer buttons**: the button that closes a panel now reads **Cancel** while transcodes are
  still running (it stops them) and only becomes **Close** once everything has finished.

  Thanks to [@ndom91](https://github.com/ndom91) for suggesting this.

## v1.2.2 - 2026-07-02
- **Fixed**: the plugin failed to load — showing status **"NotSupported"** — on any Jellyfin 10.11.x
  release older than the exact patch it was built against (for example on 10.11.8). It was compiled
  against too new a Jellyfin version; it now targets the minimum 10.11 and loads on every 10.11.x
  server.

  Thanks to [@riendril](https://github.com/riendril) for the detailed report and fix.

## v1.2.1 - 2026-06-30
- The quality picker now also appears when you choose **Download** (or **Download all**) from a
  card's `⋮` menu on the home and library pages — previously it only worked from an item's own
  detail page.
- Downloading from a card's `⋮` menu now acts on the card you clicked, so downloading a single
  episode from a series or season page picks the right episode instead of failing on the series.
- The picker now reliably appears instead of occasionally falling through to a normal download
  (for example when Download was clicked quickly, or on a series whose episode list is slow to load).

  Thanks to [@Reaster0](https://github.com/Reaster0) for the home/library fix.

## v1.2.0 - 2026-06-27
- **Max cache size (GB)**: a new setting caps the total size of cached transcodes. Once the cache
  passes the limit, the oldest finished files are removed first to make room; a download that is
  still in progress is never deleted. Leave it at 0 to keep the cache unlimited (previous behaviour).
- **Fixed**: the quality picker no longer takes over the download buttons in Jellyfin's subtitle
  search dialog, so downloading a subtitle works normally again.

  Thanks to [@Reaster0](https://github.com/Reaster0) for reporting both issues and proposing fixes.

## v1.1.1 - 2026-06-09
- Cancelling a download now reliably stops the transcode, and a cancelled download can no longer
  keep running and finish in the background.
- The "max concurrent transcodes" setting now takes effect immediately, without a server restart.
- Closing a download dialog always stops its background polling and cleans up.
- Hardening of the cache handling and of how item names are shown in the dialogs.

## v1.1.0 - 2026-06-08
- **Download all** for a whole season or series: pick one quality, follow a per-episode progress
  list with a download icon for each finished episode, or grab the **Original** files. The bulk
  button unlocks once every episode is ready.
- **Cache reuse**: downloading the same item and quality again is served instantly from the last
  transcode instead of re-encoding (finished files are kept for 7 days by default).
- **Subtitles**: embedded and external text subtitle tracks are muxed into the download as
  selectable soft tracks.
- **No upscaling**: qualities above the source are hidden, and a mixed-resolution batch falls back
  to the best quality each episode's source allows.
- **Redesigned settings page**: edit quality presets in a table, a prerequisite check for the File
  Transformation plugin, and maintenance buttons to stop all transcodes or clear the cache.
- A running transcode is never auto-cancelled; cleaning up abandoned transcodes is opt-in.

## v1.0.6 - 2026-06-07
- "Download all": keep the bulk download button locked until every episode has finished, add a
  download icon next to each finished episode, and fix the progress-list spacing.

## v1.0.5 - 2026-06-07
- Add **Download all** for series and seasons: pick one quality and download every episode, with
  a per-episode progress list and a download icon for each finished episode.
- Automatically retry an episode once if the server transcode hiccups during a large batch.

## v1.0.4 - 2026-06-07
- Embed selectable subtitle tracks in transcoded downloads so you can pick them in your player.

## v1.0.3 - 2026-06-07
- Fix downloads not working in the native Jellyfin apps (Android and the iOS Jellyfin Mobile app).

## v1.0.2 - 2026-06-07
- Close the "..." menu when the download quality picker opens.

## v1.0.1 - 2026-06-07
- Fix the download button not appearing in the web client.

## v1.0.0 - 2026-06-07
- Initial release.
- Adds a quality picker to Jellyfin's **Download** action in the web client and the official
  mobile apps: download the **Original**, or a smaller server-side transcode
  (**480p / 720p / 1080p / 4K**, configurable).
- Reuses Jellyfin's own encoder (NVENC / QSV / VAAPI / software), so **no API key is required**.
- Output is a faststart **MP4** with a progress bar, cancel support, proper file names
  (including `Show SxxExx Title`), and **no upscaling** (qualities above the source are hidden).
- **Settings page**: video codec, audio bitrate and channels, "Original" toggle, max concurrent
  transcodes, orphan timeout, retention/cleanup days, and quality presets.
- **Scheduled cleanup** task removes finished transcode files after the configured retention.
- **Dual-licensed**: free under AGPL-3.0 for personal, home, and non-profit use; a separate
  commercial license is available for closed-source or commercial use.
