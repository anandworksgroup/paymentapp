using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using PaymentApp.Api.Common;

namespace PaymentApp.Api.Data;

/// <summary>
/// The current tenant for this unit of work. Request code gets it from authentication; background jobs
/// use <see cref="EnterSystem"/> explicitly, which is the only way to read across tenants.
/// </summary>
public class TenantScope
{
    public string? OrgId { get; private set; }
    public bool Livemode { get; private set; }
    public bool System { get; private set; }

    public void Set(string orgId, bool livemode) { OrgId = orgId; Livemode = livemode; System = false; }
    public void EnterSystem() { System = true; }
    public void Clear() { OrgId = null; System = false; }

    /// <summary>Temporarily acts as a specific tenant (e.g. processing a provider webhook for its payment).</summary>
    public IDisposable Use(string orgId, bool livemode)
    {
        var (o, l, s) = (OrgId, Livemode, System);
        Set(orgId, livemode);
        return new Restore(() => { OrgId = o; Livemode = l; System = s; });
    }

    /// <summary>Temporarily reads across tenants. Only platform jobs and admin endpoints use this.</summary>
    public IDisposable Elevate()
    {
        var s = System;
        System = true;
        return new Restore(() => System = s);
    }

    private sealed class Restore(Action undo) : IDisposable
    {
        private bool _done;
        public void Dispose() { if (_done) return; _done = true; undo(); }
    }
}

public class AppDb(DbContextOptions<AppDb> options, TenantScope tenant) : DbContext(options)
{
    public TenantScope Tenant { get; } = tenant;

