using System;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;
using Jellyfin.Plugin.TranscodeDownloader.Transcoding;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.TranscodeDownloader.Api;

/// <summary>HTTP API for the Transcode Downloader plugin.</summary>
[ApiController]
[Route("TranscodeDownloader")]
public class TranscodeDownloaderController : ControllerBase
{
    private readonly TranscodeManager _manager;

    /// <summary>Initializes a new instance of the <see cref="TranscodeDownloaderController"/> class.</summary>
    /// <param name="manager">The transcode manager.</param>
    public TranscodeDownloaderController(TranscodeManager manager)
    {
        _manager = manager;
    }

    /// <summary>Serves the client script that is injected into the web UI.</summary>
    /// <returns>The JavaScript file.</returns>
    [HttpGet("ClientScript")]
    [AllowAnonymous]
    public ActionResult GetClientScript()
    {
        var asm = GetType().Assembly;
        var name = asm.GetManifestResourceNames().FirstOrDefault(n => n.EndsWith("client.js", StringComparison.Ordinal));
        if (name is null)
        {
            return NotFound();
        }

        var stream = asm.GetManifestResourceStream(name);
        return stream is null ? NotFound() : File(stream, "application/javascript; charset=utf-8");
    }

    /// <summary>Gets the available download options for an item.</summary>
    /// <param name="itemId">The item id.</param>
    /// <returns>The presets and whether "Original" is offered.</returns>
    [HttpGet("Options")]
    [Authorize]
    public ActionResult GetOptions([FromQuery] Guid itemId)
    {
        var opts = _manager.GetOptions(itemId);
        if (opts is null)
        {
            return Ok(new { downloadable = false });
        }

        return Ok(new
        {
            downloadable = true,
            kind = opts.Kind,
            showOriginal = opts.ShowOriginal,
            presets = opts.Presets.Select(p => new { label = p.Label, height = p.MaxHeight }),
            children = opts.Children.Select(c => new
            {
                id = c.Id.ToString("N", CultureInfo.InvariantCulture),
                name = c.Name
            })
        });
    }

    /// <summary>Starts a transcode job.</summary>
    /// <param name="body">The request.</param>
    /// <returns>The job id and file name.</returns>
    [HttpPost("Jobs")]
    [Authorize]
    public ActionResult CreateJob([FromBody] StartJobRequest body)
    {
        var token = GetToken();
        if (string.IsNullOrEmpty(token))
        {
            return Unauthorized();
        }

        if (body is null || !Guid.TryParse(body.ItemId, out var id))
        {
            return BadRequest("invalid itemId");
        }

        var job = _manager.CreateJob(id, body.Height, token, out var error);
        if (job is null)
        {
            return BadRequest(error);
        }

        return Ok(new { jobId = job.Id.ToString("N", CultureInfo.InvariantCulture), filename = job.FileName });
    }

    /// <summary>Gets a job's status.</summary>
    /// <param name="id">Job id.</param>
    /// <returns>The status.</returns>
    [HttpGet("Jobs/{id:guid}")]
    [Authorize]
    public ActionResult GetJob(Guid id)
    {
        var job = _manager.Touch(id);
        if (job is null)
        {
            return NotFound();
        }

        return Ok(new
        {
            state = job.State.ToString().ToLowerInvariant(),
            progress = Math.Round(job.Progress, 1),
            filename = job.FileName,
            size = job.Size,
            error = job.Error
        });
    }

    /// <summary>Cancels a job.</summary>
    /// <param name="id">Job id.</param>
    /// <returns>The cancelled state.</returns>
    [HttpDelete("Jobs/{id:guid}")]
    [Authorize]
    public ActionResult CancelJob(Guid id)
    {
        _manager.Cancel(id);
        return Ok(new { state = "cancelled" });
    }

    /// <summary>Downloads a finished transcode file.</summary>
    /// <param name="id">Job id.</param>
    /// <returns>The file.</returns>
    [HttpGet("Jobs/{id:guid}/File")]
    [Authorize]
    public ActionResult GetFile(Guid id)
    {
        var stream = _manager.OpenCompletedFile(id, out var fileName);
        if (stream is null)
        {
            return NotFound();
        }

        return File(stream, "video/mp4", fileName, enableRangeProcessing: true);
    }

    private string? GetToken()
    {
        if (Request.Query.TryGetValue("api_key", out var k) && !string.IsNullOrEmpty(k))
        {
            return k.ToString();
        }

        if (Request.Headers.TryGetValue("X-Emby-Token", out var h) && !string.IsNullOrEmpty(h))
        {
            return h.ToString();
        }

        var auth = Request.Headers.Authorization.ToString();
        var m = Regex.Match(auth, "Token=\"?([^\",]+)\"?", RegexOptions.IgnoreCase);
        return m.Success ? m.Groups[1].Value : null;
    }
}
