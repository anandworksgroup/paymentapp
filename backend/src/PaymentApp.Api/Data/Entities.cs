using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;
using System.Text.Json.Serialization;
using PaymentApp.Api.Common;

namespace PaymentApp.Api.Data;

// Conventions:
//  * No navigation properties; objects reference each other by prefixed id (the API object graph, §319).
//  * TenantEntity rows are merchant-owned and carry org_id + livemode; a global query filter makes
//    cross-tenant reads impossible from request code (§81, §195).
//  * JSON columns end in "Json", are hidden, and are re-exposed as raw JSON through [NotMapped] getters.

public abstract class Entity
{
    public string Id { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    [NotMapped] public abstract string Object { get; }
}

public abstract class TenantEntity : Entity
{
    public string OrgId { get; set; } = "";
    public bool Livemode { get; set; }
}

public interface IHasMetadata
{
    string? MetadataJson { get; set; }
}

// ───────────────────────────── Identity ─────────────────────────────

public class User : Entity
{
    public override string Object => "user";
    public string Email { get; set; } = "";
    public bool EmailVerified { get; set; }
    [JsonIgnore] public string PasswordHash { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Phone { get; set; }
    public string? Country { get; set; }
    public string? DateOfBirth { get; set; }
    public string? Nationality { get; set; }
    public string? Address { get; set; }
    /// <summary>Internal platform role (SUPER_ADMIN, COMPLIANCE_ADMIN, …); null for merchants and customers.</summary>
    public string? PlatformRole { get; set; }
    /// <summary>Account restriction state (§69): NORMAL, LIMITED, PAYMENTS_DISABLED, TRANSFERS_DISABLED, WITHDRAWALS_DISABLED, COMPLIANCE_HOLD, FROZEN, CLOSED.</summary>
    public string Status { get; set; } = "NORMAL";
    public int KycLevel { get; set; }
    public string KycStatus { get; set; } = "NOT_STARTED";
    public DateTime? KycVerifiedAt { get; set; }
    public int RiskScore { get; set; }
    public string RiskLevel { get; set; } = "low";
    [JsonIgnore] public string? MfaSecretEnc { get; set; }
    public bool MfaEnabled { get; set; }
    [JsonIgnore] public string? RecoveryCodesJson { get; set; }
    public DateTime? LastLoginAt { get; set; }
    public DateTime? LastActivityAt { get; set; }
    public DateTime? DeletedAt { get; set; }
}

public class Session : Entity
{
    public override string Object => "session";
    public string UserId { get; set; } = "";
    [JsonIgnore] public string TokenHash { get; set; } = "";
    public DateTime ExpiresAt { get; set; }
    public DateTime? RevokedAt { get; set; }
    public DateTime? StepUpUntil { get; set; }
    public bool MfaPending { get; set; }
    public string? Ip { get; set; }
    public string? UserAgent { get; set; }
    public string? DeviceId { get; set; }
    public DateTime LastSeenAt { get; set; }
}

public class Device : Entity
{
    public override string Object => "device";
    public string UserId { get; set; } = "";
    public string Fingerprint { get; set; } = "";
    public string? UserAgent { get; set; }
    public string? Platform { get; set; }
    public string? LastIp { get; set; }
    public string? LastCountry { get; set; }
    public DateTime LastSeenAt { get; set; }
}

public class SecurityEvent : Entity
{
    public override string Object => "security_event";
    public string? UserId { get; set; }
    public string? OrgId { get; set; }
    public string Type { get; set; } = "";
    public string? Ip { get; set; }
    public string? DeviceId { get; set; }
    public string? Detail { get; set; }
}

public class Organization : Entity
{
    public override string Object => "organization";
    public string Name { get; set; } = "";
    public string Country { get; set; } = "US";
    public string DefaultCurrency { get; set; } = "USD";
    /// <summary>Merchant lifecycle (§9): UNREGISTERED … APPROVED, RESTRICTED, SUSPENDED, REJECTED, CLOSED.</summary>
    public string Status { get; set; } = "APPLICATION_STARTED";
    /// <summary>Go-live control (§224): TEST → READY → PRODUCTION.</summary>
    public string GoLiveState { get; set; } = "TEST";
    /// <summary>Operational restriction (§68-69): NORMAL, ENHANCED_MONITORING, PAYOUT_HOLD, PAYMENTS_DISABLED, SUSPENDED, …</summary>
    public string Restriction { get; set; } = "NORMAL";
    public int RiskScore { get; set; }
    public string RiskLevel { get; set; } = "low";
    public string? SupportEmail { get; set; }
    public string? Website { get; set; }
    public string? BrandColor { get; set; }
    public string? LogoUrl { get; set; }
    public string PayoutSchedule { get; set; } = "daily";
    public int SettlementDelayDays { get; set; } = 2;
    public int ReserveBps { get; set; }
    public int ReserveHoldDays { get; set; } = 90;
    public long MinimumPayoutMinor { get; set; } = 100;
    public string InvoicePrefix { get; set; } = "";
    public long InvoiceSequence { get; set; }
    public string DunningRetryDaysCsv { get; set; } = "1,3,5,7";
    public string DunningFinalAction { get; set; } = "cancel";
    public int DunningGraceDays { get; set; } = 3;
    /// <summary>Retention (§257): coupon offered when a customer starts to cancel; null = no discount offer.</summary>
    public string? RetentionCouponId { get; set; }
    public bool RetentionOfferPause { get; set; } = true;
    public DateTime? ClosedAt { get; set; }
}

public class Membership : Entity
{
    public override string Object => "membership";
    public string OrgId { get; set; } = "";
    public string UserId { get; set; } = "";
    public string Role { get; set; } = "owner";
}

public class ApiKey : Entity
{
    public override string Object => "api_key";
    public string OrgId { get; set; } = "";
    public bool Livemode { get; set; }
    /// <summary>publishable | secret | restricted.</summary>
    public string Type { get; set; } = "secret";
    public string Name { get; set; } = "";
    public string DisplayKey { get; set; } = "";
    [JsonIgnore] public string KeyHash { get; set; } = "";
    /// <summary>Publishable keys are not secret, so they are also kept in the clear for lookups.</summary>
    public string? PublishableValue { get; set; }
    [JsonIgnore] public string? PermissionsJson { get; set; }
    [NotMapped] public JsonElement? Permissions => Json.Raw(PermissionsJson);
    public string? AllowedIpsCsv { get; set; }
    public string? CreatedBy { get; set; }
    public DateTime? RevokedAt { get; set; }
    public DateTime? LastUsedAt { get; set; }
}

// ───────────────────────── Onboarding / KYB ─────────────────────────

public class MerchantApplication : TenantEntityNoMode
{
    public override string Object => "merchant_application";
    public string Status { get; set; } = "APPLICATION_STARTED";
    public string? LegalName { get; set; }
    public string? TradingName { get; set; }
    public string? Website { get; set; }
    public string? BusinessType { get; set; }
    public string? Industry { get; set; }
    public string? Country { get; set; }
    public string? RegisteredAddress { get; set; }
    public string? OperatingAddress { get; set; }
    public string? RegistrationNumber { get; set; }
    public string? TaxNumber { get; set; }
    public string? ContactEmail { get; set; }
    public string? ContactPhone { get; set; }
    public string? ProductDescription { get; set; }
    public string? CustomerType { get; set; }
    public long? AverageOrderMinor { get; set; }
    public long? ExpectedMonthlyVolumeMinor { get; set; }
    public string? CountriesServedCsv { get; set; }
    public string? RefundPolicyUrl { get; set; }
    public string? TermsUrl { get; set; }
    public string? PrivacyUrl { get; set; }
    public DateTime? SubmittedAt { get; set; }
    public DateTime? DecidedAt { get; set; }
    public string? DecidedBy { get; set; }
    public string? DecisionReason { get; set; }
    public int RiskScore { get; set; }
    [JsonIgnore] public string? ChecksJson { get; set; }
    [NotMapped] public JsonElement? Checks => Json.Raw(ChecksJson);
    public string? RequiredActions { get; set; }
    public DateTime UpdatedAt { get; set; }
}

/// <summary>Org-owned but not split by test/live mode (onboarding, team, payout destinations).</summary>
public abstract class TenantEntityNoMode : Entity
{
    public string OrgId { get; set; } = "";
}

public class BeneficialOwner : TenantEntityNoMode
{
    public override string Object => "beneficial_owner";
    public string Name { get; set; } = "";
    public string? DateOfBirth { get; set; }
    public string? Nationality { get; set; }
    public string? Country { get; set; }
    public int OwnershipBps { get; set; }
    /// <summary>director | controller | owner | representative.</summary>
    public string Relationship { get; set; } = "owner";
    public string VerificationStatus { get; set; } = "pending";
    public string ScreeningStatus { get; set; } = "not_screened";
}

public class StoredFile : Entity
{
    public override string Object => "file";
    public string? OrgId { get; set; }
    public string? UserId { get; set; }
    public string Purpose { get; set; } = "";
    public string FileName { get; set; } = "";
    public string ContentType { get; set; } = "";
    public long Size { get; set; }
    public string Sha256 { get; set; } = "";
    [JsonIgnore] public string StoragePath { get; set; } = "";
    public string? UploadedBy { get; set; }
    /// <summary>not_scanned | clean | infected — "not_scanned" until a malware-scanner adapter is configured.</summary>
    public string ScanStatus { get; set; } = "not_scanned";
    public bool Livemode { get; set; }
    public string? LinkedObjectId { get; set; }
}

public class PayoutDestination : TenantEntityNoMode
{
    public override string Object => "payout_destination";
    public string BankCountry { get; set; } = "";
    public string Currency { get; set; } = "";
    public string AccountHolder { get; set; } = "";
    public string? BankName { get; set; }
    [JsonIgnore] public string AccountNumberEnc { get; set; } = "";
    public string Last4 { get; set; } = "";
    public string? RoutingNumber { get; set; }
    public string? Swift { get; set; }
    public string Status { get; set; } = "verified";
    public bool IsDefault { get; set; }
}

// ───────────────────────────── Catalog ─────────────────────────────

public class Product : TenantEntity, IHasMetadata
{
    public override string Object => "product";
    public string Name { get; set; } = "";
    public string? Description { get; set; }
    /// <summary>draft | active | archived (§12, §185).</summary>
    public string Status { get; set; } = "active";
    /// <summary>saas, digital, subscription, api, membership, course, download, service, license, credit_package, usage.</summary>
    public string Type { get; set; } = "saas";
    /// <summary>Tax category drives the tax engine (digital_service, saas, ebook, general).</summary>
    public string TaxCategory { get; set; } = "digital_service";
    public string DeliveryType { get; set; } = "access";
    public string? BrandId { get; set; }
    public string? ImageUrl { get; set; }
    public string? FeaturesCsv { get; set; }
    [JsonIgnore] public string? MetadataJson { get; set; }
    [NotMapped] public JsonElement? Metadata => Json.Raw(MetadataJson);
    public DateTime UpdatedAt { get; set; }
}

public class PriceTier
{
    /// <summary>Inclusive upper bound; null means infinity.</summary>
    public long? UpTo { get; set; }
    public long UnitAmount { get; set; }
    public long FlatAmount { get; set; }
}

public class Price : TenantEntity, IHasMetadata
{
    public override string Object => "price";
    public string ProductId { get; set; } = "";
    public string? Nickname { get; set; }
    public string Currency { get; set; } = "USD";
    /// <summary>one_time | recurring.</summary>
    public string Type { get; set; } = "one_time";
    /// <summary>standard | per_unit | tiered | package (§13).</summary>
    public string Scheme { get; set; } = "standard";
    public long UnitAmount { get; set; }
    [JsonIgnore] public string? TiersJson { get; set; }
    [NotMapped] public List<PriceTier>? Tiers => Json.Deserialize<List<PriceTier>>(TiersJson);
    /// <summary>volume (all units at the reached tier) | graduated (each tier separately).</summary>
    public string? TiersMode { get; set; }
    public long PackageSize { get; set; } = 1;
    public string? Interval { get; set; }
    public int IntervalCount { get; set; } = 1;
    public int TrialDays { get; set; }
    /// <summary>licensed (quantity/seats) | metered (usage).</summary>
    public string UsageType { get; set; } = "licensed";
    public string? MeterId { get; set; }
    public long CreditsGranted { get; set; }
    public long? MinimumAmount { get; set; }
    public long? MaximumAmount { get; set; }
    /// <summary>exclusive (tax added on top) | inclusive (tax contained in the price).</summary>
    public string TaxBehavior { get; set; } = "exclusive";
    /// <summary>Country-specific / PPP price overrides in this price's currency: {"IN": 999}.</summary>
    [JsonIgnore] public string? CountryAmountsJson { get; set; }
    [NotMapped] public JsonElement? CountryAmounts => Json.Raw(CountryAmountsJson);
    /// <summary>Prices are versioned, never destructively edited once used (§184).</summary>
    public int Version { get; set; } = 1;
    public string? PreviousVersionId { get; set; }
    public string? SupersededById { get; set; }
    public bool Active { get; set; } = true;
    [JsonIgnore] public string? MetadataJson { get; set; }
    [NotMapped] public JsonElement? Metadata => Json.Raw(MetadataJson);
}

public class Coupon : TenantEntity
{
    public override string Object => "coupon";
    public string Code { get; set; } = "";
    public string? Name { get; set; }
    public int? PercentOffBps { get; set; }
    public long? AmountOff { get; set; }
    public string? Currency { get; set; }
    /// <summary>once | repeating | forever.</summary>
    public string Duration { get; set; } = "once";
    public int? DurationInMonths { get; set; }
    public int? MaxRedemptions { get; set; }
    public int TimesRedeemed { get; set; }
    public DateTime? StartsAt { get; set; }
    public DateTime? ExpiresAt { get; set; }
    public long? MinimumAmount { get; set; }
    public string? ProductIdsCsv { get; set; }
    public string? CountriesCsv { get; set; }
    public string? CustomerId { get; set; }
    public bool FirstTimeOnly { get; set; }
    /// <summary>Promotion rule (§50): applied automatically when all conditions match.</summary>
    public bool AutoApply { get; set; }
    public bool Active { get; set; } = true;
}

public class LegalDocument : Entity
{
    public override string Object => "legal_document";
    public string Key { get; set; } = "";
    public int Version { get; set; }
    public string Title { get; set; } = "";
    public string Body { get; set; } = "";
    public DateTime EffectiveAt { get; set; }
}

// ───────────────────────────── Customers ─────────────────────────────

public class Customer : TenantEntity, IHasMetadata
{
    public override string Object => "customer";
    public string? ExternalId { get; set; }
    public string? Email { get; set; }
    public string? Name { get; set; }
    public string? Phone { get; set; }
    public string? Country { get; set; }
    public string? Locale { get; set; }
    public string? PostalCode { get; set; }
    public string? AddressLine { get; set; }
    public string? TaxId { get; set; }
    public string TaxStatus { get; set; } = "taxable";
    /// <summary>b2c | b2b.</summary>
    public string CustomerType { get; set; } = "b2c";
    public string? DefaultPaymentMethodId { get; set; }
    /// <summary>Account credit from downgrades/credit notes, applied to the next invoice (§180, §183).</summary>
    public long CreditBalance { get; set; }
    public string? CreditCurrency { get; set; }
    public int PaymentTermsDays { get; set; }
    public long? CreditLimit { get; set; }
    [JsonIgnore] public string? MetadataJson { get; set; }
    [NotMapped] public JsonElement? Metadata => Json.Raw(MetadataJson);
    public DateTime UpdatedAt { get; set; }
    public DateTime? AnonymizedAt { get; set; }
    /// <summary>Set when this record was merged into another customer (§186); kept for history.</summary>
    public string? MergedIntoId { get; set; }
}

public class PaymentMethod : TenantEntity
{
    public override string Object => "payment_method";
    public string CustomerId { get; set; } = "";
    public string Type { get; set; } = "card";
    public string ProviderId { get; set; } = "";
    /// <summary>Provider token only; the platform never stores PAN/CVV (§76, §161).</summary>
    [JsonIgnore] public string ProviderToken { get; set; } = "";
    public string? Brand { get; set; }
    public string? Last4 { get; set; }
    public int? ExpMonth { get; set; }
    public int? ExpYear { get; set; }
    public string? Fingerprint { get; set; }
    public string? Country { get; set; }
    public bool Detached { get; set; }
}

public class Entitlement : TenantEntity
{
    public override string Object => "entitlement";
    public string CustomerId { get; set; } = "";
    public string ProductId { get; set; } = "";
    public string SourceType { get; set; } = "";
    public string SourceId { get; set; } = "";
    /// <summary>active | revoked | expired.</summary>
    public string Status { get; set; } = "active";
    public string? FeaturesCsv { get; set; }
    public long Seats { get; set; } = 1;
    public string? LicenseKey { get; set; }
    public DateTime? ExpiresAt { get; set; }
    public DateTime? RevokedAt { get; set; }
    public string? RevokeReason { get; set; }
}

// ───────────────────────────── Checkout ─────────────────────────────

public class LineItem
{
    public string PriceId { get; set; } = "";
    public string? ProductId { get; set; }
    public string? Description { get; set; }
    public long Quantity { get; set; } = 1;
    public long UnitAmount { get; set; }
    public long Amount { get; set; }
    public long Discount { get; set; }
    public long Tax { get; set; }
    public string? TaxRuleId { get; set; }
    public int? TaxRuleVersion { get; set; }
    public int TaxRateBps { get; set; }
    public string? TaxType { get; set; }
    public bool TaxInclusive { get; set; }
}

public class CheckoutSession : TenantEntity, IHasMetadata
{
    public override string Object => "checkout_session";
    /// <summary>payment | subscription.</summary>
    public string Mode { get; set; } = "payment";
    /// <summary>open | complete | expired.</summary>
    public string Status { get; set; } = "open";
    [JsonIgnore] public string LineItemsJson { get; set; } = "[]";
    [NotMapped] public List<LineItem> LineItems => Json.Deserialize<List<LineItem>>(LineItemsJson) ?? [];
    public string Currency { get; set; } = "USD";
    public string? Country { get; set; }
    public string? CustomerId { get; set; }
    public string? CustomerEmail { get; set; }
    public string? CouponId { get; set; }
    public long Subtotal { get; set; }
    public long Discount { get; set; }
    public long Tax { get; set; }
    public long Total { get; set; }
    public string? TaxLabel { get; set; }
    public string? SuccessUrl { get; set; }
    public string? CancelUrl { get; set; }
    public string? PaymentLinkId { get; set; }
    public DateTime ExpiresAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public string? PaymentId { get; set; }
    public string? OrderId { get; set; }
    public string? SubscriptionId { get; set; }
    public string? ClientReferenceId { get; set; }
    public string? ExperimentVariant { get; set; }
    public bool CouponReserved { get; set; }
    public string? AffiliateCode { get; set; }
    public string? SellerId { get; set; }
    public int? ApplicationFeeBps { get; set; }
    /// <summary>Confirm lock: while set in the future, a second confirm is refused so one session can't charge twice.</summary>
    public DateTime? ProcessingUntil { get; set; }
    public int TrialDays { get; set; }
    public string? CustomerType { get; set; }
    public string? TaxId { get; set; }
    public string? CustomerName { get; set; }
    public string? RecurringSummary { get; set; }
    [JsonIgnore] public string? MetadataJson { get; set; }
    [NotMapped] public JsonElement? Metadata => Json.Raw(MetadataJson);
    [NotMapped] public string Url => $"/checkout/{Id}";
}

public class PaymentLink : TenantEntity, IHasMetadata
{
    public override string Object => "payment_link";
    public string PriceId { get; set; } = "";
    public long Quantity { get; set; } = 1;
    public bool AllowCoupons { get; set; } = true;
    public string? CouponId { get; set; }
    /// <summary>active | expired | disabled.</summary>
    public string Status { get; set; } = "active";
    public DateTime? ExpiresAt { get; set; }
    public string? SuccessUrl { get; set; }
    public string? CancelUrl { get; set; }
    public int Visits { get; set; }
    public string? SellerId { get; set; }
    public int? ApplicationFeeBps { get; set; }
    public int Completions { get; set; }
    [JsonIgnore] public string? MetadataJson { get; set; }
    [NotMapped] public JsonElement? Metadata => Json.Raw(MetadataJson);
    [NotMapped] public string Url => $"/pay/{Id}";
}

public class Order : TenantEntity
{
    public override string Object => "order";
    public string? CustomerId { get; set; }
    public string Currency { get; set; } = "USD";
    public long Subtotal { get; set; }
    public long Discount { get; set; }
    public long Tax { get; set; }
    public long Total { get; set; }
    public long AmountRefunded { get; set; }
    /// <summary>open | paid | partially_refunded | refunded | disputed | cancelled. Independent of payment state (§140).</summary>
    public string Status { get; set; } = "open";
    [JsonIgnore] public string ItemsJson { get; set; } = "[]";
    [NotMapped] public List<LineItem> Items => Json.Deserialize<List<LineItem>>(ItemsJson) ?? [];
    public string? Country { get; set; }
    public string? CheckoutSessionId { get; set; }
    public string? PaymentId { get; set; }
    public string? InvoiceId { get; set; }
    public string? CouponId { get; set; }
    /// <summary>Legal document versions accepted at purchase; immutable once attached (§35).</summary>
    public string? AcceptedTermsVersion { get; set; }
    public string? SellerOfRecord { get; set; }
    public DateTime UpdatedAt { get; set; }
}

// ───────────────────────────── Payments ─────────────────────────────

public class Payment : TenantEntity, IHasMetadata
{
    public override string Object => "payment";
    public string? OrderId { get; set; }
    public string? InvoiceId { get; set; }
    public string? CustomerId { get; set; }
    public string? CheckoutSessionId { get; set; }
    public long Amount { get; set; }
    public string Currency { get; set; } = "USD";
    /// <summary>CREATED, REQUIRES_ACTION, PROCESSING, AUTHORIZED, SUCCEEDED, FAILED, CANCELLED, REFUNDED, PARTIALLY_REFUNDED, DISPUTED, CHARGEBACK (§19).</summary>
    public string Status { get; set; } = "CREATED";
    public long AmountCaptured { get; set; }
    public long AmountRefunded { get; set; }
    public long AmountDisputed { get; set; }
    public long TaxAmount { get; set; }
    public long FeeAmount { get; set; }
    public long ProcessorFeeAmount { get; set; }
    public long NetAmount { get; set; }
    /// <summary>Marketplace (§101): the connected seller and its share of this payment.</summary>
    public string? SellerId { get; set; }
    public long SellerAmount { get; set; }
    public long ApplicationFeeAmount { get; set; }
    public string? ProviderId { get; set; }
    public string? ProviderTransactionId { get; set; }
    public string? PaymentMethodType { get; set; }
    public string? PaymentMethodId { get; set; }
    public string? CardBrand { get; set; }
    public string? Last4 { get; set; }
    public string? Country { get; set; }
    public int RiskScore { get; set; }
    /// <summary>ALLOW | REVIEW | CHALLENGE | DECLINE (§22).</summary>
    public string? RiskAction { get; set; }
    [JsonIgnore] public string? RiskReasonsJson { get; set; }
    [NotMapped] public JsonElement? RiskReasons => Json.Raw(RiskReasonsJson);
    public string ReviewStatus { get; set; } = "none";
    public string? FailureCode { get; set; }
    public string? FailureMessage { get; set; }
    public string? ProviderFailureCode { get; set; }
    public string? SuggestedAction { get; set; }
    [JsonIgnore] public string? NextActionJson { get; set; }
    [NotMapped] public JsonElement? NextAction => Json.Raw(NextActionJson);
    public string? ThreeDsResult { get; set; }
    public string? Description { get; set; }
    public string? CustomerEmail { get; set; }
    public string? Ip { get; set; }
    public string? DeviceId { get; set; }
    [JsonIgnore] public string? MetadataJson { get; set; }
    [NotMapped] public JsonElement? Metadata => Json.Raw(MetadataJson);
    [JsonIgnore] public string? PendingTokenForAction { get; set; }
    public int Version { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public class PaymentAttempt : TenantEntity
{
    public override string Object => "payment_attempt";
    public string PaymentId { get; set; } = "";
    public string ProviderId { get; set; } = "";
    public string Status { get; set; } = "PROCESSING";
    public string? ProviderTransactionId { get; set; }
    public string? ErrorCode { get; set; }
    public string? ProviderErrorCode { get; set; }
    public string? DeclineType { get; set; }
    public int LatencyMs { get; set; }
    public string? ThreeDsResult { get; set; }
    public string? RoutingReason { get; set; }
    public DateTime? CompletedAt { get; set; }
}

public class Refund : TenantEntity
{
    public override string Object => "refund";
    public string PaymentId { get; set; } = "";
    public long Amount { get; set; }
    public long TaxAmount { get; set; }
    public string Currency { get; set; } = "USD";
    /// <summary>REQUESTED | PROCESSING | SUCCEEDED | FAILED (§36).</summary>
    public string Status { get; set; } = "REQUESTED";
    public string? Reason { get; set; }
    public string? ProviderRefundId { get; set; }
    public string? RequestedBy { get; set; }
    public string? FailureReason { get; set; }
    public DateTime? CompletedAt { get; set; }
}

public class Dispute : TenantEntity
{
    public override string Object => "dispute";
    public string PaymentId { get; set; } = "";
    public long Amount { get; set; }
    public long FeeAmount { get; set; }
    public string Currency { get; set; } = "USD";
    public string Reason { get; set; } = "fraudulent";
    /// <summary>needs_response | under_review | won | lost.</summary>
    public string Status { get; set; } = "needs_response";
    public DateTime EvidenceDueBy { get; set; }
    public string? ProviderDisputeId { get; set; }
    public DateTime? SubmittedAt { get; set; }
    public DateTime? ClosedAt { get; set; }
}

public class DisputeEvidence : TenantEntity
{
    public override string Object => "dispute_evidence";
    public string DisputeId { get; set; } = "";
    public string Type { get; set; } = "";
    public string? Text { get; set; }
    public string? FileId { get; set; }
    public string? AddedBy { get; set; }
}

public class Provider : Entity
{
    public override string Object => "provider";
    public string Name { get; set; } = "";
    public string Kind { get; set; } = "simulator";
    public bool Livemode { get; set; }
    public bool Enabled { get; set; } = true;
    public int Priority { get; set; } = 100;
    public string CountriesCsv { get; set; } = "*";
    public string CurrenciesCsv { get; set; } = "*";
    public string MethodsCsv { get; set; } = "card";
    public int FeeBps { get; set; }
    public long FeeFixedMinor { get; set; }
    public int SettlementDays { get; set; } = 1;
    [JsonIgnore] public string? CredentialsEnc { get; set; }
    public string HealthState { get; set; } = "HEALTHY";
    public DateTime? HealthUpdatedAt { get; set; }
    /// <summary>Test hook: forces the simulator to behave as unavailable.</summary>
    public bool ForceOutage { get; set; }
}

public class ProviderHealthSample : Entity
{
    public override string Object => "provider_health_sample";
    public string ProviderId { get; set; } = "";
    public bool Success { get; set; }
    public bool Timeout { get; set; }
    public int LatencyMs { get; set; }
    public string? ErrorType { get; set; }
    public string? Country { get; set; }
    public string? Method { get; set; }
}

public class RoutingRule : Entity
{
    public override string Object => "routing_rule";
    public string? OrgId { get; set; }
    public int Priority { get; set; } = 100;
    public string? Country { get; set; }
    public string? Currency { get; set; }
    public string? Method { get; set; }
    public string ProviderId { get; set; } = "";
    public int? Percent { get; set; }
    public bool Enabled { get; set; } = true;
}

public class ProviderEvent : Entity
{
    public override string Object => "provider_event";
    public string ProviderId { get; set; } = "";
    public string ProviderEventId { get; set; } = "";
    public string Type { get; set; } = "";
    [JsonIgnore] public string Payload { get; set; } = "";
    public string Status { get; set; } = "received";
    public DateTime? ProcessedAt { get; set; }
    public string? Error { get; set; }
}

/// <summary>
/// The payment simulator's own records. It stands in for an external PSP's database so that
/// reconciliation compares two genuinely independent sources.
/// </summary>
public class SimProviderRecord : Entity
{
    public override string Object => "sim_provider_record";
    public string ProviderId { get; set; } = "";
    public string Type { get; set; } = "charge";
    public string ProviderReference { get; set; } = "";
    public string? InternalReference { get; set; }
    public long Amount { get; set; }
    public long Fee { get; set; }
    public string Currency { get; set; } = "USD";
    public string Status { get; set; } = "succeeded";
    public DateTime? SettledAt { get; set; }
}

public class SimCardToken : Entity
{
    public override string Object => "token";
    public string ProviderId { get; set; } = "";
    public string Behavior { get; set; } = "success";
    public string Type { get; set; } = "card";
    public string? Brand { get; set; }
    public string? Last4 { get; set; }
    public int? ExpMonth { get; set; }
    public int? ExpYear { get; set; }
    public string? Country { get; set; }
    public string Fingerprint { get; set; } = "";
    public bool Reusable { get; set; } = true;
}

// ───────────────────────────── Ledger ─────────────────────────────

public class LedgerAccount : Entity
{
    public override string Object => "ledger_account";
    /// <summary>platform | org | wallet.</summary>
    public string OwnerType { get; set; } = "platform";
    public string? OwnerId { get; set; }
    public string Code { get; set; } = "";
    public string Currency { get; set; } = "USD";
    public bool Livemode { get; set; }
    /// <summary>asset | liability | revenue | expense | equity. Assets/expenses are debit-normal.</summary>
    public string Kind { get; set; } = "liability";
}

public class LedgerTransaction : Entity
{
    public override string Object => "ledger_transaction";
    public string Type { get; set; } = "";
    public string Description { get; set; } = "";
    public string? OrgId { get; set; }
    public bool Livemode { get; set; }
    public string SourceType { get; set; } = "";
    public string SourceId { get; set; } = "";
    /// <summary>Unique posting key; the same business event can never be posted twice (§20, §204).</summary>
    public string PostingKey { get; set; } = "";
    public string? ParentTransactionId { get; set; }
    public string? ReversesTransactionId { get; set; }
    public DateTime EffectiveAt { get; set; }
    public string? RequestId { get; set; }
    public string? ActorId { get; set; }
}

public class LedgerEntry : Entity
{
    public override string Object => "ledger_entry";
    public string TransactionId { get; set; } = "";
    public string AccountId { get; set; } = "";
    /// <summary>D or C.</summary>
    public string Direction { get; set; } = "D";
    public long Amount { get; set; }
    public string Currency { get; set; } = "USD";
}

public class BalanceTransaction : TenantEntity
{
    public override string Object => "balance_transaction";
    /// <summary>payment, refund, dispute, dispute_reversal, payout, payout_failure, adjustment, reserve_hold, reserve_release, transfer_to_wallet, fee.</summary>
    public string Type { get; set; } = "";
    public long Amount { get; set; }
    public long Fee { get; set; }
    public long Net { get; set; }
    public string Currency { get; set; } = "USD";
    public string SourceType { get; set; } = "";
    public string SourceId { get; set; } = "";
    /// <summary>pending | available.</summary>
    public string Status { get; set; } = "pending";
    public DateTime AvailableOn { get; set; }
    public string LedgerTransactionId { get; set; } = "";
    public string? PayoutId { get; set; }
    public long ReserveAmount { get; set; }
    /// <summary>Part of the payment passed on to a marketplace seller (not the merchant's money).</summary>
    public long SellerAmount { get; set; }
    public DateTime? ReserveReleaseOn { get; set; }
    public bool ReserveReleased { get; set; }
    public bool HeldForReview { get; set; }
    public string? Description { get; set; }
}

public class Adjustment : Entity
{
    public override string Object => "adjustment";
    public string? OrgId { get; set; }
    public bool Livemode { get; set; }
    public string? WalletId { get; set; }
    public long Amount { get; set; }
    public string Currency { get; set; } = "USD";
    public string Reason { get; set; } = "";
    public string RequestedBy { get; set; } = "";
    public string? ApprovalId { get; set; }
    public string? LedgerTransactionId { get; set; }
    public string? CaseId { get; set; }
    public string? ReconExceptionId { get; set; }
}

public class FeeSchedule : Entity
{
    public override string Object => "fee_schedule";
    public string? OrgId { get; set; }
    public string? Country { get; set; }
    public string? Method { get; set; }
    public int PercentBps { get; set; }
    public long FixedMinor { get; set; }
    public string FixedCurrency { get; set; } = "USD";
    public long? MinimumMinor { get; set; }
    public long? MaximumMinor { get; set; }
    public int InternationalBps { get; set; }
    public int Priority { get; set; } = 100;
    public int Version { get; set; } = 1;
    public bool Active { get; set; } = true;
}

// ───────────────────────────── Billing ─────────────────────────────

public class Subscription : TenantEntity, IHasMetadata
{
    public override string Object => "subscription";
    public string CustomerId { get; set; } = "";
    /// <summary>TRIALING | ACTIVE | PAST_DUE | PAUSED | CANCELLED | EXPIRED | INCOMPLETE (§25).</summary>
    public string Status { get; set; } = "INCOMPLETE";
    public string Currency { get; set; } = "USD";
    public DateTime CurrentPeriodStart { get; set; }
    public DateTime CurrentPeriodEnd { get; set; }
    public DateTime BillingAnchor { get; set; }
    public DateTime? TrialEnd { get; set; }
    public bool CancelAtPeriodEnd { get; set; }
    public DateTime? CanceledAt { get; set; }
    public string? CancellationReason { get; set; }
    public string? CancellationFeedback { get; set; }
    public DateTime? PausedAt { get; set; }
    public DateTime? ResumesAt { get; set; }
    public string? CouponId { get; set; }
    public int CouponPeriodsUsed { get; set; }
    public string? DefaultPaymentMethodId { get; set; }
    /// <summary>charge_automatically | send_invoice.</summary>
    public string CollectionMethod { get; set; } = "charge_automatically";
    public int DaysUntilDue { get; set; } = 30;
    public string? TestClockId { get; set; }
    public string? LatestInvoiceId { get; set; }
    public int DunningAttempts { get; set; }
    public DateTime? NextRetryAt { get; set; }
    public DateTime? PastDueSince { get; set; }
    public string? Country { get; set; }
    [JsonIgnore] public string? MetadataJson { get; set; }
    [NotMapped] public JsonElement? Metadata => Json.Raw(MetadataJson);
    public int Version { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public class SubscriptionItem : TenantEntity
{
    public override string Object => "subscription_item";
    public string SubscriptionId { get; set; } = "";
    public string PriceId { get; set; } = "";
    public long Quantity { get; set; } = 1;
    public bool Deleted { get; set; }
}

public class Invoice : TenantEntity, IHasMetadata
{
    public override string Object => "invoice";
    public string Number { get; set; } = "";
    public string? CustomerId { get; set; }
    public string? SubscriptionId { get; set; }
    /// <summary>subscription | usage | one_time | manual | proration.</summary>
    public string BillingReason { get; set; } = "manual";
    /// <summary>DRAFT | OPEN | PAID | PARTIALLY_PAID | PAST_DUE | VOID | UNCOLLECTIBLE (§31).</summary>
    public string Status { get; set; } = "DRAFT";
    public string Currency { get; set; } = "USD";
    public long Subtotal { get; set; }
    public long Discount { get; set; }
    public long Tax { get; set; }
    public long Total { get; set; }
    public long AmountPaid { get; set; }
    public long AmountDue { get; set; }
    public long AmountCredited { get; set; }
    public DateTime? PeriodStart { get; set; }
    public DateTime? PeriodEnd { get; set; }
    public DateTime? DueDate { get; set; }
    public DateTime? FinalizedAt { get; set; }
    public DateTime? PaidAt { get; set; }
    public string? PaymentId { get; set; }
    public int AttemptCount { get; set; }
    public string? CustomerName { get; set; }
    public string? CustomerEmail { get; set; }
    public string? CustomerTaxId { get; set; }
    public string? CustomerCountry { get; set; }
    public string? SellerOfRecord { get; set; }
    public string? PurchaseOrder { get; set; }
    public string? Memo { get; set; }
    /// <summary>Exact inputs used to compute this invoice so the result is reproducible (§26).</summary>
    [JsonIgnore] public string? CalculationInputsJson { get; set; }
    [JsonIgnore] public string? MetadataJson { get; set; }
    [NotMapped] public JsonElement? Metadata => Json.Raw(MetadataJson);
    public string? PdfSha256 { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public class InvoiceLine : TenantEntity
{
    public override string Object => "invoice_line";
    public string InvoiceId { get; set; } = "";
    public string? PriceId { get; set; }
    public string? ProductId { get; set; }
    public string Description { get; set; } = "";
    public long Quantity { get; set; }
    public long UnitAmount { get; set; }
    public long Amount { get; set; }
    public long Discount { get; set; }
    public long Tax { get; set; }
    public int TaxRateBps { get; set; }
    public string? TaxRuleId { get; set; }
    public int? TaxRuleVersion { get; set; }
    public string? TaxType { get; set; }
    public bool Proration { get; set; }
    public DateTime? PeriodStart { get; set; }
    public DateTime? PeriodEnd { get; set; }
    public int Sort { get; set; }
}

public class CreditNote : TenantEntity
{
    public override string Object => "credit_note";
    public string InvoiceId { get; set; } = "";
    public string Number { get; set; } = "";
    public long Amount { get; set; }
    public long Tax { get; set; }
    public string Currency { get; set; } = "USD";
    public string Reason { get; set; } = "";
    public string? RefundId { get; set; }
}

public class Meter : TenantEntity
{
    public override string Object => "meter";
    public string EventName { get; set; } = "";
    public string DisplayName { get; set; } = "";
    /// <summary>sum | count | max | last.</summary>
    public string Aggregation { get; set; } = "sum";
    public string? Unit { get; set; }
}

public class UsageEvent : TenantEntity
{
    public override string Object => "usage_event";
    public string CustomerId { get; set; } = "";
    public string EventName { get; set; } = "";
    public long Quantity { get; set; }
    public DateTime Timestamp { get; set; }
    public string IdempotencyKey { get; set; } = "";
    public string? SubscriptionId { get; set; }
    public string? InvoiceId { get; set; }
    public string? Dimension { get; set; }
    /// <summary>Corrections are new events that reference the original (§29).</summary>
    public string? CorrectsEventId { get; set; }
    public bool Late { get; set; }
}

public class CreditLedgerEntry : TenantEntity
{
    public override string Object => "credit_ledger_entry";
    public string CustomerId { get; set; } = "";
    public string CreditType { get; set; } = "credits";
    /// <summary>issue | consume | reserve | release | expire | refund | adjust | transfer.</summary>
    public string Operation { get; set; } = "";
    /// <summary>Signed delta to the available balance.</summary>
    public long Delta { get; set; }
    public long ReservedDelta { get; set; }
    public long BalanceAfter { get; set; }
    public string? SourceType { get; set; }
    public string? SourceId { get; set; }
    public string? IdempotencyKey { get; set; }
    public DateTime? ExpiresAt { get; set; }
    public string? Description { get; set; }
}

public class TestClock : TenantEntity
{
    public override string Object => "test_clock";
    public string Name { get; set; } = "";
    public DateTime FrozenTime { get; set; }
    public string Status { get; set; } = "ready";
}

// ───────────────────────────── Payouts / Recon ─────────────────────────────

public class Payout : TenantEntity
{
    public override string Object => "payout";
    public long Amount { get; set; }
    public string Currency { get; set; } = "USD";
    /// <summary>PENDING | PROCESSING | PAID | FAILED | RETURNED | ON_HOLD (§38).</summary>
    public string Status { get; set; } = "PENDING";
    public string? DestinationId { get; set; }
    public string? DestinationLast4 { get; set; }
    public DateTime? ArrivalDate { get; set; }
    public string? FailureReason { get; set; }
    public string? BankReference { get; set; }
    public string? LedgerTransactionId { get; set; }
    [JsonIgnore] public string? BreakdownJson { get; set; }
    [NotMapped] public JsonElement? Breakdown => Json.Raw(BreakdownJson);
    public bool Automatic { get; set; }
    public string? HoldReason { get; set; }
    public DateTime? PaidAt { get; set; }
}

public class ReconRun : Entity
{
    public override string Object => "reconciliation_run";
    public string Scope { get; set; } = "provider";
    public int Matched { get; set; }
    public int Exceptions { get; set; }
    public DateTime CompletedAt { get; set; }
    public string? TriggeredBy { get; set; }
}

public class ReconException : Entity
{
    public override string Object => "reconciliation_exception";
    public string RunId { get; set; } = "";
    /// <summary>amount_mismatch, currency_mismatch, missing_internal, missing_provider, duplicate, unknown_payout, ledger_imbalance, wallet_discrepancy.</summary>
    public string Type { get; set; } = "";
    public string Status { get; set; } = "open";
    public string? ProviderId { get; set; }
    public string? OrgId { get; set; }
    public string? InternalReference { get; set; }
    public string? ExternalReference { get; set; }
    public long? ExpectedAmount { get; set; }
    public long? ActualAmount { get; set; }
    public string? Currency { get; set; }
    public string Details { get; set; } = "";
    public string? ResolvedBy { get; set; }
    public string? Resolution { get; set; }
    public DateTime? ResolvedAt { get; set; }
}

// ───────────────────────────── Tax ─────────────────────────────

public class TaxRule : Entity
{
    public override string Object => "tax_rule";
    public string Country { get; set; } = "";
    public string? Region { get; set; }
    public string TaxCategory { get; set; } = "*";
    public string CustomerType { get; set; } = "*";
    public string TaxType { get; set; } = "VAT";
    public int RateBps { get; set; }
    public bool ReverseChargeB2B { get; set; }
    public string Label { get; set; } = "";
    public int Version { get; set; } = 1;
    public DateTime EffectiveFrom { get; set; }
    public DateTime? EffectiveTo { get; set; }
    /// <summary>line | invoice rounding (§138).</summary>
    public string Rounding { get; set; } = "line";
}

public class TaxRecord : TenantEntity
{
    public override string Object => "tax_record";
    public string SourceType { get; set; } = "";
    public string SourceId { get; set; } = "";
    public string? InvoiceId { get; set; }
    public string? OrderId { get; set; }
    public string Country { get; set; } = "";
    public string TaxType { get; set; } = "";
    public string? TaxRuleId { get; set; }
    public int? TaxRuleVersion { get; set; }
    public int RateBps { get; set; }
    public long TaxableAmount { get; set; }
    public long TaxAmount { get; set; }
    public string Currency { get; set; } = "USD";
    public bool ReverseCharge { get; set; }
    public bool Exempt { get; set; }
}

public class CountryCapability : Entity
{
    public override string Object => "country_capability";
    public string Country { get; set; } = "";
    public string Name { get; set; } = "";
    public bool CheckoutEnabled { get; set; } = true;
    public bool WalletEnabled { get; set; }
    public bool PayoutsEnabled { get; set; } = true;
    public bool MerchantOnboardingEnabled { get; set; } = true;
    public string DefaultCurrency { get; set; } = "USD";
    public string PaymentMethodsCsv { get; set; } = "card";
    public string Locale { get; set; } = "en-US";
    public int WalletKycLevelRequired { get; set; } = 1;
    public string? Restrictions { get; set; }
}

// ───────────────────────────── Webhooks / Events ─────────────────────────────

public class Event : Entity
{
    public override string Object => "event";
    public string? OrgId { get; set; }
    public bool Livemode { get; set; }
    public string? UserId { get; set; }
    public string Type { get; set; } = "";
    public string ObjectType { get; set; } = "";
    public string ObjectId { get; set; } = "";
    [JsonIgnore] public string DataJson { get; set; } = "{}";
    [NotMapped] public JsonElement? Data => Json.Raw(DataJson);
    public string ApiVersion { get; set; } = "2026-09-30";
    public long Sequence { get; set; }
    public string? RequestId { get; set; }
}

public class OutboxMessage
{
    public long Id { get; set; }
    public string EventId { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public DateTime? ProcessedAt { get; set; }
    public int Attempts { get; set; }
    public string? LastError { get; set; }
}

public class WebhookEndpoint : TenantEntity
{
    public override string Object => "webhook_endpoint";
    public string Url { get; set; } = "";
    public string? Description { get; set; }
    [JsonIgnore] public string SecretEnc { get; set; } = "";
    [JsonIgnore] public string? PreviousSecretEnc { get; set; }
    public DateTime? PreviousSecretExpiresAt { get; set; }
    public string EnabledEventsCsv { get; set; } = "*";
    public string Status { get; set; } = "enabled";
    public int ConsecutiveFailures { get; set; }
    public DateTime? LastSuccessAt { get; set; }
    public DateTime? LastFailureAt { get; set; }
}

public class WebhookDelivery : TenantEntity
{
    public override string Object => "webhook_delivery";
    public string EventId { get; set; } = "";
    public string EndpointId { get; set; } = "";
    public int Attempt { get; set; }
    /// <summary>pending | succeeded | retrying | dead.</summary>
    public string Status { get; set; } = "pending";
    public DateTime NextAttemptAt { get; set; }
    public int? ResponseStatus { get; set; }
    public string? ResponseBody { get; set; }
    public int DurationMs { get; set; }
    public bool IsReplay { get; set; }
    public DateTime? CompletedAt { get; set; }
}

public class Notification : Entity
{
    public override string Object => "notification";
    public string? OrgId { get; set; }
    public string? UserId { get; set; }
    public string Channel { get; set; } = "email";
    public string Recipient { get; set; } = "";
    public string Template { get; set; } = "";
    public string Subject { get; set; } = "";
    public string Body { get; set; } = "";
    public string Category { get; set; } = "transactional";
    public string Status { get; set; } = "queued";
    public string? ObjectType { get; set; }
    public string? ObjectId { get; set; }
    public bool Read { get; set; }
}

public class EmailTemplate : Entity
{
    public override string Object => "email_template";
    public string? OrgId { get; set; }
    public string Key { get; set; } = "";
    public string Subject { get; set; } = "";
    public string Body { get; set; } = "";
    public int Version { get; set; } = 1;
    public bool Active { get; set; } = true;
}

// ───────────────────────────── Audit / platform ─────────────────────────────

public class AuditLog
{
    public long Seq { get; set; }
    public string Id { get; set; } = "";
    public DateTime At { get; set; }
    public string ActorType { get; set; } = "";
    public string? ActorId { get; set; }
    public string? ActorRole { get; set; }
    public string? OrgId { get; set; }
    public string Action { get; set; } = "";
    public string? ObjectType { get; set; }
    public string? ObjectId { get; set; }
    public string? BeforeJson { get; set; }
    public string? AfterJson { get; set; }
    public string? Reason { get; set; }
    public string? Ip { get; set; }
    public string? RequestId { get; set; }
    public string? CaseId { get; set; }
    public string? ApprovalId { get; set; }
    public string PrevHash { get; set; } = "";
    public string Hash { get; set; } = "";
}

public class StateTransition : Entity
{
    public override string Object => "state_transition";
    public string ObjectType { get; set; } = "";
    public string ObjectId { get; set; } = "";
    public string? OrgId { get; set; }
    public string? FromState { get; set; }
    public string ToState { get; set; } = "";
    public string? ActorId { get; set; }
    public string? Reason { get; set; }
    public string? RequestId { get; set; }
}

public class DataAccessLog : Entity
{
    public override string Object => "data_access_log";
    public string AdminUserId { get; set; } = "";
    public string ObjectType { get; set; } = "";
    public string ObjectId { get; set; } = "";
    public string Action { get; set; } = "viewed";
    public string? Fields { get; set; }
    public string? Reason { get; set; }
    public string? Ip { get; set; }
}

public class IdempotencyRecord
{
    public long Id { get; set; }
    public string Scope { get; set; } = "";
    public string Key { get; set; } = "";
    public string Method { get; set; } = "";
    public string Path { get; set; } = "";
    public string RequestHash { get; set; } = "";
    public int? ResponseStatus { get; set; }
    public string? ResponseBody { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
}

public class ApiRequestLog
{
    public long Id { get; set; }
    public string RequestId { get; set; } = "";
    public string? OrgId { get; set; }
    public bool Livemode { get; set; }
    public string? UserId { get; set; }
    public string? ApiKeyId { get; set; }
    public string Method { get; set; } = "";
    public string Path { get; set; } = "";
    public int Status { get; set; }
    public int LatencyMs { get; set; }
    public string? Ip { get; set; }
    public string? UserAgent { get; set; }
    public string? ErrorCode { get; set; }
    public DateTime At { get; set; }
}

// ───────────────────────────── Wallet ─────────────────────────────

public class Wallet : Entity
{
    public override string Object => "wallet";
    /// <summary>user | org.</summary>
    public string OwnerType { get; set; } = "user";
    public string OwnerId { get; set; } = "";
    /// <summary>active | frozen | closed.</summary>
    public string Status { get; set; } = "active";
    public string Handle { get; set; } = "";
    public string CurrenciesCsv { get; set; } = "USD";
}

public class WalletHold : Entity
{
    public override string Object => "wallet_hold";
    public string WalletId { get; set; } = "";
    public string Currency { get; set; } = "USD";
    public long Amount { get; set; }
    public string Reason { get; set; } = "";
    /// <summary>active | released | captured.</summary>
    public string Status { get; set; } = "active";
    public string? RefType { get; set; }
    public string? RefId { get; set; }
    public DateTime? ReleasedAt { get; set; }
}

public class BankAccount : Entity
{
    public override string Object => "bank_account";
    public string OwnerType { get; set; } = "user";
    public string OwnerId { get; set; } = "";
    public string Country { get; set; } = "";
    public string Currency { get; set; } = "";
    public string BankName { get; set; } = "";
    public string AccountHolder { get; set; } = "";
    [JsonIgnore] public string AccountNumberEnc { get; set; } = "";
    public string Last4 { get; set; } = "";
    public string? Routing { get; set; }
    /// <summary>Keyed hash of account+routing: lets risk spot shared bank accounts without decrypting (§113).</summary>
    [JsonIgnore] public string Fingerprint { get; set; } = "";
    public string VerificationStatus { get; set; } = "verified";
    public bool NameMatch { get; set; } = true;
    public DateTime? RemovedAt { get; set; }
}

public class Transfer : Entity
{
    public override string Object => "transfer";
    /// <summary>funding | internal | withdrawal | merchant_proceeds | conversion.</summary>
    public string Type { get; set; } = "internal";
    /// <summary>CREATED, SCREENING, PENDING, PROCESSING, COMPLETED, FAILED, RETURNED, HELD, CANCELLED (§41).</summary>
    public string Status { get; set; } = "CREATED";
    public string? SenderWalletId { get; set; }
    public string? RecipientWalletId { get; set; }
    public string? BankAccountId { get; set; }
    public string? SourceOrgId { get; set; }
    public string SourceCurrency { get; set; } = "USD";
    public long SourceAmount { get; set; }
    public string DestinationCurrency { get; set; } = "USD";
    public long DestinationAmount { get; set; }
    public long? FxRateE9 { get; set; }
    public long? FxMidRateE9 { get; set; }
    public string? FxQuoteId { get; set; }
    public DateTime? FxRateTimestamp { get; set; }
    public long FeeAmount { get; set; }
    public long FxSpreadAmount { get; set; }
    public string? Purpose { get; set; }
    public string? SourceOfFunds { get; set; }
    public string? Note { get; set; }
    public string? FundingSource { get; set; }
    public string? Rail { get; set; }
    public string? ScreeningResult { get; set; }
    public string? HoldId { get; set; }
    /// <summary>Neutral, non-sensitive message the customer sees (§71).</summary>
    public string? CustomerMessage { get; set; }
    [JsonIgnore] public string? InternalReason { get; set; }
    public string? ParentTransferId { get; set; }
    public string? LedgerTransactionId { get; set; }
    public string InitiatedBy { get; set; } = "";
    public string? Ip { get; set; }
    public string? DeviceId { get; set; }
    public string? SenderCountry { get; set; }
    public string? RecipientCountry { get; set; }
    public string? FailureReason { get; set; }
    public DateTime? CompletedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public class FxQuote : Entity
{
    public override string Object => "fx_quote";
    public string UserId { get; set; } = "";
    public string FromCurrency { get; set; } = "";
    public string ToCurrency { get; set; } = "";
    public long SourceAmount { get; set; }
    public long DestinationAmount { get; set; }
    public long MidRateE9 { get; set; }
    public long CustomerRateE9 { get; set; }
    public int SpreadBps { get; set; }
    public long SpreadAmount { get; set; }
    public long FeeAmount { get; set; }
    public DateTime RateTimestamp { get; set; }
    public string RateSource { get; set; } = "";
    public DateTime ExpiresAt { get; set; }
    public DateTime? UsedAt { get; set; }
}

public class FxRate : Entity
{
    public override string Object => "fx_rate";
    public string Base { get; set; } = "USD";
    public string Quote { get; set; } = "";
    /// <summary>Quote-currency major units per 1 base major unit, × 1e9.</summary>
    public long RateE9 { get; set; }
    public string Source { get; set; } = "";
    public DateTime AsOf { get; set; }
}

public class WalletLimit : Entity
{
    public override string Object => "wallet_limit";
    public string Country { get; set; } = "*";
    public int KycLevel { get; set; }
    public string TransferType { get; set; } = "*";
    /// <summary>Limits are denominated in USD minor units and converted at mid-market for checks.</summary>
    public long PerTransactionUsd { get; set; }
    public long DailyUsd { get; set; }
    public long MonthlyUsd { get; set; }
    public long MaxBalanceUsd { get; set; }
}

// ───────────────────────────── AML / Compliance ─────────────────────────────

public class MonitoringRule : Entity
{
    public override string Object => "monitoring_rule";
    public string Key { get; set; } = "";
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public bool Enabled { get; set; } = true;
    public string Severity { get; set; } = "MEDIUM";
    [JsonIgnore] public string ParamsJson { get; set; } = "{}";
    [NotMapped] public JsonElement? Params => Json.Raw(ParamsJson);
    /// <summary>hold the triggering transfer (policy) or alert only.</summary>
    public string Action { get; set; } = "alert";
    public int Version { get; set; } = 1;
}

public class Alert : Entity
{
    public override string Object => "alert";
    /// <summary>aml | sanctions | fraud | merchant_risk | pep.</summary>
    public string Type { get; set; } = "aml";
    public string RuleKey { get; set; } = "";
    public int RuleVersion { get; set; }
    public string SubjectType { get; set; } = "user";
    public string SubjectId { get; set; } = "";
    public string? TransferId { get; set; }
    public string? PaymentId { get; set; }
    public string Severity { get; set; } = "MEDIUM";
    /// <summary>NEW, QUEUED, IN_REVIEW, REQUESTED_INFORMATION, ESCALATED, FALSE_POSITIVE, RESOLVED, REPORTED, CLOSED (§63).</summary>
    public string Status { get; set; } = "NEW";
    public long? Amount { get; set; }
    public string? Currency { get; set; }
    /// <summary>Plain-language, non-accusatory statement (§94): "Unusual transaction pattern".</summary>
    public string Summary { get; set; } = "";
    [JsonIgnore] public string ReasonsJson { get; set; } = "[]";
    [NotMapped] public JsonElement? Reasons => Json.Raw(ReasonsJson);
    [JsonIgnore] public string? RelatedJson { get; set; }
    [NotMapped] public JsonElement? Related => Json.Raw(RelatedJson);
    public string? CaseId { get; set; }
    public string? AssignedTo { get; set; }
    /// <summary>FALSE_POSITIVE | TRUE_MATCH | INCONCLUSIVE (§95).</summary>
    public string? Conclusion { get; set; }
    public string? ConclusionNote { get; set; }
    public string? ResolvedBy { get; set; }
    public DateTime? ResolvedAt { get; set; }
    public string DedupeKey { get; set; } = "";
}

public class ComplianceCase : Entity
{
    public override string Object => "case";
    public string Title { get; set; } = "";
    public string Type { get; set; } = "aml";
    public string SubjectType { get; set; } = "user";
    public string SubjectId { get; set; } = "";
    /// <summary>OPEN | IN_REVIEW | ACTION_REQUIRED | ESCALATED | RESOLVED | REJECTED | CLOSED.</summary>
    public string Status { get; set; } = "OPEN";
    public string Priority { get; set; } = "MEDIUM";
    public string? AssignedTo { get; set; }
    public string CreatedBy { get; set; } = "";
    public DateTime DueAt { get; set; }
    public string? Decision { get; set; }
    public string? DecisionReason { get; set; }
    public string? DecidedBy { get; set; }
    public DateTime? ClosedAt { get; set; }
    public bool LegalHold { get; set; }
    public bool Confidential { get; set; } = true;
    public DateTime UpdatedAt { get; set; }
}

public class CaseNote : Entity
{
    public override string Object => "case_note";
    public string CaseId { get; set; } = "";
    public string AuthorId { get; set; } = "";
    /// <summary>observation | evidence | reasoning | action | next_step.</summary>
    public string Kind { get; set; } = "observation";
    public string Body { get; set; } = "";
    public bool Finalized { get; set; }
    public DateTime? FinalizedAt { get; set; }
}

public class CaseEvidence : Entity
{
    public override string Object => "case_evidence";
    public string CaseId { get; set; } = "";
    public string Type { get; set; } = "";
    public string? RefType { get; set; }
    public string? RefId { get; set; }
    public string Description { get; set; } = "";
    public string Source { get; set; } = "platform";
    [JsonIgnore] public string SnapshotJson { get; set; } = "{}";
    [NotMapped] public JsonElement? Snapshot => Json.Raw(SnapshotJson);
    /// <summary>SHA-256 of the captured snapshot: chain of custody (§99).</summary>
    public string Sha256 { get; set; } = "";
    public string CapturedBy { get; set; } = "";
}

public class ApprovalRequest : Entity
{
    public override string Object => "approval_request";
    /// <summary>freeze_user, unfreeze_user, restrict_org, suspend_org, ledger_adjustment, close_case, confirm_sanctions, release_payout_hold …</summary>
    public string Action { get; set; } = "";
    public string TargetType { get; set; } = "";
    public string TargetId { get; set; } = "";
    [JsonIgnore] public string PayloadJson { get; set; } = "{}";
    [NotMapped] public JsonElement? Payload => Json.Raw(PayloadJson);
    public string Reason { get; set; } = "";
    public string? CaseId { get; set; }
    public string RequestedBy { get; set; } = "";
    /// <summary>pending | approved | rejected | executed | failed.</summary>
    public string Status { get; set; } = "pending";
    public string? DecidedBy { get; set; }
    public DateTime? DecidedAt { get; set; }
    public string? DecisionNote { get; set; }
    public DateTime? ExecutedAt { get; set; }
    public string? ExecutionResult { get; set; }
}

public class ScreeningList : Entity
{
    public override string Object => "screening_list";
    public string Name { get; set; } = "";
    public string Source { get; set; } = "";
    public string Version { get; set; } = "";
    public bool Active { get; set; } = true;
}

public class ScreeningEntry : Entity
{
    public override string Object => "screening_entry";
    public string ListId { get; set; } = "";
    public string Name { get; set; } = "";
    public string? AliasesCsv { get; set; }
    public string EntryType { get; set; } = "person";
    public string? DateOfBirth { get; set; }
    public string? Country { get; set; }
    public string? Program { get; set; }
}

public class ScreeningCheck : Entity
{
    public override string Object => "screening_check";
    public string SubjectType { get; set; } = "";
    public string SubjectId { get; set; } = "";
    public string ScreenedName { get; set; } = "";
    public string Context { get; set; } = "";
    public string ListVersion { get; set; } = "";
    /// <summary>clear | potential_match | confirmed_match | false_positive.</summary>
    public string Result { get; set; } = "clear";
    public int Score { get; set; }
    public string? MatchedEntryId { get; set; }
    public string? MatchedName { get; set; }
    public string MatchLogic { get; set; } = "";
    public string? AlertId { get; set; }
    public string? ReviewedBy { get; set; }
}

public class KycCheck : Entity
{
    public override string Object => "kyc_check";
    public string UserId { get; set; } = "";
    public int LevelRequested { get; set; }
    public string DocumentType { get; set; } = "";
    public string? DocumentFileId { get; set; }
    public string Provider { get; set; } = "kyc_simulator";
    public string Result { get; set; } = "processing";
    public string? ProviderResponse { get; set; }
    public string? ReviewedBy { get; set; }
    public string? Reason { get; set; }
}

public class CopilotAction : TenantEntity
{
    public override string Object => "copilot_action";
    public string Kind { get; set; } = "";
    public string Summary { get; set; } = "";
    public string RiskLevel { get; set; } = "low";
    [JsonIgnore] public string PayloadJson { get; set; } = "{}";
    [NotMapped] public JsonElement? Payload => Json.Raw(PayloadJson);
    /// <summary>draft | applied | discarded.</summary>
    public string Status { get; set; } = "draft";
    public string RequestedBy { get; set; } = "";
    public string? ResultObjectId { get; set; }
    public DateTime? DecidedAt { get; set; }
}

// ───────────────────────────── Growth ─────────────────────────────

public class AffiliateAccount : TenantEntity
{
    public override string Object => "affiliate";
    public string Name { get; set; } = "";
    public string Email { get; set; } = "";
    /// <summary>Referral code used in links: /pay/{link}?ref=CODE.</summary>
    public string Code { get; set; } = "";
    /// <summary>percentage | fixed.</summary>
    public string CommissionType { get; set; } = "percentage";
    public int RateBps { get; set; }
    public long FixedAmount { get; set; }
    public string? FixedCurrency { get; set; }
    /// <summary>first_payment | recurring | months.</summary>
    public string Duration { get; set; } = "first_payment";
    public int? DurationMonths { get; set; }
    public int HoldDays { get; set; } = 30;
    public string Status { get; set; } = "active";
    public int Clicks { get; set; }
}

public class AffiliateReferral : TenantEntity
{
    public override string Object => "affiliate_referral";
    public string AffiliateId { get; set; } = "";
    public string CustomerId { get; set; } = "";
    public string? CheckoutSessionId { get; set; }
}

public class AffiliateCommission : TenantEntity
{
    public override string Object => "affiliate_commission";
    public string AffiliateId { get; set; } = "";
    public string CustomerId { get; set; } = "";
    public string PaymentId { get; set; } = "";
    public long BasisAmount { get; set; }
    public long Amount { get; set; }
    public string Currency { get; set; } = "USD";
    /// <summary>pending (hold period) | approved (accrued in ledger) | paid | reversed.</summary>
    public string Status { get; set; } = "pending";
    public DateTime ApproveAfter { get; set; }
    public string? LedgerTransactionId { get; set; }
    public DateTime? PaidAt { get; set; }
    public string? ReversalReason { get; set; }
}

public class CustomerBudget : TenantEntity
{
    public override string Object => "customer_budget";
    public string CustomerId { get; set; } = "";
    /// <summary>A meter event name, or "*" for all metered usage.</summary>
    public string EventName { get; set; } = "*";
    public long MonthlyLimit { get; set; }
    /// <summary>hard = reject events over the limit; soft = accept and notify.</summary>
    public string Mode { get; set; } = "soft";
    public string ThresholdsCsv { get; set; } = "50,75,90,100";
    /// <summary>"yyyy-MM:threshold" markers already notified, so each alert fires once per month.</summary>
    public string NotifiedCsv { get; set; } = "";
    public bool Active { get; set; } = true;
}

/// <summary>Checkout A/B test on a payment link (§108): variants swap the price and/or coupon.</summary>
public class Experiment : TenantEntity
{
    public override string Object => "experiment";
    public string Name { get; set; } = "";
    public string PaymentLinkId { get; set; } = "";
    /// <summary>draft | running | stopped.</summary>
    public string Status { get; set; } = "draft";
    [JsonIgnore] public string VariantsJson { get; set; } = "[]";
    [NotMapped] public List<ExperimentVariant> Variants => Json.Deserialize<List<ExperimentVariant>>(VariantsJson) ?? [];
    public string? Hypothesis { get; set; }
    public DateTime? StartedAt { get; set; }
    public DateTime? StoppedAt { get; set; }
}

public class ExperimentVariant
{
    public string Key { get; set; } = "";
    public int Weight { get; set; } = 50;
    public string? PriceId { get; set; }
    public string? CouponCode { get; set; }
}

/// <summary>A customer-facing brand of an organization (§102): its own name, look and support contact.</summary>
public class Brand : TenantEntityNoMode
{
    public override string Object => "brand";
    public string Name { get; set; } = "";
    public string? LogoUrl { get; set; }
    public string? Color { get; set; }
    public string? SupportEmail { get; set; }
    public string? Website { get; set; }
    public bool Active { get; set; } = true;
}

// ───────────────────────────── Marketplace (§101) ─────────────────────────────

public class Seller : TenantEntityNoMode
{
    public override string Object => "seller";
    public string Name { get; set; } = "";
    public string Email { get; set; } = "";
    public string Country { get; set; } = "US";
    public string DefaultCurrency { get; set; } = "USD";
    /// <summary>pending_verification | active | restricted | rejected.</summary>
    public string Status { get; set; } = "pending_verification";
    public string ScreeningStatus { get; set; } = "not_screened";
    /// <summary>The marketplace's own commission on each sale (application fee), in basis points.</summary>
    public int CommissionBps { get; set; } = 1000;
    public string? PayoutBankName { get; set; }
    public string? PayoutCurrency { get; set; }
    public string? PayoutLast4 { get; set; }
    [JsonIgnore] public string? PayoutAccountEnc { get; set; }
    public string? DecisionReason { get; set; }
}

public class SellerBalanceTransaction : TenantEntity
{
    public override string Object => "seller_balance_transaction";
    public string SellerId { get; set; } = "";
    /// <summary>sale | refund | dispute | dispute_reversal | payout | payout_failure.</summary>
    public string Type { get; set; } = "";
    public long Amount { get; set; }
    public string Currency { get; set; } = "USD";
    /// <summary>pending | available.</summary>
    public string Status { get; set; } = "pending";
    public DateTime AvailableOn { get; set; }
    public string SourceType { get; set; } = "";
    public string SourceId { get; set; } = "";
    public string LedgerTransactionId { get; set; } = "";
    public string? PayoutId { get; set; }
    public string? Description { get; set; }
}

public class SellerPayout : TenantEntity
{
    public override string Object => "seller_payout";
    public string SellerId { get; set; } = "";
    public long Amount { get; set; }
    public string Currency { get; set; } = "USD";
    /// <summary>PENDING | PROCESSING | PAID | FAILED.</summary>
    public string Status { get; set; } = "PENDING";
    public string? BankLast4 { get; set; }
    public string? LedgerTransactionId { get; set; }
    public string? FailureReason { get; set; }
    public DateTime? PaidAt { get; set; }
}

// ───────────────────────────── Finance operations ─────────────────────────────

/// <summary>Month-end close (§230, §231): checks, a hashed snapshot of closing balances, and a lock.</summary>
public class AccountingPeriod : TenantEntity
{
    public override string Object => "accounting_period";
    /// <summary>yyyy-MM.</summary>
    public string Period { get; set; } = "";
    public string Status { get; set; } = "closed";
    public DateTime ClosedAt { get; set; }
    public string ClosedBy { get; set; } = "";
    [JsonIgnore] public string ChecksJson { get; set; } = "[]";
    [NotMapped] public JsonElement? Checks => Json.Raw(ChecksJson);
    [JsonIgnore] public string SnapshotJson { get; set; } = "{}";
    [NotMapped] public JsonElement? Snapshot => Json.Raw(SnapshotJson);
    public string SnapshotSha256 { get; set; } = "";
}

public class ImportJob : TenantEntity
{
    public override string Object => "import";
    /// <summary>customers | products.</summary>
    public string Type { get; set; } = "";
    public string Format { get; set; } = "csv";
    /// <summary>previewed | completed | failed.</summary>
    public string Status { get; set; } = "previewed";
    public bool DryRun { get; set; }
    public int Total { get; set; }
    public int Valid { get; set; }
    public int Invalid { get; set; }
    public int Duplicates { get; set; }
    public int Imported { get; set; }
    [JsonIgnore] public string ResultsJson { get; set; } = "[]";
    [NotMapped] public JsonElement? Results => Json.Raw(ResultsJson);
    public string CreatedBy { get; set; } = "";
}

/// <summary>Custom checkout/portal domains verified by DNS TXT record (§176, §177).</summary>
public class CustomDomain : TenantEntityNoMode
{
    public override string Object => "domain";
    public string Hostname { get; set; } = "";
    /// <summary>checkout | portal | payment_links.</summary>
    public string Purpose { get; set; } = "checkout";
    /// <summary>PENDING | VERIFIED | FAILED | REVOKED.</summary>
    public string Status { get; set; } = "PENDING";
    public string VerificationToken { get; set; } = "";
    public DateTime? VerifiedAt { get; set; }
    public DateTime? LastCheckedAt { get; set; }
    public string? LastError { get; set; }
}

// ───────────────────────────── Support, incidents, flags ─────────────────────────────

public class SupportTicket : Entity
{
    public override string Object => "support_ticket";
    public string OrgId { get; set; } = "";
    public string CreatedByUserId { get; set; } = "";
    public string Subject { get; set; } = "";
    /// <summary>bug | payment_issue | tax_issue | checkout_issue | feature_request | account | other (§207).</summary>
    public string Category { get; set; } = "other";
    /// <summary>open | awaiting_merchant | resolved | closed.</summary>
    public string Status { get; set; } = "open";
    public string Priority { get; set; } = "normal";
    public string? AssignedTo { get; set; }
    public string? RelatedObjectId { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public class TicketMessage : Entity
{
    public override string Object => "ticket_message";
    public string TicketId { get; set; } = "";
    public string AuthorId { get; set; } = "";
    /// <summary>merchant | staff.</summary>
    public string AuthorType { get; set; } = "merchant";
    public string Body { get; set; } = "";
    /// <summary>Staff-only notes are never shown to the merchant.</summary>
    public bool Internal { get; set; }
}

public class Incident : Entity
{
    public override string Object => "incident";
    public string Title { get; set; } = "";
    /// <summary>minor | major | critical.</summary>
    public string Severity { get; set; } = "minor";
    /// <summary>investigating | identified | monitoring | resolved.</summary>
    public string Status { get; set; } = "investigating";
    public string AffectedServicesCsv { get; set; } = "";
    public string CustomerImpact { get; set; } = "";
    public DateTime StartedAt { get; set; }
    public DateTime? ResolvedAt { get; set; }
    public string CreatedBy { get; set; } = "";
}

public class IncidentUpdate : Entity
{
    public override string Object => "incident_update";
    public string IncidentId { get; set; } = "";
    public string Status { get; set; } = "";
    public string Message { get; set; } = "";
    public string AuthorId { get; set; } = "";
}

/// <summary>Feature flag (§119) scoped by environment, org allow-list, country and percentage.</summary>
public class FeatureFlag : Entity
{
    public override string Object => "feature_flag";
    public string Key { get; set; } = "";
    public string Description { get; set; } = "";
    public bool Enabled { get; set; } = true;
    public int RolloutPercent { get; set; } = 100;
    public string? OrgIdsCsv { get; set; }
    public string? CountriesCsv { get; set; }
    public string Environment { get; set; } = "*";
    public DateTime UpdatedAt { get; set; }
}
