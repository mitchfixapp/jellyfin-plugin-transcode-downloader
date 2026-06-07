namespace Jellyfin.Plugin.TranscodeDownloader.Api;

/// <summary>Request body for starting a transcode job.</summary>
public class StartJobRequest
{
    /// <summary>Gets or sets the item id.</summary>
    public string ItemId { get; set; } = string.Empty;

    /// <summary>Gets or sets the requested output height.</summary>
    public int Height { get; set; }
}
