using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Plugin.TranscodeDownloader.Configuration;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Net;
using MediaBrowser.Controller.Configuration;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.MediaEncoding;
using MediaBrowser.Model.Entities;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.TranscodeDownloader.Transcoding;

/// <summary>
/// Owns the transcode job queue: builds the (internal) Jellyfin transcode URL,
/// remuxes its output to a faststart MP4 with ffmpeg, tracks progress, and cleans up.
/// </summary>
public sealed class TranscodeManager : IDisposable
{
    private static readonly QualityPreset[] DefaultQualities =
    {
        new() { Label = "480p", MaxHeight = 480, MinSourceWidth = 0, VideoBitrate = 1_200_000 },
        new() { Label = "720p", MaxHeight = 720, MinSourceWidth = 1152, VideoBitrate = 2_500_000 },
        new() { Label = "1080p", MaxHeight = 1080, MinSourceWidth = 1728, VideoBitrate = 5_000_000 },
        new() { Label = "4K", MaxHeight = 2160, MinSourceWidth = 3456, VideoBitrate = 16_000_000 }
    };

    private readonly ILogger<TranscodeManager> _logger;
    private readonly ILibraryManager _libraryManager;
    private readonly IMediaEncoder _mediaEncoder;
    private readonly IServerConfigurationManager _serverConfig;
    private readonly IApplicationPaths _appPaths;

    private readonly ConcurrentDictionary<Guid, TranscodeJob> _jobs = new();
    private readonly ConcurrentDictionary<string, SemaphoreSlim> _keyLocks = new(StringComparer.Ordinal);
    private readonly SemaphoreSlim _slots;
    private readonly Timer _reaper;

    /// <summary>
    /// Initializes a new instance of the <see cref="TranscodeManager"/> class.
    /// </summary>
    /// <param name="logger">Logger.</param>
    /// <param name="libraryManager">Library manager.</param>
    /// <param name="mediaEncoder">Media encoder (provides the ffmpeg path).</param>
    /// <param name="serverConfig">Server configuration manager.</param>
    /// <param name="appPaths">Application paths.</param>
    public TranscodeManager(
        ILogger<TranscodeManager> logger,
        ILibraryManager libraryManager,
        IMediaEncoder mediaEncoder,
        IServerConfigurationManager serverConfig,
        IApplicationPaths appPaths)
    {
        _logger = logger;
        _libraryManager = libraryManager;
        _mediaEncoder = mediaEncoder;
        _serverConfig = serverConfig;
        _appPaths = appPaths;

        var max = Math.Max(1, Config.MaxConcurrent);
        _slots = new SemaphoreSlim(max, max);
        _reaper = new Timer(_ => Reap(), null, TimeSpan.FromSeconds(15), TimeSpan.FromSeconds(15));
        Directory.CreateDirectory(WorkDir);
    }

    private static PluginConfiguration Config => Plugin.Instance!.Configuration;

    private static IReadOnlyList<QualityPreset> EffectiveQualities =>
        Config.Qualities.Count > 0 ? Config.Qualities : DefaultQualities;

    private string WorkDir =>
        string.IsNullOrWhiteSpace(Config.WorkPath)
            ? Path.Combine(_appPaths.CachePath, "transcode-downloader")
            : Config.WorkPath;

