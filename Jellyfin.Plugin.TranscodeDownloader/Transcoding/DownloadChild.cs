using System;

namespace Jellyfin.Plugin.TranscodeDownloader.Transcoding;

/// <summary>A downloadable child item (episode) of a series or season.</summary>
public sealed class DownloadChild
{
    /// <summary>Gets or sets the item id.</summary>
    public Guid Id { get; set; }

    /// <summary>Gets or sets the display name (for example "S01E02 Title").</summary>
    public string Name { get; set; } = string.Empty;
}
