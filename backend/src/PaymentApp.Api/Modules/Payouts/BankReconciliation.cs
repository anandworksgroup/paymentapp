using System.Globalization;
using Microsoft.EntityFrameworkCore;
using PaymentApp.Api.Common;
using PaymentApp.Api.Data;
using PaymentApp.Api.Infrastructure;
using PaymentApp.Api.Modules.Operations;

namespace PaymentApp.Api.Modules.Payouts;

/// <summary>
/// Bank-statement reconciliation (§229): the merchant uploads their bank's CSV statement and each deposit is
/// matched to a paid payout — first by the payout reference printed on the statement, then by exact amount
/// within a few days of the payout. Unknown deposits and payouts missing from the statement are listed so
/// nothing is silently assumed to have arrived.
/// </summary>
public class BankReconciliationService(AppDb db, Uow uow)
{
    private static readonly string[] DateCols = ["date", "booking_date", "value_date", "transaction_date", "posted"];
    private static readonly string[] AmountCols = ["amount", "value"];
    private static readonly string[] RefCols = ["reference", "ref", "bank_reference", "transaction_reference"];
    private static readonly string[] DescCols = ["description", "narrative", "details", "memo"];
    private const int MatchWindowDays = 5;

    public static long ParseAmount(string raw, string currency)
    {
        var s = raw.Trim().Replace(" ", "").Replace(" ", "");
        var negative = s.StartsWith('(') && s.EndsWith(')');
        s = s.Trim('(', ')');
        // "1,234.56" → thousands separators removed; "1234,56" (comma decimal) → dot.
        if (s.Contains(',') && s.Contains('.')) s = s.Replace(",", "");
        else if (s.Count(c => c == ',') == 1 && s.Split(',')[1].Length != 3) s = s.Replace(',', '.');
        else s = s.Replace(",", "");
        if (!decimal.TryParse(s, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var major))
            throw ApiException.Invalid($"'{raw}' is not an amount.");
        var exponent = Money.Info(currency).Exponent;
        var minor = major * (decimal)Math.Pow(10, exponent);
        if (minor != decimal.Truncate(minor)) throw ApiException.Invalid($"'{raw}' has more decimals than {currency} allows.");
        return (long)(negative ? -minor : minor);
    }

    public async Task<object> Import(string content, string currency, string? accountLabel)
    {
        currency = Money.Normalize(currency);
        var rows = ImportService.Parse("csv", content);
        if (rows.Count == 0) throw ApiException.Invalid("The statement has no rows.");
        if (rows.Count > 20_000) throw ApiException.Invalid("At most 20,000 lines per statement.");
        string? Col(Dictionary<string, string> r, string[] names) => names.Select(n => r.GetValueOrDefault(n)).FirstOrDefault(v => !string.IsNullOrWhiteSpace(v));
        var header = rows[0].Keys.ToList();
        if (!DateCols.Any(header.Contains)) throw ApiException.Invalid("Missing a date column (date, booking_date or value_date).");
        var hasAmount = AmountCols.Any(header.Contains);
        if (!hasAmount && !(header.Contains("credit") || header.Contains("debit"))) throw ApiException.Invalid("Missing an amount column (amount, or credit/debit).");

        var lines = new List<BankStatementLine>();
        var errors = new List<string>();
        for (var i = 0; i < rows.Count; i++)
        {
            var r = rows[i];
            try
            {
                var dateRaw = Col(r, DateCols) ?? throw ApiException.Invalid("date is empty");
                if (!DateTime.TryParse(dateRaw, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var date))
                    throw ApiException.Invalid($"'{dateRaw}' is not a date (use YYYY-MM-DD)");
                long amount;
                if (hasAmount) amount = ParseAmount(Col(r, AmountCols)!, currency);
                else
                {
                    var credit = r.GetValueOrDefault("credit");
                    var debit = r.GetValueOrDefault("debit");
                    amount = !string.IsNullOrWhiteSpace(credit) ? ParseAmount(credit, currency) : -Math.Abs(ParseAmount(debit ?? "0", currency));
                }
                var lineCurrency = r.GetValueOrDefault("currency") is { Length: 3 } c ? Money.Normalize(c) : currency;
                lines.Add(new BankStatementLine
                {
                    Id = Ids.New("bsl"), CreatedAt = uow.Now, LineNumber = i + 2, Date = date, Amount = amount, Currency = lineCurrency,
                    Reference = Col(r, RefCols)?.Trim(), Description = Col(r, DescCols)?.Trim(),
                });
            }
            catch (ApiException ex) { errors.Add($"Line {i + 2}: {ex.Message}"); }
        }
        if (errors.Count > 0) throw new ApiException(400, "statement_invalid", $"{errors.Count} line(s) couldn't be read. {string.Join(" ", errors.Take(5))}", errors.Take(50));

        return await uow.Run(async () =>
        {
            var st = new BankStatement
            {
                Id = Ids.New("bst"), CreatedAt = uow.Now, AccountLabel = string.IsNullOrWhiteSpace(accountLabel) ? "Bank account" : accountLabel.Trim(), Currency = currency,
                PeriodStart = lines.Min(l => l.Date), PeriodEnd = lines.Max(l => l.Date), Lines = lines.Count, CreatedBy = uow.Ctx.ActorId,
            };
            foreach (var l in lines) l.StatementId = st.Id;
            db.BankStatements.Add(st);
            db.BankStatementLines.AddRange(lines);
            await AutoMatch(lines);
            Recount(st, lines);
            uow.Audit("bank_statement.import", "bank_statement", st.Id, after: new { st.Lines, st.Matched, st.Unmatched });
            return await Detail(st, lines);
        });
    }

