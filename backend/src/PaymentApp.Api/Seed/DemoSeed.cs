using Microsoft.EntityFrameworkCore;
using PaymentApp.Api.Common;
using PaymentApp.Api.Infrastructure;
using PaymentApp.Api.Modules.Billing;
using PaymentApp.Api.Modules.Checkout;
using PaymentApp.Api.Modules.Compliance;
using PaymentApp.Api.Modules.Identity;
using PaymentApp.Api.Modules.Merchants;
using PaymentApp.Api.Modules.Payments;
using PaymentApp.Api.Modules.Payouts;
using PaymentApp.Api.Modules.Platform;
using PaymentApp.Api.Modules.Wallet;

namespace PaymentApp.Api.Data;

/// <summary>
/// Development demo environment (§275): `dotnet run -- seed --reset`. Everything is created through the
/// real services, so the ledger, events, alerts and audit trail are genuine. Development only — the
/// credentials below are sandbox test credentials, and Program refuses to seed in Production.
/// </summary>
public static class DemoSeed
{
    public const string Password = "DemoPass!2026";

    public static async Task Run(IServiceProvider root)
    {
        var clock = (SystemClock)root.GetRequiredService<IClock>();
        var rng = new Random(42);
        using (var s = root.CreateScope())
            if (await s.ServiceProvider.GetRequiredService<AppDb>().Users.AnyAsync()) { Console.WriteLine("Database already has users. Run with --reset to reseed."); return; }

        // ───── Staff ─────
        var staff = new (string Email, string Name, string Role)[]
        {
            ("admin@demo.test", "Sam Superadmin", "SUPER_ADMIN"), ("compliance@demo.test", "Chen Compliance", "COMPLIANCE_ADMIN"),
            ("analyst@demo.test", "Ada Analyst", "AML_ANALYST"), ("finance@demo.test", "Fin Nance", "FINANCE_ADMIN"),
            ("support@demo.test", "Sue Support", "SUPPORT_ADMIN"), ("auditor@demo.test", "Audra Auditor", "AUDITOR"),
        };
        var users = new Dictionary<string, User>();
        foreach (var (email, name, role) in staff)
        {
            var u = await As(root, null, null, async sp => (await sp.GetRequiredService<IdentityService>().SignUp(email, Password, name, "US", null)).User);
            await WithDb(root, async db => { (await db.Users.FirstAsync(x => x.Id == u.Id)).PlatformRole = role; await db.SaveChangesAsync(); });
            users[email] = u;
        }

        // ───── Merchant ─────
        var owner = await As(root, null, null, async sp => (await sp.GetRequiredService<IdentityService>().SignUp("owner@acme.test", Password, "Olivia Owner", "US", "+15550100")).User);
        var org = await As(root, owner, null, sp => sp.GetRequiredService<MerchantService>().CreateOrganization(owner, "Acme AI Labs", "US", "USD"));
        await As(root, owner, org.Id, sp => sp.GetRequiredService<MerchantService>().UpdateApplication(org.Id, a =>
        {
            a.LegalName = "Acme AI Labs Inc"; a.TradingName = "Acme Writer"; a.Website = "https://acme-writer.example"; a.Industry = "software"; a.BusinessType = "corporation";
            a.Country = "US"; a.RegisteredAddress = "500 Market St, San Francisco, CA"; a.RegistrationNumber = "C4455667"; a.TaxNumber = "94-1234567";
            a.ProductDescription = "AI writing assistant (SaaS), API access and template packs"; a.CustomerType = "b2c_and_b2b"; a.ExpectedMonthlyVolumeMinor = 5_000_000;
            a.RefundPolicyUrl = "https://acme-writer.example/refunds"; a.TermsUrl = "https://acme-writer.example/terms"; a.PrivacyUrl = "https://acme-writer.example/privacy";
        }, [new BeneficialOwner { Name = "Olivia Owner", DateOfBirth = "1986-04-12", Nationality = "US", Country = "US", OwnershipBps = 7000, Relationship = "owner" },
            new BeneficialOwner { Name = "Raj Patel", DateOfBirth = "1984-09-30", Nationality = "IN", Country = "US", OwnershipBps = 3000, Relationship = "director" }]));
        await As(root, owner, org.Id, sp => sp.GetRequiredService<MerchantService>().Submit(org.Id));
        await As(root, users["compliance@demo.test"], null, sp => sp.GetRequiredService<MerchantService>().Decide(org.Id, true, "KYB verified: registry match, owners screened clear", users["compliance@demo.test"]));
        foreach (var (email, name, role) in new[] { ("dev@acme.test", "Dev Eloper", "developer"), ("fin@acme.test", "Fiona Finance", "finance"), ("help@acme.test", "Hal Support", "support") })
        {
            var u = await As(root, null, null, async sp => (await sp.GetRequiredService<IdentityService>().SignUp(email, Password, name, "US", null)).User);
            await WithDb(root, async db => { db.Memberships.Add(new Membership { Id = Ids.New("mem"), CreatedAt = DateTime.UtcNow, OrgId = org.Id, UserId = u.Id, Role = role }); await db.SaveChangesAsync(); });
        }

        // A second merchant still in review, so the admin queue has work in it.
        var owner2 = await As(root, null, null, async sp => (await sp.GetRequiredService<IdentityService>().SignUp("owner@pixelforge.test", Password, "Priya Nair", "IN", null)).User);
        var org2 = await As(root, owner2, null, sp => sp.GetRequiredService<MerchantService>().CreateOrganization(owner2, "PixelForge Studio", "IN", "INR"));
        await As(root, owner2, org2.Id, sp => sp.GetRequiredService<MerchantService>().UpdateApplication(org2.Id, a =>
        {
            a.LegalName = "PixelForge Studio Pvt Ltd"; a.Website = "https://pixelforge.example"; a.Industry = "digital_goods"; a.Country = "IN"; a.RegisteredAddress = "12 MG Road, Bengaluru";
            a.RegistrationNumber = "U72900KA2020PTC000000"; a.ProductDescription = "Design templates and courses"; a.RefundPolicyUrl = "https://pixelforge.example/r";
            a.TermsUrl = "https://pixelforge.example/t"; a.PrivacyUrl = "https://pixelforge.example/p";
        }, [new BeneficialOwner { Name = "Priya Nair", DateOfBirth = "1991-01-20", Nationality = "IN", Country = "IN", OwnershipBps = 10000, Relationship = "owner" }]));
        await As(root, owner2, org2.Id, sp => sp.GetRequiredService<MerchantService>().Submit(org2.Id));

        // ───── Catalog ─────
        var ids = await As(root, owner, org.Id, async sp =>
        {
            var db = sp.GetRequiredService<AppDb>();
            var uow = sp.GetRequiredService<Uow>();
            return await uow.Run(async () =>
            {
                Product P(string name, string type, string desc, string features, string category = "saas") { var p = new Product { Id = Ids.New("prod"), CreatedAt = uow.Now, UpdatedAt = uow.Now, Name = name, Type = type, Description = desc, FeaturesCsv = features, TaxCategory = category }; db.Products.Add(p); return p; }
                Price Pr(Product p, long amount, string type = "one_time", string? interval = null, Action<Price>? more = null) { var x = new Price { Id = Ids.New("price"), CreatedAt = uow.Now, ProductId = p.Id, Currency = "USD", Type = type, Interval = interval, UnitAmount = amount }; more?.Invoke(x); db.Prices.Add(x); return x; }
                var pro = P("Acme Writer Pro", "subscription", "Unlimited AI drafts, brand voice and team sharing.", "drafts_unlimited,brand_voice,sharing");
                var team = P("Acme Writer Team", "subscription", "Everything in Pro for teams, priced per seat.", "drafts_unlimited,brand_voice,sharing,sso");
                var api = P("Acme API", "api", "Metered API access to the writing models.", "api");
                var credits = P("Credit Pack", "credit_package", "1,000 generation credits.", "credits", "digital_service");
                var templates = P("Template Bundle", "download", "120 premium document templates.", "templates", "digital_service");
                var meter = new Meter { Id = Ids.New("mtr"), CreatedAt = uow.Now, EventName = "api_requests", DisplayName = "API requests", Aggregation = "sum", Unit = "requests" };
                db.Meters.Add(meter);
                var result = new
                {
                    ProMonthly = Pr(pro, 2000, "recurring", "month", x => { x.CountryAmountsJson = "{\"IN\":900}"; x.Nickname = "Pro monthly"; }).Id,
                    ProYearly = Pr(pro, 20000, "recurring", "year", x => x.Nickname = "Pro yearly").Id,
                    TeamSeat = Pr(team, 1500, "recurring", "month", x => { x.Scheme = "per_unit"; x.TrialDays = 14; x.Nickname = "Team per seat"; }).Id,
                    ApiMetered = Pr(api, 0, "recurring", "month", x =>
                    {
                        x.UsageType = "metered"; x.MeterId = meter.Id; x.Scheme = "tiered"; x.TiersMode = "graduated"; x.Nickname = "API graduated";
                        x.TiersJson = Json.Serialize(new List<PriceTier> { new() { UpTo = 10_000, UnitAmount = 0 }, new() { UpTo = null, UnitAmount = 1 } });
                        x.MaximumAmount = 500_000;
                    }).Id,
                    CreditPack = Pr(credits, 4900, more: x => x.CreditsGranted = 1000).Id,
                    Templates = Pr(templates, 2900).Id,
                    TemplatesProduct = templates.Id,
                };
                db.Coupons.Add(new Coupon { Id = Ids.New("coup"), CreatedAt = uow.Now, Code = "LAUNCH20", Name = "Launch 20% off", PercentOffBps = 2000, Duration = "once", MaxRedemptions = 500 });
                db.Coupons.Add(new Coupon { Id = Ids.New("coup"), CreatedAt = uow.Now, Code = "INDIA25", Name = "India launch offer", PercentOffBps = 2500, CountriesCsv = "IN", AutoApply = true, Duration = "once" });
                db.PaymentLinks.Add(new PaymentLink { Id = Ids.New("plink", 16), CreatedAt = uow.Now, PriceId = result.Templates, SuccessUrl = "https://acme-writer.example/thanks" });
                db.PaymentLinks.Add(new PaymentLink { Id = Ids.New("plink", 16), CreatedAt = uow.Now, PriceId = result.CreditPack });
                return result;
            });
        });
        await As(root, owner, org.Id, async sp =>
        {
            var m = sp.GetRequiredService<MerchantService>();
            await m.CreateApiKey(org.Id, false, "secret", "Server (test)", null, null);
            return await m.AddPayoutDestination(org.Id, "US", "USD", "Acme AI Labs Inc", "First Test Bank", "000123456789", "110000000", null);
        });

        // ───── Two months of sales (older subscriptions renew during seeding) ─────
        var countries = new[] { "US", "US", "US", "GB", "DE", "FR", "IN", "IN", "AU", "CA", "SG", "NL" };
        var names = new[] { "Maya Chen", "Liam Walker", "Sofia Rossi", "Noah Kim", "Emma Schmidt", "Arjun Mehta", "Chloe Martin", "Lucas Brown", "Aisha Khan", "Kenji Sato", "Olivia Smith", "Ravi Kumar", "Hannah Müller", "Tom Evans", "Isla Wright" };
        var sales = new List<string>();
        for (var day = 62; day >= 1; day--)
        {
            var perDay = (day > 31 ? rng.Next(2) : 1 + rng.Next(2)) + (day < 10 ? 1 : 0);
            for (var k = 0; k < perDay; k++)
            {
                clock.Offset = TimeSpan.FromDays(-day) + TimeSpan.FromMinutes(rng.Next(60 * 20));
                var country = countries[rng.Next(countries.Length)];
                var name = names[rng.Next(names.Length)];
                var email = $"{name.Split(' ')[0].ToLowerInvariant()}.{rng.Next(1000)}@example.com";
                var roll = rng.Next(100);
                var (price, mode, qty) = roll switch
                {
                    < 35 => (ids.ProMonthly, "subscription", 1L),
                    < 45 => (ids.ProYearly, "subscription", 1L),
                    < 55 => (ids.TeamSeat, "subscription", (long)(3 + rng.Next(8))),
                    < 75 => (ids.CreditPack, "payment", 1L),
                    _ => (ids.Templates, "payment", 1L),
                };
                var card = rng.Next(100) switch
                {
                    < 6 => "4000000000009995", < 9 => "4000000000000002", < 11 => "4000000000000259", < 14 => "4000000000000341", _ => "4242424242424242",
                };
                if (mode == "subscription" && card is "4000000000000002" or "4000000000009995") card = "4242424242424242";
                try
                {
                    var r = await Checkout(root, owner, org.Id, mode, price, qty, country, email, name, card, rng.Next(10) == 0 ? "LAUNCH20" : null);
                    if (r != null) sales.Add(r);
                }
                catch (ApiException ex) { Console.WriteLine($"  checkout skipped: {ex.Message}"); }
            }
        }
        clock.Offset = TimeSpan.FromDays(-3);
        // A UPI payment and a refund.
        await Checkout(root, owner, org.Id, "payment", ids.Templates, 1, "IN", "ananya@example.in", "Ananya Rao", "upi:success@upi", null);
        await As(root, owner, org.Id, async sp =>
        {
            var p = await sp.GetRequiredService<AppDb>().Payments.Where(x => x.Status == "SUCCEEDED" && x.Amount >= 2000).OrderBy(x => x.CreatedAt).Skip(2).FirstOrDefaultAsync();
            return p == null ? null : await sp.GetRequiredService<PaymentService>().CreateRefund(p.Id, p.Amount / 2, "requested_by_customer");
        });

        // Usage for metered API customers (one API subscription via server-side creation).
        clock.Offset = TimeSpan.FromDays(-20);
        await As(root, owner, org.Id, async sp =>
        {
            var db = sp.GetRequiredService<AppDb>();
            var uow = sp.GetRequiredService<Uow>();
            var c = new Customer { Id = Ids.New("cus"), CreatedAt = uow.Now, UpdatedAt = uow.Now, Email = "platform@bigco.example", Name = "BigCo Platform Team", Country = "GB", CustomerType = "b2b", TaxId = "GB123456789" };
            await uow.Run(async () => { db.Customers.Add(c); await Task.CompletedTask; });
            var tok = await Token(root, "4242424242424242");
            var pm = await uow.Run(async () => await sp.GetRequiredService<CheckoutService>().SavePaymentMethod(c, tok));
            await uow.Run(async () => { c.DefaultPaymentMethodId = pm.Id; await Task.CompletedTask; });
            var sub = await sp.GetRequiredService<BillingService>().Create(c.Id, [(ids.ApiMetered, 1)], pm.Id, null, 0, "charge_automatically", 30, null, null);
            await uow.Run(async () =>
            {
                for (var d = 0; d < 20; d++)
                    db.UsageEvents.Add(new UsageEvent { Id = Ids.New("ue"), CreatedAt = uow.Now.AddDays(d), CustomerId = c.Id, EventName = "api_requests", Quantity = 2000 + rng.Next(9000), Timestamp = uow.Now.AddDays(d), IdempotencyKey = $"seed-{d}", SubscriptionId = sub.Id });
                await Task.CompletedTask;
            });
            return sub;
        });

        // Renewals, dunning, settlement and a payout — run the jobs as of "now".
        clock.Offset = TimeSpan.Zero;
        await RunJobs(root);
        await As(root, owner, org.Id, async sp =>
        {
            var t = sp.GetRequiredService<TreasuryService>();
            await t.Settle(DateTime.UtcNow);
            try { return await t.CreatePayout(org.Id, false, "USD", null, automatic: false); } catch (ApiException) { return null; }
        });
        await RunJobs(root);

        // ───── Wallet users & AML patterns ─────
        var walletUsers = new Dictionary<string, User>();
        foreach (var (email, name, country, dob) in new[]
                 {
                     ("alice@wallet.test", "Alice Sharma", "IN", "1990-05-01"), ("bob@wallet.test", "Bob Carter", "GB", "1988-11-11"),
                     ("carol@wallet.test", "Carol Diaz", "US", "1992-02-14"), ("dave@wallet.test", "Dave Okafor", "US", "1979-07-07"),
                     ("erin@wallet.test", "Erin Walsh", "US", "1995-03-03"), ("frank@wallet.test", "Frank Li", "SG", "1983-12-25"),
                     ("gina@wallet.test", "Gina Rossi", "DE", "1990-10-10"), ("hugo@wallet.test", "Hugo Martin", "FR", "1987-06-06"),
                 })
        {
            clock.Offset = TimeSpan.FromDays(-12);
            var u = await As(root, null, null, async sp => (await sp.GetRequiredService<IdentityService>().SignUp(email, Password, name, country, null)).User);
            await As(root, u, null, async sp => await sp.GetRequiredService<IdentityService>().SubmitKyc(await Reload(sp, u), name, dob, country, "1 Demo Street", "passport", 2));
            await As(root, u, null, async sp => await sp.GetRequiredService<WalletService>().ForUser(await Reload(sp, u)));
            walletUsers[email] = u;
        }
        // A KYC that needs manual review (screening near-match to a synthetic list entry).
        var ivan = await As(root, null, null, async sp => (await sp.GetRequiredService<IdentityService>().SignUp("ivan@wallet.test", Password, "Ivan Sampleblock", "GB", null)).User);
        await As(root, ivan, null, async sp => await sp.GetRequiredService<IdentityService>().SubmitKyc(await Reload(sp, ivan), "Ivan Sampleblock", "1980-01-01", "GB", "9 Test Lane", "passport", 2));

        async Task Fund(string email, string cur, long amt, int daysAgo) { clock.Offset = TimeSpan.FromDays(-daysAgo); await As(root, walletUsers[email], null, async sp => await sp.GetRequiredService<WalletService>().Fund(await Reload(sp, walletUsers[email]), cur, amt, "bank_transfer")); }
        async Task<Transfer?> Send(string from, string to, string cur, long amt, int daysAgo, string? toCur = null, int minutes = 0)
        {
            clock.Offset = TimeSpan.FromDays(-daysAgo) + TimeSpan.FromMinutes(minutes);
            return await As(root, walletUsers[from], null, async sp =>
            {
                var user = await Reload(sp, walletUsers[from]);
                var wallets = sp.GetRequiredService<WalletService>();
                var src = await wallets.ForUser(user, create: false);
                var target = (await wallets.ForUser(await Reload(sp, walletUsers[to]), create: false)).Handle;
                string? quote = null;
                if (toCur != null && toCur != cur) quote = (await sp.GetRequiredService<FxService>().Quote(user.Id, cur, toCur, amt)).Id;
                try { return await wallets.Send(user, src, new SendRequest(target, cur, amt, toCur, quote, "Personal support", "Demo transfer", null)); }
                catch (ApiException ex) { Console.WriteLine($"  transfer skipped: {ex.Message}"); return null; }
            });
        }
        await Fund("alice@wallet.test", "INR", 25_000_000, 10);
        await Fund("bob@wallet.test", "GBP", 300_000, 10);
        await Fund("carol@wallet.test", "USD", 500_000, 9);
        await Fund("erin@wallet.test", "USD", 800_000, 8);
        await Send("alice@wallet.test", "bob@wallet.test", "INR", 1_000_000, 7, "GBP");
        await Send("bob@wallet.test", "gina@wallet.test", "GBP", 40_000, 6, "EUR");
        await Send("alice@wallet.test", "frank@wallet.test", "INR", 500_000, 5, "USD");
        // Circular: carol → dave → erin → carol within hours.
        await Send("carol@wallet.test", "dave@wallet.test", "USD", 150_000, 4);
        await Fund("dave@wallet.test", "USD", 10_000, 4);
        await Send("dave@wallet.test", "erin@wallet.test", "USD", 140_000, 4, minutes: 30);
        await Send("erin@wallet.test", "carol@wallet.test", "USD", 130_000, 4, minutes: 60);
        // One-to-many: erin → 5 recipients in a day.
        var n = 0;
        foreach (var to in new[] { "alice@wallet.test", "bob@wallet.test", "frank@wallet.test", "gina@wallet.test", "hugo@wallet.test" })
            await Send("erin@wallet.test", to, "USD", 20_000 + 1000 * n, 2, minutes: 10 * n++);
        // Large transfer: held for compliance review by policy.
        await Fund("carol@wallet.test", "USD", 600_000, 1);
        await Fund("carol@wallet.test", "USD", 600_000, 1);
        await Send("carol@wallet.test", "hugo@wallet.test", "USD", 1_100_000, 1, "EUR");
        // New bank account then immediate withdrawal: held.
        clock.Offset = TimeSpan.FromHours(-3);
        await As(root, walletUsers["bob@wallet.test"], null, async sp =>
        {
            var bob = await Reload(sp, walletUsers["bob@wallet.test"]);
            var wallets = sp.GetRequiredService<WalletService>();
            var ba = await wallets.AddBankAccount("user", bob.Id, bob.Name, "GB", "GBP", "Demo Bank UK", "Bob Carter", "GB29NWBK60161331926819", "601613");
            return await wallets.Withdraw(bob, "GBP", 50_000, ba.Id, null);
        });
        // A normal withdrawal for Alice to an older account.
        clock.Offset = TimeSpan.FromDays(-6);
        var aliceBank = await As(root, walletUsers["alice@wallet.test"], null, async sp => { var a = await Reload(sp, walletUsers["alice@wallet.test"]); return await sp.GetRequiredService<WalletService>().AddBankAccount("user", a.Id, a.Name, "IN", "INR", "Demo Bank India", "Alice Sharma", "123456789012", "DEMO0001234"); });
        clock.Offset = TimeSpan.FromDays(-3);
        await As(root, walletUsers["alice@wallet.test"], null, async sp => await sp.GetRequiredService<WalletService>().Withdraw(await Reload(sp, walletUsers["alice@wallet.test"]), "INR", 2_000_000, aliceBank.Id, null));

        // Merchant proceeds into the business wallet (MoR + wallet link, §118).
        clock.Offset = TimeSpan.Zero;
        await As(root, owner, org.Id, async sp =>
        {
            var ledger = sp.GetRequiredService<Modules.Ledger.LedgerService>();
            var available = await ledger.MerchantBalance(org.Id, Modules.Ledger.Accounts.MerchantAvailable, "USD", false);
            return available > 10_000 ? await sp.GetRequiredService<WalletService>().MoveMerchantProceeds(org.Id, false, "USD", 10_000) : null;
        });

        // An analyst opens a case on the circular-flow alert.
        var analyst = users["analyst@demo.test"];
        await As(root, analyst, null, async sp =>
        {
            var db = sp.GetRequiredService<AppDb>();
            var alert = await db.Alerts.OrderBy(a => a.CreatedAt).FirstOrDefaultAsync(a => a.RuleKey == "circular");
            if (alert == null) return null;
            var compliance = sp.GetRequiredService<ComplianceService>();
            var c = await compliance.OpenCase("user", alert.SubjectId, "Circular transfers between three wallets", "HIGH", [alert.Id]);
            await compliance.AddNote(c.Id, "observation", "Three wallets moved ~$1,300-1,500 in a loop within one hour. Counterparties were onboarded the same week.", finalize: true);
            if (alert.TransferId != null) await compliance.AddEvidence(c.Id, "transfer", alert.TransferId, "Closing transfer of the loop");
            return c;
        });

        await RunJobs(root);
        using (var s = root.CreateScope())
        {
            s.ServiceProvider.GetRequiredService<RequestContext>().IsSystem = true;
            await s.ServiceProvider.GetRequiredService<ReconciliationService>().Run("seed");
        }
        clock.Offset = TimeSpan.Zero;

        // Created last so seeding doesn't queue hundreds of deliveries to a listener that isn't running.
        await As(root, owner, org.Id, async sp => (await sp.GetRequiredService<MerchantService>().CreateWebhook("http://localhost:4242/webhooks", "payment.*,subscription.*,invoice.*,refund.*,dispute.*,payout.*", "Local dev listener (start one with the CLI or any HTTP server)", false)).Endpoint);

        Console.WriteLine();
        Console.WriteLine("Demo data ready. Sign in with password " + Password + " (sandbox only):");
        Console.WriteLine("  Merchant owner   owner@acme.test          (Acme AI Labs — approved, test mode)");
        Console.WriteLine("  Merchant team    dev@acme.test / fin@acme.test / help@acme.test");
        Console.WriteLine("  Pending merchant owner@pixelforge.test    (application under review)");
        Console.WriteLine("  Staff            admin@ compliance@ analyst@ finance@ support@ auditor@ demo.test");
        Console.WriteLine("  Wallet users     alice@ bob@ carol@ dave@ erin@ frank@ gina@ hugo@ wallet.test");
    }

