using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using PaymentApp.Api.Common;
using PaymentApp.Api.Data;
using PaymentApp.Api.Infrastructure;
using PaymentApp.Api.Modules.Payments;

namespace PaymentApp.Api.Modules.Compliance;

/// <summary>
/// Sanctions / PEP screening (§58-§60, §166). Every check stores the list version, the matching logic and
/// the score, and a potential match is a review condition — never a determination (§94).
/// </summary>
public class ScreeningService(AppDb db, Uow uow)
{
    public record Outcome(string Result, int Score, string? AlertId, ScreeningCheck Check);

    public async Task<Outcome> Screen(string subjectType, string subjectId, string name, string? dob, string? country, string context)
    {
        var lists = await db.ScreeningLists.Where(l => l.Active).ToListAsync();
        var listIds = lists.Select(l => l.Id).ToList();
        var entries = await db.ScreeningEntries.Where(e => listIds.Contains(e.ListId)).ToListAsync();
        var normalized = Normalize(name);
        ScreeningEntry? best = null;
        var bestScore = 0;
        foreach (var e in entries)
        {
            foreach (var candidate in new[] { e.Name }.Concat((e.AliasesCsv ?? "").Split('|', StringSplitOptions.RemoveEmptyEntries)))
            {
                var score = Score(normalized, Normalize(candidate));
                if (score == 0) continue;
                if (dob != null && e.DateOfBirth != null && dob != e.DateOfBirth) score -= 15;
                if (country != null && e.Country != null && !string.Equals(country, e.Country, StringComparison.OrdinalIgnoreCase)) score -= 5;
                if (score > bestScore) { bestScore = score; best = e; }
            }
        }
        var result = bestScore >= 88 ? "potential_match" : "clear";
        var version = string.Join(",", lists.Select(l => $"{l.Name}@{l.Version}"));
        var check = new ScreeningCheck
        {
            Id = Ids.New("scr"), CreatedAt = uow.Now, SubjectType = subjectType, SubjectId = subjectId, ScreenedName = name, Context = context,
            ListVersion = version, Result = result, Score = Math.Max(0, bestScore), MatchedEntryId = result == "clear" ? null : best?.Id,
            MatchedName = result == "clear" ? null : best?.Name, MatchLogic = "token-sorted Jaro-Winkler ≥ 0.88; −15 DOB mismatch; −5 country mismatch",
        };
        db.ScreeningChecks.Add(check);
        string? alertId = null;
        if (result == "potential_match")
        {
            var alert = new Alert
            {
                Id = Ids.New("alt"), CreatedAt = uow.Now, Type = best!.Program?.Contains("PEP") == true ? "pep" : "sanctions", RuleKey = "sanctions_screening",
                SubjectType = subjectType, SubjectId = subjectId, Severity = "CRITICAL", Status = "NEW",
                Summary = best.Program?.Contains("PEP") == true ? "Potential politically exposed person match" : "Potential sanctions match",
                ReasonsJson = Json.Serialize(new[] { new { code = "name_similarity", text = $"'{name}' resembles listed name '{best.Name}' (score {bestScore}).", list = version, context } }),
                RelatedJson = Json.Serialize(new { screening_check = check.Id, entry = best.Id, program = best.Program }),
                DedupeKey = $"screen:{subjectId}:{best.Id}:{context}:{uow.Now:yyyyMMddHH}",
            };
            var existing = await db.Alerts.FirstOrDefaultAsync(a => a.DedupeKey == alert.DedupeKey);
            if (existing == null) db.Alerts.Add(alert); else alert = existing;
            check.AlertId = alert.Id;
            alertId = alert.Id;
        }
        await db.SaveChangesAsync();
        return new Outcome(result, bestScore, alertId, check);
    }

    public static string Normalize(string s)
    {
        var d = s.Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder();
        foreach (var c in d)
            if (char.IsLetterOrDigit(c) || c == ' ') sb.Append(char.ToLowerInvariant(c));
        var tokens = sb.ToString().Split(' ', StringSplitOptions.RemoveEmptyEntries).Where(t => t is not ("mr" or "mrs" or "ms" or "dr" or "ltd" or "llc" or "inc")).OrderBy(t => t);
        return string.Join(' ', tokens);
    }

    public static int Score(string a, string b)
    {
        if (a.Length == 0 || b.Length == 0) return 0;
        if (a == b) return 100;
        return (int)Math.Round(JaroWinkler(a, b) * 100);
    }

