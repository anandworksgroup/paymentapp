using Microsoft.EntityFrameworkCore;
using PaymentApp.Api.Common;
using PaymentApp.Api.Data;
using PaymentApp.Api.Infrastructure;
using PaymentApp.Api.Modules.Delivery;

namespace PaymentApp.Api.Modules.Checkout;

/// <summary>
/// Payment requests (§253, §254): a salesperson asks one customer for a custom amount. Each request is a
/// hosted checkout (so tax, risk, 3-D Secure and receipts all work as usual) locked to that customer and
/// amount, emailed with a link, and tracked until paid, cancelled or expired.
/// </summary>
public class PaymentRequestService(AppDb db, Uow uow, CheckoutService checkout, IConfiguration config)
{
    private string Link(PaymentRequest r) => $"{PlatformUrls.Web(config)}/checkout/{r.CheckoutSessionId}";

    public async Task<object> Create(string? customerId, string? email, long amount, string currency, string description, string? taxCategory, int? expiresInDays, string? note, bool send)
    {
        currency = Money.Normalize(currency);
        if (amount <= 0) throw ApiException.Invalid("amount must be positive (minor units).");
        if (string.IsNullOrWhiteSpace(description) || description.Length > 200) throw ApiException.Invalid("description is required (max 200 characters).");
        if (expiresInDays is < 1 or > 90) throw ApiException.Invalid("expires_in_days must be 1-90.");
        taxCategory ??= "digital_service";
        if (!System.Text.RegularExpressions.Regex.IsMatch(taxCategory, "^[a-z][a-z0-9_]{1,40}$")) throw ApiException.Invalid("tax_category must be a category key such as digital_service or ebook.");
        Customer? customer = null;
        if (customerId != null)
        {
            customer = await db.Customers.FirstOrDefaultAsync(c => c.Id == customerId) ?? throw ApiException.NotFound("customer");
            if (customer.MergedIntoId != null) throw ApiException.Conflict("customer_merged", $"This customer was merged into {customer.MergedIntoId}.");
        }
        email = (email ?? customer?.Email)?.Trim().ToLowerInvariant();
        if (string.IsNullOrEmpty(email) || !email.Contains('@')) throw ApiException.Invalid("A customer or email address is required.");

        // One hidden product per tax category carries the tax treatment; each request gets its own price.
        var price = await uow.Run(async () =>
        {
            var name = $"Payment request ({taxCategory.Replace('_', ' ')})";
            var product = await db.Products.FirstOrDefaultAsync(p => p.Name == name && p.Type == "payment_request");
            if (product == null)
            {
                product = new Product { Id = Ids.New("prod"), CreatedAt = uow.Now, UpdatedAt = uow.Now, Name = name, Type = "payment_request", TaxCategory = taxCategory, DeliveryType = "none", Description = "Custom amounts requested from individual customers." };
                db.Products.Add(product);
            }
            var pr = new Price { Id = Ids.New("price"), CreatedAt = uow.Now, ProductId = product.Id, Currency = currency, Type = "one_time", UnitAmount = amount, Nickname = description.Trim() };
            db.Prices.Add(pr);
            await Task.CompletedTask;
            return pr;
        });
        var session = await checkout.Create("payment", [new LineRequest(price.Id, 1)], customer?.Id, email, customer?.Country, null, null, null, null, null, null);
        return await uow.Run(async () =>
        {
            var s = await db.CheckoutSessions.FirstAsync(x => x.Id == session.Id);
            s.ExpiresAt = uow.Now.AddDays(expiresInDays ?? 14);
            var r = new PaymentRequest
            {
                Id = Ids.New("preq"), CreatedAt = uow.Now, CustomerId = customer?.Id, Email = email, Amount = amount, Currency = currency, Description = description.Trim(),
                Note = note?.Trim(), PriceId = price.Id, CheckoutSessionId = s.Id, ExpiresAt = s.ExpiresAt, CreatedBy = uow.Ctx.ActorId,
            };
            db.PaymentRequests.Add(r);
            if (send) await Send(r, reminder: false);
            uow.Emit("payment_request.created", r);
            uow.Audit("payment_request.create", "payment_request", r.Id, after: new { amount, currency, email });
            return View(r);
        });
    }

