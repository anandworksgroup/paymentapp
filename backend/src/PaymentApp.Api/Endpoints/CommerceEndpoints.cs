using System.Text;
using Microsoft.EntityFrameworkCore;
using PaymentApp.Api.Common;
using PaymentApp.Api.Data;
using PaymentApp.Api.Infrastructure;
using PaymentApp.Api.Modules.Billing;
using PaymentApp.Api.Modules.Checkout;
using PaymentApp.Api.Modules.Engines;
using PaymentApp.Api.Modules.Payments;

namespace PaymentApp.Api.Endpoints;

public record ProductRequest(string? Name, string? Description, string? Type, string? TaxCategory, string? DeliveryType, string? ImageUrl, string? Features, string? Status, Dictionary<string, string>? Metadata);
public record PriceRequest(string ProductId, string Currency, string Type, string? Scheme, long UnitAmount, List<PriceTier>? Tiers, string? TiersMode, long? PackageSize,
    string? Interval, int? IntervalCount, int? TrialDays, string? UsageType, string? MeterId, long? CreditsGranted, long? MinimumAmount, long? MaximumAmount,
    string? TaxBehavior, Dictionary<string, long>? CountryAmounts, string? Nickname, Dictionary<string, string>? Metadata);
public record CouponRequest(string Code, string? Name, int? PercentOffBps, long? AmountOff, string? Currency, string? Duration, int? DurationInMonths, int? MaxRedemptions,
    DateTime? StartsAt, DateTime? ExpiresAt, long? MinimumAmount, string? ProductIds, string? Countries, string? CustomerId, bool? FirstTimeOnly, bool? AutoApply);
public record MeterRequest(string EventName, string DisplayName, string? Aggregation, string? Unit);
public record CustomerRequest(string? Email, string? Name, string? Phone, string? Country, string? Locale, string? PostalCode, string? AddressLine, string? TaxId,
    string? CustomerType, string? ExternalId, int? PaymentTermsDays, long? CreditLimit, string? TaxStatus, Dictionary<string, string>? Metadata);
public record CheckoutRequest(string Mode, List<LineRequest> LineItems, string? Customer, string? CustomerEmail, string? Country, string? Coupon, string? SuccessUrl,
    string? CancelUrl, string? ClientReferenceId, Dictionary<string, string>? Metadata, string? Affiliate = null);
public record PaymentLinkRequest(string PriceId, long? Quantity, bool? AllowCoupons, string? Coupon, DateTime? ExpiresAt, string? SuccessUrl, string? CancelUrl, Dictionary<string, string>? Metadata);
public record QuoteRequest(string? Country, string? CustomerType, string? TaxId, string? Coupon);
public record AuthenticateRequest(string Result);
public record TokenRequest(string Type, string? Number, int? ExpMonth, int? ExpYear, string? Cvc, string? Vpa);
public record AttachPmRequest(string Token);
public record PortalCancelRequest(string? Reason, string? Feedback, string? AcceptOffer);

