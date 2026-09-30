using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using PaymentApp.Api.Common;
using PaymentApp.Api.Data;
using PaymentApp.Api.Infrastructure;
using PaymentApp.Api.Modules.Billing;
using PaymentApp.Api.Modules.Payouts;
using PaymentApp.Api.Modules.Wallet;

namespace PaymentApp.Api.Modules.Platform;

/// <summary>Drains the outbox (§83): fans each committed event out to webhooks and notifications, exactly once.</summary>
public class OutboxProcessor(AppDb db, Notifier notifier, IClock clock)
{
    public async Task<int> ProcessBatch(int max = 200)
    {
        using var _ = db.Tenant.Elevate();
        var batch = await db.Outbox.Where(o => o.ProcessedAt == null).OrderBy(o => o.Id).Take(max).ToListAsync();
        foreach (var msg in batch)
        {
            try
            {
                var e = await db.Events.FirstAsync(x => x.Id == msg.EventId);
                if (e.OrgId != null)
                {
                    var endpoints = await db.WebhookEndpoints.Where(w => w.OrgId == e.OrgId && w.Livemode == e.Livemode && w.Status != "disabled").ToListAsync();
                    foreach (var ep in endpoints.Where(ep => Matches(ep.EnabledEventsCsv, e.Type)))
                    {
                        if (await db.WebhookDeliveries.AnyAsync(d => d.EventId == e.Id && d.EndpointId == ep.Id && !d.IsReplay)) continue;
                        db.WebhookDeliveries.Add(new WebhookDelivery
                        {
                            Id = Ids.New("whd"), CreatedAt = clock.UtcNow, OrgId = e.OrgId, Livemode = e.Livemode, EventId = e.Id, EndpointId = ep.Id,
                            Status = "pending", NextAttemptAt = clock.UtcNow,
                        });
                    }
                }
                await notifier.ForEvent(e);
                msg.ProcessedAt = clock.UtcNow;
            }
            catch (Exception ex)
            {
                msg.Attempts++;
                msg.LastError = ex.Message;
                if (msg.Attempts >= 10) msg.ProcessedAt = clock.UtcNow; // dead-lettered; visible via last_error
            }
            await db.SaveChangesAsync();
        }
        return batch.Count;
    }

    public static bool Matches(string csv, string type) =>
        csv == "*" || csv.Split(',').Any(p => p == type || (p.EndsWith(".*") && type.StartsWith(p[..^1])));
}

/// <summary>
/// Signed webhook delivery with exponential backoff, dead-lettering and replay (§56, §57, §131, §132).
/// Signature: Webhook-Signature: t={unix},v1={hex(HMAC_SHA256(secret, "{t}.{body}"))}
/// </summary>
public class WebhookSender(AppDb db, IHttpClientFactory http, FieldEncryptor encryptor, IClock clock, ILogger<WebhookSender> log)
{
    public static readonly TimeSpan[] Backoff = [TimeSpan.FromMinutes(1), TimeSpan.FromMinutes(5), TimeSpan.FromMinutes(15), TimeSpan.FromHours(1), TimeSpan.FromHours(6), TimeSpan.FromHours(24)];

    public static string Payload(Event e) => Json.Serialize(new
    {
        id = e.Id, @object = "event", type = e.Type, api_version = e.ApiVersion, created = e.CreatedAt, livemode = e.Livemode,
        sequence = e.Sequence, request_id = e.RequestId, data = new { @object = e.Data },
    });

    public static string Sign(string secret, long timestamp, string payload) => $"t={timestamp},v1={Crypto.HmacSha256Hex(secret, $"{timestamp}.{payload}")}";

    public async Task<int> SendDue()
    {
        using var _ = db.Tenant.Elevate();
        var now = clock.UtcNow;
        var due = await db.WebhookDeliveries.Where(d => (d.Status == "pending" || d.Status == "retrying") && d.NextAttemptAt <= now).OrderBy(d => d.NextAttemptAt).Take(50).ToListAsync();
        foreach (var d in due) await Deliver(d);
        return due.Count;
    }

