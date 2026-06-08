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
    /// Gets or sets a value indicating whether a transcode whose dialog stopped polling is
    /// auto-cancelled. Turn this off to let every transcode run to completion (cancel manually).
    /// </summary>
    public bool AutoCancelAbandoned { get; set; } = true;

    /// <summary>Gets or sets how long (seconds) a single job may go without a status poll before it is auto-cancelled.</summary>
    public int OrphanTimeoutSeconds { get; set; } = 45;

    /// <summary>
    /// Gets or sets how long (minutes) a "Download all" batch job may go without a status poll
    /// before it is auto-cancelled. Generous by default so a big batch keeps going if the browser
    /// tab is backgrounded or briefly closed.
    /// </summary>
    public int BulkGraceMinutes { get; set; } = 1440;

    /// <summary>Gets or sets how many days a finished transcode file is kept before automatic cleanup.</summary>
    public double CleanupAfterDays { get; set; } = 1.0;

    /// <summary>Gets or sets an optional override path for temporary transcode files. Empty = plugin cache folder.</summary>
    public string WorkPath { get; set; } = string.Empty;
}
