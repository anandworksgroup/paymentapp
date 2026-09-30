using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using PaymentApp.Api.Common;
using PaymentApp.Api.Data;
using PaymentApp.Api.Infrastructure;
using PaymentApp.Api.Modules.Billing;
using PaymentApp.Api.Modules.Ledger;
using PaymentApp.Api.Modules.Payouts;

namespace PaymentApp.Api.Modules.Operations;

/// <summary>
/// Month-end close (§230, §231). Closing a month runs the close checklist, then stores a snapshot of every
/// closing balance and the statement totals together with its SHA-256. Because the ledger is append-only
/// and postings are always dated "now", nothing can later land inside a closed month; re-verifying the
/// snapshot proves the closed numbers never changed. Corrections go into the current open month.
/// </summary>
public class PeriodCloseService(AppDb db, Uow uow, TreasuryService treasury, LedgerService ledger)
{
    public static (DateTime Start, DateTime End) Bounds(string period)
    {
        if (!Regex.IsMatch(period, @"^\d{4}-\d{2}$") || !DateTime.TryParse(period + "-01", out var start)) throw ApiException.Invalid("period must be YYYY-MM.");
        start = DateTime.SpecifyKind(start, DateTimeKind.Utc);
        return (start, start.AddMonths(1));
    }

    public async Task<object> Preview(string orgId, bool livemode, string period)
    {
        var checks = await Checks(orgId, livemode, period);
        var closed = await db.AccountingPeriods.AnyAsync(p => p.Period == period);
        return new
        {
            @object = "period_close_preview", period, already_closed = closed, can_close = !closed && checks.All(c => c.Passed || !c.Blocking),
            checks = checks.Select(c => new { key = c.Key, label = c.Label, passed = c.Passed, blocking = c.Blocking, detail = c.Detail }),
        };
    }

    private async Task<List<(string Key, string Label, bool Passed, bool Blocking, string Detail)>> Checks(string orgId, bool livemode, string period)
    {
        var (start, end) = Bounds(period);
        var checks = new List<(string, string, bool, bool, string)>();
        checks.Add(("month_ended", "The month has ended", end <= uow.Now, true, end <= uow.Now ? "" : $"Close after {end:yyyy-MM-dd}."));
        var prior = start.AddMonths(-1).ToString("yyyy-MM");
        var anyEarlier = await db.Payments.AnyAsync(p => p.CreatedAt < start);
        var priorClosed = !anyEarlier || await db.AccountingPeriods.AnyAsync(p => p.Period == prior);
        checks.Add(("previous_closed", "Previous month is closed", priorClosed, false, priorClosed ? "" : $"{prior} is still open (recommended to close in order)."));
        var inFlight = await db.Payments.CountAsync(p => p.CreatedAt >= start && p.CreatedAt < end && (p.Status == "PROCESSING" || p.Status == "REQUIRES_ACTION" || p.Status == "CREATED"));
        checks.Add(("payments_final", "Transactions complete", inFlight == 0, true, inFlight == 0 ? "" : $"{inFlight} payment(s) from the month are still in flight."));
        var refunds = await db.Refunds.CountAsync(r => r.CreatedAt >= start && r.CreatedAt < end && (r.Status == "REQUESTED" || r.Status == "PROCESSING"));
        checks.Add(("refunds_final", "Refunds complete", refunds == 0, true, refunds == 0 ? "" : $"{refunds} refund(s) still processing."));
        var disputes = await db.Disputes.CountAsync(d => d.CreatedAt >= start && d.CreatedAt < end && d.Status == "needs_response");
        checks.Add(("disputes_accounted", "Disputes accounted", true, false, disputes == 0 ? "" : $"{disputes} dispute(s) still need a response; their funds are already debited."));
        var payouts = await db.Payouts.CountAsync(p => p.CreatedAt >= start && p.CreatedAt < end && (p.Status == "PENDING" || p.Status == "PROCESSING"));
        checks.Add(("payouts_reconciled", "Payouts settled", payouts == 0, true, payouts == 0 ? "" : $"{payouts} payout(s) not yet paid or returned."));
        var exceptions = await db.ReconExceptions.CountAsync(e => e.OrgId == orgId && e.Status == "open");
        checks.Add(("reconciliation", "No open reconciliation exceptions", exceptions == 0, false, exceptions == 0 ? "" : $"{exceptions} open exception(s) — resolve or explain before filing."));
        var integrity = JsonDocument.Parse(Json.Serialize(await LedgerService.VerifyIntegrity(db))).RootElement.GetProperty("balanced").GetBoolean();
        checks.Add(("ledger_balanced", "Ledger balanced", integrity, true, integrity ? "" : "Ledger integrity check failed."));
        foreach (var currency in await Currencies(orgId, livemode))
        {
            var stmt = JsonDocument.Parse(Json.Serialize(await treasury.Statement(orgId, livemode, currency, start, end))).RootElement;
            var ok = stmt.GetProperty("reconciles").GetBoolean();
            checks.Add(($"statement_{currency}", $"{currency} statement reconciles", ok, true, ok ? "" : "Opening + movements ≠ closing."));
        }
        return checks;
    }