    public static double JaroWinkler(string s1, string s2)
    {
        var range = Math.Max(0, Math.Max(s1.Length, s2.Length) / 2 - 1);
        var m1 = new bool[s1.Length];
        var m2 = new bool[s2.Length];
        var matches = 0;
        for (var i = 0; i < s1.Length; i++)
            for (var j = Math.Max(0, i - range); j < Math.Min(s2.Length, i + range + 1); j++)
                if (!m2[j] && s1[i] == s2[j]) { m1[i] = m2[j] = true; matches++; break; }
        if (matches == 0) return 0;
        var t = 0;
        for (int i = 0, k = 0; i < s1.Length; i++)
        {
            if (!m1[i]) continue;
            while (!m2[k]) k++;
            if (s1[i] != s2[k]) t++;
            k++;
        }
        var jaro = (matches / (double)s1.Length + matches / (double)s2.Length + (matches - t / 2.0) / matches) / 3;
        var prefix = 0;
        for (var i = 0; i < Math.Min(4, Math.Min(s1.Length, s2.Length)) && s1[i] == s2[i]; i++) prefix++;
        return jaro + prefix * 0.1 * (1 - jaro);
    }
}

/// <summary>
/// Transaction monitoring (§47-§50, §106-§111). Rules are configuration (thresholds, windows, action)
/// evaluated against the candidate transfer plus recent history. Output is an explainable alert: which
/// rule, which values, which related transfers (§174) — and "hold" only where policy says so.
/// </summary>
public class MonitoringService(AppDb db, Uow uow)
{
    public record Outcome(bool Hold, string Reason, List<Alert> Alerts);

    private record Hit(MonitoringRule Rule, List<object> Reasons, List<string> RelatedTransfers, List<string> Counterparties);