    /// <summary>
    /// Gets the download options for an item. For a movie/episode this is a single video with its
    /// quality presets; for a series/season it is the list of downloadable episodes ("download all").
    /// </summary>
    /// <param name="itemId">The item id.</param>
    /// <returns>The download options, or null if the item is not downloadable.</returns>
    public DownloadOptions? GetOptions(Guid itemId)
    {
        var item = _libraryManager.GetItemById(itemId);
        if (item is Video video)
        {
            return new DownloadOptions
            {
                Kind = "video",
                ShowOriginal = Config.ShowOriginal,
                Presets = FilterPresets(GetSourceWidth(video))
            };
        }

        if (item is Folder folder)
        {
            var episodes = folder.GetRecursiveChildren(i => i is Video)
                .OfType<Video>()
                .OrderBy(e => (e as Episode)?.ParentIndexNumber ?? int.MaxValue)
                .ThenBy(e => (e as Episode)?.IndexNumber ?? int.MaxValue)
                .ThenBy(e => e.SortName, StringComparer.OrdinalIgnoreCase)
                .ToList();
            if (episodes.Count == 0)
            {
                return null;
            }

            var maxWidth = episodes.Select(GetSourceWidth).DefaultIfEmpty(0).Max();
            var children = episodes
                .Select(e => new DownloadChild { Id = e.Id, Name = BuildChildName(e) })
                .ToList();
            return new DownloadOptions
            {
                Kind = "folder",
                ShowOriginal = Config.ShowOriginal,
                Presets = FilterPresets(maxWidth),
                Children = children
            };
        }

        return null;
    }

    private static List<QualityPreset> FilterPresets(int srcWidth)
    {
        var presets = EffectiveQualities
            .Where(q => srcWidth <= 0 || srcWidth >= (int)(q.MinSourceWidth * 0.9))
            .OrderBy(q => q.MaxHeight)
            .ToList();
        if (presets.Count == 0)
        {
            presets.Add(EffectiveQualities.OrderBy(q => q.MaxHeight).First());
        }

        return presets;
    }

    private static string BuildChildName(Video v)
    {
        if (v is Episode ep)
        {
            var code = ep.ParentIndexNumber.HasValue && ep.IndexNumber.HasValue
                ? string.Format(CultureInfo.InvariantCulture, "S{0:D2}E{1:D2}", ep.ParentIndexNumber.Value, ep.IndexNumber.Value)
                : string.Empty;
            return string.Join(" ", new[] { code, ep.Name }.Where(s => !string.IsNullOrWhiteSpace(s)));
        }

        return v.Name ?? "video";
    }

    /// <summary>Creates and queues a transcode job.</summary>
    /// <param name="itemId">Source item id.</param>
    /// <param name="requestedHeight">Requested output height.</param>
    /// <param name="token">The user's access token (for the internal stream call).</param>
    /// <param name="error">Set to an error message when the job cannot be created.</param>
    /// <returns>The created job, or null on failure.</returns>
    public TranscodeJob? CreateJob(Guid itemId, int requestedHeight, string token, out string? error)
    {
        error = null;
        if (_libraryManager.GetItemById(itemId) is not Video item)
        {
            error = "This item has no media file — pick an episode or movie.";
            return null;
        }

        var srcWidth = GetSourceWidth(item);
        var preset = ResolvePreset(requestedHeight, srcWidth);
        var cacheKey = ComputeCacheKey(item, preset);
        var job = new TranscodeJob
        {
            ItemId = itemId,
            Height = preset.MaxHeight,
            DurationSeconds = (item.RunTimeTicks ?? 0) / (double)TimeSpan.TicksPerSecond,
            FileName = BuildFileName(item, preset.MaxHeight),
            CacheKey = cacheKey,
            OutputPath = Path.Combine(WorkDir, "td_" + cacheKey + ".mp4")
        };
        _jobs[job.Id] = job;

        // Reuse an identical transcode (same item, quality and encode settings) that the cleanup
        // task has not removed yet, so a repeat download is served instantly instead of being
        // re-encoded. The check is on the file on disk, so it also works after a server restart.
        if (!TryUseExistingFile(job))
        {
            _ = Task.Run(() => RunAsync(job, preset, token));
        }

        return job;
    }

    /// <summary>Gets a job and refreshes its last-seen timestamp (keeps the orphan reaper away).</summary>
    /// <param name="id">Job id.</param>
    /// <returns>The job, or null.</returns>
    public TranscodeJob? Touch(Guid id)
    {
        if (_jobs.TryGetValue(id, out var job))
        {
            job.LastSeenUtc = DateTime.UtcNow;
            return job;
        }

        return null;
    }

    /// <summary>Gets a job without touching it.</summary>
    /// <param name="id">Job id.</param>
    /// <returns>The job, or null.</returns>
    public TranscodeJob? Get(Guid id) => _jobs.TryGetValue(id, out var job) ? job : null;

