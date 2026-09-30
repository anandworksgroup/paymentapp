using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using PaymentApp.Api.Common;
using PaymentApp.Api.Data;
using PaymentApp.Api.Infrastructure;
using PaymentApp.Api.Modules.Checkout;
using PaymentApp.Api.Modules.Delivery;
using PaymentApp.Api.Modules.Growth;
using PaymentApp.Api.Modules.Identity;
using PaymentApp.Api.Modules.Payouts;
using PaymentApp.Api.Modules.Platform;
using PaymentApp.Api.Modules.Risk;

namespace PaymentApp.Api.Endpoints;

public record RiskRuleRequest(string? Name, string? Field, string? Operator, string? Value, string? Action, bool? Enabled, int? Priority);
public record AssetRequest(string FileId, string? Name, int? MaxDownloads, int? LinkDays);
public record GrantResetRequest(int? MaxDownloads, int? ExtendDays, string? Reason);
public record ExportRequest(string Type, string? Format, DateTime? From, DateTime? To);
public record RetentionUpdateRequest(int? Days, bool? Enabled, string? Reason);
public record RoleRequest(string? Name, string? Description, string[]? Permissions);
public record ScimTokenRequest(string? DefaultRole);
public record EmailRequest(string Email);
public record EmailCodeRequest(string Email, string Code);
public record MagicLinkRequest(string Token);
public record PasswordResetConfirmRequest(string Token, string Password);
public record BankStatementRequest(string Content, string Currency, string? AccountLabel);
public record LineMatchRequest(string Payout);
public record LineStatusRequest(bool Ignore, string? Note);
public record PaymentRequestCreate(string? Customer, string? Email, long Amount, string Currency, string Description, string? TaxCategory, int? ExpiresInDays, string? Note, bool? Send);

