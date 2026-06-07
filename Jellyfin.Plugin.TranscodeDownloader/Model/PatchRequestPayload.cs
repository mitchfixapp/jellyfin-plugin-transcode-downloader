namespace Jellyfin.Plugin.TranscodeDownloader.Model;

/// <summary>Payload passed by the File Transformation plugin to a transform callback.</summary>
public class PatchRequestPayload
{
    /// <summary>Gets or sets the current file contents to transform.</summary>
    public string? Contents { get; set; }
}
