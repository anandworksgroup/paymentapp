using System.Diagnostics;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using PaymentApp.Api.Common;
using PaymentApp.Api.Data;

namespace PaymentApp.Api.Infrastructure;

/// <summary>Stable error envelope (§133): { error: { code, message, request_id, details } }.</summary>
public class ErrorMiddleware(RequestDelegate next, ILogger<ErrorMiddleware> log)
{
    public async Task Invoke(HttpContext http, RequestContext ctx)
    {
        try
        {
            await next(http);
        }
        catch (Exception ex) when (!http.Response.HasStarted)
        {
            var (status, code, message, details) = ex switch
            {
                ApiException a => (a.Status, a.Code, a.Message, a.Details),
                DbUpdateConcurrencyException => (409, "concurrent_modification", "This object was changed by another request. Retry with fresh data.", null),
                BadHttpRequestException b => (400, "invalid_request", b.InnerException?.Message ?? b.Message, null),
                System.Text.Json.JsonException j => (400, "invalid_json", j.Message, null),
                DbUpdateException d when d.InnerException?.Message.Contains("UNIQUE") == true => (409, "duplicate", "A conflicting record already exists.", null),
                _ => (500, "internal_error", "Something went wrong on our side. The request id helps support trace it.", null),
            };
            if (status >= 500) log.LogError(ex, "Unhandled error {RequestId}", ctx.RequestId);
            http.Response.StatusCode = status;
            http.Items["error_code"] = code;
            await http.Response.WriteAsJsonAsync(new { error = new { code, message, request_id = ctx.RequestId, details } }, Json.Options);
        }
    }
}

/// <summary>
/// Idempotency-Key support for every POST (§20, §144): the first result is stored and replayed for
/// retries with the same key and body; a different body with a reused key is rejected.
/// </summary>
public class IdempotencyMiddleware(RequestDelegate next)
{
    public async Task Invoke(HttpContext http, RequestContext ctx, DbContextOptions<AppDb> options, IClock clock)
    {
        var key = http.Request.Headers["Idempotency-Key"].FirstOrDefault();
        if (!HttpMethods.IsPost(http.Request.Method) || string.IsNullOrEmpty(key)) { await next(http); return; }
        if (key.Length > 255) throw ApiException.Invalid("Idempotency-Key must be at most 255 characters.");

        http.Request.EnableBuffering();
        string body;
        using (var reader = new StreamReader(http.Request.Body, leaveOpen: true)) body = await reader.ReadToEndAsync();
        http.Request.Body.Position = 0;
        var scope = ctx.ApiKey != null ? $"org:{ctx.OrgId}:{ctx.Livemode}" : ctx.User != null ? $"user:{ctx.User.Id}:{ctx.OrgId}:{ctx.Livemode}" : $"public:{http.Request.Path}";
        var hash = Crypto.Sha256Hex($"{http.Request.Method} {http.Request.Path}\n{body}");

        await using var db = new AppDb(options, SystemScope());
        var record = new IdempotencyRecord { Scope = scope, Key = key, Method = http.Request.Method, Path = http.Request.Path, RequestHash = hash, CreatedAt = clock.UtcNow };
        db.IdempotencyRecords.Add(record);
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateException)
        {
            db.ChangeTracker.Clear();
            var existing = await db.IdempotencyRecords.AsNoTracking().FirstAsync(r => r.Scope == scope && r.Key == key);
            if (existing.RequestHash != hash) throw new ApiException(422, "idempotency_key_reused", "This Idempotency-Key was used with a different request.");
            if (existing.CompletedAt == null) throw ApiException.Conflict("idempotency_in_progress", "A request with this Idempotency-Key is still being processed.");
            http.Response.StatusCode = existing.ResponseStatus ?? 200;
            http.Response.ContentType = "application/json";
            http.Response.Headers["Idempotent-Replayed"] = "true";
            await http.Response.WriteAsync(existing.ResponseBody ?? "");
            return;
        }