    public async Task<Outcome> Evaluate(Transfer t, User user)
    {
        var rules = await db.MonitoringRules.Where(r => r.Enabled).ToListAsync();
        var hits = new List<Hit>();
        var usd = FxTable.ToUsd(t.SourceAmount, t.SourceCurrency);
        var wallet = t.Type == "funding" ? t.RecipientWalletId : t.SenderWalletId;
        var history = await db.Transfers.Where(x => (x.SenderWalletId == wallet || x.RecipientWalletId == wallet) && x.Id != t.Id
                                                    && x.Status != "FAILED" && x.Status != "CANCELLED" && x.CreatedAt >= uow.Now.AddDays(-120)).ToListAsync();

        foreach (var rule in rules)
        {
            var p = JsonDocument.Parse(rule.ParamsJson).RootElement;
            long L(string k, long d) => p.TryGetProperty(k, out var v) ? v.GetInt64() : d;
            switch (rule.Key)
            {
                case "large_transaction" when usd >= L("usd_threshold", 1_000_000):
                    hits.Add(new(rule, [Reason("amount", $"Amount {Money.Format(t.SourceAmount, t.SourceCurrency)} (≈{Money.Format(usd, "USD")}) is at or above the review threshold.", usd, L("usd_threshold", 1_000_000))], [], []));
                    break;
                case "velocity":
                {
                    var window = uow.Now.AddMinutes(-L("window_minutes", 60));
                    var recent = history.Where(x => x.SenderWalletId == wallet && x.CreatedAt >= window).ToList();
                    if (t.SenderWalletId != null && recent.Count + 1 >= L("count", 10))
                        hits.Add(new(rule, [Reason("velocity", $"{recent.Count + 1} outgoing transfers within {L("window_minutes", 60)} minutes.", recent.Count + 1, L("count", 10))], recent.Select(x => x.Id).ToList(), []));
                    break;
                }
                case "rapid_pass_through" when t.SenderWalletId != null && t.Type is "internal" or "withdrawal":
                {
                    var window = uow.Now.AddMinutes(-L("window_minutes", 60));
                    var inflows = history.Where(x => x.RecipientWalletId == wallet && x.Status == "COMPLETED" && x.CreatedAt >= window).ToList();
                    var inUsd = inflows.Sum(x => FxTable.ToUsd(x.DestinationAmount, x.DestinationCurrency));
                    var outUsd = history.Where(x => x.SenderWalletId == wallet && x.CreatedAt >= window).Sum(x => FxTable.ToUsd(x.SourceAmount, x.SourceCurrency)) + usd;
                    if (inUsd >= L("min_usd", 100_000) && outUsd * 10_000 >= inUsd * L("min_outflow_ratio_bps", 8000))
                        hits.Add(new(rule, [Reason("pass_through", $"{Money.Format(outUsd, "USD")} moved out within {L("window_minutes", 60)} minutes of receiving {Money.Format(inUsd, "USD")}.", outUsd, inUsd)],
                            inflows.Select(x => x.Id).ToList(), []));
                    break;
                }
                case "fan_in" when t.RecipientWalletId != null && t.Type == "internal":
                {
                    var window = uow.Now.AddHours(-L("window_hours", 24));
                    var senders = await db.Transfers.Where(x => x.RecipientWalletId == t.RecipientWalletId && x.CreatedAt >= window && x.SenderWalletId != null && x.Status != "CANCELLED")
                        .Select(x => x.SenderWalletId!).Distinct().ToListAsync();
                    if (!senders.Contains(t.SenderWalletId!)) senders.Add(t.SenderWalletId!);
                    if (senders.Count >= L("distinct_senders", 5))
                        hits.Add(new(rule, [Reason("many_to_one", $"{senders.Count} distinct senders paid this recipient within {L("window_hours", 24)} hours.", senders.Count, L("distinct_senders", 5))], [], senders));
                    break;
                }
                case "fan_out" when t.SenderWalletId != null && t.Type == "internal":
                {
                    var window = uow.Now.AddHours(-L("window_hours", 24));
                    var recipients = history.Where(x => x.SenderWalletId == wallet && x.CreatedAt >= window && x.RecipientWalletId != null).Select(x => x.RecipientWalletId!).Distinct().ToList();
                    if (!recipients.Contains(t.RecipientWalletId!)) recipients.Add(t.RecipientWalletId!);
                    if (recipients.Count >= L("distinct_recipients", 5))
                        hits.Add(new(rule, [Reason("one_to_many", $"Sent to {recipients.Count} distinct recipients within {L("window_hours", 24)} hours.", recipients.Count, L("distinct_recipients", 5))], [], recipients));
                    break;
                }
                case "circular" when t.Type == "internal":
                {
                    var path = await FindCycle(t, (int)L("max_hops", 4), uow.Now.AddHours(-L("window_hours", 72)));
                    if (path != null)
                        hits.Add(new(rule, [Reason("circular_flow", $"Funds return to the originating wallet through {path.Count} hops.", path.Count, L("max_hops", 4))], path, []));
                    break;
                }
                case "dormant_reactivation" when t.SenderWalletId != null && usd >= L("min_usd", 50_000):
                {
                    var last = history.Where(x => x.SenderWalletId == wallet).OrderByDescending(x => x.CreatedAt).FirstOrDefault();
                    var walletRow = await db.Wallets.FirstAsync(w => w.Id == wallet);
                    var lastActivity = last?.CreatedAt ?? walletRow.CreatedAt;
                    if (lastActivity <= uow.Now.AddDays(-L("dormant_days", 90)))
                        hits.Add(new(rule, [Reason("dormant", $"First outgoing activity in {(uow.Now - lastActivity).Days} days, for {Money.Format(usd, "USD")}.", (uow.Now - lastActivity).Days, L("dormant_days", 90))], [], []));
                    break;
                }
                case "new_bank_withdrawal" when t.Type == "withdrawal" && t.BankAccountId != null:
                {
                    var bank = await db.BankAccounts.FirstAsync(b => b.Id == t.BankAccountId);
                    var minutes = L("minutes", 60);
                    var shared = await db.BankAccounts.Where(b => b.Fingerprint == bank.Fingerprint && b.OwnerId != bank.OwnerId).Select(b => b.OwnerId).ToListAsync();
                    if (bank.CreatedAt >= uow.Now.AddMinutes(-minutes))
                        hits.Add(new(rule, [Reason("new_bank_account", $"Withdrawal to a bank account added {(int)(uow.Now - bank.CreatedAt).TotalMinutes} minutes ago.", (long)(uow.Now - bank.CreatedAt).TotalMinutes, minutes)], [], shared));
                    if (shared.Count > 0)
                        hits.Add(new(rule, [Reason("shared_bank_account", $"The destination bank account is also registered by {shared.Count} other account(s).", shared.Count, 0)], [], shared));
                    break;
                }
                case "structuring" when t.SenderWalletId != null:
                {
                    var threshold = L("usd_threshold", 1_000_000);
                    var band = threshold - threshold * L("band_bps", 1000) / 10_000;
                    var window = uow.Now.AddHours(-L("window_hours", 24));
                    var near = history.Where(x => x.SenderWalletId == wallet && x.CreatedAt >= window).Select(x => FxTable.ToUsd(x.SourceAmount, x.SourceCurrency)).Count(v => v >= band && v < threshold);
                    if (usd >= band && usd < threshold) near++;
                    if (near >= L("count", 3))
                        hits.Add(new(rule, [Reason("structuring", $"{near} transfers just below the {Money.Format(threshold, "USD")} review threshold within {L("window_hours", 24)} hours.", near, L("count", 3))], [], []));
                    break;
                }
                case "account_takeover" when t.Type is "withdrawal" or "internal":
                {
                    var window = uow.Now.AddMinutes(-L("minutes", 60));
                    var events = await db.SecurityEvents.Where(e => e.UserId == user.Id && e.CreatedAt >= window).Select(e => e.Type).ToListAsync();
                    var signals = events.Where(e => e is "password_reset" or "new_device" or "mfa_disabled" or "bank_account_added" or "impossible_travel").Distinct().ToList();
                    if (signals.Count >= 2 && usd >= L("min_usd", 20_000))
                        hits.Add(new(rule, [Reason("account_takeover_pattern", $"Recent security changes ({string.Join(", ", signals)}) followed by a {Money.Format(usd, "USD")} transfer.", signals.Count, 2)], [], []));
                    break;
                }
            }
        }

        var alerts = new List<Alert>();
        foreach (var h in hits)
        {
            var dedupe = $"{h.Rule.Key}:{user.Id}:{t.Id}";
            if (await db.Alerts.AnyAsync(a => a.DedupeKey == dedupe)) continue;
            var a = new Alert
            {
                Id = Ids.New("alt"), CreatedAt = uow.Now, Type = "aml", RuleKey = h.Rule.Key, RuleVersion = h.Rule.Version, SubjectType = "user", SubjectId = user.Id,
                TransferId = t.Id, Severity = h.Rule.Severity, Status = "NEW", Amount = t.SourceAmount, Currency = t.SourceCurrency,
                Summary = SummaryFor(h.Rule.Key), ReasonsJson = Json.Serialize(h.Reasons),
                RelatedJson = Json.Serialize(new { transfers = h.RelatedTransfers, counterparties = h.Counterparties, rule = new { h.Rule.Key, h.Rule.Version, @params = JsonDocument.Parse(h.Rule.ParamsJson).RootElement } }),
                DedupeKey = dedupe,
            };
            db.Alerts.Add(a);
            alerts.Add(a);
        }
        var holdRule = hits.FirstOrDefault(h => h.Rule.Action == "hold");
        return new Outcome(holdRule != null, holdRule == null ? "" : $"Monitoring rule {holdRule.Rule.Key} v{holdRule.Rule.Version}", alerts);
    }