public static class CommerceEndpoints
{
    public static void Map(WebApplication app)
    {
        var v1 = app.MapGroup("/v1").WithTags("Catalog & Customers");

        // ───────── Products (§12) ─────────
        v1.MapGet("/products", async (HttpRequest req, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireOrg("products.read");
            var q = db.Products.AsQueryable();
            if (req.Query["status"].FirstOrDefault() is { } st) q = q.Where(p => p.Status == st);
            return await Paging.List(q, req);
        });
        v1.MapGet("/products/{id}", async (string id, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireOrg("products.read");
            var p = await db.Products.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("product");
            var prices = await db.Prices.Where(x => x.ProductId == id).OrderByDescending(x => x.CreatedAt).ToListAsync();
            var priceIds = prices.Select(x => x.Id).ToList();
            var subscribers = await db.SubscriptionItems.Where(i => priceIds.Contains(i.PriceId) && !i.Deleted).Select(i => i.SubscriptionId).Distinct().CountAsync();
            var orders = (await db.Orders.Where(o => o.Status != "open").ToListAsync()).Where(o => o.Items.Any(i => i.ProductId == id)).ToList();
            var links = await db.PaymentLinks.Where(l => priceIds.Contains(l.PriceId)).ToListAsync();
            return new { product = p, prices, sales = orders.Count, revenue_by_currency = orders.GroupBy(o => o.Currency).ToDictionary(g => g.Key, g => g.Sum(o => o.Items.Where(i => i.ProductId == id).Sum(i => i.Amount - i.Discount))), subscriptions = subscribers, payment_links = links };
        });
        v1.MapPost("/products", async (ProductRequest r, RequestContext ctx, AppDb db, Uow uow) =>
        {
            ctx.RequireOrg("products.write");
            if (string.IsNullOrWhiteSpace(r.Name)) throw ApiException.Invalid("name is required.");
            return Results.Json(await uow.Run(async () =>
            {
                var p = new Product
                {
                    Id = Ids.New("prod"), CreatedAt = uow.Now, UpdatedAt = uow.Now, Name = r.Name.Trim(), Description = r.Description, Type = r.Type ?? "saas",
                    TaxCategory = r.TaxCategory ?? "digital_service", DeliveryType = r.DeliveryType ?? "access", ImageUrl = r.ImageUrl, FeaturesCsv = r.Features,
                    Status = r.Status is "draft" ? "draft" : "active", MetadataJson = r.Metadata == null ? null : Json.Serialize(r.Metadata),
                };
                db.Products.Add(p);
                uow.Emit("product.created", p);
                uow.Audit("product.create", "product", p.Id, after: new { p.Name });
                await Task.CompletedTask;
                return p;
            }), statusCode: 201);
        });
        v1.MapPatch("/products/{id}", async (string id, ProductRequest r, RequestContext ctx, AppDb db, Uow uow) =>
        {
            ctx.RequireOrg("products.write");
            return await uow.Run(async () =>
            {
                var p = await db.Products.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("product");
                var before = new { p.Name, p.Status, p.TaxCategory };
                p.Name = r.Name ?? p.Name; p.Description = r.Description ?? p.Description; p.ImageUrl = r.ImageUrl ?? p.ImageUrl;
                p.TaxCategory = r.TaxCategory ?? p.TaxCategory; p.FeaturesCsv = r.Features ?? p.FeaturesCsv; p.Type = r.Type ?? p.Type;
                if (r.Metadata != null) p.MetadataJson = Json.Serialize(r.Metadata);
                if (r.Status != null)
                {
                    if (r.Status is not ("draft" or "active" or "archived")) throw ApiException.Invalid("status must be draft, active or archived.");
                    p.Status = r.Status; // archived products stay visible historically but cannot be bought (§185)
                }
                p.UpdatedAt = uow.Now;
                uow.Emit("product.updated", p);
                uow.Audit("product.update", "product", p.Id, before, new { p.Name, p.Status, p.TaxCategory });
                return p;
            });
        });

        // ───────── Prices (§13, §184) ─────────
        v1.MapGet("/prices", async (HttpRequest req, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireOrg("products.read");
            var q = db.Prices.AsQueryable();
            if (req.Query["product"].FirstOrDefault() is { } p) q = q.Where(x => x.ProductId == p);
            if (req.Query["active"].FirstOrDefault() is { } a) q = q.Where(x => x.Active == (a == "true"));
            return await Paging.List(q, req);
        });
        v1.MapGet("/prices/{id}", async (string id, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireOrg("products.read");
            return await db.Prices.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("price");
        });
        v1.MapPost("/prices", async (PriceRequest r, RequestContext ctx, AppDb db, Uow uow) =>
        {
            ctx.RequireOrg("products.write");
            var product = await db.Products.FirstOrDefaultAsync(p => p.Id == r.ProductId) ?? throw ApiException.NotFound("product");
            var price = BuildPrice(r);
            if (price.MeterId != null && !await db.Meters.AnyAsync(m => m.Id == price.MeterId)) throw ApiException.NotFound("meter");
            if (price.UsageType == "metered" && price.MeterId == null) throw ApiException.Invalid("Metered prices need meter_id.");
            return Results.Json(await uow.Run(async () =>
            {
                price.Id = Ids.New("price");
                price.CreatedAt = uow.Now;
                db.Prices.Add(price);
                uow.Emit("price.created", price);
                uow.Audit("price.create", "price", price.Id, after: new { price.UnitAmount, price.Currency, price.Scheme, product = product.Id });
                await Task.CompletedTask;
                return price;
            }), statusCode: 201);
        });
        v1.MapPost("/prices/{id}/versions", async (string id, PriceRequest r, RequestContext ctx, AppDb db, Uow uow) =>
        {
            // A published price is never edited destructively: a new version supersedes it, and existing
            // subscriptions keep referencing the version they bought (§184, §267).
            ctx.RequireOrg("products.write");
            return await uow.Run(async () =>
            {
                var old = await db.Prices.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("price");
                if (old.SupersededById != null) throw ApiException.Conflict("price_superseded", $"Version {old.Version} was already superseded by {old.SupersededById}.");
                var next = BuildPrice(r with { ProductId = old.ProductId });
                next.Id = Ids.New("price");
                next.CreatedAt = uow.Now;
                next.Version = old.Version + 1;
                next.PreviousVersionId = old.Id;
                old.SupersededById = next.Id;
                old.Active = false;
                db.Prices.Add(next);
                uow.Emit("price.created", next);
                uow.Emit("price.updated", old);
                uow.Audit("price.new_version", "price", next.Id, new { old.Id, old.UnitAmount, old.Version }, new { next.Id, next.UnitAmount, next.Version });
                await Task.CompletedTask;
                return next;
            });
        });
        v1.MapPost("/prices/{id}/deactivate", async (string id, RequestContext ctx, AppDb db, Uow uow) =>
        {
            ctx.RequireOrg("products.write");
            return await uow.Run(async () =>
            {
                var p = await db.Prices.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("price");
                p.Active = false;
                uow.Emit("price.updated", p);
                uow.Audit("price.deactivate", "price", p.Id);
                await Task.CompletedTask;
                return p;
            });
        });
        v1.MapPost("/prices/{id}/preview", async (string id, HttpRequest req, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireOrg("products.read");
            var p = await db.Prices.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("price");
            var quantities = (req.Query["quantities"].FirstOrDefault() ?? "1,10,100,1000,10000").Split(',').Select(long.Parse);
            return new { price = p.Id, currency = p.Currency, amounts = quantities.Select(q => new { quantity = q, amount = PricingEngine.Amount(p, q, req.Query["country"].FirstOrDefault()) }) };
        });

        // ───────── Coupons & promotions (§49, §50) ─────────
        v1.MapGet("/coupons", async (HttpRequest req, RequestContext ctx, AppDb db) => { ctx.RequireOrg("products.read"); return await Paging.List(db.Coupons, req); });
        v1.MapPost("/coupons", async (CouponRequest r, RequestContext ctx, AppDb db, Uow uow) =>
        {
            ctx.RequireOrg("coupons.write");
            if ((r.PercentOffBps == null) == (r.AmountOff == null)) throw ApiException.Invalid("Provide exactly one of percent_off_bps or amount_off.");
            if (r.PercentOffBps is < 1 or > 10_000) throw ApiException.Invalid("percent_off_bps must be 1-10000.");
            if (r.AmountOff != null && r.Currency == null) throw ApiException.Invalid("currency is required with amount_off.");
            var code = r.Code.Trim().ToUpperInvariant();
            if (code.Length is < 3 or > 40) throw ApiException.Invalid("code must be 3-40 characters.");
            if (await db.Coupons.AnyAsync(c => c.Code == code)) throw ApiException.Conflict("code_taken", "A coupon with this code already exists.");
            return Results.Json(await uow.Run(async () =>
            {
                var c = new Coupon
                {
                    Id = Ids.New("coup"), CreatedAt = uow.Now, Code = code, Name = r.Name, PercentOffBps = r.PercentOffBps, AmountOff = r.AmountOff,
                    Currency = r.Currency == null ? null : Money.Normalize(r.Currency), Duration = r.Duration ?? "once", DurationInMonths = r.DurationInMonths,
                    MaxRedemptions = r.MaxRedemptions, StartsAt = r.StartsAt, ExpiresAt = r.ExpiresAt, MinimumAmount = r.MinimumAmount, ProductIdsCsv = r.ProductIds,
                    CountriesCsv = r.Countries?.ToUpperInvariant(), CustomerId = r.CustomerId, FirstTimeOnly = r.FirstTimeOnly ?? false, AutoApply = r.AutoApply ?? false,
                };
                db.Coupons.Add(c);
                uow.Audit("coupon.create", "coupon", c.Id, after: new { c.Code, c.PercentOffBps, c.AmountOff });
                await Task.CompletedTask;
                return c;
            }), statusCode: 201);
        });
        v1.MapPost("/coupons/{id}/deactivate", async (string id, RequestContext ctx, AppDb db, Uow uow) =>
        {
            ctx.RequireOrg("coupons.write");
            return await uow.Run(async () =>
            {
                var c = await db.Coupons.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("coupon");
                c.Active = false;
                uow.Audit("coupon.deactivate", "coupon", c.Id);
                await Task.CompletedTask;
                return c;
            });
        });

        // ───────── Meters (§28) ─────────
        v1.MapGet("/meters", async (HttpRequest req, RequestContext ctx, AppDb db) => { ctx.RequireOrg("usage.read"); return await Paging.List(db.Meters, req); });
        v1.MapPost("/meters", async (MeterRequest r, RequestContext ctx, AppDb db, Uow uow) =>
        {
            ctx.RequireOrg("products.write");
            if (r.Aggregation is not (null or "sum" or "count" or "max" or "last")) throw ApiException.Invalid("aggregation must be sum, count, max or last.");
            if (await db.Meters.AnyAsync(m => m.EventName == r.EventName)) throw ApiException.Conflict("meter_exists", "A meter for this event name exists.");
            return Results.Json(await uow.Run(async () =>
            {
                var m = new Meter { Id = Ids.New("mtr"), CreatedAt = uow.Now, EventName = r.EventName, DisplayName = r.DisplayName, Aggregation = r.Aggregation ?? "sum", Unit = r.Unit };
                db.Meters.Add(m);
                uow.Audit("meter.create", "meter", m.Id);
                await Task.CompletedTask;
                return m;
            }), statusCode: 201);
        });

        // ───────── Customers (§23, §139) ─────────
        v1.MapGet("/customers", async (HttpRequest req, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireOrg("customers.read");
            var q = db.Customers.AsQueryable();
            if (req.Query["email"].FirstOrDefault() is { } e) q = q.Where(c => c.Email == e.ToLowerInvariant());
            if (req.Query["search"].FirstOrDefault() is { Length: > 1 } s)
            {
                var term = s.ToLowerInvariant();
                q = q.Where(c => c.Id == s || (c.Email != null && c.Email.Contains(term)) || (c.Name != null && c.Name.ToLower().Contains(term)) || c.ExternalId == s || c.Phone == s);
            }
            return await Paging.List(q, req);
        });
        v1.MapGet("/customers/{id}", async (string id, RequestContext ctx, AppDb db, CreditService credits) =>
        {
            ctx.RequireOrg("customers.read");
            var c = await db.Customers.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("customer");
            var (available, reserved) = await credits.Balance(id, "credits");
            return new
            {
                customer = c,
                payment_methods = await db.PaymentMethods.Where(p => p.CustomerId == id && !p.Detached).ToListAsync(),
                orders = await db.Orders.Where(o => o.CustomerId == id).OrderByDescending(o => o.CreatedAt).Take(20).ToListAsync(),
                payments = await db.Payments.Where(p => p.CustomerId == id).OrderByDescending(p => p.CreatedAt).Take(20).ToListAsync(),
                subscriptions = await db.Subscriptions.Where(s => s.CustomerId == id).OrderByDescending(s => s.CreatedAt).ToListAsync(),
                invoices = await db.Invoices.Where(i => i.CustomerId == id).OrderByDescending(i => i.CreatedAt).Take(20).ToListAsync(),
                entitlements = await db.Entitlements.Where(e => e.CustomerId == id).ToListAsync(),
                credits = new { available, reserved },
                usage = await db.UsageEvents.Where(u => u.CustomerId == id).GroupBy(u => u.EventName).Select(g => new { event_name = g.Key, quantity = g.Sum(x => x.Quantity), events = g.Count() }).ToListAsync(),
                refunds = await db.Refunds.Where(r => db.Payments.Where(p => p.CustomerId == id).Select(p => p.Id).Contains(r.PaymentId)).ToListAsync(),
                disputes = await db.Disputes.Where(d => db.Payments.Where(p => p.CustomerId == id).Select(p => p.Id).Contains(d.PaymentId)).ToListAsync(),
            };
        });
        v1.MapPost("/customers", async (CustomerRequest r, RequestContext ctx, AppDb db, Uow uow) =>
        {
            ctx.RequireOrg("customers.write");
            var email = r.Email?.Trim().ToLowerInvariant();
            if (r.ExternalId != null && await db.Customers.AnyAsync(c => c.ExternalId == r.ExternalId)) throw ApiException.Conflict("external_id_taken", "A customer with this external_id exists.");
            return Results.Json(await uow.Run(async () =>
            {
                var c = new Customer
                {
                    Id = Ids.New("cus"), CreatedAt = uow.Now, UpdatedAt = uow.Now, Email = email, Name = r.Name, Phone = r.Phone, Country = r.Country?.ToUpperInvariant(),
                    Locale = r.Locale, PostalCode = r.PostalCode, AddressLine = r.AddressLine, TaxId = r.TaxId, CustomerType = r.CustomerType ?? (r.TaxId != null ? "b2b" : "b2c"),
                    ExternalId = r.ExternalId, PaymentTermsDays = r.PaymentTermsDays ?? 0, CreditLimit = r.CreditLimit, TaxStatus = r.TaxStatus ?? "taxable",
                    MetadataJson = r.Metadata == null ? null : Json.Serialize(r.Metadata),
                };
                db.Customers.Add(c);
                uow.Emit("customer.created", c);
                await Task.CompletedTask;
                return c;
            }), statusCode: 201);
        });
        v1.MapPatch("/customers/{id}", async (string id, CustomerRequest r, RequestContext ctx, AppDb db, Uow uow) =>
        {
            ctx.RequireOrg("customers.write");
            return await uow.Run(async () =>
            {
                var c = await db.Customers.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("customer");
                c.Email = r.Email?.ToLowerInvariant() ?? c.Email; c.Name = r.Name ?? c.Name; c.Phone = r.Phone ?? c.Phone; c.Country = r.Country?.ToUpperInvariant() ?? c.Country;
                c.TaxId = r.TaxId ?? c.TaxId; c.CustomerType = r.CustomerType ?? c.CustomerType; c.PostalCode = r.PostalCode ?? c.PostalCode; c.AddressLine = r.AddressLine ?? c.AddressLine;
                c.PaymentTermsDays = r.PaymentTermsDays ?? c.PaymentTermsDays; c.CreditLimit = r.CreditLimit ?? c.CreditLimit; c.TaxStatus = r.TaxStatus ?? c.TaxStatus;
                if (r.Metadata != null) c.MetadataJson = Json.Serialize(r.Metadata);
                c.UpdatedAt = uow.Now;
                uow.Emit("customer.updated", c);
                await Task.CompletedTask;
                return c;
            });
        });
        v1.MapPost("/customers/{id}/payment_methods", async (string id, AttachPmRequest r, RequestContext ctx, AppDb db, CheckoutService checkout, Uow uow) =>
        {
            ctx.RequireOrg("customers.write");
            var c = await db.Customers.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("customer");
            return await uow.Run(async () =>
            {
                var pm = await checkout.SavePaymentMethod(c, r.Token);
                c.DefaultPaymentMethodId ??= pm.Id;
                return pm;
            });
        });
        v1.MapPost("/customers/{id}/anonymize", async (string id, RequestContext ctx, AppDb db, Uow uow) =>
        {
            // Privacy deletion (§74): personal data is removed, financial records are retained.
            ctx.RequireOrg("customers.write");
            return await uow.Run(async () =>
            {
                var c = await db.Customers.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("customer");
                c.Email = null; c.Name = "Deleted customer"; c.Phone = null; c.AddressLine = null; c.PostalCode = null; c.MetadataJson = null;
                c.AnonymizedAt = uow.Now;
                foreach (var p in await db.Payments.Where(p => p.CustomerId == id).ToListAsync()) { p.CustomerEmail = null; p.Ip = null; }
                foreach (var i in await db.Invoices.Where(i => i.CustomerId == id).ToListAsync()) { i.CustomerEmail = null; }
                uow.Audit("customer.anonymize", "customer", c.Id, reason: "privacy request");
                await Task.CompletedTask;
                return c;
            });
        });
        v1.MapPost("/customers/{id}/portal_sessions", async (string id, RequestContext ctx, AppDb db, IConfiguration config, IClock clock) =>
        {
            ctx.RequireOrg("customers.write");
            var c = await db.Customers.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("customer");
            var token = PortalToken.Issue(config, c.Id, c.OrgId, c.Livemode, clock.UtcNow.AddHours(1));
            return new { @object = "portal_session", url = $"/portal/{token}", expires_at = clock.UtcNow.AddHours(1) };
        });

        // ───────── Checkout & payment links (§15, §48) ─────────
        var co = app.MapGroup("/v1").WithTags("Checkout");
        co.MapPost("/checkout/sessions", async (CheckoutRequest r, RequestContext ctx, CheckoutService checkout) =>
        {
            ctx.RequireOrg("checkout.write");
            return Results.Json(await checkout.Create(r.Mode, r.LineItems ?? [], r.Customer, r.CustomerEmail, r.Country, r.Coupon, r.SuccessUrl, r.CancelUrl, null,
                r.Metadata == null ? null : Json.Serialize(r.Metadata), r.ClientReferenceId, r.Affiliate), statusCode: 201);
        });
        co.MapGet("/checkout/sessions", async (HttpRequest req, RequestContext ctx, AppDb db) => { ctx.RequireOrg("payments.read"); return await Paging.List(db.CheckoutSessions, req); });
        co.MapGet("/checkout/sessions/{id}", async (string id, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireOrg("payments.read");
            return await db.CheckoutSessions.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("checkout session");
        });
        co.MapGet("/payment_links", async (HttpRequest req, RequestContext ctx, AppDb db) => { ctx.RequireOrg("payments.read"); return await Paging.List(db.PaymentLinks, req); });
        co.MapPost("/payment_links", async (PaymentLinkRequest r, RequestContext ctx, AppDb db, Uow uow) =>
        {
            ctx.RequireOrg("checkout.write");
            var price = await db.Prices.FirstOrDefaultAsync(p => p.Id == r.PriceId && p.Active) ?? throw ApiException.NotFound("price");
            string? couponId = null;
            if (r.Coupon != null) couponId = (await db.Coupons.FirstOrDefaultAsync(c => c.Code == r.Coupon.ToUpperInvariant()) ?? throw ApiException.NotFound("coupon")).Id;
            return Results.Json(await uow.Run(async () =>
            {
                var l = new PaymentLink
                {
                    Id = Ids.New("plink", 16), CreatedAt = uow.Now, PriceId = price.Id, Quantity = r.Quantity ?? 1, AllowCoupons = r.AllowCoupons ?? true, CouponId = couponId,
                    ExpiresAt = r.ExpiresAt, SuccessUrl = r.SuccessUrl, CancelUrl = r.CancelUrl, MetadataJson = r.Metadata == null ? null : Json.Serialize(r.Metadata),
                };
                db.PaymentLinks.Add(l);
                uow.Emit("payment_link.created", l);
                uow.Audit("payment_link.create", "payment_link", l.Id);
                await Task.CompletedTask;
                return l;
            }), statusCode: 201);
        });
        co.MapPost("/payment_links/{id}/disable", async (string id, RequestContext ctx, AppDb db, Uow uow) =>
        {
            ctx.RequireOrg("checkout.write");
            return await uow.Run(async () =>
            {
                var l = await db.PaymentLinks.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("payment link");
                l.Status = "disabled";
                uow.Audit("payment_link.disable", "payment_link", l.Id);
                await Task.CompletedTask;
                return l;
            });
        });

        // ───────── Public (buyer-facing) endpoints — no merchant credentials ─────────
        var pub = app.MapGroup("/v1/public").WithTags("Public checkout");
        pub.MapGet("/checkout/{id}", async (string id, CheckoutService checkout, AppDb db) =>
        {
            var (s, scope) = await checkout.LoadPublic(id);
            using (scope) return await PublicView(s, db);
        });
        pub.MapPost("/checkout/{id}/quote", async (string id, QuoteRequest r, CheckoutService checkout, AppDb db) =>
        {
            var (s, scope) = await checkout.LoadPublic(id);
            using (scope)
            {
                await checkout.Requote(s, r.Country, r.CustomerType, r.TaxId, r.Coupon);
                return await PublicView(s, db);
            }
        });
        pub.MapPost("/checkout/{id}/confirm", async (string id, ConfirmRequest r, CheckoutService checkout, RequestContext ctx) =>
        {
            var (s, scope) = await checkout.LoadPublic(id);
            using (scope) return await checkout.Confirm(s, r, ctx);
        });
        pub.MapPost("/checkout/{id}/authenticate", async (string id, AuthenticateRequest r, CheckoutService checkout, PaymentService payments, AppDb db) =>
        {
            var (s, scope) = await checkout.LoadPublic(id);
            using (scope)
            {
                var p = await db.Payments.FirstOrDefaultAsync(x => x.Id == s.PaymentId) ?? throw ApiException.NotFound("payment");
                p = await payments.CompleteAuthentication(p, r.Result == "pass");
                await db.Entry(s).ReloadAsync();
                return checkout.Result(s, p);
            }
        });
        pub.MapPost("/links/{id}", async (string id, HttpRequest req, AppDb db, CheckoutService checkout, IClock clock) =>
        {
            var link = await db.PaymentLinks.IgnoreQueryFilters().FirstOrDefaultAsync(l => l.Id == id) ?? throw ApiException.NotFound("payment link");
            using var _ = db.Tenant.Use(link.OrgId, link.Livemode);
            if (link.Status != "active" || (link.ExpiresAt != null && link.ExpiresAt < clock.UtcNow))
                throw new ApiException(410, "link_inactive", "This payment link is no longer active.");
            var price = await db.Prices.FirstAsync(p => p.Id == link.PriceId);
            var coupon = link.CouponId == null ? null : (await db.Coupons.FirstAsync(c => c.Id == link.CouponId)).Code;
            // A/B test (§108): a running experiment on this link assigns a weighted variant per visit.
            var experiment = await db.Experiments.FirstOrDefaultAsync(e => e.PaymentLinkId == link.Id && e.Status == "running");
            string? variantTag = null;
            if (experiment != null)
            {
                var variants = experiment.Variants;
                var roll = Random.Shared.Next(variants.Sum(v => v.Weight));
                var chosen = variants.First(v => (roll -= v.Weight) < 0);
                if (chosen.PriceId != null) price = await db.Prices.FirstAsync(p => p.Id == chosen.PriceId);
                if (chosen.CouponCode != null) coupon = chosen.CouponCode;
                variantTag = $"{experiment.Id}:{chosen.Key}";
            }
            link.Visits++;
            // Affiliate click tracking: /pay/{link}?ref=CODE (§51).
            var referral = req.Query["ref"].FirstOrDefault()?.Trim().ToUpperInvariant();
            if (!string.IsNullOrEmpty(referral))
            {
                var affiliate = await db.Affiliates.FirstOrDefaultAsync(a => a.Code == referral && a.Status == "active");
                if (affiliate != null) affiliate.Clicks++; else referral = null;
            }
            await db.SaveChangesAsync();
            var s = await checkout.Create(price.Type == "recurring" ? "subscription" : "payment", [new LineRequest(price.Id, link.Quantity)], null, null, null, coupon,
                link.SuccessUrl, link.CancelUrl, link.Id, link.MetadataJson, null, referral);
            if (variantTag != null) { s.ExperimentVariant = variantTag; await db.SaveChangesAsync(); }
            return new { checkout_session = s.Id, url = s.Url };
        });
        pub.MapGet("/links/{id}", async (string id, AppDb db) =>
        {
            var link = await db.PaymentLinks.IgnoreQueryFilters().FirstOrDefaultAsync(l => l.Id == id) ?? throw ApiException.NotFound("payment link");
            using var _ = db.Tenant.Use(link.OrgId, link.Livemode);
            var price = await db.Prices.FirstAsync(p => p.Id == link.PriceId);
            var product = await db.Products.FirstAsync(p => p.Id == price.ProductId);
            var org = await db.Organizations.FirstAsync(o => o.Id == link.OrgId);
            return new { link.Id, link.Status, merchant = new { org.Name, org.BrandColor, org.LogoUrl }, product = new { product.Name, product.Description, product.ImageUrl }, price = new { price.UnitAmount, price.Currency, price.Type, price.Interval } };
        });

        // Sandbox tokenization: stands in for the PSP's hosted card fields, so the platform never sees PAN/CVV (§162).
        pub.MapPost("/sim/tokens", async (TokenRequest r, AppDb db, IClock clock) =>
        {
            var tok = new SimCardToken { Id = Ids.New("tok", 24), CreatedAt = clock.UtcNow, ProviderId = "vault" };
            if (r.Type == "upi")
            {
                var vpa = r.Vpa?.Trim().ToLowerInvariant() ?? throw ApiException.Invalid("vpa is required.");
                tok.Type = "upi";
                tok.Behavior = SimulatorProvider.TestUpi.GetValueOrDefault(vpa, "success");
                tok.Last4 = vpa.Split('@')[0][..Math.Min(4, vpa.Split('@')[0].Length)];
                tok.Brand = "upi";
                tok.Country = "IN";
                tok.Fingerprint = Crypto.Sha256Hex("upi:" + vpa);
            }
            else
            {
                var number = new string((r.Number ?? "").Where(char.IsDigit).ToArray());
                if (number.Length is < 12 or > 19) throw new ApiException(400, "invalid_number", "Your card number is incomplete.");
                if (!Luhn(number)) throw new ApiException(400, "invalid_number", "Your card number is invalid.");
                if (r.ExpMonth is null or < 1 or > 12 || r.ExpYear is null) throw new ApiException(400, "invalid_expiry", "Your card's expiration date is incomplete.");
                var (behavior, brand, country) = SimulatorProvider.TestCards.GetValueOrDefault(number, ("success", number.StartsWith('5') ? "mastercard" : number.StartsWith('3') ? "amex" : "visa", "US"));
                var expYear = r.ExpYear < 100 ? 2000 + r.ExpYear.Value : r.ExpYear.Value;
                if (new DateTime(expYear, r.ExpMonth.Value, 1).AddMonths(1) <= clock.UtcNow) behavior = "expired_card";
                tok.Type = "card"; tok.Behavior = behavior; tok.Brand = brand; tok.Country = country; tok.Last4 = number[^4..];
                tok.ExpMonth = r.ExpMonth; tok.ExpYear = expYear; tok.Fingerprint = Crypto.Sha256Hex("card:" + number);
            }
            db.SimTokens.Add(tok);
            await db.SaveChangesAsync();
            return new { id = tok.Id, @object = "token", type = tok.Type, card = new { brand = tok.Brand, last4 = tok.Last4, exp_month = tok.ExpMonth, exp_year = tok.ExpYear, country = tok.Country } };
        }).RequireRateLimiting("public");

        // ───────── Customer portal (§24) ─────────
        var portal = app.MapGroup("/v1/portal/{token}").WithTags("Customer portal");
        portal.MapGet("/", async (string token, AppDb db, IConfiguration config, IClock clock, CreditService credits) =>
        {
            var (customer, scope) = await PortalToken.Resolve(token, db, config, clock);
            using (scope)
            {
                var org = await db.Organizations.FirstAsync(o => o.Id == customer.OrgId);
                var (available, _) = await credits.Balance(customer.Id, "credits");
                return new
                {
                    merchant = new { org.Name, org.BrandColor, org.LogoUrl, org.SupportEmail },
                    customer = new { customer.Id, customer.Name, customer.Email, customer.Country, customer.TaxId },
                    subscriptions = await db.Subscriptions.Where(s => s.CustomerId == customer.Id).OrderByDescending(s => s.CreatedAt).ToListAsync(),
                    invoices = await db.Invoices.Where(i => i.CustomerId == customer.Id && i.Status != "DRAFT").OrderByDescending(i => i.CreatedAt).Take(24).ToListAsync(),
                    payment_methods = await db.PaymentMethods.Where(p => p.CustomerId == customer.Id && !p.Detached).ToListAsync(),
                    entitlements = await db.Entitlements.Where(e => e.CustomerId == customer.Id && e.Status == "active").ToListAsync(),
                    credits = available,
                };
            }
        });
        // Cancellation with a retention step (§257): reasons, then an optional save offer, then cancel.
        portal.MapGet("/subscriptions/{id}/cancel_options", async (string token, string id, AppDb db, IConfiguration config, IClock clock) =>
        {
            var (customer, scope) = await PortalToken.Resolve(token, db, config, clock);
            using (scope)
            {
                var sub = await db.Subscriptions.FirstOrDefaultAsync(s => s.Id == id && s.CustomerId == customer.Id) ?? throw ApiException.NotFound("subscription");
                var org = await db.Organizations.FirstAsync(o => o.Id == sub.OrgId);
                var coupon = org.RetentionCouponId == null || sub.CouponId == org.RetentionCouponId ? null : await db.Coupons.FirstOrDefaultAsync(c => c.Id == org.RetentionCouponId && c.Active);
                var offers = new List<object>();
                if (coupon != null)
                    offers.Add(new { type = "discount", coupon = coupon.Code, description = coupon.PercentOffBps is { } bps ? $"{bps / 100}% off" + (coupon.Duration == "repeating" ? $" for {coupon.DurationInMonths} months" : coupon.Duration == "forever" ? "" : " on your next invoice") : $"{Money.Format(coupon.AmountOff ?? 0, coupon.Currency ?? sub.Currency)} off" });
                if (org.RetentionOfferPause && sub.Status == "ACTIVE") offers.Add(new { type = "pause", description = "Pause instead: no charges until you resume" });
                return new { @object = "cancel_options", subscription = sub.Id, period_end = sub.CurrentPeriodEnd, reasons = CancelReasons, offers };
            }
        });
        portal.MapPost("/subscriptions/{id}/cancel", async (string token, string id, PortalCancelRequest? r, AppDb db, IConfiguration config, IClock clock, BillingService billing, Uow uow) =>
        {
            var (customer, scope) = await PortalToken.Resolve(token, db, config, clock);
            using (scope)
            {
                var sub = await db.Subscriptions.FirstOrDefaultAsync(s => s.Id == id && s.CustomerId == customer.Id) ?? throw ApiException.NotFound("subscription");
                var reason = r?.Reason is { } given && CancelReasons.Contains(given) ? given : "customer_portal";
                if (r?.AcceptOffer == "discount")
                {
                    var org = await db.Organizations.FirstAsync(o => o.Id == sub.OrgId);
                    var coupon = await db.Coupons.FirstOrDefaultAsync(c => c.Id == org.RetentionCouponId && c.Active) ?? throw ApiException.Invalid("No discount offer is available.");
                    return (object)await uow.Run(async () =>
                    {
                        sub.CouponId = coupon.Id;
                        sub.CouponPeriodsUsed = 0;
                        sub.CancelAtPeriodEnd = false;
                        sub.CancellationFeedback = r.Feedback;
                        uow.Emit("subscription.retained", sub);
                        uow.Audit("subscription.retention_offer", "subscription", sub.Id, after: new { offer = "discount", coupon = coupon.Code, reason }, orgId: sub.OrgId);
                        await Task.CompletedTask;
                        return sub;
                    });
                }
                if (r?.AcceptOffer == "pause")
                {
                    await uow.Run(async () => { uow.Emit("subscription.retained", sub); sub.CancellationFeedback = r.Feedback; await Task.CompletedTask; });
                    return await billing.Pause(id, true);
                }
                var cancelled = await billing.Cancel(id, atPeriodEnd: true, reason);
                if (!string.IsNullOrWhiteSpace(r?.Feedback))
                    await uow.Run(async () => { cancelled.CancellationFeedback = r.Feedback.Length > 1000 ? r.Feedback[..1000] : r.Feedback; await Task.CompletedTask; });
                return cancelled;
            }
        });
        portal.MapPost("/subscriptions/{id}/resume", async (string token, string id, AppDb db, IConfiguration config, IClock clock, Uow uow) =>
        {
            var (customer, scope) = await PortalToken.Resolve(token, db, config, clock);
            using (scope)
                return await uow.Run(async () =>
                {
                    var s = await db.Subscriptions.FirstOrDefaultAsync(x => x.Id == id && x.CustomerId == customer.Id) ?? throw ApiException.NotFound("subscription");
                    s.CancelAtPeriodEnd = false;
                    uow.Emit("subscription.updated", s);
                    return s;
                });
        });
        portal.MapPost("/payment_methods", async (string token, AttachPmRequest r, AppDb db, IConfiguration config, IClock clock, CheckoutService checkout, Uow uow) =>
        {
            var (customer, scope) = await PortalToken.Resolve(token, db, config, clock);
            using (scope)
                return await uow.Run(async () =>
                {
                    var pm = await checkout.SavePaymentMethod(customer, r.Token);
                    customer.DefaultPaymentMethodId = pm.Id;
                    foreach (var s in await db.Subscriptions.Where(s => s.CustomerId == customer.Id && s.Status != "CANCELLED").ToListAsync()) s.DefaultPaymentMethodId = pm.Id;
                    uow.Emit("customer.updated", customer);
                    return pm;
                });
        });
        portal.MapGet("/invoices/{id}/pdf", async (string token, string id, AppDb db, IConfiguration config, IClock clock) =>
        {
            var (customer, scope) = await PortalToken.Resolve(token, db, config, clock);
            using (scope)
            {
                var inv = await db.Invoices.FirstOrDefaultAsync(i => i.Id == id && i.CustomerId == customer.Id) ?? throw ApiException.NotFound("invoice");
                return Results.File(await InvoicePdf.Render(db, inv), "application/pdf", $"{inv.Number}.pdf");
            }
        });
    }