        var original = http.Response.Body;
        using var buffer = new MemoryStream();
        http.Response.Body = buffer;
        try
        {
            await next(http);
        }
        catch
        {
            http.Response.Body = original;
            db.IdempotencyRecords.Remove(record);
            await db.SaveChangesAsync();
            throw;
        }
        buffer.Position = 0;
        var responseBody = await new StreamReader(buffer).ReadToEndAsync();
        buffer.Position = 0;
        await buffer.CopyToAsync(original);
        http.Response.Body = original;
        if (http.Response.StatusCode >= 500) db.IdempotencyRecords.Remove(record);
        else
        {
            record.ResponseStatus = http.Response.StatusCode;
            record.ResponseBody = responseBody;
            record.CompletedAt = clock.UtcNow;
        }
        await db.SaveChangesAsync();
    }

    private static TenantScope SystemScope() { var t = new TenantScope(); t.EnterSystem(); return t; }
}

/// <summary>Per-request API log (§130): who, what, how long — never request bodies or secrets.</summary>
public class RequestLogMiddleware(RequestDelegate next)
{
    public async Task Invoke(HttpContext http, RequestContext ctx, DbContextOptions<AppDb> options, IClock clock)
    {
        var sw = Stopwatch.StartNew();
        try { await next(http); }
        finally
        {
            if (http.Request.Path.StartsWithSegments("/v1") && !http.Request.Path.StartsWithSegments("/v1/public/sim"))
            {
                try
                {
                    var t = new TenantScope();
                    t.EnterSystem();
                    await using var db = new AppDb(options, t);
                    db.ApiRequestLogs.Add(new ApiRequestLog
                    {
                        RequestId = ctx.RequestId, OrgId = ctx.OrgId, Livemode = ctx.Livemode, UserId = ctx.User?.Id, ApiKeyId = ctx.ApiKey?.Id,
                        Method = http.Request.Method, Path = http.Request.Path, Status = http.Response.StatusCode, LatencyMs = (int)sw.ElapsedMilliseconds,
                        Ip = ctx.Ip, UserAgent = ctx.UserAgent?.Length > 200 ? ctx.UserAgent[..200] : ctx.UserAgent, ErrorCode = http.Items["error_code"] as string, At = clock.UtcNow,
                    });
                    await db.SaveChangesAsync();
                }
                catch { /* logging must never break the request */ }
            }
        }
    }
}

public static class RateLimits
{
    /// <summary>Limits per API key / user / IP (§79), stricter on money-moving endpoints; 429 + Retry-After (§134).</summary>
    public static void Configure(RateLimiterOptions o, IConfiguration config)
    {
        static string Partition(HttpContext h)
        {
            var auth = h.Request.Headers.Authorization.ToString();
            return auth.Length > 20 ? "k:" + Crypto.Sha256Hex(auth)[..16] : "ip:" + h.Connection.RemoteIpAddress;
        }
        var scale = config.GetValue("RateLimits:Scale", 1);
        o.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(h =>
            RateLimitPartition.GetFixedWindowLimiter(Partition(h), _ => new FixedWindowRateLimiterOptions { PermitLimit = 600 * scale, Window = TimeSpan.FromMinutes(1) }));
        o.AddPolicy("financial", h => RateLimitPartition.GetFixedWindowLimiter("fin:" + Partition(h), _ => new FixedWindowRateLimiterOptions { PermitLimit = 60 * scale, Window = TimeSpan.FromMinutes(1) }));
        o.AddPolicy("public", h => RateLimitPartition.GetFixedWindowLimiter("pub:" + h.Connection.RemoteIpAddress, _ => new FixedWindowRateLimiterOptions { PermitLimit = 120 * scale, Window = TimeSpan.FromMinutes(1) }));
        o.OnRejected = async (c, token) =>
        {
            c.HttpContext.Response.StatusCode = 429;
            c.HttpContext.Response.Headers.RetryAfter = "60";
            await c.HttpContext.Response.WriteAsJsonAsync(new { error = new { code = "rate_limited", message = "Too many requests. Retry after 60 seconds." } }, token);
        };
    }
}