    private static object Reason(string code, string text, long observed, long threshold) => new { code, text, observed, threshold };

    /// <summary>Plain-language, non-accusatory alert titles (§94).</summary>
    public static string SummaryFor(string key) => key switch
    {
        "large_transaction" => "Transaction above review threshold",
        "velocity" => "High transaction velocity",
        "rapid_pass_through" => "Rapid movement of funds after receipt",
        "fan_in" => "Unusually concentrated incoming transfers",
        "fan_out" => "Unusually dispersed outgoing transfers",
        "circular" => "Circular movement of funds",
        "dormant_reactivation" => "Sudden activity after dormancy",
        "new_bank_withdrawal" => "Withdrawal to newly added or shared bank account",
        "structuring" => "Repeated transfers just below threshold",
        "account_takeover" => "Security changes followed by money movement",
        _ => "Unusual transaction pattern",
    };

    /// <summary>Depth-limited search for A → … → A through completed transfers in the window.</summary>
    private async Task<List<string>?> FindCycle(Transfer t, int maxHops, DateTime since)
    {
        var edges = await db.Transfers.Where(x => x.Type == "internal" && x.CreatedAt >= since && (x.Status == "COMPLETED" || x.Status == "HELD"))
            .Select(x => new { x.Id, x.SenderWalletId, x.RecipientWalletId }).ToListAsync();
        var origin = t.SenderWalletId;
        var queue = new Queue<(string Wallet, List<string> Path)>();
        queue.Enqueue((t.RecipientWalletId!, [t.Id]));
        while (queue.Count > 0)
        {
            var (w, path) = queue.Dequeue();
            if (path.Count > maxHops) continue;
            foreach (var e in edges.Where(e => e.SenderWalletId == w))
            {
                if (path.Contains(e.Id)) continue;
                var next = new List<string>(path) { e.Id };
                if (e.RecipientWalletId == origin) return next;
                queue.Enqueue((e.RecipientWalletId!, next));
            }
        }
        return null;
    }
}
