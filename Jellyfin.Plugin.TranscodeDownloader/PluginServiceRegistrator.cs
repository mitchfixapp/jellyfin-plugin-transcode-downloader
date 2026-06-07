using Jellyfin.Plugin.TranscodeDownloader.Transcoding;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using Microsoft.Extensions.DependencyInjection;

namespace Jellyfin.Plugin.TranscodeDownloader;

/// <summary>Registers plugin services in Jellyfin's DI container.</summary>
public class PluginServiceRegistrator : IPluginServiceRegistrator
{
    /// <inheritdoc />
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        // Singleton: holds the job queue and state for the lifetime of the server.
        serviceCollection.AddSingleton<TranscodeManager>();
    }
}
