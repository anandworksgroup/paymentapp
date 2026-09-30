using System.Text.Json;
using Anthropic;
using Anthropic.Models.Beta.Messages;
using Microsoft.EntityFrameworkCore;
using PaymentApp.Api.Common;
using PaymentApp.Api.Data;
using PaymentApp.Api.Infrastructure;
using PaymentApp.Api.Modules.Payments;
using PaymentApp.Api.Modules.Payouts;
using PaymentApp.Api.Modules.Reports;

namespace PaymentApp.Api.Modules.Copilot;

/// <summary>
/// AI financial copilot (§46, §47, §326, §327). Claude answers only from tool results that query the
/// merchant's own tenant-scoped data. Read tools run automatically; write tools never execute — they
/// store a draft the merchant must confirm (§47), and high-risk actions (refunds, payout changes, tax
/// configuration) are deliberately not exposed as tools at all.
/// </summary>
public class CopilotService(AppDb db, Uow uow, RequestContext ctx, ReportsService reports, TreasuryService treasury, IConfiguration config, ILogger<CopilotService> log)
{
    private const string Model = "claude-opus-5-5";
    private const int MaxIterations = 8;

    private const string SystemPrompt = """
        You are the financial copilot inside a merchant's payments and billing dashboard. The platform acts as
        Merchant of Record: it collects payments, remits sales tax/VAT/GST, and pays out the merchant's net proceeds.

        Ground every number in tool results from this conversation. If the tools don't return what's needed, say
        what's missing instead of estimating — a fabricated figure is worse than no answer here. Amounts from tools are
        integer minor units (e.g. 1099 = 10.99 in a two-decimal currency); convert them when you present them.

        End each answer with a short "Data used" line naming the tools, the time period and any filters.

        You can prepare drafts (a new price, a payment link), but drafts are not applied until the merchant presses
        Confirm, so describe them as drafts awaiting confirmation. Refunds, payout account changes, tax settings
        and account closure are not available to you: point the merchant to the relevant dashboard page, which asks
        them to re-authenticate.

        Keep answers short and scannable: lead with the direct answer, then at most a few supporting bullets.
        """;

    public bool Configured => !string.IsNullOrEmpty(ApiKey);
    private string? ApiKey => config["Anthropic:ApiKey"] ?? Environment.GetEnvironmentVariable("ANTHROPIC_API_KEY");

    public record ToolTrace(string Name, JsonElement Input, string Summary);