    /// <summary>
    /// Opens the finished output file of a completed job for download. The path is derived
    /// solely from the server-generated job id, never from caller-supplied strings.
    /// </summary>
    /// <param name="id">Job id.</param>
    /// <param name="fileName">Set to the download file name.</param>
    /// <returns>A readable, seekable stream, or null if the job is not ready.</returns>
    [System.Diagnostics.CodeAnalysis.SuppressMessage(
        "Security",
        "CA3003:Review code for file path injection vulnerabilities",
        Justification = "The output path is composed only of the server work directory plus a 'td_' prefix and a server-computed content hash, is canonicalized, and is verified to remain within the work directory. The Guid argument only indexes an in-memory dictionary and is never used as a raw path string.")]
    public Stream? OpenCompletedFile(Guid id, out string fileName)
    {
        fileName = "video.mp4";
        if (!_jobs.TryGetValue(id, out var job) || job.State != JobState.Done)
        {
            return null;
        }

        // The output path was built server-side (work dir + a server-computed content hash).
        // Canonicalize it and verify it stays inside the work dir before opening: this validates
        // against path traversal and satisfies the taint analyzer (CA3003); the request only
        // supplies a Guid that indexes the in-memory job dictionary.
        var root = Path.GetFullPath(WorkDir);
        var candidate = Path.GetFullPath(job.OutputPath);
        if (!candidate.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.Ordinal) || !File.Exists(candidate))
        {
            return null;
        }