    public async Task Deliver(WebhookDelivery d)
    {
        var ep = await db.WebhookEndpoints.FirstAsync(x => x.Id == d.EndpointId);
        var e = await db.Events.FirstAsync(x => x.Id == d.EventId);
        var payload = Payload(e);
        var ts = new DateTimeOffset(clock.UtcNow).ToUnixTimeSeconds();
        var signature = Sign(encryptor.Decrypt(ep.SecretEnc), ts, payload);
        if (ep.PreviousSecretEnc != null && ep.PreviousSecretExpiresAt > clock.UtcNow)
            signature += ",v1=" + Crypto.HmacSha256Hex(encryptor.Decrypt(ep.PreviousSecretEnc), $"{ts}.{payload}");
        var sw = Stopwatch.StartNew();
        d.Attempt++;
        try
        {
            await UrlGuard.Ensure(ep.Url, ep.Livemode);
            var req = new HttpRequestMessage(HttpMethod.Post, ep.Url) { Content = new StringContent(payload, Encoding.UTF8, "application/json") };
            req.Headers.Add("Webhook-Id", e.Id);
            req.Headers.Add("Webhook-Timestamp", ts.ToString());
            req.Headers.Add("Webhook-Signature", signature);
            req.Headers.Add("Webhook-Delivery-Id", d.Id);
            using var res = await http.CreateClient("webhooks").SendAsync(req);
            var body = await res.Content.ReadAsStringAsync();
            d.ResponseStatus = (int)res.StatusCode;
            d.ResponseBody = body.Length > 500 ? body[..500] : body;
            if (res.IsSuccessStatusCode)
            {
                d.Status = "succeeded";
                d.CompletedAt = clock.UtcNow;
                ep.ConsecutiveFailures = 0;
                ep.LastSuccessAt = clock.UtcNow;
                if (ep.Status == "failing") ep.Status = "enabled";
            }
            else Fail(d, ep, $"HTTP {(int)res.StatusCode}");
        }
        catch (Exception ex)
        {
            d.ResponseBody = ex.Message.Length > 500 ? ex.Message[..500] : ex.Message;
            Fail(d, ep, ex.GetType().Name);
            log.LogInformation("Webhook {Delivery} to {Url} failed: {Error}", d.Id, ep.Url, ex.Message);
        }
        d.DurationMs = (int)sw.ElapsedMilliseconds;
        await db.SaveChangesAsync();
    }

    private void Fail(WebhookDelivery d, WebhookEndpoint ep, string reason)
    {
        ep.ConsecutiveFailures++;
        ep.LastFailureAt = clock.UtcNow;
        if (ep.ConsecutiveFailures >= 5) ep.Status = "failing";
        if (d.Attempt > Backoff.Length) { d.Status = "dead"; d.CompletedAt = clock.UtcNow; }
        else { d.Status = "retrying"; d.NextAttemptAt = clock.UtcNow + Backoff[d.Attempt - 1]; }
    }
}

/// <summary>SSRF protection for merchant-supplied URLs: live endpoints may not target private networks.</summary>
public static class UrlGuard
{
    public static async Task Ensure(string url, bool livemode)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || (uri.Scheme != "https" && uri.Scheme != "http"))
            throw ApiException.Invalid("Webhook URL must be an absolute http(s) URL.");
        if (!livemode) return; // test mode may target localhost for local development (§272)
        if (uri.Scheme != "https") throw ApiException.Invalid("Live webhook endpoints must use HTTPS.");
        var addresses = IPAddress.TryParse(uri.Host, out var literal) ? [literal] : await Dns.GetHostAddressesAsync(uri.Host);
        foreach (var ip in addresses)
            if (IsPrivate(ip)) throw ApiException.Invalid("Live webhook endpoints cannot point to private or loopback addresses.");
    }

    public static bool IsPrivate(IPAddress ip)
    {
        if (IPAddress.IsLoopback(ip)) return true;
        if (ip.AddressFamily == AddressFamily.InterNetworkV6) return ip.IsIPv6LinkLocal || ip.IsIPv6SiteLocal || ip.IsIPv6UniqueLocal;
        var b = ip.GetAddressBytes();
        return b[0] == 10 || (b[0] == 172 && b[1] >= 16 && b[1] <= 31) || (b[0] == 192 && b[1] == 168) || (b[0] == 169 && b[1] == 254) || b[0] == 0 || b[0] == 127;
    }
}

