using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Runtime.Loader;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Plugin.TranscodeDownloader.Helpers;
using MediaBrowser.Model.Tasks;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json.Linq;

namespace Jellyfin.Plugin.TranscodeDownloader.ScheduledTasks;

/// <summary>
/// Runs at startup and injects the client script into the web UI. Prefers the
/// File Transformation plugin (in-memory, no write access needed); falls back to
/// patching index.html directly.
/// </summary>
public class StartupInjectionTask : IScheduledTask
{
    private readonly ILogger<StartupInjectionTask> _logger;

    /// <summary>Initializes a new instance of the <see cref="StartupInjectionTask"/> class.</summary>
    /// <param name="logger">Logger.</param>
    public StartupInjectionTask(ILogger<StartupInjectionTask> logger)
    {
        _logger = logger;
    }

    /// <inheritdoc />
    public string Name => "Transcode Downloader: inject UI";

    /// <inheritdoc />
    public string Key => "TranscodeDownloaderInject";

    /// <inheritdoc />
    public string Description => "Injects the Transcode Downloader button into the Jellyfin web UI.";

    /// <inheritdoc />
    public string Category => "Transcode Downloader";

    /// <inheritdoc />
    public IEnumerable<TaskTriggerInfo> GetDefaultTriggers() => new[]
    {
        new TaskTriggerInfo { Type = TaskTriggerInfoType.StartupTrigger }
    };

    /// <inheritdoc />
    public Task ExecuteAsync(IProgress<double> progress, CancellationToken cancellationToken)
    {
        try
        {
            if (!TryRegisterFileTransformation())
            {
                _logger.LogInformation("[TranscodeDownloader] File Transformation plugin not found; using direct index.html injection.");
                Plugin.Instance?.InjectScript();
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[TranscodeDownloader] script injection failed; trying direct injection.");
            try
            {
                Plugin.Instance?.InjectScript();
            }
            catch (Exception ex2)
            {
                _logger.LogError(ex2, "[TranscodeDownloader] direct injection also failed.");
            }
        }

        progress.Report(100);
        return Task.CompletedTask;
    }

    private bool TryRegisterFileTransformation()
    {
        var assembly = AssemblyLoadContext.All
            .SelectMany(x => x.Assemblies)
            .FirstOrDefault(x => x.FullName?.Contains(".FileTransformation", StringComparison.Ordinal) ?? false);

        var interfaceType = assembly?.GetType("Jellyfin.Plugin.FileTransformation.PluginInterface");
        if (interfaceType is null)
        {
            return false;
        }

        var payload = new JObject
        {
            { "id", "b3d8f1a0-7c42-4e9b-9a55-1f6e2c0d4a88" },
            { "fileNamePattern", "index.html" },
            { "callbackAssembly", GetType().Assembly.FullName },
            { "callbackClass", typeof(TransformationPatches).FullName },
            { "callbackMethod", nameof(TransformationPatches.IndexHtml) }
        };

        interfaceType.GetMethod("RegisterTransformation")?.Invoke(null, new object?[] { payload });
        _logger.LogInformation("[TranscodeDownloader] registered script injection with the File Transformation plugin.");
        return true;
    }
}