        fileName = job.FileName;
        return new FileStream(candidate, FileMode.Open, FileAccess.Read, FileShare.Read);
    }

    /// <summary>Cancels a job: kills ffmpeg and marks it cancelled.</summary>
    /// <param name="id">Job id.</param>
    public void Cancel(Guid id)
    {
        if (_jobs.TryGetValue(id, out var job))
        {
            CancelJob(job);
        }
    }

    /// <summary>Removes finished jobs (and their files) older than the configured retention.</summary>
    public void CleanupExpired()
    {
        var cutoff = DateTime.UtcNow - TimeSpan.FromDays(Math.Max(0, Config.CleanupAfterDays));
        foreach (var pair in _jobs.ToArray())
        {
            var job = pair.Value;
            var finished = job.State is JobState.Done or JobState.Error or JobState.Cancelled;
            if (finished && job.CreatedUtc < cutoff)
            {
                TryDelete(job.OutputPath);
                _jobs.TryRemove(pair.Key, out _);
            }
        }

        // Also remove cached output files that no live job references. After a restart the
        // in-memory job list is empty, so previously cached files would otherwise linger forever.
        // The cutoff is by last-write time (refreshed whenever a file is reused), and files a live
        // job still points to are skipped, so an in-progress or recently used transcode is safe.
        try
        {
            if (Directory.Exists(WorkDir))
            {
                var active = new HashSet<string>(
                    _jobs.Values
                        .Where(j => j.State is JobState.Queued or JobState.Running or JobState.Done)
                        .Select(j => Path.GetFullPath(j.OutputPath)),
                    StringComparer.Ordinal);

                foreach (var file in Directory.EnumerateFiles(WorkDir, "*.mp4"))
                {
                    if (active.Contains(Path.GetFullPath(file)))
                    {
                        continue;
                    }

                    try
                    {
                        if (File.GetLastWriteTimeUtc(file) < cutoff)
                        {
                            File.Delete(file);
                        }
                    }
                    catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                    {
                        // in use or already gone; skip
                    }
                }
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            _logger.LogDebug(ex, "[TranscodeDownloader] disk cleanup skipped");
        }
    }

    /// <inheritdoc />
    public void Dispose()
    {
        _reaper.Dispose();
        _slots.Dispose();
        foreach (var keyLock in _keyLocks.Values)
        {
            keyLock.Dispose();
        }

        _keyLocks.Clear();
    }

    private void Reap()
    {
        try
        {
            var timeout = TimeSpan.FromSeconds(Math.Max(10, Config.OrphanTimeoutSeconds));
            var now = DateTime.UtcNow;
            foreach (var job in _jobs.Values)
            {
                if (job.State is JobState.Queued or JobState.Running && now - job.LastSeenUtc > timeout)
                {
                    _logger.LogInformation("[TranscodeDownloader] orphan job {Id} ({File}) cancelled", job.Id, job.FileName);
                    CancelJob(job);
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[TranscodeDownloader] reaper error");
        }
    }

    private static void CancelJob(TranscodeJob job)
    {
        job.State = JobState.Cancelled;
        try
        {
            if (job.Process is { HasExited: false } p)
            {
                p.Kill(true);
            }
        }
        catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception)
        {
            // process already gone
        }
    }

    private async Task RunAsync(TranscodeJob job, QualityPreset preset, string token)
    {
        // ffmpeg writes to a per-job temp file that is renamed onto the cache path only on success,
        // so the cache only ever holds complete files (a killed/partial run is never reused).
        var tempPath = Path.Combine(WorkDir, job.Id.ToString("N", CultureInfo.InvariantCulture) + ".part.mp4");

        // Serialize identical requests (same cache key) so two concurrent downloads of the same item
        // and quality encode once and the second reuses the result. The key lock is taken before a
        // concurrency slot so a waiting duplicate does not occupy a slot.
        var keyLock = _keyLocks.GetOrAdd(job.CacheKey, _ => new SemaphoreSlim(1, 1));
        await keyLock.WaitAsync().ConfigureAwait(false);
        try
        {
            if (job.State == JobState.Cancelled || TryUseExistingFile(job))
            {
                return;
            }

            await _slots.WaitAsync().ConfigureAwait(false);
            try
            {
                if (job.State == JobState.Cancelled || TryUseExistingFile(job))
                {
                    return;
                }

                job.State = JobState.Running;
                var url = BuildStreamUrl(job.ItemId, preset, token, job.Id);

                // Jellyfin's internal transcode stream occasionally returns a transient 5XX when several
                // transcodes start at once (e.g. "Download all"); retry once before giving up.
                const int maxAttempts = 2;
                for (var attempt = 1; attempt <= maxAttempts; attempt++)
                {
                    var stderr = new StringBuilder();
                    var psi = new ProcessStartInfo
                    {
                        FileName = _mediaEncoder.EncoderPath,
                        RedirectStandardOutput = true,
                        RedirectStandardError = true,
                        UseShellExecute = false,
                        CreateNoWindow = true
                    };
                    foreach (var arg in BuildFfmpegArgs(job, url, tempPath))
                    {
                        psi.ArgumentList.Add(arg);
                    }

                    using (var process = new Process { StartInfo = psi, EnableRaisingEvents = true })
                    {
                        process.OutputDataReceived += (_, e) =>
                        {
                            if (e.Data is not null)
                            {
                                ParseProgress(job, e.Data);
                            }
                        };
                        process.ErrorDataReceived += (_, e) =>
                        {
                            if (e.Data is not null && stderr.Length < 4000)
                            {
                                stderr.AppendLine(e.Data);
                            }
                        };

                        job.Process = process;
                        process.Start();
                        process.BeginOutputReadLine();
                        process.BeginErrorReadLine();
                        await process.WaitForExitAsync().ConfigureAwait(false);

                        if (job.State == JobState.Cancelled)
                        {
                            TryDelete(tempPath);
                            return;
                        }

                        if (process.ExitCode == 0 && File.Exists(tempPath) && new FileInfo(tempPath).Length > 0)
                        {
                            Promote(tempPath, job);
                            job.Progress = 100;
                            job.State = JobState.Done;
                            _logger.LogInformation("[TranscodeDownloader] finished {File} ({Size} bytes)", job.FileName, job.Size);
                            return;
                        }

                        var error = Tail(stderr.ToString()) ?? string.Format(CultureInfo.InvariantCulture, "ffmpeg exit {0}", process.ExitCode);
                        TryDelete(tempPath);

                        if (attempt < maxAttempts)
                        {
                            _logger.LogWarning("[TranscodeDownloader] job {Id} attempt {Attempt}/{Max} failed ({Error}); retrying", job.Id, attempt, maxAttempts, error);
                            job.Progress = 0;
                            await Task.Delay(2000).ConfigureAwait(false);
                            if (job.State == JobState.Cancelled)
                            {
                                return;
                            }

                            continue;
                        }

                        job.State = JobState.Error;
                        job.Error = error;
                        _logger.LogWarning("[TranscodeDownloader] job {Id} failed after {Max} attempts: {Error}", job.Id, maxAttempts, job.Error);
                    }
                }
            }
            finally
            {
                _slots.Release();
            }
        }
        catch (Exception ex)
        {
            job.State = JobState.Error;
            job.Error = ex.Message;
            _logger.LogError(ex, "[TranscodeDownloader] job {Id} crashed", job.Id);
            TryDelete(tempPath);
        }
        finally
        {
            keyLock.Release();
        }
    }

    /// <summary>
    /// Marks a job as done by reusing the cache file already on disk, refreshing its last-write
    /// time so recently used transcodes are not cleaned up. Returns false if no complete file exists.
    /// </summary>
    private bool TryUseExistingFile(TranscodeJob job)
    {
        try
        {
            if (File.Exists(job.OutputPath))
            {
                var fi = new FileInfo(job.OutputPath);
                if (fi.Length > 0)
                {
                    try
                    {
                        File.SetLastWriteTimeUtc(job.OutputPath, DateTime.UtcNow);
                    }
                    catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                    {
                        // touching the timestamp is best-effort
                    }

                    job.Size = fi.Length;
                    job.Progress = 100;
                    job.State = JobState.Done;
                    _logger.LogInformation("[TranscodeDownloader] reusing cached {File} ({Size} bytes)", job.FileName, job.Size);
                    return true;
                }
            }
        }
        catch (IOException)
        {
            // fall through and transcode fresh
        }

        return false;
    }

    private void Promote(string tempPath, TranscodeJob job)
    {
        try
        {
            File.Move(tempPath, job.OutputPath, overwrite: true);
        }
        catch (IOException ex)
        {
            _logger.LogDebug(ex, "[TranscodeDownloader] could not move temp into cache for {Id}", job.Id);
            TryDelete(tempPath);
        }

        try
        {
            job.Size = File.Exists(job.OutputPath) ? new FileInfo(job.OutputPath).Length : 0;
        }
        catch (IOException)
        {
            job.Size = 0;
        }
    }

    private List<string> BuildFfmpegArgs(TranscodeJob job, string url, string outputPath)
    {
        var args = new List<string> { "-hide_banner", "-loglevel", "error", "-i", url };

        // Collect the source's text subtitle tracks so they can be embedded as selectable (soft)
        // tracks in the download. An MP4 can only carry text subtitles (mov_text), so image
        // subtitles such as PGS/VOBSUB are skipped. Embedded text subs are read back from the
        // original file, external ones from their sidecar files; each is added as its own input.
        var embedded = new List<MediaStream>();
        var external = new List<MediaStream>();
        string? originalPath = null;
        if (_libraryManager.GetItemById(job.ItemId) is Video video)
        {
            originalPath = video.Path;
            try
            {
                foreach (var s in video.GetMediaStreams())
                {
                    if (s.Type != MediaStreamType.Subtitle || !s.IsTextSubtitleStream)
                    {
                        continue;
                    }

                    if (s.IsExternal)
                    {
                        if (!string.IsNullOrEmpty(s.Path) && File.Exists(s.Path))
                        {
                            external.Add(s);
                        }
                    }
                    else
                    {
                        embedded.Add(s);
                    }
                }
            }
            catch (InvalidOperationException)
            {
                embedded.Clear();
                external.Clear();
            }
        }

        var hasOriginal = embedded.Count > 0 && !string.IsNullOrEmpty(originalPath) && File.Exists(originalPath);
        if (hasOriginal)
        {
            args.Add("-i");
            args.Add(originalPath!);
        }

        var externalInputStart = hasOriginal ? 2 : 1;
        foreach (var es in external)
        {
            args.Add("-i");
            args.Add(es.Path!);
        }

        // Video + audio come from the Jellyfin transcode (input 0); subtitles from the original
        // file (input 1) and/or the external sidecars. Every map is optional (?) so a missing
        // stream never fails the whole remux.
        args.Add("-map");
        args.Add("0:v:0");
        args.Add("-map");
        args.Add("0:a?");

        var orderedSubs = new List<MediaStream>();
        if (hasOriginal)
        {
            foreach (var s in embedded)
            {
                args.Add("-map");
                args.Add(string.Format(CultureInfo.InvariantCulture, "1:{0}?", s.Index));
                orderedSubs.Add(s);
            }
        }

        for (var i = 0; i < external.Count; i++)
        {
            args.Add("-map");
            args.Add(string.Format(CultureInfo.InvariantCulture, "{0}:0?", externalInputStart + i));
            orderedSubs.Add(external[i]);
        }

        args.Add("-c");
        args.Add("copy");
        if (orderedSubs.Count > 0)
        {
            args.Add("-c:s");
            args.Add("mov_text");
        }

        // Tag each output subtitle track with language/title so the local player can label them.
        for (var i = 0; i < orderedSubs.Count; i++)
        {
            var s = orderedSubs[i];
            if (!string.IsNullOrWhiteSpace(s.Language))
            {
                args.Add(string.Format(CultureInfo.InvariantCulture, "-metadata:s:s:{0}", i));
                args.Add("language=" + s.Language);
            }

            if (!string.IsNullOrWhiteSpace(s.Title))
            {
                args.Add(string.Format(CultureInfo.InvariantCulture, "-metadata:s:s:{0}", i));
                args.Add("title=" + s.Title);
            }
        }

        args.Add("-movflags");
        args.Add("+faststart");
        args.Add("-progress");
        args.Add("pipe:1");
        args.Add("-nostats");
        args.Add("-y");
        args.Add(outputPath);
        return args;
    }

    private static void ParseProgress(TranscodeJob job, string line)
    {
        // ffmpeg -progress emits "out_time=HH:MM:SS.micros"
        if (!line.StartsWith("out_time=", StringComparison.Ordinal) || job.DurationSeconds <= 0)
        {
            return;
        }

        var m = Regex.Match(line, @"out_time=(\d+):(\d{2}):(\d{2}(?:\.\d+)?)");
        if (m.Success
            && int.TryParse(m.Groups[1].Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var h)
            && int.TryParse(m.Groups[2].Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var min)
            && double.TryParse(m.Groups[3].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var s))
        {
            var secs = (h * 3600) + (min * 60) + s;
            job.Progress = Math.Min(99, secs / job.DurationSeconds * 100);
        }
    }

    private string BuildStreamUrl(Guid itemId, QualityPreset preset, string token, Guid jobId)
    {
        var net = _serverConfig.GetNetworkConfiguration();
        var baseUrl = (net.BaseUrl ?? string.Empty).TrimEnd('/');
        var id = itemId.ToString("N", CultureInfo.InvariantCulture);
        var q = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["static"] = "false",
            ["mediaSourceId"] = id,
            ["deviceId"] = "transcode-downloader-" + jobId.ToString("N", CultureInfo.InvariantCulture),
            ["container"] = "mp4",
            ["videoCodec"] = Config.VideoCodec,
            ["audioCodec"] = "aac",
            ["maxHeight"] = preset.MaxHeight.ToString(CultureInfo.InvariantCulture),
            ["videoBitRate"] = preset.VideoBitrate.ToString(CultureInfo.InvariantCulture),
            ["audioBitRate"] = Config.AudioBitrate.ToString(CultureInfo.InvariantCulture),
            ["maxAudioChannels"] = Config.MaxAudioChannels.ToString(CultureInfo.InvariantCulture),
            ["api_key"] = token
        };
        var query = string.Join("&", q.Select(kv => kv.Key + "=" + Uri.EscapeDataString(kv.Value)));
        return string.Format(
            CultureInfo.InvariantCulture,
            "http://127.0.0.1:{0}{1}/Videos/{2}/stream.mp4?{3}",
            net.InternalHttpPort,
            baseUrl,
            id,
            query);
    }

    private static QualityPreset ResolvePreset(int requestedHeight, int srcWidth)
    {
        var ordered = EffectiveQualities.OrderBy(q => q.MaxHeight).ToList();
        var requested = ordered.FirstOrDefault(q => q.MaxHeight == requestedHeight) ?? ordered[^1];

        if (srcWidth > 0 && srcWidth < requested.MinSourceWidth)
        {
            var allowed = ordered.Where(q => q.MinSourceWidth <= srcWidth).ToList();
            if (allowed.Count > 0)
            {
                return allowed[^1];
            }
        }

        return requested;
    }

    private static int GetSourceWidth(BaseItem item)
    {
        try
        {
            var v = item.GetMediaStreams().FirstOrDefault(s => s.Type == MediaStreamType.Video);
            return v?.Width ?? 0;
        }
        catch (InvalidOperationException)
        {
            return 0;
        }
    }

    /// <summary>
    /// Builds a deterministic cache key from everything that affects the output bytes: the item,
    /// the resolved quality, the encode settings, and the source file's size and modified time
    /// (so the cache invalidates when the source or settings change).
    /// </summary>
    private static string ComputeCacheKey(Video item, QualityPreset preset)
    {
        long length = 0;
        long modifiedTicks = 0;
        try
        {
            if (!string.IsNullOrEmpty(item.Path) && File.Exists(item.Path))
            {
                var fi = new FileInfo(item.Path);
                length = fi.Length;
                modifiedTicks = fi.LastWriteTimeUtc.Ticks;
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // source not directly statable; the id + runtime below still key the cache
        }

        var raw = string.Join(
            "|",
            item.Id.ToString("N", CultureInfo.InvariantCulture),
            preset.MaxHeight.ToString(CultureInfo.InvariantCulture),
            preset.VideoBitrate.ToString(CultureInfo.InvariantCulture),
            Config.VideoCodec,
            Config.AudioBitrate.ToString(CultureInfo.InvariantCulture),
            Config.MaxAudioChannels.ToString(CultureInfo.InvariantCulture),
            length.ToString(CultureInfo.InvariantCulture),
            modifiedTicks.ToString(CultureInfo.InvariantCulture));
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(raw));
        return Convert.ToHexString(hash, 0, 12).ToLowerInvariant();
    }

    private static string BuildFileName(BaseItem item, int height)
    {
        string baseName;
        if (item is Episode ep)
        {
            var code = ep.ParentIndexNumber.HasValue && ep.IndexNumber.HasValue
                ? string.Format(CultureInfo.InvariantCulture, "S{0:D2}E{1:D2}", ep.ParentIndexNumber.Value, ep.IndexNumber.Value)
                : string.Empty;
            baseName = string.Join(" ", new[] { ep.SeriesName, code, ep.Name }.Where(s => !string.IsNullOrWhiteSpace(s)));
        }
        else
        {
            baseName = item.Name ?? "video";
            if (item.ProductionYear is int year)
            {
                baseName += string.Format(CultureInfo.InvariantCulture, " ({0})", year);
            }
        }

        baseName = string.Format(CultureInfo.InvariantCulture, "{0} {1}p", baseName, height);
        foreach (var c in Path.GetInvalidFileNameChars())
        {
            baseName = baseName.Replace(c, '_');
        }

        return baseName.Trim() + ".mp4";
    }

    private static string? Tail(string s)
    {
        s = s.Trim();
        if (s.Length == 0)
        {
            return null;
        }

        return s.Length <= 500 ? s : s[^500..];
    }

    private void TryDelete(string path)
    {
        try
        {
            if (!string.IsNullOrEmpty(path) && File.Exists(path))
            {
                File.Delete(path);
            }
        }
        catch (IOException ex)
        {
            _logger.LogDebug(ex, "[TranscodeDownloader] could not delete {Path}", path);
        }
    }
}