/// <summary>Risk rules, digital delivery, exports, retention, roles/SCIM, passwordless sign-in, bank reconciliation and payment requests.</summary>
public static class TrustEndpoints
{
    public static void Map(WebApplication app)
    {
        // ───────── Merchant risk rules (§22) ─────────
        var risk = app.MapGroup("/v1/risk/rules").WithTags("Risk");
        risk.MapGet("/", async (RequestContext ctx, AppDb db) =>
        {
            ctx.RequireOrg("payments.read");
            return new { @object = "list", data = await db.RiskRules.OrderBy(r => r.Priority).ThenBy(r => r.CreatedAt).ToListAsync(), fields = RiskRuleService.Fields, operators = RiskRuleService.Operators, actions = RiskRuleService.Actions };
        });
        risk.MapPost("/", async (RiskRuleRequest r, RequestContext ctx, AppDb db, Uow uow) =>
        {
            ctx.RequireOrg("payments.write");
            if (string.IsNullOrWhiteSpace(r.Name) || r.Name.Length > 80) throw ApiException.Invalid("name is required (max 80 characters).");
            RiskRuleService.Validate(r.Field ?? "", r.Operator ?? "", r.Value ?? "", r.Action ?? "");
            if (await db.RiskRules.CountAsync() >= 100) throw ApiException.Invalid("At most 100 rules.");
            return Results.Json(await uow.Run(async () =>
            {
                var rule = new RiskRule
                {
                    Id = Ids.New("rrule"), CreatedAt = uow.Now, UpdatedAt = uow.Now, Name = r.Name.Trim(), Field = r.Field!, Operator = r.Operator!, Value = r.Value!.Trim(),
                    Action = r.Action!, Enabled = r.Enabled ?? true, Priority = r.Priority ?? 100, CreatedBy = uow.Ctx.ActorId,
                };
                db.RiskRules.Add(rule);
                uow.Audit("risk_rule.create", "risk_rule", rule.Id, after: new { rule.Name, rule.Field, rule.Operator, rule.Value, rule.Action, rule.Priority });
                await Task.CompletedTask;
                return rule;
            }), statusCode: 201);
        });
        risk.MapPatch("/{id}", async (string id, RiskRuleRequest r, RequestContext ctx, AppDb db, Uow uow) =>
        {
            ctx.RequireOrg("payments.write");
            return await uow.Run(async () =>
            {
                var rule = await db.RiskRules.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("risk rule");
                var before = new { rule.Name, rule.Field, rule.Operator, rule.Value, rule.Action, rule.Enabled, rule.Priority };
                RiskRuleService.Validate(r.Field ?? rule.Field, r.Operator ?? rule.Operator, r.Value ?? rule.Value, r.Action ?? rule.Action);
                if (r.Name != null) { if (string.IsNullOrWhiteSpace(r.Name) || r.Name.Length > 80) throw ApiException.Invalid("name is required (max 80 characters)."); rule.Name = r.Name.Trim(); }
                rule.Field = r.Field ?? rule.Field; rule.Operator = r.Operator ?? rule.Operator; rule.Value = r.Value?.Trim() ?? rule.Value; rule.Action = r.Action ?? rule.Action;
                rule.Enabled = r.Enabled ?? rule.Enabled; rule.Priority = r.Priority ?? rule.Priority; rule.UpdatedAt = uow.Now;
                uow.Audit("risk_rule.update", "risk_rule", rule.Id, before, new { rule.Name, rule.Field, rule.Operator, rule.Value, rule.Action, rule.Enabled, rule.Priority });
                await Task.CompletedTask;
                return rule;
            });
        });
        risk.MapDelete("/{id}", async (string id, RequestContext ctx, AppDb db, Uow uow) =>
        {
            ctx.RequireOrg("payments.write");
            await uow.Run(async () =>
            {
                var rule = await db.RiskRules.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("risk rule");
                db.RiskRules.Remove(rule);
                uow.Audit("risk_rule.delete", "risk_rule", rule.Id, before: new { rule.Name, rule.Field, rule.Operator, rule.Value, rule.Action });
                await Task.CompletedTask;
            });
            return Results.NoContent();
        });
        risk.MapPost("/test", async (RiskRuleRequest r, RequestContext ctx, RiskRuleService rules) =>
        {
            ctx.RequireOrg("payments.read");
            return await rules.Backtest(r.Field ?? "", r.Operator ?? "", r.Value ?? "", r.Action ?? "review");
        });

        // ───────── Digital delivery (§52, §291) ─────────
        app.MapGet("/v1/products/{id}/assets", async (string id, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireOrg("products.read");
            var assets = await db.ProductAssets.Where(a => a.ProductId == id && a.Active).OrderBy(a => a.CreatedAt).ToListAsync();
            var fileIds = assets.Select(a => a.FileId).ToList();
            var files = await db.Files.Where(f => fileIds.Contains(f.Id)).ToDictionaryAsync(f => f.Id);
            return new { @object = "list", data = assets.Select(a => new { asset = a, file = files.TryGetValue(a.FileId, out var f) ? new { f.FileName, f.ContentType, f.Size, f.ScanStatus } : null }) };
        }).WithTags("Catalog & Customers");
        app.MapPost("/v1/products/{id}/assets", async (string id, AssetRequest r, RequestContext ctx, DeliveryService delivery) =>
        {
            ctx.RequireOrg("products.write");
            return Results.Json(await delivery.AddAsset(id, r.FileId, r.Name, r.MaxDownloads, r.LinkDays), statusCode: 201);
        }).WithTags("Catalog & Customers");
        app.MapDelete("/v1/products/{id}/assets/{assetId}", async (string id, string assetId, RequestContext ctx, AppDb db, Uow uow) =>
        {
            ctx.RequireOrg("products.write");
            await uow.Run(async () =>
            {
                var a = await db.ProductAssets.FirstOrDefaultAsync(x => x.Id == assetId && x.ProductId == id) ?? throw ApiException.NotFound("asset");
                // New buyers stop getting it; people who already bought keep their links.
                a.Active = false;
                uow.Audit("product.asset_remove", "product", id, before: new { asset = a.Id });
                await Task.CompletedTask;
            });
            return Results.NoContent();
        }).WithTags("Catalog & Customers");
        app.MapGet("/v1/customers/{id}/downloads", async (string id, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireOrg("customers.read");
            return new { @object = "list", data = await db.DownloadGrants.Where(g => g.CustomerId == id).OrderByDescending(g => g.CreatedAt).ToListAsync() };
        }).WithTags("Catalog & Customers");
        app.MapPost("/v1/download_grants/{id}/reset", async (string id, GrantResetRequest r, RequestContext ctx, DeliveryService delivery) =>
        {
            ctx.RequireOrg("customers.write");
            return await delivery.Reset(id, r.MaxDownloads, r.ExtendDays, r.Reason);
        }).WithTags("Catalog & Customers");
        app.MapPost("/v1/download_grants/{id}/link", async (string id, RequestContext ctx, AppDb db, DeliveryService delivery) =>
        {
            ctx.RequireOrg("customers.write");
            var g = await db.DownloadGrants.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("download");
            var (grant, url) = await delivery.Rotate(id, g.CustomerId);
            return new { grant, url, note = "The previous link for this file no longer works. Send this one to the customer." };
        }).WithTags("Catalog & Customers");
        app.MapGet("/v1/public/downloads/{token}", async (string token, HttpContext http, DeliveryService delivery, RequestContext ctx) =>
        {
            var (file, content) = await delivery.Download(token, ctx.Ip);
            http.Response.Headers["X-Content-Type-Options"] = "nosniff";
            http.Response.Headers["Cache-Control"] = "no-store";
            return Results.File(content, file.ContentType, file.FileName);
        }).WithTags("Public checkout").RequireRateLimiting("public");
        app.MapGet("/v1/portal/{token}/downloads", async (string token, AppDb db, IConfiguration config, IClock clock) =>
        {
            var (customer, scope) = await PortalToken.Resolve(token, db, config, clock);
            using (scope)
            {
                var grants = await db.DownloadGrants.Where(g => g.CustomerId == customer.Id).OrderByDescending(g => g.CreatedAt).ToListAsync();
                var active = (await db.Entitlements.Where(e => e.CustomerId == customer.Id && e.Status == "active").Select(e => e.Id).ToListAsync()).ToHashSet();
                return new { @object = "list", data = grants.Select(g => new { g.Id, g.AssetName, g.Downloads, g.MaxDownloads, g.ExpiresAt, available = active.Contains(g.EntitlementId) && (g.ExpiresAt == null || g.ExpiresAt > clock.UtcNow) && g.Downloads < g.MaxDownloads }) };
            }
        }).WithTags("Customer portal");
        app.MapPost("/v1/portal/{token}/downloads/{id}/link", async (string token, string id, AppDb db, IConfiguration config, IClock clock, DeliveryService delivery) =>
        {
            var (customer, scope) = await PortalToken.Resolve(token, db, config, clock);
            using (scope)
            {
                var (grant, url) = await delivery.Rotate(id, customer.Id);
                return new { url, downloads_left = grant.MaxDownloads - grant.Downloads, expires_at = grant.ExpiresAt };
            }
        }).WithTags("Customer portal");

        // ───────── Exports (§97) ─────────
        var exp = app.MapGroup("/v1/exports").WithTags("Reports");
        exp.MapPost("/", async (ExportRequest r, RequestContext ctx, ExportService exports) =>
        {
            ctx.RequireOrg("reports.read");
            return Results.Json(await exports.Request(r.Type, r.Format ?? "csv", r.From, r.To), statusCode: 202);
        });
        exp.MapGet("/", async (HttpRequest req, RequestContext ctx, AppDb db) => { ctx.RequireOrg("reports.read"); return await Paging.List(db.Exports, req); });
        exp.MapGet("/{id}", async (string id, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireOrg("reports.read");
            return await db.Exports.FirstOrDefaultAsync(e => e.Id == id) ?? throw ApiException.NotFound("export");
        });
        exp.MapPost("/{id}/link", async (string id, RequestContext ctx, AppDb db, FileService files, Uow uow) =>
        {
            ctx.RequireOrg("reports.read");
            var job = await db.Exports.FirstOrDefaultAsync(e => e.Id == id) ?? throw ApiException.NotFound("export");
            if (job.Status == "expired") throw new ApiException(410, "export_expired", "This export has expired. Run it again.");
            if (job.Status != "completed" || job.FileId == null) throw ApiException.Conflict("export_not_ready", $"The export is {job.Status}.");
            var file = await db.Files.FirstAsync(f => f.Id == job.FileId);
            var (token, expires) = files.SignLink(file, TimeSpan.FromMinutes(5));
            uow.Audit("export.download_link", "export", job.Id);
            await db.SaveChangesAsync();
            return new { url = $"/v1/files/download/{token}", expires_at = expires, file = new { file.FileName, file.Size, file.ContentType } };
        });

        // ───────── Retention (§115) ─────────
        app.MapGet("/v1/admin/retention", async (RequestContext ctx, AppDb db) =>
        {
            ctx.RequireAdmin("admin.overview");
            await RetentionService.EnsureDefaults(db);
            return new
            {
                @object = "retention_policies", data = await db.RetentionPolicies.OrderBy(p => p.DataClass).ToListAsync(), financial_records = RetentionService.FinancialNote,
                recent_runs = await db.RetentionRuns.OrderByDescending(r => r.CreatedAt).Take(10).ToListAsync(),
            };
        }).WithTags("Admin");
        app.MapPut("/v1/admin/retention/{dataClass}", async (string dataClass, RetentionUpdateRequest r, RequestContext ctx, RetentionService retention) =>
        {
            ctx.RequireAdmin("admin.config.manage");
            return await retention.Update(dataClass, r.Days, r.Enabled, r.Reason);
        }).WithTags("Admin");
        app.MapPost("/v1/admin/retention/run", async (HttpRequest req, RequestContext ctx, RetentionService retention) =>
        {
            ctx.RequireAdmin("admin.config.manage");
            return await retention.Run(req.Query["dry_run"] != "false", ctx.ActorId);
        }).WithTags("Admin");
        app.MapGet("/v1/retention", async (RequestContext ctx, AppDb db) =>
        {
            ctx.RequireMember();
            await RetentionService.EnsureDefaults(db);
            return new { @object = "retention_policies", data = (await db.RetentionPolicies.OrderBy(p => p.DataClass).ToListAsync()).Select(p => new { p.DataClass, p.Description, p.Days, p.Enabled }), financial_records = RetentionService.FinancialNote };
        }).WithTags("Me");

        // ───────── Custom roles and SCIM (§173) ─────────
        var roles = app.MapGroup("/v1/roles").WithTags("Organization");
        roles.MapGet("/", async (RequestContext ctx, RoleService svc) => await svc.List(ctx.RequireOrg("team.read")));
        roles.MapPost("/", async (RoleRequest r, RequestContext ctx, RoleService svc) =>
            Results.Json(await svc.Create(ctx.RequireOrg("team.manage"), r.Name ?? "", r.Description, r.Permissions), statusCode: 201));
        roles.MapPatch("/{key}", async (string key, RoleRequest r, RequestContext ctx, RoleService svc) => { ctx.RequireOrg("team.manage"); return await svc.Update(key, r.Name, r.Description, r.Permissions); });
        roles.MapDelete("/{key}", async (string key, RequestContext ctx, RoleService svc) => { await svc.Delete(ctx.RequireOrg("team.manage"), key); return Results.NoContent(); });

        app.MapGet("/v1/organization/scim_tokens", async (RequestContext ctx, AppDb db) =>
        {
            ctx.RequireOrg("team.manage");
            return new { @object = "list", data = await db.ScimTokens.OrderByDescending(t => t.CreatedAt).ToListAsync(), base_url = "/scim/v2" };
        }).WithTags("Organization");
        app.MapPost("/v1/organization/scim_tokens", async (ScimTokenRequest r, RequestContext ctx, ScimService scim, IClock clock) =>
        {
            var orgId = ctx.RequireOrg("team.manage");
            ctx.RequireStepUp(clock);
            string? secret = null;
            var t = await scim.CreateToken(orgId, r.DefaultRole ?? "analyst", ctx.ActorId, s => { secret = s; return Task.CompletedTask; });
            return Results.Json(new { scim_token = t, token = secret, base_url = "/scim/v2", note = "Copy the token now: it's shown once. Paste it with the base URL into your identity provider." }, statusCode: 201);
        }).WithTags("Organization");
        app.MapDelete("/v1/organization/scim_tokens/{id}", async (string id, RequestContext ctx, AppDb db, Uow uow) =>
        {
            ctx.RequireOrg("team.manage");
            await uow.Run(async () =>
            {
                var t = await db.ScimTokens.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("SCIM token");
                t.RevokedAt ??= uow.Now;
                uow.Audit("scim.token_revoke", "scim_token", t.Id);
                await Task.CompletedTask;
            });
            return Results.NoContent();
        }).WithTags("Organization");

        var scim = app.MapGroup("/scim/v2").WithTags("SCIM");
        static string Base(HttpRequest req) => $"{req.Scheme}://{req.Host}";
        static ScimToken Require(RequestContext ctx) => ctx.ScimToken ?? throw new ScimException(401, "A SCIM bearer token is required.");
        // SCIM attribute names are camelCase by specification, unlike the rest of this API.
        var scimJson = new JsonSerializerOptions(JsonSerializerDefaults.Web) { PropertyNamingPolicy = null, DictionaryKeyPolicy = null };
        async Task<IResult> Scim(Func<Task<object?>> run, int ok = 200)
        {
            try
            {
                var result = await run();
                return result == null ? Results.NoContent() : Results.Json(result, scimJson, "application/scim+json", ok);
            }
            catch (ScimException ex)
            {
                return Results.Json(new Dictionary<string, object?> { ["schemas"] = new[] { "urn:ietf:params:scim:api:messages:2.0:Error" }, ["status"] = ex.Status.ToString(), ["scimType"] = ex.ScimType, ["detail"] = ex.Message },
                    scimJson, "application/scim+json", ex.Status);
            }
        }
        static async Task<JsonElement> Body(HttpRequest req)
        {
            try { return (await JsonDocument.ParseAsync(req.Body)).RootElement; }
            catch (JsonException) { throw new ScimException(400, "The body must be JSON.", "invalidSyntax"); }
        }
        scim.MapGet("/ServiceProviderConfig", () => Results.Json(new Dictionary<string, object>
        {
            ["schemas"] = new[] { "urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig" },
            ["patch"] = new { supported = true }, ["bulk"] = new { supported = false, maxOperations = 0, maxPayloadSize = 0 },
            ["filter"] = new { supported = true, maxResults = 200 }, ["changePassword"] = new { supported = false }, ["sort"] = new { supported = false }, ["etag"] = new { supported = false },
            ["authenticationSchemes"] = new[] { new { type = "oauthbearertoken", name = "Bearer token", description = "Organization SCIM token" } },
        }, scimJson, "application/scim+json"));
        scim.MapGet("/Users", (HttpRequest req, RequestContext ctx, ScimService svc) => Scim(async () =>
        {
            var t = Require(ctx);
            int.TryParse(req.Query["startIndex"], out var start);
            var count = int.TryParse(req.Query["count"], out var c) ? c : 100;
            return await svc.List(t.OrgId, req.Query["filter"], start == 0 ? 1 : start, count, Base(req));
        }));
        scim.MapGet("/Users/{id}", (string id, HttpRequest req, RequestContext ctx, ScimService svc) => Scim(async () => await svc.Get(Require(ctx).OrgId, id, Base(req))));
        scim.MapPost("/Users", (HttpRequest req, RequestContext ctx, ScimService svc) => Scim(async () => await svc.Create(Require(ctx), await Body(req), Base(req)), 201));
        scim.MapPut("/Users/{id}", (string id, HttpRequest req, RequestContext ctx, ScimService svc) => Scim(async () => await svc.Replace(Require(ctx).OrgId, id, await Body(req), Base(req))));
        scim.MapPatch("/Users/{id}", (string id, HttpRequest req, RequestContext ctx, ScimService svc) => Scim(async () => await svc.Patch(Require(ctx).OrgId, id, await Body(req), Base(req))));
        scim.MapDelete("/Users/{id}", (string id, RequestContext ctx, ScimService svc) => Scim(async () => { await svc.Delete(Require(ctx).OrgId, id); return null; }));

        // ───────── Passwordless sign-in and password reset (§7) ─────────
        var auth = app.MapGroup("/v1/auth").WithTags("Auth");
        auth.MapPost("/email_code", async (EmailRequest r, PasswordlessService pw) => Results.Json(await pw.RequestSignIn(r.Email), statusCode: 202)).RequireRateLimiting("public");
        auth.MapPost("/email_code/verify", async (EmailCodeRequest r, PasswordlessService pw) => await pw.VerifyCode(r.Email, r.Code)).RequireRateLimiting("public");
        auth.MapPost("/magic_link/verify", async (MagicLinkRequest r, PasswordlessService pw) => await pw.VerifyLink(r.Token)).RequireRateLimiting("public");
        auth.MapPost("/password_reset", async (EmailRequest r, PasswordlessService pw) => Results.Json(await pw.RequestPasswordReset(r.Email), statusCode: 202)).RequireRateLimiting("public");
        auth.MapPost("/password_reset/confirm", async (PasswordResetConfirmRequest r, PasswordlessService pw) => await pw.ConfirmPasswordReset(r.Token, r.Password)).RequireRateLimiting("public");

        // ───────── Bank-statement reconciliation (§229) ─────────
        var bank = app.MapGroup("/v1/bank_statements").WithTags("Balance & payouts");
        bank.MapPost("/", async (BankStatementRequest r, RequestContext ctx, BankReconciliationService recon) =>
        {
            ctx.RequireOrg("payouts.manage");
            return Results.Json(await recon.Import(r.Content, r.Currency, r.AccountLabel), statusCode: 201);
        });
        bank.MapGet("/", async (HttpRequest req, RequestContext ctx, AppDb db) => { ctx.RequireOrg("payouts.read"); return await Paging.List(db.BankStatements, req); });
        bank.MapGet("/{id}", async (string id, RequestContext ctx, AppDb db, BankReconciliationService recon) =>
        {
            ctx.RequireOrg("payouts.read");
            return await recon.Detail(await db.BankStatements.FirstOrDefaultAsync(s => s.Id == id) ?? throw ApiException.NotFound("bank statement"));
        });
        bank.MapPost("/{id}/lines/{lineId}/match", async (string id, string lineId, LineMatchRequest r, RequestContext ctx, BankReconciliationService recon) =>
        {
            ctx.RequireOrg("payouts.manage");
            return await recon.Match(id, lineId, r.Payout);
        });
        bank.MapPost("/{id}/lines/{lineId}/status", async (string id, string lineId, LineStatusRequest r, RequestContext ctx, BankReconciliationService recon) =>
        {
            ctx.RequireOrg("payouts.manage");
            return await recon.SetStatus(id, lineId, r.Ignore, r.Note);
        });

        // ───────── Payment requests (§253, §254) ─────────
        var preq = app.MapGroup("/v1/payment_requests").WithTags("Checkout");
        preq.MapPost("/", async (PaymentRequestCreate r, RequestContext ctx, PaymentRequestService svc) =>
        {
            ctx.RequireOrg("payments.write");
            return Results.Json(await svc.Create(r.Customer, r.Email, r.Amount, r.Currency, r.Description, r.TaxCategory, r.ExpiresInDays, r.Note, r.Send ?? true), statusCode: 201);
        });
        preq.MapGet("/", async (HttpRequest req, RequestContext ctx, AppDb db, Uow uow, PaymentRequestService svc) =>
        {
            ctx.RequireOrg("payments.read");
            var q = db.PaymentRequests.AsQueryable();
            if (req.Query["customer"].FirstOrDefault() is { Length: > 0 } c) q = q.Where(x => x.CustomerId == c);
            var list = await q.OrderByDescending(x => x.CreatedAt).Take(200).ToListAsync();
            await uow.Run(async () => { foreach (var r in list) await svc.Sync(r); });
            var status = req.Query["status"].FirstOrDefault();
            return new { @object = "list", data = list.Where(r => string.IsNullOrEmpty(status) || r.Status == status).Select(svc.View) };
        });
        preq.MapGet("/{id}", async (string id, RequestContext ctx, AppDb db, Uow uow, PaymentRequestService svc) =>
        {
            ctx.RequireOrg("payments.read");
            var r = await db.PaymentRequests.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("payment request");
            await uow.Run(async () => await svc.Sync(r));
            return svc.View(r);
        });
        preq.MapPost("/{id}/remind", async (string id, RequestContext ctx, PaymentRequestService svc) => { ctx.RequireOrg("payments.write"); return await svc.Remind(id); });
        preq.MapPost("/{id}/cancel", async (string id, RequestContext ctx, PaymentRequestService svc) => { ctx.RequireOrg("payments.write"); return await svc.Cancel(id); });
    }
}