    private static async Task<User> Reload(IServiceProvider sp, User u) => await sp.GetRequiredService<AppDb>().Users.FirstAsync(x => x.Id == u.Id);

    private static async Task RunJobs(IServiceProvider root)
    {
        var runner = root.GetRequiredService<JobRunner>();
        for (var i = 0; i < 3; i++) await runner.RunAll();
    }

    private static async Task<string> Token(IServiceProvider root, string card)
    {
        return await WithDb(root, async db =>
        {
            var t = new SimCardToken { Id = Ids.New("tok", 24), CreatedAt = DateTime.UtcNow, ProviderId = "vault" };
            if (card.StartsWith("upi:"))
            {
                var vpa = card[4..];
                (t.Type, t.Behavior, t.Brand, t.Last4, t.Country, t.Fingerprint) = ("upi", SimulatorProvider.TestUpi[vpa], "upi", vpa[..4], "IN", Crypto.Sha256Hex(vpa));
            }
            else
            {
                var (behavior, brand, country) = SimulatorProvider.TestCards[card];
                (t.Type, t.Behavior, t.Brand, t.Last4, t.Country, t.ExpMonth, t.ExpYear, t.Fingerprint) = ("card", behavior, brand, card[^4..], country, 12, 2031, Crypto.Sha256Hex(card + Guid.NewGuid()));
            }
            db.SimTokens.Add(t);
            await db.SaveChangesAsync();
            return t.Id;
        });
    }