    public static readonly string[] CancelReasons = ["too_expensive", "missing_features", "switching_provider", "not_using_enough", "technical_issues", "other"];

    private static Price BuildPrice(PriceRequest r)
    {
        var p = new Price
        {
            ProductId = r.ProductId, Currency = Money.Normalize(r.Currency), Type = r.Type, Scheme = r.Scheme ?? (r.Tiers != null ? "tiered" : "standard"), UnitAmount = r.UnitAmount,
            TiersJson = r.Tiers == null ? null : Json.Serialize(r.Tiers), TiersMode = r.TiersMode, PackageSize = r.PackageSize ?? 1, Interval = r.Interval,
            IntervalCount = r.IntervalCount ?? 1, TrialDays = r.TrialDays ?? 0, UsageType = r.UsageType ?? "licensed", MeterId = r.MeterId, CreditsGranted = r.CreditsGranted ?? 0,
            MinimumAmount = r.MinimumAmount, MaximumAmount = r.MaximumAmount, TaxBehavior = r.TaxBehavior ?? "exclusive", Nickname = r.Nickname,
            CountryAmountsJson = r.CountryAmounts == null ? null : Json.Serialize(r.CountryAmounts.ToDictionary(k => k.Key.ToUpperInvariant(), v => v.Value)),
            MetadataJson = r.Metadata == null ? null : Json.Serialize(r.Metadata),
        };
        if (r.Type is not ("one_time" or "recurring")) throw ApiException.Invalid("type must be one_time or recurring.");
        if (p.TaxBehavior is not ("exclusive" or "inclusive")) throw ApiException.Invalid("tax_behavior must be exclusive or inclusive.");
        PricingEngine.Validate(p);
        return p;
    }

