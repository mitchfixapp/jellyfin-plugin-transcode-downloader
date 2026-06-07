# Logo / brand assets

Catalog artwork for the Transcode Downloader plugin.

| File | Purpose |
|------|---------|
| `icon.svg` | Editable source |
| `icon.png` | 512×512 — used as `imageUrl` in `manifest.json` (the catalog tile) |
| `icon-256.png` | 256×256 |
| `icon-1024.png` | 1024×1024 |

The artwork is a dark tile with the **Jellyfin logo** (brand base), the Material
`file_download` icon (as used in the Jellyfin UI), media icons (film / clapperboard / tv),
and the plugin name.

## Attribution

The Jellyfin logo mark is © the Jellyfin contributors and is licensed under
**CC BY-SA 4.0** (<https://github.com/jellyfin/jellyfin-ux>). The remaining artwork is part
of this plugin and shares its license.

To regenerate the PNGs from the source after editing `icon.svg`:

```bash
npx @resvg/resvg-js-cli icon.svg -o icon.png   # or render at 256/512/1024
```