    private static async Task<string?> Checkout(IServiceProvider root, User owner, string orgId, string mode, string priceId, long qty, string country, string email, string name, string card, string? coupon)
    {
        var token = await Token(root, card);
        return await As(root, owner, orgId, async sp =>
        {
            var checkout = sp.GetRequiredService<CheckoutService>();
            var s = await checkout.Create(mode, [new LineRequest(priceId, qty)], null, email, country, coupon, "https://acme-writer.example/thanks", null, null, null, null);
            var ctx = sp.GetRequiredService<RequestContext>();
            ctx.Ip = $"203.0.113.{Random.Shared.Next(1, 250)}";
            dynamic r = await checkout.Confirm(s, new ConfirmRequest(email, name, country, null, null, "b2c", token, true, coupon), ctx);
            return (string?)r.payment;
        });
    }

    private static async Task<T> WithDb<T>(IServiceProvider root, Func<AppDb, Task<T>> f)
    {
        using var scope = root.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDb>();
        db.Tenant.EnterSystem();
        return await f(db);
    }

    private static async Task WithDb(IServiceProvider root, Func<AppDb, Task> f) => await WithDb<bool>(root, async db => { await f(db); return true; });

    private static async Task<T> As<T>(IServiceProvider root, User? user, string? orgId, Func<IServiceProvider, Task<T>> f)
    {
        using var scope = root.CreateScope();
        var sp = scope.ServiceProvider;
        var ctx = sp.GetRequiredService<RequestContext>();
        ctx.User = user;
        var who = user?.Id ?? "anon";
        ctx.Ip = $"198.51.100.{(Math.Abs(who.GetHashCode()) % 200) + 20}";
        ctx.UserAgent = "Mozilla/5.0 (demo seed)";
        ctx.DeviceId = "dev-" + Crypto.Sha256Hex(who)[..12];
        if (user?.PlatformRole != null && Permissions.AdminRoles.TryGetValue(user.PlatformRole, out var perms)) ctx.AdminPermissions = perms.ToHashSet();
        if (orgId != null)
        {
            ctx.OrgId = orgId;
            ctx.MemberRole = "owner";
            ctx.Permissions = Permissions.MerchantRoles["owner"].ToHashSet();
            sp.GetRequiredService<TenantScope>().Set(orgId, false);
        }
        if (user == null && orgId == null) ctx.IsSystem = false;
        return await f(sp);
    }
}