    private async Task<List<string>> Currencies(string orgId, bool livemode) =>
        await db.LedgerAccounts.Where(a => a.OwnerType == "org" && a.OwnerId == orgId && a.Livemode == livemode).Select(a => a.Currency).Distinct().ToListAsync();

    public async Task<AccountingPeriod> Close(string orgId, bool livemode, string period)
    {
        if (await db.AccountingPeriods.AnyAsync(p => p.Period == period)) throw ApiException.Conflict("period_closed", $"{period} is already closed.");
        var checks = await Checks(orgId, livemode, period);
        var blocking = checks.Where(c => c.Blocking && !c.Passed).ToList();
        if (blocking.Count > 0) throw new ApiException(409, "close_blocked", "The period can't be closed yet: " + string.Join("; ", blocking.Select(c => c.Detail)), blocking.Select(c => new { key = c.Key, detail = c.Detail }));
        var snapshot = await Snapshot(orgId, livemode, period);
        return await uow.Run(async () =>
        {
            var p = new AccountingPeriod
            {
                Id = Ids.New("aper"), CreatedAt = uow.Now, Period = period, ClosedAt = uow.Now, ClosedBy = uow.Ctx.ActorId,
                ChecksJson = Json.Serialize(checks.Select(c => new { key = c.Key, label = c.Label, passed = c.Passed, blocking = c.Blocking, detail = c.Detail })),
                SnapshotJson = snapshot, SnapshotSha256 = Crypto.Sha256Hex(snapshot),
            };
            db.AccountingPeriods.Add(p);
            uow.Emit("accounting_period.closed", p);
            uow.Audit("period.close", "accounting_period", p.Id, after: new { period, p.SnapshotSha256 }, orgId: orgId);
            await Task.CompletedTask;
            return p;
        });
    }

    /// <summary>Deterministic JSON of closing balances and statements as of the period end.</summary>
    private async Task<string> Snapshot(string orgId, bool livemode, string period)
    {
        var (start, end) = Bounds(period);
        var accounts = await db.LedgerAccounts.Where(a => (a.OwnerType == "org" && a.OwnerId == orgId || a.OwnerType == "seller" && db.Sellers.IgnoreQueryFilters().Any(s => s.Id == a.OwnerId && s.OrgId == orgId)) && a.Livemode == livemode)
            .OrderBy(a => a.OwnerType).ThenBy(a => a.OwnerId).ThenBy(a => a.Code).ThenBy(a => a.Currency).ToListAsync();
        var balances = new List<object>();
        foreach (var a in accounts) balances.Add(new { owner = a.OwnerType + ":" + a.OwnerId, a.Code, a.Currency, closing = await ledger.Balance(a, end.AddTicks(-1)) });
        var statements = new List<object>();
        foreach (var c in accounts.Select(a => a.Currency).Distinct().OrderBy(c => c)) statements.Add(await treasury.Statement(orgId, livemode, c, start, end));
        var entries = await db.LedgerEntries.CountAsync(e => e.CreatedAt >= start && e.CreatedAt < end && accounts.Select(a => a.Id).Contains(e.AccountId));
        return Json.Serialize(new { period, livemode, balances, statements, ledger_entries_in_period = entries });
    }