    private async Task AutoMatch(List<BankStatementLine> lines)
    {
        var credits = lines.Where(l => l.Amount > 0).ToList();
        if (credits.Count == 0) return;
        var from = credits.Min(l => l.Date).AddDays(-MatchWindowDays - 2);
        var to = credits.Max(l => l.Date).AddDays(1);
        var taken = (await db.BankStatementLines.Where(l => l.PayoutId != null).Select(l => l.PayoutId!).ToListAsync()).ToHashSet();
        var payouts = await db.Payouts.Where(p => p.Status == "PAID" && p.PaidAt >= from && p.PaidAt <= to).ToListAsync();
        foreach (var line in credits)
        {
            var open = payouts.Where(p => !taken.Contains(p.Id) && p.Currency == line.Currency && p.Amount == line.Amount).ToList();
            var text = $"{line.Reference} {line.Description}";
            var byRef = open.FirstOrDefault(p => text.Contains(p.Id, StringComparison.OrdinalIgnoreCase) || (p.BankReference != null && text.Contains(p.BankReference, StringComparison.OrdinalIgnoreCase)));
            var byDate = byRef ?? open.Where(p => p.PaidAt != null && Math.Abs((line.Date.Date - p.PaidAt.Value.Date).TotalDays) <= MatchWindowDays)
                .OrderBy(p => Math.Abs((line.Date - p.PaidAt!.Value).TotalHours)).FirstOrDefault();
            if (byDate == null) continue;
            line.PayoutId = byDate.Id;
            line.Status = "matched";
            line.MatchMethod = byRef != null ? "reference" : "amount_date";
            taken.Add(byDate.Id);
        }
    }

    private static void Recount(BankStatement st, IReadOnlyCollection<BankStatementLine> lines)
    {
        st.Matched = lines.Count(l => l.Status == "matched");
        st.Ignored = lines.Count(l => l.Status == "ignored");
        st.Unmatched = lines.Count(l => l.Status == "unmatched");
    }

