namespace Jellyfin.Plugin.TranscodeDownloader.Configuration;

/// <summary>
/// A selectable download quality preset.
/// </summary>
public class QualityPreset
{
    /// <summary>Gets or sets the label shown to the user (e.g. "720p").</summary>
    public string Label { get; set; } = string.Empty;

    /// <summary>Gets or sets the maximum output height in pixels (Jellyfin keeps the aspect ratio).</summary>
    public int MaxHeight { get; set; }

    /// <summary>
    /// Gets or sets the source width (px) at or above which this preset is offered.
    /// Prevents upscaling: a 1080p source won't show a 4K option.
    /// </summary>
    public int MinSourceWidth { get; set; }

    /// <summary>Gets or sets the target video bitrate in bits per second.</summary>
    public int VideoBitrate { get; set; }
}
