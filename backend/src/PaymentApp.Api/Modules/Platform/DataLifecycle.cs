using System.Text;
using Microsoft.EntityFrameworkCore;
using PaymentApp.Api.Common;
using PaymentApp.Api.Data;
using PaymentApp.Api.Endpoints;
using PaymentApp.Api.Infrastructure;
using PaymentApp.Api.Modules.Growth;

namespace PaymentApp.Api.Modules.Platform;

/// <summary>
/// Asynchronous exports (§97). A request is queued and returns at once; the job runner builds the file,
/// stores it encrypted like any other file and notifies the requester. Downloads go through short-lived
/// signed links, and finished exports expire after seven days (removed by retention).
/// </summary>
public class ExportService(AppDb db, Uow uow, FileService files)
{
    public static readonly string[] Types = ["payments", "refunds", "customers", "invoices", "subscriptions", "balance_transactions", "disputes"];
    public const int MaxRows = 500_000;

    public async Task<ExportJob> Request(string type, string format, DateTime? from, DateTime? to)
    {
        if (!Types.Contains(type)) throw ApiException.Invalid($"type must be one of {string.Join(", ", Types)}.");
        if (format is not ("csv" or "json")) throw ApiException.Invalid("format must be csv or json.");
        if (from != null && to != null && from > to) throw ApiException.Invalid("from must be before to.");
        var active = await db.Exports.CountAsync(e => e.Status == "queued" || e.Status == "running");
        if (active >= 5) throw new ApiException(429, "too_many_exports", "Five exports are already in progress. Wait for one to finish.");
        return await uow.Run(async () =>
        {
            var job = new ExportJob
            {
                Id = Ids.New("exp"), CreatedAt = uow.Now, Type = type, Format = format, From = from?.ToUniversalTime(), To = to?.ToUniversalTime(),
                RequestedBy = uow.Ctx.ActorId,
            };
            db.Exports.Add(job);
            uow.Audit("export.request", "export", job.Id, after: new { type, format, from, to });
            await Task.CompletedTask;
            return job;
        });
    }

    /// <summary>Job step: builds queued exports one at a time, each in its own tenant scope.</summary>
    public async Task<int> ProcessQueued()
    {
        List<ExportJob> queued;
        using (db.Tenant.Elevate())
            queued = await db.Exports.AsNoTracking().Where(e => e.Status == "queued").OrderBy(e => e.CreatedAt).Take(5).ToListAsync();
        foreach (var snapshot in queued)
        {
            using var _ = db.Tenant.Use(snapshot.OrgId, snapshot.Livemode);
            var claimed = await db.Exports.Where(e => e.Id == snapshot.Id && e.Status == "queued")
                .ExecuteUpdateAsync(u => u.SetProperty(e => e.Status, "running").SetProperty(e => e.StartedAt, uow.Now));
            if (claimed == 0) continue;
            try
            {
                var (bytes, rows) = await Build(snapshot);
                await uow.Run(async () =>
                {
                    var job = await db.Exports.FirstAsync(e => e.Id == snapshot.Id);
                    var file = await files.SaveGenerated(bytes, $"{job.Type}-{uow.Now:yyyyMMdd-HHmm}.{job.Format}", job.Format == "csv" ? "text/csv" : "application/json", "export", job.OrgId, job.Livemode);
                    job.Status = "completed";
                    job.Rows = rows;
                    job.FileId = file.Id;
                    job.CompletedAt = uow.Now;
                    job.ExpiresAt = uow.Now.AddDays(7);
                    db.Notifications.Add(new Notification
                    {
                        Id = Ids.New("ntf"), CreatedAt = uow.Now, OrgId = job.OrgId, UserId = job.RequestedBy.StartsWith("usr_") ? job.RequestedBy : null, Channel = "in_app",
                        Recipient = $"org:{job.OrgId}", Template = "export_ready", Subject = $"Your {job.Type.Replace('_', ' ')} export is ready",
                        Body = $"{rows:N0} rows. The file is available for 7 days.", Category = "account", Status = "delivered", ObjectType = "export", ObjectId = job.Id,
                    });
                });
            }
            catch (Exception ex) when (ex is ApiException or InvalidOperationException or DbUpdateException)
            {
                await db.Exports.Where(e => e.Id == snapshot.Id).ExecuteUpdateAsync(u => u.SetProperty(e => e.Status, "failed").SetProperty(e => e.Error, ex.Message).SetProperty(e => e.CompletedAt, uow.Now));
            }
        }
        return queued.Count;
    }