    public async Task<object> Detail(BankStatement st, List<BankStatementLine>? lines = null)
    {
        lines ??= await db.BankStatementLines.Where(l => l.StatementId == st.Id).OrderBy(l => l.LineNumber).ToListAsync();
        // Paid payouts that should have landed within the statement period but aren't on any statement.
        var matchedAnywhere = (await db.BankStatementLines.Where(l => l.PayoutId != null).Select(l => l.PayoutId!).ToListAsync()).ToHashSet();
        foreach (var l in lines.Where(l => l.PayoutId != null)) matchedAnywhere.Add(l.PayoutId!);
        var start = st.PeriodStart ?? st.CreatedAt;
        var end = (st.PeriodEnd ?? st.CreatedAt).AddDays(-2); // allow for bank lag at the end of the statement
        var missing = (await db.Payouts.Where(p => p.Status == "PAID" && p.Currency == st.Currency && p.PaidAt >= start && p.PaidAt <= end).ToListAsync())
            .Where(p => !matchedAnywhere.Contains(p.Id)).ToList();
        return new
        {
            @object = "bank_statement", statement = st,
            summary = new
            {
                credits = lines.Where(l => l.Amount > 0).Sum(l => l.Amount), debits = lines.Where(l => l.Amount < 0).Sum(l => l.Amount),
                matched_amount = lines.Where(l => l.Status == "matched").Sum(l => l.Amount),
                unknown_deposits = lines.Count(l => l.Status == "unmatched" && l.Amount > 0),
                payouts_missing = missing.Count,
            },
            lines,
            missing_payouts = missing.Select(p => new { p.Id, p.Amount, p.Currency, p.PaidAt, p.DestinationLast4, p.BankReference }),
        };
    }

    public async Task<object> Match(string statementId, string lineId, string payoutId)
    {
        return await uow.Run(async () =>
        {
            var line = await db.BankStatementLines.FirstOrDefaultAsync(l => l.Id == lineId && l.StatementId == statementId) ?? throw ApiException.NotFound("statement line");
            var payout = await db.Payouts.FirstOrDefaultAsync(p => p.Id == payoutId) ?? throw ApiException.NotFound("payout");
            if (payout.Status != "PAID") throw ApiException.Conflict("payout_not_paid", "Only paid payouts can be matched to a deposit.");
            if (payout.Currency != line.Currency || payout.Amount != line.Amount)
                throw ApiException.Invalid($"The deposit ({Money.Format(line.Amount, line.Currency)}) doesn't equal the payout ({Money.Format(payout.Amount, payout.Currency)}).");
            if (await db.BankStatementLines.AnyAsync(l => l.PayoutId == payoutId && l.Id != lineId)) throw ApiException.Conflict("already_matched", "This payout is already matched to another deposit.");
            line.PayoutId = payoutId;
            line.Status = "matched";
            line.MatchMethod = "manual";
            line.Note = null;
            var st = await db.BankStatements.FirstAsync(s => s.Id == statementId);
            await db.SaveChangesAsync();
            Recount(st, await db.BankStatementLines.Where(l => l.StatementId == statementId).ToListAsync());
            uow.Audit("bank_statement.match", "bank_statement_line", line.Id, after: new { payoutId });
            return (object)line;
        });
    }

    public async Task<object> SetStatus(string statementId, string lineId, bool ignore, string? note)
    {
        if (ignore && string.IsNullOrWhiteSpace(note)) throw ApiException.Invalid("Say why this line is ignored (for example: rent, card fees).");
        return await uow.Run(async () =>
        {
            var line = await db.BankStatementLines.FirstOrDefaultAsync(l => l.Id == lineId && l.StatementId == statementId) ?? throw ApiException.NotFound("statement line");
            line.Status = ignore ? "ignored" : "unmatched";
            line.PayoutId = null;
            line.MatchMethod = null;
            line.Note = ignore ? note!.Trim() : null;
            var st = await db.BankStatements.FirstAsync(s => s.Id == statementId);
            await db.SaveChangesAsync();
            Recount(st, await db.BankStatementLines.Where(l => l.StatementId == statementId).ToListAsync());
            uow.Audit(ignore ? "bank_statement.ignore" : "bank_statement.unmatch", "bank_statement_line", line.Id, after: new { note });
            return (object)line;
        });
    }
}