    private static async Task<object> PublicView(CheckoutSession s, AppDb db)
    {
        var org = await db.Organizations.FirstAsync(o => o.Id == s.OrgId);
        var productIds = s.LineItems.Select(l => l.ProductId).ToList();
        var products = await db.Products.Where(p => productIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id);
        var caps = s.Country == null ? null : await db.Countries.FirstOrDefaultAsync(c => c.Country == s.Country);
        var terms = await db.LegalDocuments.Where(d => d.Key == "terms").OrderByDescending(d => d.Version).FirstOrDefaultAsync();
        var coupon = s.CouponId == null ? null : await db.Coupons.FirstOrDefaultAsync(c => c.Id == s.CouponId);
        return new
        {
            id = s.Id, @object = "checkout_session", s.Status, s.Mode, s.Livemode, s.Currency, s.Country, s.CustomerEmail,
            merchant = new { name = org.Name, brand_color = org.BrandColor, logo_url = org.LogoUrl, support_email = org.SupportEmail },
            // The platform sells as Merchant of Record; checkout must show the legal seller (§225).
            seller_of_record = "Global Monetization Platform (sandbox) as Merchant of Record",
            line_items = s.LineItems.Select(l => new
            {
                l.PriceId, l.Description, l.Quantity, l.UnitAmount, l.Amount, l.Discount, l.Tax, l.TaxRateBps, l.TaxType, l.TaxInclusive,
                product = products.TryGetValue(l.ProductId!, out var p) ? new { p.Name, p.Description, p.ImageUrl } : null,
            }),
            s.Subtotal, s.Discount, s.Tax, tax_label = s.TaxLabel, s.Total, s.TrialDays, recurring = s.RecurringSummary,
            coupon = coupon == null ? null : new { coupon.Code, coupon.Name },
            payment_methods = (caps?.PaymentMethodsCsv ?? "card").Split(','),
            terms = terms == null ? null : new { version = terms.Version, title = terms.Title },
            s.ExpiresAt, s.SuccessUrl, s.CancelUrl, s.PaymentId,
            test_mode_notice = s.Livemode ? null : "Test mode — use card 4242 4242 4242 4242 with any future date and CVC.",
        };
    }

