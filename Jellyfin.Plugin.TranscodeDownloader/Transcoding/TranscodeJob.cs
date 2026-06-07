using System;
using System.Diagnostics;

namespace Jellyfin.Plugin.TranscodeDownloader.Transcoding;

/// <summary>The lifecycle state of a transcode job.</summary>
public enum JobState
{
    /// <summary>Waiting for a free concurrency slot.</summary>
    Queued,

    /// <summary>ffmpeg is running.</summary>
    Running,

    /// <summary>Finished successfully; the file is ready to download.</summary>
    Done,

    /// <summary>Failed.</summary>
    Error,

    /// <summary>Cancelled by the user or the orphan reaper.</summary>
    Cancelled
}

/// <summary>A single transcode-download job.</summary>
public class TranscodeJob
{
    /// <summary>Gets the job id.</summary>
    public Guid Id { get; init; } = Guid.NewGuid();

    /// <summary>Gets the source item id.</summary>
    public Guid ItemId { get; init; }

    /// <summary>Gets or sets the (clamped) output height.</summary>
    public int Height { get; set; }

    /// <summary>Gets or sets the download file name.</summary>
    public string FileName { get; set; } = "video.mp4";

    /// <summary>Gets or sets the source duration in seconds (for progress).</summary>
    public double DurationSeconds { get; set; }

    /// <summary>Gets or sets the job state.</summary>
    public JobState State { get; set; } = JobState.Queued;

    /// <summary>Gets or sets the progress percentage (0-100).</summary>
    public double Progress { get; set; }

    /// <summary>Gets or sets the finished file size in bytes.</summary>
    public long Size { get; set; }

    /// <summary>Gets or sets the error message, if any.</summary>
    public string? Error { get; set; }

    /// <summary>Gets or sets the output file path.</summary>
    public string OutputPath { get; set; } = string.Empty;

    /// <summary>Gets the creation time (UTC).</summary>
    public DateTime CreatedUtc { get; init; } = DateTime.UtcNow;

    /// <summary>Gets or sets the last status-poll time (UTC), used by the orphan reaper.</summary>
    public DateTime LastSeenUtc { get; set; } = DateTime.UtcNow;

    /// <summary>Gets or sets the running ffmpeg process.</summary>
    public Process? Process { get; set; }
}