    public async Task<object> Verify(string periodId)
    {
        var p = await db.AccountingPeriods.FirstOrDefaultAsync(x => x.Id == periodId) ?? throw ApiException.NotFound("accounting period");
        var now = Crypto.Sha256Hex(await Snapshot(p.OrgId, p.Livemode, p.Period));
        return new { @object = "period_verification", period = p.Period, closed_sha256 = p.SnapshotSha256, recomputed_sha256 = now, unchanged = now == p.SnapshotSha256 };
    }
}

/// <summary>CSV/JSON imports with validation preview (§187-§189) and customer merge (§186).</summary>
public class ImportService(AppDb db, Uow uow, CreditService credits)
{
    public static List<Dictionary<string, string>> Parse(string format, string content)
    {
        if (content.Length > 5_000_000) throw ApiException.Invalid("Imports are limited to 5 MB.");
        if (format == "json")
        {
            var rows = JsonSerializer.Deserialize<List<Dictionary<string, JsonElement>>>(content) ?? throw ApiException.Invalid("Expected a JSON array of objects.");
            return rows.Select(r => r.ToDictionary(k => k.Key.Trim().ToLowerInvariant(), v => v.Value.ValueKind == JsonValueKind.String ? v.Value.GetString() ?? "" : v.Value.ToString())).ToList();
        }
        var lines = ParseCsv(content);
        if (lines.Count == 0) throw ApiException.Invalid("The file is empty.");
        var header = lines[0].Select(h => h.Trim().ToLowerInvariant()).ToList();
        return lines.Skip(1).Where(l => l.Any(c => c.Length > 0)).Select(l => header.Select((h, i) => (h, v: i < l.Count ? l[i].Trim() : "")).ToDictionary(x => x.h, x => x.v)).ToList();
    }

    /// <summary>RFC 4180 CSV: quoted fields, doubled quotes, newlines inside quotes.</summary>
    public static List<List<string>> ParseCsv(string text)
    {
        var rows = new List<List<string>>();
        var row = new List<string>();
        var field = new StringBuilder();
        var quoted = false;
        for (var i = 0; i < text.Length; i++)
        {
            var c = text[i];
            if (quoted)
            {
                if (c == '"' && i + 1 < text.Length && text[i + 1] == '"') { field.Append('"'); i++; }
                else if (c == '"') quoted = false;
                else field.Append(c);
            }
            else if (c == '"') quoted = true;
            else if (c == ',') { row.Add(field.ToString()); field.Clear(); }
            else if (c == '\n' || c == '\r')
            {
                if (c == '\r' && i + 1 < text.Length && text[i + 1] == '\n') i++;
                row.Add(field.ToString()); field.Clear();
                rows.Add(row); row = [];
            }
            else field.Append(c);
        }
        if (field.Length > 0 || row.Count > 0) { row.Add(field.ToString()); rows.Add(row); }
        return rows;
    }

    private static readonly Regex Email = new(@"^[^@\s]+@[^@\s]+\.[^@\s]+$");

