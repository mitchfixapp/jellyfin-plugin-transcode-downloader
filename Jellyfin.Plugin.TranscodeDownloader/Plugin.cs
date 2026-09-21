using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text.RegularExpressions;
using Jellyfin.Plugin.TranscodeDownloader.Configuration;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.TranscodeDownloader;

/// <summary>
/// The Transcode Downloader plugin. Lets users download a server-side transcoded
/// (smaller) version of a movie/episode, or the original, from the Jellyfin web UI.
/// </summary>
public class Plugin : BasePlugin<PluginConfiguration>, IHasWebPages
{
    private const string PluginName = "Transcode Downloader";
    private readonly IApplicationPaths _applicationPaths;
    private readonly ILogger<Plugin> _logger;

    /// <summary>
    /// Initializes a new instance of the <see cref="Plugin"/> class.
    /// </summary>
    /// <param name="applicationPaths">Instance of the <see cref="IApplicationPaths"/> interface.</param>
    /// <param name="xmlSerializer">Instance of the <see cref="IXmlSerializer"/> interface.</param>
    /// <param name="logger">Instance of the <see cref="ILogger{Plugin}"/> interface.</param>
    public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer, ILogger<Plugin> logger)
        : base(applicationPaths, xmlSerializer)
    {
        Instance = this;
        _applicationPaths = applicationPaths;
        _logger = logger;
    }

    /// <inheritdoc />
    public override string Name => PluginName;

    /// <inheritdoc />
    public override Guid Id => Guid.Parse("b3d8f1a0-7c42-4e9b-9a55-1f6e2c0d4a88");

    /// <summary>Gets the current plugin instance.</summary>
    public static Plugin? Instance { get; private set; }

    private string IndexHtmlPath => Path.Combine(_applicationPaths.WebPath, "index.html");

    /// <summary>
    /// Gets the cache-busting key for the injected script (version + dll timestamp).
    /// </summary>
    public string CacheKey
    {
        get
        {
            long ticks = 0;
            try
            {
                ticks = new FileInfo(typeof(Plugin).Assembly.Location).LastWriteTimeUtc.Ticks;
            }
            catch (IOException)
            {
                // assembly path not available; version alone is enough
            }

            return string.Format(CultureInfo.InvariantCulture, "{0}-{1}", Version, ticks);
        }
    }

    /// <inheritdoc />
    public IEnumerable<PluginPageInfo> GetPages()
    {
        return new[]
        {
            new PluginPageInfo
            {
                Name = Name,
                DisplayName = PluginName,
                EmbeddedResourcePath = string.Format(CultureInfo.InvariantCulture, "{0}.Configuration.configPage.html", GetType().Namespace)
            }
        };
    }

    /// <summary>
    /// Injects the client script tag into the served index.html (fallback when the
    /// File Transformation plugin is not installed). Requires write access to the web root.
    /// </summary>
    public void InjectScript() => UpdateIndexHtml(true);

    /// <inheritdoc />
    public override void OnUninstalling()
    {
        UpdateIndexHtml(false);
        base.OnUninstalling();
    }

    private void UpdateIndexHtml(bool inject)
    {
        try
        {
            var indexPath = IndexHtmlPath;
            if (!File.Exists(indexPath))
            {
                _logger.LogWarning("[TranscodeDownloader] index.html not found at {Path}", indexPath);
                return;
            }

            var content = File.ReadAllText(indexPath);
            var regex = new Regex("<script[^>]*plugin=[\"']" + Regex.Escape(PluginName) + "[\"'][^>]*>\\s*</script>\\n?");
            content = regex.Replace(content, string.Empty);

            if (inject)
            {
                var scriptUrl = string.Format(CultureInfo.InvariantCulture, "../TranscodeDownloader/ClientScript?v={0}", CacheKey);
                var scriptTag = string.Format(CultureInfo.InvariantCulture, "<script plugin=\"{0}\" src=\"{1}\" defer></script>", PluginName, scriptUrl);
                if (!content.Contains("</body>", StringComparison.Ordinal))
                {
                    _logger.LogWarning("[TranscodeDownloader] no </body> in index.html; script not injected");
                    return;
                }

                content = content.Replace("</body>", scriptTag + "\n</body>", StringComparison.Ordinal);
                _logger.LogInformation("[TranscodeDownloader] injected client script into index.html");
            }
            else
            {
                _logger.LogInformation("[TranscodeDownloader] removed client script from index.html");
            }

            File.WriteAllText(indexPath, content);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            _logger.LogWarning(ex, "[TranscodeDownloader] could not update index.html (web root not writable?). Install the File Transformation plugin for injection without write access.");
        }
    }
}
