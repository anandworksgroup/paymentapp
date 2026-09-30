using Microsoft.EntityFrameworkCore;
using PaymentApp.Api.Common;
using PaymentApp.Api.Modules.Payments;

namespace PaymentApp.Api.Data;

/// <summary>
/// Creates the schema, installs append-only protections and loads reference configuration
/// (countries, tax rules, fees, providers, monitoring rules, limits, screening list). Idempotent.
/// All reference values are SAMPLE configuration for a sandbox and must be reviewed with tax, legal
/// and compliance counsel before any production use.
/// </summary>
public static class DbInit
{
    private static readonly string[] AppendOnlyTables = ["ledger_entries", "ledger_transactions", "audit_logs", "state_transitions", "credit_ledger_entries", "case_evidences", "data_access_logs", "accounting_periods"];

    public static async Task Initialize(AppDb db)
    {
        using var _ = db.Tenant.Elevate();
        await db.Database.EnsureCreatedAsync();
        if (db.Database.IsSqlite())
        {
            await db.Database.ExecuteSqlRawAsync("PRAGMA journal_mode=WAL;");
            await AddMissingColumns(db);
            foreach (var table in AppendOnlyTables)
            {
                // Financial history is append-only at the storage layer too (§40, §140, §337).
                await db.Database.ExecuteSqlRawAsync($"CREATE TRIGGER IF NOT EXISTS trg_{table}_no_update BEFORE UPDATE ON {table} BEGIN SELECT RAISE(ABORT, '{table} is append-only'); END;");
                await db.Database.ExecuteSqlRawAsync($"CREATE TRIGGER IF NOT EXISTS trg_{table}_no_delete BEFORE DELETE ON {table} BEGIN SELECT RAISE(ABORT, '{table} is append-only'); END;");
            }
            // Case notes are immutable once finalized (§163).
            await db.Database.ExecuteSqlRawAsync("CREATE TRIGGER IF NOT EXISTS trg_case_notes_final BEFORE UPDATE ON case_notes WHEN OLD.finalized = 1 BEGIN SELECT RAISE(ABORT, 'finalized case notes are immutable'); END;");
        }
        await SeedReference(db);
    }

    /// <summary>
    /// Development convenience: EnsureCreated doesn't evolve an existing SQLite file, so additive model
    /// changes (new nullable/defaulted columns) are applied in place. Production uses real migrations.
    /// </summary>
    private static async Task AddMissingColumns(AppDb db)
    {
        var conn = db.Database.GetDbConnection();
        if (conn.State != System.Data.ConnectionState.Open) await conn.OpenAsync();
        foreach (var entity in db.Model.GetEntityTypes())
        {
            var table = entity.GetTableName()!;
            var existing = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            await using (var cmd = conn.CreateCommand())
            {
                cmd.CommandText = $"PRAGMA table_info(\"{table}\")";
                await using var reader = await cmd.ExecuteReaderAsync();
                while (await reader.ReadAsync()) existing.Add(reader.GetString(1));
            }
            if (existing.Count == 0) continue;
            foreach (var prop in entity.GetProperties())
            {
                var column = prop.GetColumnName();
                if (existing.Contains(column)) continue;
                var type = prop.GetColumnType();
                var def = prop.IsNullable ? "" : type.Contains("INT", StringComparison.OrdinalIgnoreCase) || type.Contains("REAL", StringComparison.OrdinalIgnoreCase) ? " NOT NULL DEFAULT 0" : " NOT NULL DEFAULT ''";
                await using var alter = conn.CreateCommand();
                alter.CommandText = $"ALTER TABLE \"{table}\" ADD COLUMN \"{column}\" {type}{def}";
                await alter.ExecuteNonQueryAsync();
            }
        }
    }

