# Logo / brand assets

Catalog artwork for the Transcode Downloader plugin.

| File | Purpose |
|------|---------|
| `icon.svg` | Editable source |
| `icon.png` | 1920x1080 (16:9) catalog tile, used as `imageUrl` in `manifest.json` |

The artwork follows the Jellyfin plugin-catalog style: a dark frame with a centered
rounded tile (so the catalog never crops the content), the **Jellyfin logo** (brand base),
the Material `file_download` icon (as used in the Jellyfin UI), media icons
(film / clapperboard / tv), and the plugin name.

## Attribution

The Jellyfin logo mark is © the Jellyfin contributors and is licensed under
**CC BY-SA 4.0** (<https://github.com/jellyfin/jellyfin-ux>). The remaining artwork is part
of this plugin and shares its license.

## Regenerate the PNG from the source

After editing `icon.svg`, re-render `icon.png` at 1920 wide:

```bash
npx @resvg/resvg-js-cli icon.svg -o icon.png --width 1920
```