    private async Task<(byte[] Bytes, int Rows)> Build(ExportJob job)
    {
        var from = job.From ?? DateTime.MinValue;
        var to = job.To ?? DateTime.MaxValue;
        string Csv<T>(List<T> rows, params (string, Func<T, object?>)[] cols) => Endpoints.Csv.Write(rows, cols);
        byte[] Out<T>(List<T> rows, Func<List<T>, string> csv) => Encoding.UTF8.GetBytes(job.Format == "csv" ? csv(rows) : Json.Serialize(rows));
        async Task<List<T>> Take<T>(IQueryable<T> q)
        {
            var list = await q.Take(MaxRows + 1).ToListAsync();
            if (list.Count > MaxRows) throw ApiException.Invalid($"More than {MaxRows:N0} rows: narrow the date range.");
            return list;
        }
        switch (job.Type)
        {
            case "payments":
            {
                var rows = await Take(db.Payments.AsNoTracking().Where(p => p.CreatedAt >= from && p.CreatedAt < to).OrderBy(p => p.CreatedAt));
                return (Out(rows, r => Csv(r, ("id", p => p.Id), ("created_at", p => p.CreatedAt), ("status", p => p.Status), ("amount", p => p.Amount), ("currency", p => p.Currency),
                    ("tax", p => p.TaxAmount), ("fee", p => p.FeeAmount), ("net", p => p.NetAmount), ("refunded", p => p.AmountRefunded), ("customer", p => p.CustomerId),
                    ("email", p => p.CustomerEmail), ("country", p => p.Country), ("method", p => p.PaymentMethodType), ("brand", p => p.CardBrand), ("last4", p => p.Last4),
                    ("risk_score", p => p.RiskScore), ("risk_action", p => p.RiskAction), ("failure_code", p => p.FailureCode))), rows.Count);
            }
            case "refunds":
            {
                var rows = await Take(db.Refunds.AsNoTracking().Where(r => r.CreatedAt >= from && r.CreatedAt < to).OrderBy(r => r.CreatedAt));
                return (Out(rows, r => Csv(r, ("id", x => x.Id), ("created_at", x => x.CreatedAt), ("payment", x => x.PaymentId), ("status", x => x.Status),
                    ("amount", x => x.Amount), ("currency", x => x.Currency), ("reason", x => x.Reason))), rows.Count);
            }
            case "customers":
            {
                var rows = await Take(db.Customers.AsNoTracking().Where(c => c.CreatedAt >= from && c.CreatedAt < to && c.MergedIntoId == null).OrderBy(c => c.CreatedAt));
                return (Out(rows, r => Csv(r, ("id", c => c.Id), ("created_at", c => c.CreatedAt), ("email", c => c.Email), ("name", c => c.Name), ("country", c => c.Country),
                    ("type", c => c.CustomerType), ("tax_id", c => c.TaxId), ("external_id", c => c.ExternalId))), rows.Count);
            }
            case "invoices":
            {
                var rows = await Take(db.Invoices.AsNoTracking().Where(i => i.CreatedAt >= from && i.CreatedAt < to).OrderBy(i => i.CreatedAt));
                return (Out(rows, r => Csv(r, ("id", i => i.Id), ("number", i => i.Number), ("created_at", i => i.CreatedAt), ("status", i => i.Status), ("customer", i => i.CustomerId),
                    ("currency", i => i.Currency), ("subtotal", i => i.Subtotal), ("tax", i => i.Tax), ("total", i => i.Total), ("amount_paid", i => i.AmountPaid), ("due", i => i.DueDate))), rows.Count);
            }
            case "subscriptions":
            {
                var rows = await Take(db.Subscriptions.AsNoTracking().Where(s => s.CreatedAt >= from && s.CreatedAt < to).OrderBy(s => s.CreatedAt));
                return (Out(rows, r => Csv(r, ("id", s => s.Id), ("created_at", s => s.CreatedAt), ("status", s => s.Status), ("customer", s => s.CustomerId), ("currency", s => s.Currency),
                    ("current_period_end", s => s.CurrentPeriodEnd), ("cancel_at_period_end", s => s.CancelAtPeriodEnd), ("cancelled_at", s => s.CanceledAt))), rows.Count);
            }
            case "balance_transactions":
            {
                var rows = await Take(db.BalanceTransactions.AsNoTracking().Where(t => t.CreatedAt >= from && t.CreatedAt < to).OrderBy(t => t.CreatedAt));
                return (Out(rows, r => Csv(r, ("id", t => t.Id), ("created_at", t => t.CreatedAt), ("type", t => t.Type), ("amount", t => t.Amount), ("fee", t => t.Fee),
                    ("net", t => t.Net), ("currency", t => t.Currency), ("status", t => t.Status), ("available_on", t => t.AvailableOn), ("source", t => t.SourceId))), rows.Count);
            }
            default:
            {
                var rows = await Take(db.Disputes.AsNoTracking().Where(d => d.CreatedAt >= from && d.CreatedAt < to).OrderBy(d => d.CreatedAt));
                return (Out(rows, r => Csv(r, ("id", d => d.Id), ("created_at", d => d.CreatedAt), ("payment", d => d.PaymentId), ("status", d => d.Status),
                    ("amount", d => d.Amount), ("currency", d => d.Currency), ("reason", d => d.Reason), ("evidence_due_by", d => d.EvidenceDueBy))), rows.Count);
            }
        }
    }
}

