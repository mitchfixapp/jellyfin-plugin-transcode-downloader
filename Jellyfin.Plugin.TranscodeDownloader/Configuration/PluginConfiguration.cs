using System.Collections.ObjectModel;
using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.TranscodeDownloader.Configuration;

/// <summary>
/// Plugin configuration.
/// </summary>
public class PluginConfiguration : BasePluginConfiguration
{
    /// <summary>
    /// Gets the offered quality presets. Left empty by default so the server falls back to
    /// built-in presets; the admin can populate/customise it from the dashboard.
    /// </summary>
    public Collection<QualityPreset> Qualities { get; } = new();

    /// <summary>Gets or sets the output video codec ("h264" or "hevc").</summary>
    public string VideoCodec { get; set; } = "h264";

    /// <summary>Gets or sets the output audio bitrate in bits per second.</summary>
    public int AudioBitrate { get; set; } = 160_000;

    /// <summary>Gets or sets the maximum number of output audio channels (2 = stereo downmix).</summary>
    public int MaxAudioChannels { get; set; } = 2;

    /// <summary>Gets or sets a value indicating whether to offer an "Original" (direct, no transcode) download.</summary>
    public bool ShowOriginal { get; set; } = true;

    /// <summary>Gets or sets the maximum number of concurrent transcodes.</summary>
    public int MaxConcurrent { get; set; } = 2;

    /// <summary>
    /// Gets or sets a value indicating whether transcodes that are still queued are auto-cancelled
    /// when their dialog stops polling. A running transcode is never auto-cancelled regardless of
    /// this setting. Off by default, so nothing is cancelled automatically.
    /// </summary>
    public bool AutoCancelAbandoned { get; set; }

    /// <summary>Gets or sets how long (seconds) a single job may go without a status poll before it is auto-cancelled.</summary>
    public int OrphanTimeoutSeconds { get; set; } = 45;

    /// <summary>
    /// Gets or sets how long (minutes) a "Download all" batch job may go without a status poll
    /// before it is auto-cancelled. Generous by default so a big batch keeps going if the browser
    /// tab is backgrounded or briefly closed.
    /// </summary>
    public int BulkGraceMinutes { get; set; } = 1440;

    /// <summary>Gets or sets how many days a finished transcode file is kept before automatic cleanup.</summary>
    public double CleanupAfterDays { get; set; } = 7.0;

    /// <summary>
    /// Gets or sets the maximum total size (bytes) of the cache work folder. When exceeded, the
    /// oldest (least-recently-used) finished transcodes are evicted until it fits; files an
    /// in-progress job still needs are never removed. 0 = unlimited (retention-only cleanup).
    /// </summary>
    public long MaxCacheBytes { get; set; }

    /// <summary>Gets or sets an optional override path for temporary transcode files. Empty = plugin cache folder.</summary>
    public string WorkPath { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the address (scheme, host and port) at which the encoder process can reach this
    /// Jellyfin server, e.g. "http://192.168.1.10:8096". Only needed when ffmpeg does not run on
    /// the same machine as Jellyfin (ffmpeg-over-ip, remote encoder), because the default
    /// 127.0.0.1 then points at the encoder host instead of the server. Empty = local loopback.
    /// </summary>
    public string EncoderServerUrl { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets a value indicating whether the intermediate transcode is requested from Jellyfin
    /// as MPEG-TS instead of fragmented MP4. The plugin reads that stream while ffmpeg is still
    /// writing it; MPEG-TS is written strictly sequentially, whereas fragmented MP4 patches every
    /// fragment header afterwards and a reader can catch the unpatched header when the encoder's
    /// writes have latency (ffmpeg-over-ip's file tunnel). See docs/remote-encoder.md. Off by default.
    /// </summary>
    public bool SequentialIntermediate { get; set; }
}