/// <summary>
/// Templated notifications (§62, §63, §124). Transactional/security messages are always sent; email
/// goes to a development outbox until an email provider adapter is configured.
/// </summary>
public class Notifier(AppDb db, IClock clock, ILogger<Notifier> log)
{
    private record Template(string Key, string Audience, string Channel, string Subject, string Body, string Category = "transactional");

    private static readonly Dictionary<string, Template[]> ByEvent = new()
    {
        ["payment.succeeded"] =
        [
            new("receipt", "customer", "email", "Your receipt for {{amount}}", "Hi {{customer_name}}, we received your payment of {{amount}} ({{payment_id}}). Tax: {{tax}}. Sold by {{seller}}."),
            new("payment_received", "merchant", "in_app", "Payment received: {{amount}}", "{{customer_email}} paid {{amount}}."),
        ],
        ["payment.failed"] = [new("payment_failed", "merchant", "in_app", "Payment failed: {{amount}}", "{{failure_message}} ({{payment_id}})")],
        ["invoice.payment_failed"] = [new("dunning", "customer", "email", "Action needed: payment for invoice {{invoice_number}} failed", "We couldn't collect {{amount_due}}. Please update your payment method to keep your subscription active.")],
        ["invoice.finalized"] = [new("invoice", "customer", "email", "Invoice {{invoice_number}} for {{amount_due}}", "Your invoice {{invoice_number}} is due {{due_date}}.")],
        ["subscription.created"] = [new("new_subscription", "merchant", "push", "New subscription", "{{subscription_id}} started.")],
        ["subscription.cancelled"] = [new("subscription_cancelled", "merchant", "in_app", "Subscription cancelled", "{{subscription_id}} was cancelled.")],
        ["refund.succeeded"] = [new("refund", "customer", "email", "Your refund of {{amount}}", "A refund of {{amount}} is on its way to your original payment method.")],
        ["dispute.created"] = [new("dispute", "merchant", "push", "Chargeback received: {{amount}}", "Respond with evidence before {{due}}.", "security")],
        ["payout.completed"] = [new("payout_sent", "merchant", "push", "Payout sent: {{amount}}", "Payout {{payout_id}} reached your bank.")],
        ["payout.failed"] = [new("payout_failed", "merchant", "push", "Payout failed", "{{failure_reason}}", "security")],
        ["transfer.completed"] = [new("transfer", "wallet_user", "push", "Transfer complete", "{{amount}} — {{customer_message}}")],
        ["transfer.held"] = [new("transfer_review", "wallet_user", "in_app", "Transfer under review", "{{customer_message}}")],
        ["withdrawal.completed"] = [new("withdrawal", "wallet_user", "push", "Withdrawal completed", "{{amount}} reached your bank.")],
        ["withdrawal.returned"] = [new("withdrawal_returned", "wallet_user", "push", "Withdrawal returned", "{{customer_message}}")],
    };

