# Changelog

All notable changes to this project are documented in this file.
The CI reads the section for each released version (`## vX.Y.Z`) into the release notes
and the plugin manifest.

## v1.1.0-beta.9 - 2026-06-08
- Settings: move the "Offer Original" option down to the Quality presets section, since it is one
  of the download options offered alongside the transcode qualities.

## v1.1.0-beta.8 - 2026-06-08
- The default retention for finished transcode files is now 7 days (was 1 day).

## v1.1.0-beta.7 - 2026-06-08
- A running transcode is now never auto-cancelled, and auto-cancellation is off by default. When
  you do turn it on, it only drops jobs that are still queued (not started yet); anything already
  transcoding always runs to completion.

## v1.1.0-beta.6 - 2026-06-08
- The "Download all" batch grace is now configurable (default one day), and there is a switch to
  turn off auto-cancellation entirely, so large batches or slow software encoding are not
  interrupted when you look away.
- Settings: add a "Stop all transcodes now" button and a "Clear cached files now" button.

## v1.1.0-beta.5 - 2026-06-08
- Fix "Download all" stopping after a few episodes: a backgrounded browser tab no longer causes
  the remaining episodes in a batch to be cancelled, so the whole set finishes.

## v1.1.0-beta.4 - 2026-06-08
- "Download all": add the **Original** option (it was only on single items), so you can grab every
  episode's original file, with no transcode, for a whole season or series.

## v1.1.0-beta.3 - 2026-06-08
- Fix the redesigned settings page styling not loading, so the quality preset table and the
  prerequisite banner now render at the right size.

## v1.1.0-beta.2 - 2026-06-08
- Repeat downloads are served from cache: download the same item and quality again while the
  previous transcode is still cached and it is offered instantly instead of being re-encoded.
- Redesigned settings page: edit the quality presets in a simple table instead of raw JSON, and a
  banner tells you when the required File Transformation plugin is missing or needs a restart.

## v1.1.0-beta.1 - 2026-06-08
- "Download all": the bulk button now unlocks only once **every** episode has transcoded
  successfully. If an episode fails, a **retry** button appears next to it to re-run just that
  one, and the bulk button stays locked until it succeeds.
- "Download all": per-episode quality fallback — when you pick a quality that is higher than an
  episode's source, that episode now downloads at the best quality its source allows instead of
  being skipped, so a mixed-resolution season still completes.

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