/// <summary>
/// Configurable data retention (§115). Operational data (logs, deliveries, notifications, sessions,
/// sign-in codes, exports) is purged on a schedule the platform sets per data class, never below a floor.
/// Financial records (payments, ledger, invoices, tax, audit) are outside this: they're kept for the legal
/// minimum and can't be shortened here. Anything linked to a subject under legal hold is kept.
/// </summary>
public class RetentionService(AppDb db, Uow uow, FileService files)
{
    public record ClassInfo(string Key, string Description, int DefaultDays, int MinimumDays);

    public static readonly ClassInfo[] Classes =
    [
        new("api_request_logs", "API request logs (method, path, status, latency)", 90, 30),
        new("webhook_deliveries", "Finished webhook delivery attempts and responses", 90, 30),
        new("notifications", "Sent emails and in-app notifications", 365, 90),
        new("sessions", "Expired or revoked sign-in sessions", 90, 30),
        new("security_events", "Sign-in and security events", 730, 365),
        new("login_challenges", "Used or expired sign-in codes and magic links", 30, 1),
        new("exports", "Finished export files", 7, 1),
    ];

    public const string FinancialNote = "Payments, refunds, disputes, ledger, invoices, tax records and the audit log are kept for at least 10 years and are not purged by this policy.";

    public static async Task EnsureDefaults(AppDb db)
    {
        var existing = await db.RetentionPolicies.Select(p => p.DataClass).ToListAsync();
        foreach (var c in Classes.Where(c => !existing.Contains(c.Key)))
            db.RetentionPolicies.Add(new RetentionPolicy { Id = Ids.New("ret"), CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow, DataClass = c.Key, Description = c.Description, Days = c.DefaultDays, MinimumDays = c.MinimumDays });
        await db.SaveChangesAsync();
    }

    public async Task<RetentionPolicy> Update(string dataClass, int? days, bool? enabled, string? reason)
    {
        if (string.IsNullOrWhiteSpace(reason)) throw ApiException.Invalid("A reason is required for retention changes.");
        await EnsureDefaults(db);
        return await uow.Run(async () =>
        {
            var p = await db.RetentionPolicies.FirstOrDefaultAsync(x => x.DataClass == dataClass) ?? throw ApiException.NotFound("retention policy");
            if (days != null && (days < p.MinimumDays || days > 3650)) throw ApiException.Invalid($"{dataClass} must be kept between {p.MinimumDays} and 3650 days.");
            var before = new { p.Days, p.Enabled };
            p.Days = days ?? p.Days;
            p.Enabled = enabled ?? p.Enabled;
            p.UpdatedAt = uow.Now;
            p.UpdatedBy = uow.Ctx.ActorId;
            uow.Audit("config.retention", "retention_policy", p.Id, before, new { p.Days, p.Enabled }, reason);
            await Task.CompletedTask;
            return p;
        });
    }

