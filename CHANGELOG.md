# Changelog

All notable changes to this project are documented in this file.
The CI reads the section for each released version (`## vX.Y.Z`) into the release notes
and the plugin manifest.

## v1.0.2 - 2026-06-07
- Set the commercial-license contact email (info@mitchfix.app) in COMMERCIAL.md.

## v1.0.1 - 2026-06-07
- Add a catalog icon: a dark tile with the Jellyfin logo, the Material `file_download`
  icon, media icons (film / clapperboard / tv), and the plugin name. Source and PNG
  variants live in [`logo/`](logo/).

## v1.0.0 - 2026-06-07
- Initial release.
- Adds a quality picker to Jellyfin's **Download** action in the web client and the official
  mobile apps: download the **Original**, or a smaller server-side transcode
  (**480p / 720p / 1080p / 4K**, configurable).
- Reuses Jellyfin's own encoder (NVENC / QSV / VAAPI / software) — **no API key required**.
- Output is a faststart **MP4** with a progress bar, cancel support, proper file names
  (including `Show SxxExx Title`), and **no upscaling** (qualities above the source are hidden).
- **Settings page**: video codec, audio bitrate/channels, "Original" toggle, max concurrent
  transcodes, orphan timeout, retention/cleanup days, and quality presets.
- **Scheduled cleanup** task removes finished transcode files after the configured retention.