    private static bool Luhn(string digits)
    {
        var sum = 0;
        var alt = false;
        for (var i = digits.Length - 1; i >= 0; i--)
        {
            var n = digits[i] - '0';
            if (alt) { n *= 2; if (n > 9) n -= 9; }
            sum += n;
            alt = !alt;
        }
        return sum % 10 == 0;
    }
}

/// <summary>Signed, expiring customer-portal tokens: no customer password needed, nothing stored (§24, §179).</summary>
public static class PortalToken
{
    private static string Secret(IConfiguration c) => c["Security:PortalTokenSecret"] ?? throw new InvalidOperationException("Security:PortalTokenSecret is not configured.");

    public static string Issue(IConfiguration config, string customerId, string orgId, bool livemode, DateTime expires)
    {
        var body = $"{customerId}|{orgId}|{(livemode ? 1 : 0)}|{new DateTimeOffset(expires).ToUnixTimeSeconds()}";
        var sig = Crypto.HmacSha256Hex(Secret(config), body);
        return Convert.ToBase64String(Encoding.UTF8.GetBytes(body + "|" + sig)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }

    public static async Task<(Customer, IDisposable)> Resolve(string token, AppDb db, IConfiguration config, IClock clock)
    {
        string raw;
        try
        {
            var b64 = token.Replace('-', '+').Replace('_', '/');
            raw = Encoding.UTF8.GetString(Convert.FromBase64String(b64.PadRight(b64.Length + (4 - b64.Length % 4) % 4, '=')));
        }
        catch { throw ApiException.Unauthorized("Invalid portal link."); }
        var parts = raw.Split('|');
        if (parts.Length != 5 || !Crypto.FixedTimeEquals(Crypto.HmacSha256Hex(Secret(config), string.Join('|', parts[..4])), parts[4]))
            throw ApiException.Unauthorized("Invalid portal link.");
        if (DateTimeOffset.FromUnixTimeSeconds(long.Parse(parts[3])) < clock.UtcNow) throw ApiException.Unauthorized("This portal link has expired. Request a new one.");
        var scope = db.Tenant.Use(parts[1], parts[2] == "1");
        var customer = await db.Customers.FirstOrDefaultAsync(c => c.Id == parts[0]);
        if (customer == null) { scope.Dispose(); throw ApiException.NotFound("customer"); }
        return (customer, scope);
    }
}

public static class InvoicePdf
{
    public static async Task<byte[]> Render(AppDb db, Invoice inv)
    {
        var org = await db.Organizations.FirstAsync(o => o.Id == inv.OrgId);
        var lines = await db.InvoiceLines.Where(l => l.InvoiceId == inv.Id).OrderBy(l => l.Sort).ToListAsync();
        var c = inv.Currency;
        var text = new List<(string, int, bool)>
        {
            ($"INVOICE {inv.Number}", 20, true),
            ($"Status: {inv.Status}    Issued: {inv.FinalizedAt ?? inv.CreatedAt:yyyy-MM-dd}    Due: {inv.DueDate:yyyy-MM-dd}", 10, false),
            ("", 6, false),
            ($"Seller of record: {inv.SellerOfRecord ?? "Platform"} on behalf of {org.Name}", 10, true),
            ($"Bill to: {inv.CustomerName ?? ""} <{inv.CustomerEmail ?? ""}>  {inv.CustomerCountry ?? ""}  {(inv.CustomerTaxId != null ? "Tax ID " + inv.CustomerTaxId : "")}", 10, false),
            (inv.PurchaseOrder != null ? $"PO: {inv.PurchaseOrder}" : "", 10, false),
            ("", 6, false),
            ("Description                                   Qty        Amount       Tax", 10, true),
        };
        foreach (var l in lines)
            text.Add(($"{Trunc(l.Description, 42),-44}{l.Quantity,6}  {Money.Format(l.Amount - l.Discount, c),12}  {Money.Format(l.Tax, c),10}{(l.TaxType == "reverse_charge" ? "  RC" : "")}", 10, false));
        text.Add(("", 6, false));
        text.Add(($"Subtotal: {Money.Format(inv.Subtotal, c)}   Discount: {Money.Format(inv.Discount, c)}   Tax: {Money.Format(inv.Tax, c)}", 10, false));
        if (inv.AmountCredited > 0) text.Add(($"Account credit applied: {Money.Format(inv.AmountCredited, c)}", 10, false));
        text.Add(($"TOTAL {c}: {Money.Format(inv.Total, c)}    Amount due: {Money.Format(inv.AmountDue - inv.AmountPaid, c)}", 12, true));
        if (lines.Any(l => l.TaxType == "reverse_charge")) text.Add(("Reverse charge: VAT to be accounted for by the recipient.", 9, false));
        if (inv.Memo != null) text.Add((inv.Memo, 9, false));
        return Pdf.Text(text, inv.Number);
    }

    private static string Trunc(string s, int n) => s.Length <= n ? s : s[..(n - 1)] + ".";
}
