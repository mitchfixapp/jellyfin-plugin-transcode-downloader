# Changelog

All notable changes to this project are documented in this file.
The CI reads the section for each released version (`## vX.Y.Z`) into the release notes
and the plugin manifest.

## v1.0.2 - 2026-06-07
- Close the Jellyfin "..." action sheet when the quality picker opens. That menu is a
  div-based dialog that ignores synthetic Escape, backdrop clicks and history.back(), so it
  is now dismissed by removing its container and backdrop from the DOM. Verified in-browser:
  the menu closes, the picker opens, and transcode/cancel work.

## v1.0.1 - 2026-06-07
- Fix the download button not appearing in the web UI. The File Transformation callback is now
  registered using that plugin's own JObject type, so the reflection call no longer fails with
  "Object of type JObject cannot be converted to type JObject" (an assembly-identity clash). The
  plugin no longer bundles its own Newtonsoft.Json.

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