    public async Task<ImportJob> Run(string type, string format, string content, bool dryRun)
    {
        if (type is not ("customers" or "products")) throw ApiException.Invalid("type must be customers or products.");
        if (format is not ("csv" or "json")) throw ApiException.Invalid("format must be csv or json.");
        var rows = Parse(format, content);
        if (rows.Count > 10_000) throw ApiException.Invalid("At most 10,000 rows per import.");
        var results = new List<Dictionary<string, object?>>();
        var countries = await db.Countries.Select(c => c.Country).ToListAsync();
        if (type == "customers")
        {
            var emails = await db.Customers.Where(c => c.Email != null).Select(c => c.Email!).ToListAsync();
            var externals = await db.Customers.Where(c => c.ExternalId != null).Select(c => c.ExternalId!).ToListAsync();
            var seen = new HashSet<string>();
            for (var i = 0; i < rows.Count; i++)
            {
                var r = rows[i];
                var errors = new List<string>();
                var email = r.GetValueOrDefault("email", "").ToLowerInvariant();
                var country = r.GetValueOrDefault("country", "").ToUpperInvariant();
                var ext = r.GetValueOrDefault("external_id", "");
                if (!Email.IsMatch(email)) errors.Add("email is missing or invalid");
                if (country.Length > 0 && !countries.Contains(country)) errors.Add($"unknown country '{country}'");
                var type2 = r.GetValueOrDefault("customer_type", "");
                if (type2.Length > 0 && type2 is not ("b2c" or "b2b")) errors.Add("customer_type must be b2c or b2b");
                var duplicate = emails.Contains(email) || (ext.Length > 0 && externals.Contains(ext)) || !seen.Add(email);
                results.Add(new() { ["row"] = i + 2, ["status"] = errors.Count > 0 ? "invalid" : duplicate ? "duplicate" : "valid", ["errors"] = errors, ["key"] = email });
            }
        }
        else
        {
            var names = await db.Products.Select(p => p.Name.ToLower()).ToListAsync();
            var seen = new HashSet<string>();
            for (var i = 0; i < rows.Count; i++)
            {
                var r = rows[i];
                var errors = new List<string>();
                var name = r.GetValueOrDefault("name", "");
                if (name.Length is 0 or > 200) errors.Add("name is required (max 200)");
                var amountRaw = r.GetValueOrDefault("price_amount", "");
                if (!long.TryParse(amountRaw, out var amount) || amount < 0) errors.Add("price_amount must be a non-negative integer in minor units");
                var currency = r.GetValueOrDefault("currency", "USD").ToUpperInvariant();
                if (!Money.IsSupported(currency)) errors.Add($"unsupported currency '{currency}'");
                var interval = r.GetValueOrDefault("interval", "");
                if (interval.Length > 0 && interval is not ("day" or "week" or "month" or "year")) errors.Add("interval must be day, week, month or year");
                var duplicate = names.Contains(name.ToLower()) || !seen.Add(name.ToLower());
                results.Add(new() { ["row"] = i + 2, ["status"] = errors.Count > 0 ? "invalid" : duplicate ? "duplicate" : "valid", ["errors"] = errors, ["key"] = name });
            }
        }

        return await uow.Run(async () =>
        {
            var job = new ImportJob
            {
                Id = Ids.New("imp"), CreatedAt = uow.Now, Type = type, Format = format, DryRun = dryRun, Total = rows.Count, CreatedBy = uow.Ctx.ActorId,
                Valid = results.Count(r => (string)r["status"]! == "valid"), Invalid = results.Count(r => (string)r["status"]! == "invalid"),
                Duplicates = results.Count(r => (string)r["status"]! == "duplicate"),
            };
            if (!dryRun)
            {
                for (var i = 0; i < rows.Count; i++)
                {
                    if ((string)results[i]["status"]! != "valid") { results[i]["status"] = (string)results[i]["status"]! == "invalid" ? "failed" : "skipped"; continue; }
                    var r = rows[i];
                    if (type == "customers")
                    {
                        var c = new Customer
                        {
                            Id = Ids.New("cus"), CreatedAt = uow.Now, UpdatedAt = uow.Now, Email = r["email"].ToLowerInvariant(), Name = r.GetValueOrDefault("name"),
                            Country = r.GetValueOrDefault("country") is { Length: 2 } cc ? cc.ToUpperInvariant() : null, Phone = r.GetValueOrDefault("phone") is { Length: > 0 } ph ? ph : null,
                            ExternalId = r.GetValueOrDefault("external_id") is { Length: > 0 } ex ? ex : null, TaxId = r.GetValueOrDefault("tax_id") is { Length: > 0 } tx ? tx : null,
                            CustomerType = r.GetValueOrDefault("customer_type") is { Length: > 0 } ct ? ct : "b2c",
                        };
                        db.Customers.Add(c);
                        results[i]["id"] = c.Id;
                    }
                    else
                    {
                        var interval = r.GetValueOrDefault("interval", "");
                        var p = new Product { Id = Ids.New("prod"), CreatedAt = uow.Now, UpdatedAt = uow.Now, Name = r["name"], Description = r.GetValueOrDefault("description"), Type = r.GetValueOrDefault("type") is { Length: > 0 } t ? t : "saas", TaxCategory = r.GetValueOrDefault("tax_category") is { Length: > 0 } tc ? tc : "digital_service" };
                        var price = new Price
                        {
                            Id = Ids.New("price"), CreatedAt = uow.Now, ProductId = p.Id, Currency = r.GetValueOrDefault("currency", "USD").ToUpperInvariant(), UnitAmount = long.Parse(r["price_amount"]),
                            Type = interval.Length > 0 ? "recurring" : "one_time", Interval = interval.Length > 0 ? interval : null,
                            IntervalCount = int.TryParse(r.GetValueOrDefault("interval_count"), out var ic) ? ic : 1, TrialDays = int.TryParse(r.GetValueOrDefault("trial_days"), out var td) ? td : 0,
                        };
                        db.Products.Add(p);
                        db.Prices.Add(price);
                        results[i]["id"] = p.Id;
                        results[i]["price_id"] = price.Id;
                    }
                    results[i]["status"] = "imported";
                    job.Imported++;
                }
                job.Status = "completed";
            }
            job.ResultsJson = Json.Serialize(results);
            db.Imports.Add(job);
            uow.Audit("import." + (dryRun ? "preview" : "run"), "import", job.Id, after: new { type, job.Total, job.Valid, job.Imported });
            await Task.CompletedTask;
            return job;
        });
    }