    /// <summary>Purges (or, with dryRun, counts) what each enabled policy allows.</summary>
    public async Task<RetentionRun> Run(bool dryRun, string triggeredBy)
    {
        await EnsureDefaults(db);
        using var _ = db.Tenant.Elevate();
        var now = uow.Now;
        var policies = await db.RetentionPolicies.Where(p => p.Enabled).ToDictionaryAsync(p => p.DataClass);
        var held = await db.Cases.Where(c => c.LegalHold).Select(c => c.SubjectId).Distinct().ToListAsync();
        // A held merchant covers its users' records too.
        var heldUsers = held.Concat(await db.Memberships.Where(m => held.Contains(m.OrgId)).Select(m => m.UserId).ToListAsync()).Distinct().ToList();
        var counts = new Dictionary<string, int>();

        async Task Purge<T>(string key, IQueryable<T> eligible) where T : class
        {
            if (!policies.ContainsKey(key)) return;
            counts[key] = dryRun ? await eligible.CountAsync() : await eligible.ExecuteDeleteAsync();
        }
        DateTime Cutoff(string key) => policies.TryGetValue(key, out var p) ? now.AddDays(-p.Days) : DateTime.MinValue;

        var c1 = Cutoff("api_request_logs");
        await Purge("api_request_logs", db.ApiRequestLogs.Where(r => r.At < c1 && (r.OrgId == null || !held.Contains(r.OrgId)) && (r.UserId == null || !heldUsers.Contains(r.UserId))));
        var c2 = Cutoff("webhook_deliveries");
        await Purge("webhook_deliveries", db.WebhookDeliveries.Where(d => d.CreatedAt < c2 && d.Status != "pending" && !held.Contains(d.OrgId)));
        var c3 = Cutoff("notifications");
        await Purge("notifications", db.Notifications.Where(n => n.CreatedAt < c3 && (n.OrgId == null || !held.Contains(n.OrgId)) && (n.UserId == null || !heldUsers.Contains(n.UserId))));
        var c4 = Cutoff("sessions");
        await Purge("sessions", db.Sessions.Where(s => (s.RevokedAt != null || s.ExpiresAt < now) && s.ExpiresAt < c4 && !heldUsers.Contains(s.UserId)));
        var c5 = Cutoff("security_events");
        await Purge("security_events", db.SecurityEvents.Where(e => e.CreatedAt < c5 && (e.UserId == null || !heldUsers.Contains(e.UserId)) && (e.OrgId == null || !held.Contains(e.OrgId))));
        var c6 = Cutoff("login_challenges");
        await Purge("login_challenges", db.LoginChallenges.Where(c => c.CreatedAt < c6 && (c.ConsumedAt != null || c.ExpiresAt < now)));
        if (policies.TryGetValue("exports", out var ep))
        {
            var cutoff = now.AddDays(-ep.Days);
            var expired = await db.Exports.Where(e => e.Status == "completed" && (e.ExpiresAt < now || e.CompletedAt < cutoff) && !held.Contains(e.OrgId)).ToListAsync();
            counts["exports"] = expired.Count;
            if (!dryRun)
                await uow.Run(async () =>
                {
                    foreach (var job in expired)
                    {
                        var f = job.FileId == null ? null : await db.Files.FirstOrDefaultAsync(x => x.Id == job.FileId);
                        if (f != null) files.Delete(f);
                        job.Status = "expired";
                        job.FileId = null;
                    }
                });
        }
        return await uow.Run(async () =>
        {
            var run = new RetentionRun { Id = Ids.New("rrn"), CreatedAt = now, DryRun = dryRun, TriggeredBy = triggeredBy, CountsJson = Json.Serialize(counts), HeldSubjects = held.Count, CompletedAt = uow.Now };
            db.RetentionRuns.Add(run);
            if (!dryRun) uow.Audit("retention.run", "retention_run", run.Id, after: counts);
            await Task.CompletedTask;
            return run;
        });
    }

    /// <summary>Job step: at most one real run per day.</summary>
    public async Task<int> RunDaily()
    {
        var last = await db.RetentionRuns.Where(r => !r.DryRun).OrderByDescending(r => r.CreatedAt).Select(r => (DateTime?)r.CreatedAt).FirstOrDefaultAsync();
        if (last != null && last > uow.Now.AddHours(-23)) return 0;
        var run = await Run(false, "schedule");
        return Json.Deserialize<Dictionary<string, int>>(run.CountsJson)?.Values.Sum() ?? 0;
    }
}