    public DbSet<User> Users => Set<User>();
    public DbSet<Session> Sessions => Set<Session>();
    public DbSet<Device> Devices => Set<Device>();
    public DbSet<SecurityEvent> SecurityEvents => Set<SecurityEvent>();
    public DbSet<Organization> Organizations => Set<Organization>();
    public DbSet<Membership> Memberships => Set<Membership>();
    public DbSet<ApiKey> ApiKeys => Set<ApiKey>();
    public DbSet<MerchantApplication> MerchantApplications => Set<MerchantApplication>();
    public DbSet<BeneficialOwner> BeneficialOwners => Set<BeneficialOwner>();
    public DbSet<StoredFile> Files => Set<StoredFile>();
    public DbSet<PayoutDestination> PayoutDestinations => Set<PayoutDestination>();
    public DbSet<Product> Products => Set<Product>();
    public DbSet<Price> Prices => Set<Price>();
    public DbSet<Coupon> Coupons => Set<Coupon>();
    public DbSet<LegalDocument> LegalDocuments => Set<LegalDocument>();
    public DbSet<Customer> Customers => Set<Customer>();
    public DbSet<PaymentMethod> PaymentMethods => Set<PaymentMethod>();
    public DbSet<Entitlement> Entitlements => Set<Entitlement>();
    public DbSet<CheckoutSession> CheckoutSessions => Set<CheckoutSession>();
    public DbSet<PaymentLink> PaymentLinks => Set<PaymentLink>();
    public DbSet<Order> Orders => Set<Order>();
    public DbSet<Payment> Payments => Set<Payment>();
    public DbSet<PaymentAttempt> PaymentAttempts => Set<PaymentAttempt>();
    public DbSet<Refund> Refunds => Set<Refund>();
    public DbSet<Dispute> Disputes => Set<Dispute>();
    public DbSet<DisputeEvidence> DisputeEvidence => Set<DisputeEvidence>();
    public DbSet<Provider> Providers => Set<Provider>();
    public DbSet<ProviderHealthSample> ProviderHealthSamples => Set<ProviderHealthSample>();
    public DbSet<RoutingRule> RoutingRules => Set<RoutingRule>();
    public DbSet<ProviderEvent> ProviderEvents => Set<ProviderEvent>();
    public DbSet<SimProviderRecord> SimProviderRecords => Set<SimProviderRecord>();
    public DbSet<SimCardToken> SimTokens => Set<SimCardToken>();
    public DbSet<LedgerAccount> LedgerAccounts => Set<LedgerAccount>();
    public DbSet<LedgerTransaction> LedgerTransactions => Set<LedgerTransaction>();
    public DbSet<LedgerEntry> LedgerEntries => Set<LedgerEntry>();
    public DbSet<BalanceTransaction> BalanceTransactions => Set<BalanceTransaction>();
    public DbSet<Adjustment> Adjustments => Set<Adjustment>();
    public DbSet<FeeSchedule> FeeSchedules => Set<FeeSchedule>();
    public DbSet<Subscription> Subscriptions => Set<Subscription>();
    public DbSet<SubscriptionItem> SubscriptionItems => Set<SubscriptionItem>();
    public DbSet<Invoice> Invoices => Set<Invoice>();
    public DbSet<InvoiceLine> InvoiceLines => Set<InvoiceLine>();
    public DbSet<CreditNote> CreditNotes => Set<CreditNote>();
    public DbSet<Meter> Meters => Set<Meter>();
    public DbSet<UsageEvent> UsageEvents => Set<UsageEvent>();
    public DbSet<CreditLedgerEntry> CreditLedger => Set<CreditLedgerEntry>();
    public DbSet<TestClock> TestClocks => Set<TestClock>();
    public DbSet<Payout> Payouts => Set<Payout>();
    public DbSet<ReconRun> ReconRuns => Set<ReconRun>();
    public DbSet<ReconException> ReconExceptions => Set<ReconException>();
    public DbSet<TaxRule> TaxRules => Set<TaxRule>();
    public DbSet<TaxRecord> TaxRecords => Set<TaxRecord>();
    public DbSet<CountryCapability> Countries => Set<CountryCapability>();
    public DbSet<Event> Events => Set<Event>();
    public DbSet<OutboxMessage> Outbox => Set<OutboxMessage>();
    public DbSet<WebhookEndpoint> WebhookEndpoints => Set<WebhookEndpoint>();
    public DbSet<WebhookDelivery> WebhookDeliveries => Set<WebhookDelivery>();
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<EmailTemplate> EmailTemplates => Set<EmailTemplate>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
    public DbSet<StateTransition> StateTransitions => Set<StateTransition>();
    public DbSet<DataAccessLog> DataAccessLogs => Set<DataAccessLog>();
    public DbSet<IdempotencyRecord> IdempotencyRecords => Set<IdempotencyRecord>();
    public DbSet<ApiRequestLog> ApiRequestLogs => Set<ApiRequestLog>();
    public DbSet<Wallet> Wallets => Set<Wallet>();
    public DbSet<WalletHold> WalletHolds => Set<WalletHold>();
    public DbSet<BankAccount> BankAccounts => Set<BankAccount>();
    public DbSet<Transfer> Transfers => Set<Transfer>();
    public DbSet<FxQuote> FxQuotes => Set<FxQuote>();
    public DbSet<FxRate> FxRates => Set<FxRate>();
    public DbSet<WalletLimit> WalletLimits => Set<WalletLimit>();
    public DbSet<MonitoringRule> MonitoringRules => Set<MonitoringRule>();
    public DbSet<Alert> Alerts => Set<Alert>();
    public DbSet<ComplianceCase> Cases => Set<ComplianceCase>();
    public DbSet<CaseNote> CaseNotes => Set<CaseNote>();
    public DbSet<CaseEvidence> CaseEvidence => Set<CaseEvidence>();
    public DbSet<ApprovalRequest> Approvals => Set<ApprovalRequest>();
    public DbSet<ScreeningList> ScreeningLists => Set<ScreeningList>();
    public DbSet<ScreeningEntry> ScreeningEntries => Set<ScreeningEntry>();
    public DbSet<ScreeningCheck> ScreeningChecks => Set<ScreeningCheck>();
    public DbSet<KycCheck> KycChecks => Set<KycCheck>();
    public DbSet<CopilotAction> CopilotActions => Set<CopilotAction>();
    public DbSet<AffiliateAccount> Affiliates => Set<AffiliateAccount>();
    public DbSet<AffiliateReferral> AffiliateReferrals => Set<AffiliateReferral>();
    public DbSet<AffiliateCommission> AffiliateCommissions => Set<AffiliateCommission>();
    public DbSet<CustomerBudget> CustomerBudgets => Set<CustomerBudget>();
    public DbSet<Experiment> Experiments => Set<Experiment>();
    public DbSet<Brand> Brands => Set<Brand>();
    public DbSet<Seller> Sellers => Set<Seller>();
    public DbSet<SellerBalanceTransaction> SellerBalanceTransactions => Set<SellerBalanceTransaction>();
    public DbSet<SellerPayout> SellerPayouts => Set<SellerPayout>();
    public DbSet<AccountingPeriod> AccountingPeriods => Set<AccountingPeriod>();
    public DbSet<ImportJob> Imports => Set<ImportJob>();
    public DbSet<CustomDomain> Domains => Set<CustomDomain>();
    public DbSet<SupportTicket> SupportTickets => Set<SupportTicket>();
    public DbSet<TicketMessage> TicketMessages => Set<TicketMessage>();
    public DbSet<Incident> Incidents => Set<Incident>();
    public DbSet<IncidentUpdate> IncidentUpdates => Set<IncidentUpdate>();
    public DbSet<FeatureFlag> FeatureFlags => Set<FeatureFlag>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        var utc = new ValueConverter<DateTime, DateTime>(v => v.Kind == DateTimeKind.Utc ? v : v.ToUniversalTime(), v => DateTime.SpecifyKind(v, DateTimeKind.Utc));
        var utcNullable = new ValueConverter<DateTime?, DateTime?>(v => v.HasValue ? (v.Value.Kind == DateTimeKind.Utc ? v : v.Value.ToUniversalTime()) : v, v => v.HasValue ? DateTime.SpecifyKind(v.Value, DateTimeKind.Utc) : v);

