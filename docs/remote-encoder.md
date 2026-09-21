# Remote encoders (ffmpeg-over-ip and similar)

The plugin works with a remote ffmpeg, but two things have to be set up. This page explains
what the plugin needs from the encoder, why the *Request the intermediate transcode as MPEG-TS*
setting exists, and what was tested.

## What the plugin asks ffmpeg to do

For one download the plugin runs **two** ffmpeg processes through Jellyfin's configured ffmpeg
(which, with ffmpeg-over-ip, is the client binary):

1. **Jellyfin's own transcode.** The plugin requests `/Videos/{id}/stream.{container}` from the
   server. Jellyfin starts its usual ffmpeg (hardware acceleration, tone-mapping, audio downmix)
   and writes the result to its transcode folder while serving it progressively.
2. **The plugin's remux.** A second ffmpeg reads that stream over HTTP, adds the source's text
   subtitle tracks (read from the original media file and any sidecar `.srt`), and writes a
   faststart MP4 into the plugin's work folder. That file is what the user downloads.

So the remote ffmpeg must be able to:

- **reach this Jellyfin server over HTTP** → set *Server address for the encoder*. The default
  `127.0.0.1` points at the encoder host itself when ffmpeg runs elsewhere;
- **read the original media files** (for the subtitle tracks);
- **write into the plugin's work folder**, because Jellyfin serves the finished file from there.

With **ffmpeg-over-ip v5 or newer** all file reads and writes are tunneled back to the Jellyfin
machine, so the last two just work. With **v4 and earlier**, or any setup that relies on shared
storage (NFS/SMB), the media folders and the work folder must be reachable from the ffmpeg host
under the mapped path: set *Work folder* to a folder on that share.

## Why "Request the intermediate transcode as MPEG-TS" exists

Jellyfin writes a progressive MP4 transcode as *fragmented* MP4. ffmpeg's MP4 muxer writes each
fragment header (`moof`) with a size placeholder of zero and patches in the real size right
afterwards with a seek-back write. Jellyfin serves the file while it is still being written, so
a reader that keeps up with the writer can catch a header before it is patched. ffmpeg's
demuxer treats a zero-size box as end of file and stops with a clean exit.

Locally that window is microseconds and is never hit. Through ffmpeg-over-ip's file tunnel every
seek and write is a network round trip, the window becomes milliseconds, and the plugin's remux,
which reads right at the write frontier, catches it regularly. The download then ends after a
few minutes of video.

MPEG-TS is written strictly sequentially and never patches earlier bytes, so it is not affected.
With the setting on, the plugin requests the intermediate transcode as MPEG-TS; the remux still
produces a regular faststart MP4 with the same video, audio and subtitle tracks.

The plugin also checks the finished file's duration against the item's runtime and fails the
download with *"The transcode stream ended early"* rather than serving a cut-short file.

## What was tested

Setup: ffmpeg-over-ip v5.2.1, server on Linux x86_64 (also on Windows), client mounted over
`/usr/lib/jellyfin-ffmpeg/ffmpeg` in a LinuxServer Jellyfin 12 container.

- Captures of the progressive MP4 stream through the tunnel contained a `moof` with size 0
  (after 12, 17 and 102 valid boxes in different runs); the file on disk was intact every time.
- The same stream read by a local ffmpeg came through complete; read by the tunneled remux it
  stopped early (2:53 of 3:00 in one run).
- A 3-minute clip: as MP4 through the tunnel 1 of 4 downloads was cut short; as MPEG-TS 3 of 3
  were complete, and the result downloaded through the plugin was byte-identical to the cached
  file with working range requests.
- MPEG-TS was verified for both H.264 and HEVC intermediates.
- Cost on a local NVENC setup, same 96-minute film: encode speed 27.6x as MPEG-TS versus 28.6x
  as MP4, intermediate stream about 9% larger. The final download is the same MP4.

## Alternative without the plugin setting

The same effect can be reached in the ffmpeg-over-ip server configuration, which rewrites
Jellyfin's progressive MP4 arguments to MPEG-TS; HLS playback uses different arguments and is
unaffected:

```jsonc
"rewrites": [
  ["-f mp4 -movflags frag_keyframe+empty_moov+delay_moov", "-f mpegts"]
]
```