    private static async Task SeedReference(AppDb db)
    {
        var now = DateTime.UtcNow;
        var epoch = new DateTime(2024, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        if (!await db.Countries.AnyAsync())
        {
            (string Code, string Name, string Currency, string Methods, bool Wallet, string Locale)[] countries =
            [
                ("US", "United States", "USD", "card", true, "en-US"), ("GB", "United Kingdom", "GBP", "card", true, "en-GB"),
                ("DE", "Germany", "EUR", "card", true, "de-DE"), ("FR", "France", "EUR", "card", true, "fr-FR"), ("NL", "Netherlands", "EUR", "card", true, "nl-NL"),
                ("IE", "Ireland", "EUR", "card", true, "en-IE"), ("ES", "Spain", "EUR", "card", true, "es-ES"), ("IT", "Italy", "EUR", "card", true, "it-IT"),
                ("IN", "India", "INR", "card,upi", true, "en-IN"), ("AU", "Australia", "AUD", "card", true, "en-AU"), ("CA", "Canada", "CAD", "card", true, "en-CA"),
                ("SG", "Singapore", "SGD", "card", true, "en-SG"), ("AE", "United Arab Emirates", "AED", "card", true, "en-AE"), ("BR", "Brazil", "BRL", "card", false, "pt-BR"),
                ("JP", "Japan", "JPY", "card", false, "ja-JP"),
            ];
            foreach (var c in countries)
                db.Countries.Add(new CountryCapability { Id = Ids.New("cc"), CreatedAt = now, Country = c.Code, Name = c.Name, DefaultCurrency = c.Currency, PaymentMethodsCsv = c.Methods, WalletEnabled = c.Wallet, Locale = c.Locale });
            // Comprehensively sanctioned jurisdictions are configured as unavailable (sample policy).
            foreach (var (code, name) in new[] { ("KP", "North Korea"), ("IR", "Iran"), ("SY", "Syria"), ("CU", "Cuba") })
                db.Countries.Add(new CountryCapability { Id = Ids.New("cc"), CreatedAt = now, Country = code, Name = name, CheckoutEnabled = false, WalletEnabled = false, PayoutsEnabled = false, MerchantOnboardingEnabled = false, Restrictions = "Comprehensive sanctions — not supported (sample policy)" });
        }
        if (!await db.TaxRules.AnyAsync())
        {
            (string C, string Type, int Bps, bool Rc, string Label)[] rules =
            [
                ("IN", "GST", 1800, false, "GST 18%"), ("GB", "VAT", 2000, true, "VAT 20%"), ("DE", "VAT", 1900, true, "MwSt 19%"), ("FR", "VAT", 2000, true, "TVA 20%"),
                ("NL", "VAT", 2100, true, "BTW 21%"), ("IE", "VAT", 2300, true, "VAT 23%"), ("ES", "VAT", 2100, true, "IVA 21%"), ("IT", "VAT", 2200, true, "IVA 22%"),
                ("AU", "GST", 1000, true, "GST 10%"), ("CA", "GST", 500, false, "GST 5%"), ("SG", "GST", 900, true, "GST 9%"), ("JP", "JCT", 1000, false, "JCT 10%"),
                ("AE", "VAT", 500, true, "VAT 5%"), ("US", "SALES_TAX", 0, false, "Sales tax (state rules not configured)"),
            ];
            foreach (var r in rules)
                db.TaxRules.Add(new TaxRule { Id = Ids.New("txr"), CreatedAt = now, Country = r.C, TaxType = r.Type, RateBps = r.Bps, ReverseChargeB2B = r.Rc, Label = r.Label, EffectiveFrom = epoch });
            // Category-specific example: e-books reduced rate in Germany.
            db.TaxRules.Add(new TaxRule { Id = Ids.New("txr"), CreatedAt = now, Country = "DE", TaxCategory = "ebook", TaxType = "VAT", RateBps = 700, ReverseChargeB2B = true, Label = "MwSt 7% (e-books)", EffectiveFrom = epoch });
        }
        if (!await db.FeeSchedules.AnyAsync())
        {
            db.FeeSchedules.Add(new FeeSchedule { Id = Ids.New("fee"), CreatedAt = now, PercentBps = 350, FixedMinor = 30, FixedCurrency = "USD", InternationalBps = 150, Priority = 100 });
            db.FeeSchedules.Add(new FeeSchedule { Id = Ids.New("fee"), CreatedAt = now, Method = "upi", PercentBps = 250, FixedMinor = 0, FixedCurrency = "USD", InternationalBps = 0, Priority = 50 });
        }
        if (!await db.Providers.AnyAsync())
        {
            db.Providers.Add(new Provider { Id = "sim_alpha", CreatedAt = now, Name = "Simulator Alpha (cards)", Priority = 10, MethodsCsv = "card", FeeBps = 200, FeeFixedMinor = 20, SettlementDays = 2 });
            db.Providers.Add(new Provider { Id = "sim_beta", CreatedAt = now, Name = "Simulator Beta (cards + UPI)", Priority = 20, MethodsCsv = "card,upi", FeeBps = 220, FeeFixedMinor = 15, SettlementDays = 1 });
            db.RoutingRules.Add(new RoutingRule { Id = Ids.New("rr"), CreatedAt = now, Country = "IN", Method = "upi", ProviderId = "sim_beta", Priority = 1 });
        }
        if (!await db.FxRates.AnyAsync())
            foreach (var (quote, rate) in FxTable.UsdRatesE9)
                db.FxRates.Add(new FxRate { Id = Ids.New("fx"), CreatedAt = now, Base = "USD", Quote = quote, RateE9 = rate, Source = "sandbox_reference_rates", AsOf = now });
        if (!await db.WalletLimits.AnyAsync())
        {
            db.WalletLimits.Add(new WalletLimit { Id = Ids.New("wl"), CreatedAt = now, KycLevel = 1, PerTransactionUsd = 100_000, DailyUsd = 200_000, MonthlyUsd = 1_000_000, MaxBalanceUsd = 500_000 });
            db.WalletLimits.Add(new WalletLimit { Id = Ids.New("wl"), CreatedAt = now, KycLevel = 2, PerTransactionUsd = 2_500_000, DailyUsd = 5_000_000, MonthlyUsd = 20_000_000, MaxBalanceUsd = 10_000_000 });
            db.WalletLimits.Add(new WalletLimit { Id = Ids.New("wl"), CreatedAt = now, KycLevel = 3, PerTransactionUsd = 10_000_000, DailyUsd = 25_000_000, MonthlyUsd = 100_000_000, MaxBalanceUsd = 50_000_000 });
        }
        if (!await db.MonitoringRules.AnyAsync())
        {
            (string Key, string Name, string Sev, string Action, string Params, string Desc)[] rules =
            [
                ("large_transaction", "Large transaction", "HIGH", "hold", "{\"usd_threshold\":1000000}", "Single movement at or above the review threshold."),
                ("velocity", "Velocity", "MEDIUM", "alert", "{\"count\":10,\"window_minutes\":60}", "Many outgoing transfers in a short window."),
                ("rapid_pass_through", "Rapid pass-through", "HIGH", "alert", "{\"window_minutes\":60,\"min_outflow_ratio_bps\":8000,\"min_usd\":100000}", "Funds leave soon after arriving."),
                ("fan_in", "Many-to-one", "MEDIUM", "alert", "{\"distinct_senders\":5,\"window_hours\":24}", "Many distinct senders to one recipient."),
                ("fan_out", "One-to-many", "MEDIUM", "alert", "{\"distinct_recipients\":5,\"window_hours\":24}", "One sender to many distinct recipients."),
                ("circular", "Circular flow", "HIGH", "alert", "{\"max_hops\":4,\"window_hours\":72}", "Funds return to the originating wallet."),
                ("dormant_reactivation", "Dormant reactivation", "MEDIUM", "alert", "{\"dormant_days\":90,\"min_usd\":50000}", "Large activity after long inactivity."),
                ("new_bank_withdrawal", "New bank → withdrawal", "HIGH", "hold", "{\"minutes\":60}", "Withdrawal to a just-added or shared bank account."),
                ("structuring", "Below-threshold pattern", "HIGH", "alert", "{\"usd_threshold\":1000000,\"band_bps\":1000,\"count\":3,\"window_hours\":24}", "Repeated amounts just under the review threshold."),
                ("account_takeover", "Account takeover pattern", "HIGH", "hold", "{\"minutes\":60,\"min_usd\":20000}", "Security changes followed by money movement."),
            ];
            foreach (var r in rules)
                db.MonitoringRules.Add(new MonitoringRule { Id = Ids.New("rule"), CreatedAt = now, Key = r.Key, Name = r.Name, Severity = r.Sev, Action = r.Action, ParamsJson = r.Params, Description = r.Desc });
        }
        if (!await db.ScreeningLists.AnyAsync())
        {
            // Synthetic entries only. Real deployments load official lists (UN, OFAC, EU, UK, national) through a screening provider.
            var list = new ScreeningList { Id = Ids.New("slist"), CreatedAt = now, Name = "Sandbox consolidated test list", Source = "synthetic test data", Version = "2026.09.30" };
            db.ScreeningLists.Add(list);
            db.ScreeningEntries.AddRange(
                new ScreeningEntry { Id = Ids.New("sent"), CreatedAt = now, ListId = list.Id, Name = "Viktor Testovich Blocked", AliasesCsv = "Viktor Blocked|V. T. Blocked", DateOfBirth = "1971-03-02", Country = "ZZ", Program = "TEST-SANCTIONS" },
                new ScreeningEntry { Id = Ids.New("sent"), CreatedAt = now, ListId = list.Id, Name = "Globex Embargo Trading LLC", EntryType = "entity", Country = "ZZ", Program = "TEST-SANCTIONS" },
                new ScreeningEntry { Id = Ids.New("sent"), CreatedAt = now, ListId = list.Id, Name = "Marta Exampleperson", DateOfBirth = "1965-07-14", Country = "ZZ", Program = "PEP (sample)" },
                new ScreeningEntry { Id = Ids.New("sent"), CreatedAt = now, ListId = list.Id, Name = "Ivan Sampleblock", AliasesCsv = "Ivan Sample Block", DateOfBirth = "1980-01-01", Country = "ZZ", Program = "TEST-SANCTIONS" });
        }
        if (!await db.FeatureFlags.AnyAsync())
            foreach (var (key, desc) in new[]
                     {
                         ("copilot", "AI financial copilot in the merchant dashboard"),
                         ("marketplace", "Connected sellers with split settlement"),
                         ("experiments", "Checkout A/B experiments on payment links"),
                         ("wallet_exchange", "Converting between a user's own wallet balances"),
                         ("custom_domains", "Merchant-verified custom checkout domains"),
                     })
                db.FeatureFlags.Add(new FeatureFlag { Id = Ids.New("flag"), CreatedAt = now, UpdatedAt = now, Key = key, Description = desc });
        if (!await db.LegalDocuments.AnyAsync())
        {
            db.LegalDocuments.Add(new LegalDocument { Id = Ids.New("ldoc"), CreatedAt = now, Key = "terms", Version = 1, Title = "Buyer Terms (sandbox)", EffectiveAt = epoch, Body = "Sample buyer terms for the sandbox. The platform sells as Merchant of Record. Replace with counsel-approved terms before launch." });
            db.LegalDocuments.Add(new LegalDocument { Id = Ids.New("ldoc"), CreatedAt = now, Key = "privacy", Version = 1, Title = "Privacy Notice (sandbox)", EffectiveAt = epoch, Body = "Sample privacy notice." });
            db.LegalDocuments.Add(new LegalDocument { Id = Ids.New("ldoc"), CreatedAt = now, Key = "refund_policy", Version = 1, Title = "Refund Policy (sandbox)", EffectiveAt = epoch, Body = "Sample refund policy." });
        }
        await db.SaveChangesAsync();
    }
}