        foreach (var entity in b.Model.GetEntityTypes())
        {
            entity.SetTableName(Pluralize(ToSnake(entity.ClrType.Name)));
            foreach (var p in entity.GetProperties())
            {
                p.SetColumnName(ToSnake(p.Name));
                if (p.ClrType == typeof(DateTime)) p.SetValueConverter(utc);
                if (p.ClrType == typeof(DateTime?)) p.SetValueConverter(utcNullable);
            }
        }

        b.Entity<AuditLog>().HasKey(a => a.Seq);
        b.Entity<AuditLog>().HasIndex(a => a.Id).IsUnique();
        b.Entity<AuditLog>().HasIndex(a => new { a.ObjectType, a.ObjectId });
        b.Entity<AuditLog>().HasIndex(a => a.ActorId);
        b.Entity<OutboxMessage>().HasIndex(o => o.ProcessedAt);
        b.Entity<IdempotencyRecord>().HasIndex(i => new { i.Scope, i.Key }).IsUnique();
        b.Entity<ApiRequestLog>().HasIndex(r => new { r.OrgId, r.At });

        b.Entity<User>().HasIndex(u => u.Email).IsUnique();
        b.Entity<Session>().HasIndex(s => s.TokenHash).IsUnique();
        b.Entity<Membership>().HasIndex(m => new { m.OrgId, m.UserId }).IsUnique();
        b.Entity<ApiKey>().HasIndex(k => k.KeyHash).IsUnique();
        b.Entity<Device>().HasIndex(d => new { d.UserId, d.Fingerprint }).IsUnique();
        b.Entity<Customer>().HasIndex(c => new { c.OrgId, c.Livemode, c.Email });
        b.Entity<Coupon>().HasIndex(c => new { c.OrgId, c.Livemode, c.Code }).IsUnique();
        b.Entity<Payment>().HasIndex(p => new { p.OrgId, p.Livemode, p.CreatedAt });
        b.Entity<Payment>().Property(p => p.Version).IsConcurrencyToken();
        b.Entity<Subscription>().Property(s => s.Version).IsConcurrencyToken();
        b.Entity<PaymentAttempt>().HasIndex(a => a.PaymentId);
        b.Entity<Refund>().HasIndex(r => r.PaymentId);
        b.Entity<ProviderEvent>().HasIndex(e => new { e.ProviderId, e.ProviderEventId }).IsUnique();
        b.Entity<SimProviderRecord>().HasIndex(r => new { r.ProviderId, r.ProviderReference }).IsUnique();
        b.Entity<LedgerAccount>().HasIndex(a => new { a.OwnerType, a.OwnerId, a.Code, a.Currency, a.Livemode }).IsUnique();
        b.Entity<LedgerTransaction>().HasIndex(t => t.PostingKey).IsUnique();
        b.Entity<LedgerTransaction>().HasIndex(t => new { t.SourceType, t.SourceId });
        b.Entity<LedgerEntry>().HasIndex(e => e.AccountId);
        b.Entity<LedgerEntry>().HasIndex(e => e.TransactionId);
        b.Entity<BalanceTransaction>().HasIndex(t => new { t.OrgId, t.Livemode, t.Status, t.AvailableOn });
        b.Entity<UsageEvent>().HasIndex(e => new { e.OrgId, e.Livemode, e.IdempotencyKey }).IsUnique();
        b.Entity<UsageEvent>().HasIndex(e => new { e.CustomerId, e.EventName, e.Timestamp });
        b.Entity<CreditLedgerEntry>().HasIndex(e => new { e.OrgId, e.Livemode, e.IdempotencyKey }).IsUnique();
        b.Entity<CreditLedgerEntry>().HasIndex(e => new { e.CustomerId, e.CreditType });
        b.Entity<Invoice>().HasIndex(i => new { i.OrgId, i.Livemode, i.Number }).IsUnique();
        b.Entity<InvoiceLine>().HasIndex(l => l.InvoiceId);
        b.Entity<Event>().HasIndex(e => new { e.OrgId, e.Livemode, e.Sequence });
        b.Entity<Event>().HasIndex(e => new { e.ObjectType, e.ObjectId });
        b.Entity<WebhookDelivery>().HasIndex(d => new { d.Status, d.NextAttemptAt });
        b.Entity<StateTransition>().HasIndex(t => new { t.ObjectType, t.ObjectId });
        b.Entity<Transfer>().HasIndex(t => t.SenderWalletId);
        b.Entity<Transfer>().HasIndex(t => t.RecipientWalletId);
        b.Entity<Wallet>().HasIndex(w => new { w.OwnerType, w.OwnerId }).IsUnique();
        b.Entity<Wallet>().HasIndex(w => w.Handle).IsUnique();
        b.Entity<BankAccount>().HasIndex(a => a.Fingerprint);
        b.Entity<Alert>().HasIndex(a => a.DedupeKey).IsUnique();
        b.Entity<TaxRule>().HasIndex(r => new { r.Country, r.Version });
        b.Entity<CountryCapability>().HasIndex(c => c.Country).IsUnique();
        b.Entity<FxRate>().HasIndex(r => new { r.Base, r.Quote, r.AsOf });
        b.Entity<AffiliateAccount>().HasIndex(a => new { a.OrgId, a.Livemode, a.Code }).IsUnique();
        b.Entity<AffiliateReferral>().HasIndex(r => new { r.OrgId, r.Livemode, r.CustomerId }).IsUnique();
        b.Entity<AffiliateCommission>().HasIndex(c => new { c.PaymentId, c.AffiliateId }).IsUnique();
        b.Entity<AccountingPeriod>().HasIndex(p => new { p.OrgId, p.Livemode, p.Period }).IsUnique();
        b.Entity<CustomDomain>().HasIndex(d => d.Hostname);
        b.Entity<FeatureFlag>().HasIndex(f => f.Key).IsUnique();
        b.Entity<TicketMessage>().HasIndex(m => m.TicketId);