    private async Task Send(PaymentRequest r, bool reminder)
    {
        // A new request's OrgId is stamped on save, so fall back to the current tenant.
        var orgId = string.IsNullOrEmpty(r.OrgId) ? db.Tenant.OrgId! : r.OrgId;
        var org = await db.Organizations.FirstAsync(o => o.Id == orgId);
        db.Notifications.Add(new Notification
        {
            Id = Ids.New("ntf"), CreatedAt = uow.Now, OrgId = orgId, Channel = "email", Recipient = r.Email, Template = reminder ? "payment_request_reminder" : "payment_request",
            Subject = $"{(reminder ? "Reminder: " : "")}{org.Name} requests {Money.Format(r.Amount, r.Currency)}", Status = "delivered", ObjectType = "payment_request", ObjectId = r.Id,
            Body = $"{r.Description}{(string.IsNullOrEmpty(r.Note) ? "" : "\n\n" + r.Note)}\n\nPay securely here: {Link(r)}\nThis link is valid until {r.ExpiresAt:yyyy-MM-dd}. Tax is calculated at checkout.",
        });
        r.LastSentAt = uow.Now;
    }

    public object View(PaymentRequest r) => new
    {
        r.Id, @object = "payment_request", r.Status, r.Amount, r.Currency, r.Description, r.Note, r.Email, customer = r.CustomerId, r.CheckoutSessionId,
        payment = r.PaymentId, url = Link(r), r.ExpiresAt, r.PaidAt, r.LastSentAt, r.Reminders, r.CreatedAt,
    };

    /// <summary>Brings a request's status up to date with its checkout session.</summary>
    public async Task<PaymentRequest> Sync(PaymentRequest r)
    {
        if (r.Status != "open") return r;
        var s = await db.CheckoutSessions.FirstAsync(x => x.Id == r.CheckoutSessionId);
        if (s.Status == "complete") { r.Status = "paid"; r.PaymentId = s.PaymentId; r.PaidAt ??= s.CompletedAt; }
        else if (s.Status == "expired" || r.ExpiresAt <= uow.Now) r.Status = "expired";
        return r;
    }

    public async Task<object> Remind(string id)
    {
        return await uow.Run(async () =>
        {
            var r = await Sync(await db.PaymentRequests.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("payment request"));
            if (r.Status != "open") throw ApiException.Conflict("request_" + r.Status, $"This request is {r.Status}.");
            if (r.Reminders >= 3) throw ApiException.Conflict("too_many_reminders", "Three reminders have already been sent.");
            if (r.LastSentAt > uow.Now.AddHours(-24)) throw ApiException.Conflict("reminder_too_soon", "The customer was emailed in the last 24 hours.");
            r.Reminders++;
            await Send(r, reminder: true);
            uow.Audit("payment_request.remind", "payment_request", r.Id);
            return View(r);
        });
    }

    public async Task<object> Cancel(string id)
    {
        return await uow.Run(async () =>
        {
            var r = await Sync(await db.PaymentRequests.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("payment request"));
            if (r.Status != "open") throw ApiException.Conflict("request_" + r.Status, $"This request is already {r.Status}.");
            // Same claim as a checkout confirm: a payment already in progress can't be cancelled underneath it.
            var now = uow.Now;
            var closed = await db.CheckoutSessions.Where(s => s.Id == r.CheckoutSessionId && s.Status == "open" && (s.ProcessingUntil == null || s.ProcessingUntil <= now))
                .ExecuteUpdateAsync(u => u.SetProperty(s => s.Status, "expired"));
            if (closed == 0) throw ApiException.Conflict("payment_in_progress", "The customer is paying right now. Try again in a minute.");
            uow.Transition("checkout_session", r.CheckoutSessionId, "open", "expired", r.OrgId, "payment request cancelled");
            r.Status = "cancelled";
            uow.Emit("payment_request.cancelled", r);
            uow.Audit("payment_request.cancel", "payment_request", r.Id);
            return View(r);
        });
    }

    /// <summary>Called from checkout completion, inside its unit of work.</summary>
    public static async Task OnCheckoutComplete(AppDb db, Uow uow, CheckoutSession s, Payment? p)
    {
        var r = await db.PaymentRequests.FirstOrDefaultAsync(x => x.CheckoutSessionId == s.Id);
        if (r == null || r.Status == "paid") return;
        r.Status = "paid";
        r.PaymentId = p?.Id;
        r.PaidAt = uow.Now;
        uow.Emit("payment_request.paid", r);
    }
}