    /// <summary>
    /// Merges a duplicate customer into a survivor (§186). History moves to the survivor, credits move via
    /// paired ledger entries (never edited), and the duplicate stays as a tombstone pointing at the survivor.
    /// </summary>
    public async Task<object> Merge(string sourceId, string targetId)
    {
        if (sourceId == targetId) throw ApiException.Invalid("Choose two different customers.");
        return await uow.Run(async () =>
        {
            var source = await db.Customers.FirstOrDefaultAsync(c => c.Id == sourceId) ?? throw ApiException.NotFound("customer");
            var target = await db.Customers.FirstOrDefaultAsync(c => c.Id == targetId) ?? throw ApiException.NotFound("customer");
            if (source.MergedIntoId != null || target.MergedIntoId != null) throw ApiException.Conflict("already_merged", "One of these customers was already merged.");
            var moved = new Dictionary<string, int>
            {
                ["orders"] = await db.Orders.Where(x => x.CustomerId == sourceId).ExecuteUpdateAsync(u => u.SetProperty(x => x.CustomerId, targetId)),
                ["payments"] = await db.Payments.Where(x => x.CustomerId == sourceId).ExecuteUpdateAsync(u => u.SetProperty(x => x.CustomerId, targetId)),
                ["subscriptions"] = await db.Subscriptions.Where(x => x.CustomerId == sourceId).ExecuteUpdateAsync(u => u.SetProperty(x => x.CustomerId, targetId)),
                ["invoices"] = await db.Invoices.Where(x => x.CustomerId == sourceId).ExecuteUpdateAsync(u => u.SetProperty(x => x.CustomerId, targetId)),
                ["payment_methods"] = await db.PaymentMethods.Where(x => x.CustomerId == sourceId).ExecuteUpdateAsync(u => u.SetProperty(x => x.CustomerId, targetId)),
                ["entitlements"] = await db.Entitlements.Where(x => x.CustomerId == sourceId).ExecuteUpdateAsync(u => u.SetProperty(x => x.CustomerId, targetId)),
                ["usage_events"] = await db.UsageEvents.Where(x => x.CustomerId == sourceId).ExecuteUpdateAsync(u => u.SetProperty(x => x.CustomerId, targetId)),
                ["checkout_sessions"] = await db.CheckoutSessions.Where(x => x.CustomerId == sourceId).ExecuteUpdateAsync(u => u.SetProperty(x => x.CustomerId, targetId)),
                ["budgets"] = await db.CustomerBudgets.Where(x => x.CustomerId == sourceId).ExecuteUpdateAsync(u => u.SetProperty(x => x.CustomerId, targetId)),
            };
            // Keep the survivor's referral if it has one; otherwise inherit the duplicate's.
            if (!await db.AffiliateReferrals.AnyAsync(r => r.CustomerId == targetId))
                moved["affiliate_referrals"] = await db.AffiliateReferrals.Where(r => r.CustomerId == sourceId).ExecuteUpdateAsync(u => u.SetProperty(x => x.CustomerId, targetId));
            foreach (var type in await db.CreditLedger.Where(e => e.CustomerId == sourceId).Select(e => e.CreditType).Distinct().ToListAsync())
            {
                var (available, _) = await credits.Balance(sourceId, type);
                if (available <= 0) continue;
                await credits.Apply(sourceId, type, "transfer_out", available, $"merge-out:{sourceId}:{type}", "customer_merge", targetId, $"Merged into {targetId}");
                await credits.Apply(targetId, type, "transfer_in", available, $"merge-in:{sourceId}:{type}", "customer_merge", sourceId, $"Merged from {sourceId}");
                moved["credits_" + type] = (int)available;
            }
            target.Name ??= source.Name;
            target.Phone ??= source.Phone;
            target.Country ??= source.Country;
            target.TaxId ??= source.TaxId;
            target.ExternalId ??= source.ExternalId;
            target.DefaultPaymentMethodId ??= source.DefaultPaymentMethodId;
            if (source.CreditBalance > 0 && (target.CreditCurrency == null || target.CreditCurrency == source.CreditCurrency))
            {
                target.CreditBalance += source.CreditBalance;
                target.CreditCurrency = source.CreditCurrency;
                source.CreditBalance = 0;
            }
            target.UpdatedAt = uow.Now;
            source.MergedIntoId = targetId;
            source.ExternalId = null;
            source.UpdatedAt = uow.Now;
            uow.Emit("customer.merged", source);
            uow.Emit("customer.updated", target);
            uow.Audit("customer.merge", "customer", targetId, new { merged = sourceId }, moved);
            return (object)new { @object = "customer_merge", survivor = targetId, merged = sourceId, moved };
        });
    }
}

