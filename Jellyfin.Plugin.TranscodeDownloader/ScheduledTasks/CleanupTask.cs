using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Plugin.TranscodeDownloader.Transcoding;
using MediaBrowser.Model.Tasks;

namespace Jellyfin.Plugin.TranscodeDownloader.ScheduledTasks;

/// <summary>Periodically deletes finished transcode files older than the configured retention.</summary>
public class CleanupTask : IScheduledTask
{
    private readonly TranscodeManager _manager;

    /// <summary>Initializes a new instance of the <see cref="CleanupTask"/> class.</summary>
    /// <param name="manager">The transcode manager.</param>
    public CleanupTask(TranscodeManager manager)
    {
        _manager = manager;
    }

    /// <inheritdoc />
    public string Name => "Transcode Downloader: cleanup";

    /// <inheritdoc />
    public string Key => "TranscodeDownloaderCleanup";

    /// <inheritdoc />
    public string Description => "Deletes finished transcode files older than the configured retention period.";

    /// <inheritdoc />
    public string Category => "Transcode Downloader";

    /// <inheritdoc />
    public IEnumerable<TaskTriggerInfo> GetDefaultTriggers() => new[]
    {
        new TaskTriggerInfo
        {
            Type = TaskTriggerInfoType.IntervalTrigger,
            IntervalTicks = TimeSpan.FromHours(6).Ticks
        }
    };

    /// <inheritdoc />
    public Task ExecuteAsync(IProgress<double> progress, CancellationToken cancellationToken)
    {
        _manager.CleanupExpired();
        progress.Report(100);
        return Task.CompletedTask;
    }
}
