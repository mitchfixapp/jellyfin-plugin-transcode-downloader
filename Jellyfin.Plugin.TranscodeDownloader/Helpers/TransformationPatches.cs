using System;
using System.Text.RegularExpressions;
using Jellyfin.Plugin.TranscodeDownloader.Model;

namespace Jellyfin.Plugin.TranscodeDownloader.Helpers;

/// <summary>
/// Callback used by the File Transformation plugin to inject our script tag into index.html
/// (in-memory, so it works even when the web root is not writable and survives updates).
/// </summary>
public static class TransformationPatches
{
    private const string PluginName = "Transcode Downloader";

    /// <summary>Injects the client script tag into the index.html contents.</summary>
    /// <param name="content">The transform payload.</param>
    /// <returns>The transformed HTML.</returns>
    public static string IndexHtml(PatchRequestPayload content)
    {
        var html = content?.Contents ?? string.Empty;
        if (string.IsNullOrEmpty(html))
        {
            return html;
        }

        var cacheKey = Plugin.Instance?.CacheKey ?? "1";
        var scriptUrl = $"../TranscodeDownloader/ClientScript?v={cacheKey}";
        var scriptTag = $"<script plugin=\"{PluginName}\" src=\"{scriptUrl}\" defer></script>";

        var regex = new Regex("<script[^>]*plugin=[\"']" + Regex.Escape(PluginName) + "[\"'][^>]*>\\s*</script>\\n?");
        html = regex.Replace(html, string.Empty);

        return html.Contains("</body>", StringComparison.Ordinal)
            ? html.Replace("</body>", scriptTag + "\n</body>", StringComparison.Ordinal)
            : html;
    }
}
