namespace Jellyfin.Plugin.TranscodeDownloader.Api;

/// <summary>Request body for starting a transcode job.</summary>
public class StartJobRequest
{
    /// <summary>Gets or sets the item id.</summary>
    public string ItemId { get; set; } = string.Empty;

    /// <summary>Gets or sets the requested output height.</summary>
    public int Height { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether this job is part of a "Download all" batch.
    /// Batch jobs get a longer orphan grace so the whole set finishes even if the dialog's
    /// polling is throttled (e.g. a backgrounded browser tab).
    /// </summary>
    public bool Bulk { get; set; }
}