/// <summary>Feature flags (§119): environment, org allow-list, country and deterministic percentage rollout.</summary>
public class FlagService(AppDb db, IWebHostEnvironment env)
{
    public async Task<bool> IsEnabled(string key, string? orgId)
    {
        var flag = await db.FeatureFlags.FirstOrDefaultAsync(f => f.Key == key);
        if (flag == null) return true; // unknown flags don't gate anything
        var country = orgId == null ? null : await db.Organizations.Where(o => o.Id == orgId).Select(o => o.Country).FirstOrDefaultAsync();
        return Evaluate(flag, orgId, country, env.EnvironmentName);
    }

    public static bool Evaluate(FeatureFlag f, string? orgId, string? country, string environment)
    {
        if (!f.Enabled) return false;
        if (f.Environment != "*" && !string.Equals(f.Environment, environment, StringComparison.OrdinalIgnoreCase)) return false;
        if (orgId != null && (f.OrgIdsCsv ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Contains(orgId)) return true;
        if (!string.IsNullOrEmpty(f.CountriesCsv) && (country == null || !f.CountriesCsv.Split(',', StringSplitOptions.TrimEntries).Contains(country))) return false;
        if (f.RolloutPercent >= 100) return true;
        if (f.RolloutPercent <= 0 || orgId == null) return false;
        var bucket = Convert.ToUInt32(Crypto.Sha256Hex(f.Key + ":" + orgId)[..8], 16) % 100;
        return bucket < f.RolloutPercent;
    }

    public async Task Require(string key, string? orgId)
    {
        if (!await IsEnabled(key, orgId)) throw new ApiException(403, "feature_unavailable", "This feature isn't enabled for your account yet.");
    }
}

public interface IDnsTxtResolver
{
    Task<IReadOnlyList<string>> TxtRecords(string name);
}

public class DnsTxtResolver : IDnsTxtResolver
{
    private readonly DnsClient.LookupClient _client = new();