        // Server-side tenant isolation: every merchant-owned query is scoped by org and mode.
        ApplyTenantFilter<Product>(b); ApplyTenantFilter<Price>(b); ApplyTenantFilter<Coupon>(b);
        ApplyTenantFilter<Customer>(b); ApplyTenantFilter<PaymentMethod>(b); ApplyTenantFilter<Entitlement>(b);
        ApplyTenantFilter<CheckoutSession>(b); ApplyTenantFilter<PaymentLink>(b); ApplyTenantFilter<Order>(b);
        ApplyTenantFilter<Payment>(b); ApplyTenantFilter<PaymentAttempt>(b); ApplyTenantFilter<Refund>(b);
        ApplyTenantFilter<Dispute>(b); ApplyTenantFilter<DisputeEvidence>(b); ApplyTenantFilter<BalanceTransaction>(b);
        ApplyTenantFilter<Subscription>(b); ApplyTenantFilter<SubscriptionItem>(b); ApplyTenantFilter<Invoice>(b);
        ApplyTenantFilter<InvoiceLine>(b); ApplyTenantFilter<CreditNote>(b); ApplyTenantFilter<Meter>(b);
        ApplyTenantFilter<UsageEvent>(b); ApplyTenantFilter<CreditLedgerEntry>(b); ApplyTenantFilter<TestClock>(b);
        ApplyTenantFilter<Payout>(b); ApplyTenantFilter<TaxRecord>(b); ApplyTenantFilter<WebhookEndpoint>(b);
        ApplyTenantFilter<WebhookDelivery>(b); ApplyTenantFilter<CopilotAction>(b); ApplyTenantFilter<AffiliateAccount>(b); ApplyTenantFilter<AffiliateReferral>(b); ApplyTenantFilter<AffiliateCommission>(b); ApplyTenantFilter<CustomerBudget>(b); ApplyTenantFilter<Experiment>(b); ApplyTenantFilter<SellerBalanceTransaction>(b); ApplyTenantFilter<SellerPayout>(b); ApplyTenantFilter<AccountingPeriod>(b); ApplyTenantFilter<ImportJob>(b);
        ApplyOrgFilter<MerchantApplication>(b); ApplyOrgFilter<BeneficialOwner>(b); ApplyOrgFilter<PayoutDestination>(b); ApplyOrgFilter<Brand>(b); ApplyOrgFilter<Seller>(b); ApplyOrgFilter<CustomDomain>(b);
    }

    private void ApplyTenantFilter<T>(ModelBuilder b) where T : TenantEntity =>
        b.Entity<T>().HasQueryFilter(e => Tenant.System || (e.OrgId == Tenant.OrgId && e.Livemode == Tenant.Livemode));

    private void ApplyOrgFilter<T>(ModelBuilder b) where T : TenantEntityNoMode =>
        b.Entity<T>().HasQueryFilter(e => Tenant.System || e.OrgId == Tenant.OrgId);

    public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        foreach (var entry in ChangeTracker.Entries())
        {
            if (entry.State != EntityState.Added && entry.State != EntityState.Modified) continue;
            if (entry.Entity is TenantEntity t && entry.State == EntityState.Added && !Tenant.System)
            {
                if (string.IsNullOrEmpty(t.OrgId)) { t.OrgId = Tenant.OrgId ?? throw new InvalidOperationException("No tenant in scope."); t.Livemode = Tenant.Livemode; }
                else if (t.OrgId != Tenant.OrgId || t.Livemode != Tenant.Livemode) throw new InvalidOperationException("Cross-tenant write rejected.");
            }
            if (entry.Entity is TenantEntityNoMode n && entry.State == EntityState.Added && !Tenant.System)
            {
                if (string.IsNullOrEmpty(n.OrgId)) n.OrgId = Tenant.OrgId ?? throw new InvalidOperationException("No tenant in scope.");
                else if (n.OrgId != Tenant.OrgId) throw new InvalidOperationException("Cross-tenant write rejected.");
            }
            if (entry.Entity is Entity e && entry.State == EntityState.Added && e.CreatedAt == default) e.CreatedAt = DateTime.UtcNow;
            // Optimistic concurrency (§240, §241): concurrent writers to the same payment/subscription conflict.
            if (entry.State == EntityState.Modified && entry.Entity is Payment pay) pay.Version++;
            if (entry.State == EntityState.Modified && entry.Entity is Subscription sub) sub.Version++;
        }
        return base.SaveChangesAsync(cancellationToken);
    }

    public static string Pluralize(string s) =>
        s.EndsWith('y') && !"aeiou".Contains(s[^2]) ? s[..^1] + "ies"
        : s.EndsWith('s') || s.EndsWith('x') || s.EndsWith("ch") || s.EndsWith("sh") ? s + "es"
        : s + "s";

    public static string ToSnake(string name)
    {
        var sb = new StringBuilder();
        for (var i = 0; i < name.Length; i++)
        {
            var c = name[i];
            if (char.IsUpper(c))
            {
                if (i > 0 && (char.IsLower(name[i - 1]) || (i + 1 < name.Length && char.IsLower(name[i + 1])))) sb.Append('_');
                sb.Append(char.ToLowerInvariant(c));
            }
            else sb.Append(c);
        }
        return sb.ToString();
    }
}