    public async Task<object> Ask(string question, List<CopilotTurn>? history)
    {
        if (!Configured)
            throw new ApiException(503, "copilot_unavailable", "The AI copilot needs an Anthropic API key (Anthropic:ApiKey or ANTHROPIC_API_KEY) on the server.");
        if (string.IsNullOrWhiteSpace(question) || question.Length > 4000) throw ApiException.Invalid("Ask a question of up to 4000 characters.");

        var client = new AnthropicClient { ApiKey = ApiKey };
        var messages = new List<BetaMessageParam>();
        foreach (var turn in (history ?? []).TakeLast(10))
            messages.Add(new BetaMessageParam { Role = turn.Role == "assistant" ? Role.Assistant : Role.User, Content = turn.Text });
        messages.Add(new BetaMessageParam { Role = Role.User, Content = $"Today is {DateTime.UtcNow:yyyy-MM-dd} (UTC). {question}" });

        var traces = new List<ToolTrace>();
        var proposals = new List<CopilotAction>();
        for (var i = 0; i < MaxIterations; i++)
        {
            var response = await client.Beta.Messages.Create(new MessageCreateParams
            {
                Model = Model,
                MaxTokens = 16000,
                System = SystemPrompt,
                Tools = Tools(),
                Messages = messages,
                // Claude's own refusal fallback: a declined request is re-served by a suitable model.
                Betas = ["server-side-fallback-2026-07-01"],
                Fallbacks = new Default(),
            });

            if (response.StopReason == "refusal")
                return Result("I can't help with that request here.", traces, proposals, response.StopReason);

            var assistant = new List<BetaContentBlockParam>();
            var results = new List<BetaContentBlockParam>();
            var text = new List<string>();
            foreach (var block in response.Content)
            {
                if (block.TryPickText(out var t)) { assistant.Add(new BetaTextBlockParam { Text = t.Text }); text.Add(t.Text); }
                else if (block.TryPickThinking(out var th)) assistant.Add(new BetaThinkingBlockParam { Thinking = th.Thinking, Signature = th.Signature });
                else if (block.TryPickRedactedThinking(out var rt)) assistant.Add(new BetaRedactedThinkingBlockParam { Data = rt.Data });
                else if (block.TryPickToolUse(out var tu))
                {
                    assistant.Add(new BetaToolUseBlockParam { ID = tu.ID, Name = tu.Name, Input = tu.Input });
                    var input = JsonSerializer.SerializeToElement(tu.Input);
                    string output;
                    var isError = false;
                    try
                    {
                        output = await Execute(tu.Name, input, proposals);
                    }
                    catch (ApiException ex)
                    {
                        output = Json.Serialize(new { error = ex.Code, message = ex.Message });
                        isError = true;
                    }
                    traces.Add(new ToolTrace(tu.Name, input, output.Length > 300 ? output[..300] + "…" : output));
                    results.Add(new BetaToolResultBlockParam { ToolUseID = tu.ID, Content = output, IsError = isError });
                }
            }
            messages.Add(new BetaMessageParam { Role = Role.Assistant, Content = assistant });
            if (response.StopReason != "tool_use" || results.Count == 0)
                return Result(string.Join("\n\n", text).Trim(), traces, proposals, response.StopReason);
            messages.Add(new BetaMessageParam { Role = Role.User, Content = results });
        }
        log.LogWarning("Copilot hit the iteration limit for {Org}", ctx.OrgId);
        return Result("I couldn't finish that analysis in one go. Try narrowing the question (a shorter period or one metric).", traces, proposals, "iteration_limit");
    }

    private static object Result(string answer, List<ToolTrace> traces, List<CopilotAction> proposals, string? stop) => new
    {
        @object = "copilot_answer", answer, model = Model, stop_reason = stop,
        tool_calls = traces.Select(t => new { name = t.Name, input = t.Input, result_preview = t.Summary }),
        proposals = proposals.Select(p => new { p.Id, p.Kind, p.Summary, p.RiskLevel, p.Status, payload = p.Payload }),
    };

    // ───────────────────────── Tools ─────────────────────────

    private static BetaTool Tool(string name, string description, object properties, params string[] required) => new()
    {
        Name = name,
        Description = description,
        InputSchema = new()
        {
            Properties = JsonSerializer.SerializeToElement(properties).EnumerateObject().ToDictionary(p => p.Name, p => p.Value.Clone()),
            Required = required,
        },
    };

    private static readonly object Period = new { type = "string", description = "ISO date (YYYY-MM-DD). Optional." };