    public async Task ForEvent(Event e)
    {
        if (!ByEvent.TryGetValue(e.Type, out var templates)) return;
        var data = System.Text.Json.JsonDocument.Parse(e.DataJson).RootElement;
        string S(string k) => data.TryGetProperty(k, out var v) && v.ValueKind != System.Text.Json.JsonValueKind.Null ? v.ToString() : "";
        long N(string k) => data.TryGetProperty(k, out var v) && v.ValueKind == System.Text.Json.JsonValueKind.Number ? v.GetInt64() : 0;
        var currency = S("currency") is { Length: 3 } c ? c : S("source_currency") is { Length: 3 } sc ? sc : "USD";
        var vars = new Dictionary<string, string>
        {
            ["amount"] = Money.IsSupported(currency) ? Money.Format(N("amount") != 0 ? N("amount") : N("source_amount"), currency) : "",
            ["tax"] = Money.IsSupported(currency) ? Money.Format(N("tax_amount"), currency) : "",
            ["amount_due"] = Money.IsSupported(currency) ? Money.Format(N("amount_due"), currency) : "",
            ["currency"] = currency,
            ["payment_id"] = S("id"), ["payout_id"] = S("id"), ["subscription_id"] = S("id"),
            ["customer_email"] = S("customer_email"), ["customer_name"] = S("customer_name") is { Length: > 0 } cn ? cn : "there",
            ["invoice_number"] = S("number"), ["due_date"] = S("due_date"), ["due"] = S("evidence_due_by"),
            ["failure_message"] = S("failure_message"), ["failure_reason"] = S("failure_reason"), ["customer_message"] = S("customer_message"),
            ["seller"] = "the platform as Merchant of Record",
        };
        foreach (var t in templates)
        {
            var (subject, body) = await Resolve(e.OrgId, t);
            string recipient;
            string? userId = null;
            switch (t.Audience)
            {
                case "customer":
                    recipient = S("customer_email");
                    if (string.IsNullOrEmpty(recipient)) continue;
                    break;
                case "wallet_user":
                    userId = e.UserId;
                    var u = userId == null ? null : await db.Users.FirstOrDefaultAsync(x => x.Id == userId);
                    if (u == null) continue;
                    recipient = u.Email;
                    break;
                default:
                    recipient = $"org:{e.OrgId}";
                    break;
            }
            var n = new Notification
            {
                Id = Ids.New("ntf"), CreatedAt = clock.UtcNow, OrgId = t.Audience == "merchant" ? e.OrgId : null, UserId = userId, Channel = t.Channel,
                Recipient = recipient, Template = t.Key, Subject = Render(subject, vars), Body = Render(body, vars), Category = t.Category,
                Status = t.Channel == "email" ? "sent_dev_outbox" : "delivered", ObjectType = e.ObjectType, ObjectId = e.ObjectId,
            };
            db.Notifications.Add(n);
            if (t.Channel == "email") log.LogInformation("[dev email outbox] to={To} subject={Subject}", Mask.Email(recipient), n.Subject);
        }
    }

    private async Task<(string, string)> Resolve(string? orgId, Template t)
    {
        if (orgId == null) return (t.Subject, t.Body);
        var custom = await db.EmailTemplates.Where(x => x.OrgId == orgId && x.Key == t.Key && x.Active).OrderByDescending(x => x.Version).FirstOrDefaultAsync();
        return custom == null ? (t.Subject, t.Body) : (custom.Subject, custom.Body);
    }

    /// <summary>Due soon / due today / overdue / final notice reminders for invoices on payment terms (§255).</summary>
    public async Task<int> InvoiceReminders(DateTime now)
    {
        using var _ = db.Tenant.Elevate();
        var open = await db.Invoices.Where(i => (i.Status == "OPEN" || i.Status == "PAST_DUE") && i.DueDate != null && i.CustomerEmail != null && i.AmountDue > 0).ToListAsync();
        var sent = 0;
        foreach (var inv in open)
        {
            var days = (inv.DueDate!.Value.Date - now.Date).Days;
            var (key, subject) = days switch
            {
                3 => ("invoice_due_soon", $"Invoice {inv.Number} is due in 3 days"),
                0 => ("invoice_due_today", $"Invoice {inv.Number} is due today"),
                -7 => ("invoice_overdue", $"Invoice {inv.Number} is overdue"),
                -30 => ("invoice_final_notice", $"Final notice: invoice {inv.Number}"),
                _ => (null, null),
            };
            if (key == null || inv.BillingReason != "manual" && days > 0) continue;
            if (await db.Notifications.AnyAsync(n => n.Template == key && n.ObjectId == inv.Id)) continue;
            db.Notifications.Add(new Notification
            {
                Id = Ids.New("ntf"), CreatedAt = now, OrgId = null, Channel = "email", Recipient = inv.CustomerEmail!, Template = key, Subject = subject!,
                Body = $"Amount due: {Money.Format(inv.AmountDue - inv.AmountPaid, inv.Currency)}. Due date: {inv.DueDate:yyyy-MM-dd}.", Category = "billing",
                Status = "sent_dev_outbox", ObjectType = "invoice", ObjectId = inv.Id,
            });
            sent++;
        }
        await db.SaveChangesAsync();
        return sent;
    }