    public async Task<IReadOnlyList<string>> TxtRecords(string name)
    {
        var result = await _client.QueryAsync(name, DnsClient.QueryType.TXT);
        return result.Answers.TxtRecords().SelectMany(r => r.Text).ToList();
    }
}

/// <summary>Custom domains verified by a DNS TXT challenge (§176, §177).</summary>
public class DomainService(AppDb db, Uow uow, IDnsTxtResolver dns)
{
    private static readonly Regex Hostname = new(@"^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$");
    public static string ChallengeName(string host) => $"_paymentapp-challenge.{host}";

    public async Task<CustomDomain> Add(string hostname, string purpose)
    {
        hostname = hostname.Trim().TrimEnd('.').ToLowerInvariant();
        if (!Hostname.IsMatch(hostname)) throw ApiException.Invalid("Enter a hostname like checkout.example.com.");
        if (purpose is not ("checkout" or "portal" or "payment_links")) throw ApiException.Invalid("purpose must be checkout, portal or payment_links.");
        using (db.Tenant.Elevate())
            if (await db.Domains.AnyAsync(d => d.Hostname == hostname && (d.Status == "VERIFIED" || d.Status == "PENDING")))
                throw ApiException.Conflict("domain_in_use", "This hostname is already registered.");
        return await uow.Run(async () =>
        {
            var d = new CustomDomain { Id = Ids.New("dom"), CreatedAt = uow.Now, Hostname = hostname, Purpose = purpose, VerificationToken = "pa-verify=" + Crypto.RandomToken(18) };
            db.Domains.Add(d);
            uow.Audit("domain.add", "domain", d.Id, after: new { hostname, purpose });
            await Task.CompletedTask;
            return d;
        });
    }

    public async Task<CustomDomain> Verify(string id)
    {
        var d = await db.Domains.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("domain");
        if (d.Status == "REVOKED") throw ApiException.Conflict("domain_revoked", "This domain was removed.");
        string? error = null;
        var found = false;
        try { found = (await dns.TxtRecords(ChallengeName(d.Hostname))).Any(t => t.Trim() == d.VerificationToken); }
        catch (Exception ex) { error = "DNS lookup failed: " + ex.Message; }
        return await uow.Run(async () =>
        {
            var before = d.Status;
            d.LastCheckedAt = uow.Now;
            d.LastError = found ? null : error ?? $"TXT record {ChallengeName(d.Hostname)} with the verification value was not found.";
            d.Status = found ? "VERIFIED" : before == "VERIFIED" ? "FAILED" : "PENDING";
            if (found && before != "VERIFIED") d.VerifiedAt = uow.Now;
            if (before != d.Status) uow.Transition("domain", d.Id, before, d.Status);
            await Task.CompletedTask;
            return d;
        });
    }
}