    private static List<BetaToolUnion> Tools() =>
    [
        Tool("get_revenue_summary", "Revenue, fees, taxes, refunds, chargebacks, MRR/ARR, subscriptions, customers, conversion and a daily series for a period. Use for any 'how much / how did revenue do' question. Defaults to the last 30 days.",
            new { from = Period, to = Period, currency = new { type = "string", description = "Reporting currency (ISO code). Optional." }, country = new { type = "string", description = "Filter by customer country (ISO-2). Optional." } }),
        Tool("compare_periods", "Gross revenue and payment counts for two consecutive periods of equal length ending at 'to' — for 'why did revenue drop' or period-over-period questions.",
            new { to = Period, days = new { type = "integer", description = "Length of each period in days, e.g. 1 for today vs yesterday, 7, 30." } }, "days"),
        Tool("payment_failures", "Failed payments grouped by country, failure code and payment method with counts and failure rates, for a period.",
            new { from = Period, to = Period }),
        Tool("top_products", "Products ranked by net sales (after discounts, excluding tax) in a period.",
            new { from = Period, to = Period, limit = new { type = "integer", description = "How many products (1-20). Default 5." } }),
        Tool("tax_collected", "Tax collected and remitted by the platform, by jurisdiction and tax type, for a period.",
            new { from = Period, to = Period }),
        Tool("customers_with_failed_payments", "Customers with at least N failed payments in the period, with their emails and last failure reason.",
            new { min_failures = new { type = "integer", description = "Minimum failed payments. Default 2." }, from = Period, to = Period }),
        Tool("explain_payout", "Explains a payout: amount, status, bank, and the balance transactions (payments, refunds, fees, chargebacks, reserves) it contains. Omit payout_id for the most recent payout.",
            new { payout_id = new { type = "string", description = "po_… id. Optional." } }),
        Tool("get_balance", "Current available, pending and reserved balance per currency, from the ledger.", new { }),
        Tool("find_products", "Looks up products and their active prices by name.",
            new { query = new { type = "string", description = "Part of the product name." } }, "query"),
        Tool("draft_price", "Prepares (does NOT create) a new price for an existing product, for the merchant to confirm. For credit plans set credits_granted.",
            new
            {
                product_id = new { type = "string" }, unit_amount = new { type = "integer", description = "Minor units." }, currency = new { type = "string" },
                interval = new { type = "string", @enum = new[] { "one_time", "month", "year" } }, credits_granted = new { type = "integer", description = "Credits per purchase/period. Optional." },
                nickname = new { type = "string" },
            }, "product_id", "unit_amount", "currency", "interval"),
        Tool("draft_payment_link", "Prepares (does NOT create) a shareable payment link for an existing active price, for the merchant to confirm.",
            new { price_id = new { type = "string" }, quantity = new { type = "integer" } }, "price_id"),
    ];

    private (DateTime From, DateTime To) Range(JsonElement input, int defaultDays = 30)
    {
        DateTime? Parse(string key) => input.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String && DateTime.TryParse(v.GetString(), out var d)
            ? DateTime.SpecifyKind(d, DateTimeKind.Utc) : null;
        var to = Parse("to")?.AddDays(1) ?? DateTime.UtcNow.AddMinutes(1);
        var from = Parse("from") ?? to.AddDays(-defaultDays);
        if (from >= to) throw ApiException.Invalid("'from' must be before 'to'.");
        return (from, to);
    }

    private static string? Str(JsonElement e, string key) => e.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
    private static long? Num(JsonElement e, string key) => e.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetInt64() : null;