    public static string Render(string template, IReadOnlyDictionary<string, string> vars) =>
        Regex.Replace(template, @"\{\{\s*(\w+)\s*\}\}", m => vars.TryGetValue(m.Groups[1].Value, out var v) ? WebUtility.HtmlEncode(v) : "");
}

/// <summary>Runs every background job once. Jobs are idempotent and safe to repeat (§95).</summary>
public class JobRunner(IServiceScopeFactory scopes, IClock clock, ILogger<JobRunner> log)
{
    public async Task<Dictionary<string, int>> RunAll()
    {
        var results = new Dictionary<string, int>();
        async Task Step(string name, Func<IServiceProvider, Task<int>> job)
        {
            using var scope = scopes.CreateScope();
            scope.ServiceProvider.GetRequiredService<RequestContext>().IsSystem = true;
            try { results[name] = await job(scope.ServiceProvider); }
            catch (Exception ex) { log.LogError(ex, "Job {Job} failed", name); results[name] = -1; }
        }
        var now = clock.UtcNow;
        await Step("subscriptions", sp => sp.GetRequiredService<BillingService>().RunDue(now, null));
        await Step("settlement", sp => sp.GetRequiredService<TreasuryService>().Settle(now));
        await Step("reserve_release", sp => sp.GetRequiredService<TreasuryService>().ReleaseReserves(now));
        await Step("scheduled_payouts", sp => sp.GetRequiredService<TreasuryService>().RunScheduledPayouts(now));
        await Step("payouts", sp => sp.GetRequiredService<TreasuryService>().ProcessPayouts(now));
        await Step("withdrawals", sp => sp.GetRequiredService<WalletService>().SettleWithdrawals());
        await Step("affiliate_commissions", sp => sp.GetRequiredService<Growth.AffiliateService>().ApproveDue(now));
        await Step("invoice_reminders", sp => sp.GetRequiredService<Notifier>().InvoiceReminders(now));
        await Step("outbox", sp => sp.GetRequiredService<OutboxProcessor>().ProcessBatch());
        await Step("webhooks", sp => sp.GetRequiredService<WebhookSender>().SendDue());
        return results;
    }
}

public class JobHost(JobRunner runner, IServiceScopeFactory scopes, IConfiguration config, ILogger<JobHost> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var seconds = config.GetValue("Jobs:IntervalSeconds", 10);
        if (seconds <= 0) return;
        var reconEvery = TimeSpan.FromMinutes(config.GetValue("Jobs:ReconciliationMinutes", 60));
        var lastRecon = DateTime.MinValue;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await runner.RunAll();
                if (DateTime.UtcNow - lastRecon > reconEvery)
                {
                    using var scope = scopes.CreateScope();
                    scope.ServiceProvider.GetRequiredService<RequestContext>().IsSystem = true;
                    await scope.ServiceProvider.GetRequiredService<ReconciliationService>().Run("scheduler");
                    lastRecon = DateTime.UtcNow;
                }
            }
            catch (Exception ex) { log.LogError(ex, "Job loop error"); }
            await Task.Delay(TimeSpan.FromSeconds(seconds), stoppingToken).ContinueWith(_ => { });
        }
    }
}
