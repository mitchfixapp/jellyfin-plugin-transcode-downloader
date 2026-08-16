using System.Collections.Generic;
using Jellyfin.Plugin.TranscodeDownloader.Configuration;

namespace Jellyfin.Plugin.TranscodeDownloader.Transcoding;

/// <summary>The download options for an item: a single video, or a folder (series/season) of episodes.</summary>
public sealed class DownloadOptions
{
    /// <summary>Gets or sets the item kind: <c>"video"</c> for a movie/episode, <c>"folder"</c> for a series/season.</summary>
    public string Kind { get; set; } = "video";

    /// <summary>
    /// Gets or sets the name the download group is headed with: the series for an episode or a
    /// season, otherwise the item itself.
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>Gets or sets the name of the single item's own row (e.g. <c>"S05E05 Road Rage"</c>).</summary>
    public string ItemLabel { get; set; } = string.Empty;

    /// <summary>Gets or sets a value indicating whether the "Original" (no transcode) option is offered.</summary>
    public bool ShowOriginal { get; set; }

    /// <summary>Gets the quality presets offered for this item.</summary>
    public IReadOnlyList<QualityPreset> Presets { get; init; } = new List<QualityPreset>();

    /// <summary>Gets the downloadable child episodes, when <see cref="Kind"/> is <c>"folder"</c>.</summary>
    public IReadOnlyList<DownloadChild> Children { get; init; } = new List<DownloadChild>();
}