    private async Task<string> Execute(string name, JsonElement input, List<CopilotAction> proposals)
    {
        var orgId = ctx.OrgId!;
        switch (name)
        {
            case "get_revenue_summary":
            {
                var (from, to) = Range(input);
                var currency = Str(input, "currency") ?? (await db.Organizations.FirstAsync(o => o.Id == orgId)).DefaultCurrency;
                return Json.Serialize(await reports.Dashboard(orgId, ctx.Livemode, from, to, Money.Normalize(currency), Str(input, "country"), null));
            }
            case "compare_periods":
            {
                var days = (int)Math.Clamp(Num(input, "days") ?? 1, 1, 365);
                var (_, to) = Range(input, days);
                var mid = to.AddDays(-days);
                var start = mid.AddDays(-days);
                var rows = await db.Payments.Where(p => p.CreatedAt >= start && p.CreatedAt < to).ToListAsync();
                object Period(DateTime a, DateTime b)
                {
                    var r = rows.Where(p => p.CreatedAt >= a && p.CreatedAt < b).ToList();
                    return new
                    {
                        from = a, to = b, attempts = r.Count, succeeded = r.Count(p => p.AmountCaptured > 0), failed = r.Count(p => p.Status == "FAILED"),
                        gross_by_currency = r.Where(p => p.AmountCaptured > 0).GroupBy(p => p.Currency).ToDictionary(g => g.Key, g => g.Sum(p => p.Amount - p.TaxAmount)),
                        by_country = r.Where(p => p.AmountCaptured > 0).GroupBy(p => p.Country ?? "??").ToDictionary(g => g.Key, g => g.Count()),
                    };
                }
                return Json.Serialize(new { previous = Period(start, mid), current = Period(mid, to), amounts_are = "minor units, excluding tax" });
            }
            case "payment_failures":
            {
                var (from, to) = Range(input);
                var rows = await db.Payments.Where(p => p.CreatedAt >= from && p.CreatedAt < to).ToListAsync();
                return Json.Serialize(new
                {
                    total = rows.Count, failed = rows.Count(p => p.Status == "FAILED"),
                    by_country = rows.GroupBy(p => p.Country ?? "??").Select(g => new { country = g.Key, attempts = g.Count(), failed = g.Count(p => p.Status == "FAILED"), failure_rate_pct = Math.Round(g.Count(p => p.Status == "FAILED") * 100.0 / g.Count(), 1) }).OrderByDescending(x => x.failure_rate_pct),
                    by_code = rows.Where(p => p.Status == "FAILED").GroupBy(p => p.FailureCode ?? "unknown").Select(g => new { code = g.Key, count = g.Count(), suggested_action = g.First().SuggestedAction }),
                    by_method = rows.GroupBy(p => p.PaymentMethodType ?? "unknown").Select(g => new { method = g.Key, attempts = g.Count(), failed = g.Count(p => p.Status == "FAILED") }),
                });
            }
            case "top_products":
            {
                var (from, to) = Range(input);
                var limit = (int)Math.Clamp(Num(input, "limit") ?? 5, 1, 20);
                var orders = await db.Orders.Where(o => o.CreatedAt >= from && o.CreatedAt < to && o.Status != "open" && o.Status != "cancelled").ToListAsync();
                var products = await db.Products.ToDictionaryAsync(p => p.Id, p => p.Name);
                var ranked = orders.SelectMany(o => o.Items.Select(i => new { o.Currency, i.ProductId, net = i.Amount - i.Discount - (i.TaxInclusive ? i.Tax : 0), i.Quantity }))
                    .GroupBy(x => (x.ProductId, x.Currency))
                    .Select(g => new { product_id = g.Key.ProductId, name = products.GetValueOrDefault(g.Key.ProductId ?? "", "?"), currency = g.Key.Currency, net_sales = g.Sum(x => x.net), units = g.Sum(x => x.Quantity), orders = g.Count() })
                    .OrderByDescending(x => FxTable.ToUsd(x.net_sales, x.currency)).Take(limit);
                return Json.Serialize(new { period = new { from, to }, products = ranked });
            }
            case "tax_collected":
            {
                var (from, to) = Range(input);
                var rows = await db.TaxRecords.Where(t => t.CreatedAt >= from && t.CreatedAt < to).ToListAsync();
                return Json.Serialize(new
                {
                    period = new { from, to },
                    by_jurisdiction = rows.GroupBy(r => new { r.Country, r.TaxType, r.Currency }).Select(g => new { g.Key.Country, g.Key.TaxType, g.Key.Currency, tax = g.Sum(x => x.TaxAmount), taxable = g.Sum(x => x.TaxableAmount), records = g.Count() }),
                });
            }
            case "customers_with_failed_payments":
            {
                var (from, to) = Range(input);
                var min = (int)Math.Clamp(Num(input, "min_failures") ?? 2, 1, 100);
                var failed = await db.Payments.Where(p => p.Status == "FAILED" && p.CreatedAt >= from && p.CreatedAt < to).ToListAsync();
                return Json.Serialize(failed.GroupBy(p => p.CustomerId ?? p.CustomerEmail ?? "unknown").Where(g => g.Count() >= min)
                    .Select(g => new { customer = g.Key, email = g.First().CustomerEmail, failures = g.Count(), last_failure = g.Max(p => p.CreatedAt), last_reason = g.OrderBy(p => p.CreatedAt).Last().FailureCode }).Take(50));
            }
            case "explain_payout":
            {
                var id = Str(input, "payout_id");
                var payout = id != null ? await db.Payouts.FirstOrDefaultAsync(p => p.Id == id) : await db.Payouts.OrderByDescending(p => p.CreatedAt).FirstOrDefaultAsync();
                if (payout == null) return Json.Serialize(new { message = "No payouts found." });
                var txns = await db.BalanceTransactions.Where(t => t.PayoutId == payout.Id && t.Type != "payout").ToListAsync();
                return Json.Serialize(new
                {
                    payout = new { payout.Id, payout.Amount, payout.Currency, payout.Status, payout.ArrivalDate, bank_last4 = payout.DestinationLast4, payout.FailureReason, payout.HoldReason },
                    breakdown = payout.Breakdown,
                    components = txns.GroupBy(t => t.Type).Select(g => new { type = g.Key, count = g.Count(), amount = g.Sum(t => t.Amount), fees = g.Sum(t => t.Fee), reserve_withheld = g.Sum(t => t.ReserveAmount) }),
                });
            }
            case "get_balance":
                return Json.Serialize(await treasury.Balance(orgId, ctx.Livemode));
            case "find_products":
            {
                var q = (Str(input, "query") ?? "").ToLowerInvariant();
                var products = await db.Products.Where(p => p.Name.ToLower().Contains(q)).Take(10).ToListAsync();
                var ids = products.Select(p => p.Id).ToList();
                var prices = await db.Prices.Where(p => ids.Contains(p.ProductId) && p.Active).ToListAsync();
                return Json.Serialize(products.Select(p => new { p.Id, p.Name, p.Status, prices = prices.Where(x => x.ProductId == p.Id).Select(x => new { x.Id, x.UnitAmount, x.Currency, x.Type, x.Interval, x.CreditsGranted }) }));
            }
            case "draft_price":
            {
                var productId = Str(input, "product_id") ?? throw ApiException.Invalid("product_id is required.");
                var product = await db.Products.FirstOrDefaultAsync(p => p.Id == productId) ?? throw ApiException.NotFound("product");
                var amount = Num(input, "unit_amount") ?? throw ApiException.Invalid("unit_amount is required.");
                var currency = Money.Normalize(Str(input, "currency"));
                var interval = Str(input, "interval") ?? "one_time";
                var credits = Num(input, "credits_granted") ?? 0;
                var summary = $"New {(interval == "one_time" ? "one-time" : interval + "ly")} price {Money.Format(amount, currency)} for {product.Name}" + (credits > 0 ? $" including {credits:N0} credits" : "");
                var action = await SaveDraft("create_price", summary, "low", new { product_id = product.Id, unit_amount = amount, currency, interval, credits_granted = credits, nickname = Str(input, "nickname") });
                proposals.Add(action);
                return Json.Serialize(new { draft_id = action.Id, status = "awaiting_merchant_confirmation", summary });
            }
            case "draft_payment_link":
            {
                var priceId = Str(input, "price_id") ?? throw ApiException.Invalid("price_id is required.");
                var price = await db.Prices.FirstOrDefaultAsync(p => p.Id == priceId && p.Active) ?? throw ApiException.NotFound("active price");
                var product = await db.Products.FirstAsync(p => p.Id == price.ProductId);
                var qty = Math.Max(1, Num(input, "quantity") ?? 1);
                var summary = $"Payment link for {product.Name} at {Money.Format(price.UnitAmount, price.Currency)}{(qty > 1 ? $" × {qty}" : "")}";
                var action = await SaveDraft("create_payment_link", summary, "low", new { price_id = price.Id, quantity = qty });
                proposals.Add(action);
                return Json.Serialize(new { draft_id = action.Id, status = "awaiting_merchant_confirmation", summary });
            }
            default:
                throw ApiException.Invalid($"Unknown tool {name}.");
        }
    }

    private async Task<CopilotAction> SaveDraft(string kind, string summary, string risk, object payload)
    {
        return await uow.Run(async () =>
        {
            var a = new CopilotAction { Id = Ids.New("cpa"), CreatedAt = uow.Now, Kind = kind, Summary = summary, RiskLevel = risk, PayloadJson = Json.Serialize(payload), RequestedBy = ctx.ActorId };
            db.CopilotActions.Add(a);
            uow.Audit("copilot.draft", "copilot_action", a.Id, after: new { kind, summary });
            await Task.CompletedTask;
            return a;
        });
    }

    /// <summary>The merchant confirms a draft; it then runs through the normal, permission-checked code path.</summary>
    public async Task<object> Confirm(string actionId, bool approve)
    {
        var a = await db.CopilotActions.FirstOrDefaultAsync(x => x.Id == actionId) ?? throw ApiException.NotFound("copilot draft");
        if (a.Status != "draft") throw ApiException.Conflict("already_decided", $"This draft is {a.Status}.");
        if (!approve)
            return await uow.Run(async () => { a.Status = "discarded"; uow.Audit("copilot.discard", "copilot_action", a.Id); await Task.CompletedTask; return (object)a; });
        var p = JsonDocument.Parse(a.PayloadJson).RootElement;
        return await uow.Run(async () =>
        {
            Entity created;
            switch (a.Kind)
            {
                case "create_price":
                {
                    ctx.RequireOrg("products.write");
                    var interval = p.GetProperty("interval").GetString()!;
                    var price = new Price
                    {
                        Id = Ids.New("price"), CreatedAt = uow.Now, ProductId = p.GetProperty("product_id").GetString()!, UnitAmount = p.GetProperty("unit_amount").GetInt64(),
                        Currency = p.GetProperty("currency").GetString()!, Type = interval == "one_time" ? "one_time" : "recurring", Interval = interval == "one_time" ? null : interval,
                        CreditsGranted = p.GetProperty("credits_granted").GetInt64(), Nickname = p.TryGetProperty("nickname", out var n) ? n.GetString() : null,
                    };
                    Engines.PricingEngine.Validate(price);
                    db.Prices.Add(price);
                    uow.Emit("price.created", price);
                    created = price;
                    break;
                }
                case "create_payment_link":
                {
                    ctx.RequireOrg("checkout.write");
                    var link = new PaymentLink { Id = Ids.New("plink", 16), CreatedAt = uow.Now, PriceId = p.GetProperty("price_id").GetString()!, Quantity = p.GetProperty("quantity").GetInt64() };
                    db.PaymentLinks.Add(link);
                    uow.Emit("payment_link.created", link);
                    created = link;
                    break;
                }
                default: throw ApiException.Invalid("Unsupported draft.");
            }
            a.Status = "applied";
            a.ResultObjectId = created.Id;
            a.DecidedAt = uow.Now;
            uow.Audit("copilot.apply", "copilot_action", a.Id, after: new { a.Kind, created = created.Id });
            await Task.CompletedTask;
            return (object)new { action = a, created };
        });
    }
}

public record CopilotTurn(string Role, string Text);
public record CopilotAsk(string Question, List<CopilotTurn>? History);
public record CopilotConfirm(bool Approve);

public static class CopilotEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/v1/copilot").WithTags("Copilot");
        g.MapGet("/status", (RequestContext ctx, CopilotService copilot) => { ctx.RequireOrg("copilot.use"); return new { configured = copilot.Configured, model = "claude-opus-5-5" }; });
        g.MapPost("/ask", async (CopilotAsk r, RequestContext ctx, CopilotService copilot) => { ctx.RequireOrg("copilot.use"); return await copilot.Ask(r.Question, r.History); })
            .RequireRateLimiting("financial");
        g.MapPost("/actions/{id}/confirm", async (string id, CopilotConfirm r, RequestContext ctx, CopilotService copilot) => { ctx.RequireOrg("copilot.use"); return await copilot.Confirm(id, r.Approve); });
        g.MapGet("/actions", async (HttpRequest req, RequestContext ctx, AppDb db) => { ctx.RequireOrg("copilot.use"); return await Endpoints.Paging.List(db.CopilotActions, req); });
    }
}
