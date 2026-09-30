using Microsoft.EntityFrameworkCore;
using PaymentApp.Api.Common;
using PaymentApp.Api.Data;
using PaymentApp.Api.Infrastructure;
using PaymentApp.Api.Modules.Ledger;
using PaymentApp.Api.Modules.Payments;

namespace PaymentApp.Api.Modules.Compliance;

/// <summary>
/// Case management, four-eyes approvals, restrictions and financial adjustments (§62-§69, §155-§165).
/// Consequential actions are never executed by the person who requested them.
/// </summary>
public class ComplianceService(AppDb db, Uow uow, LedgerService ledger, IServiceProvider services)
{
    // Which approvals need which permission from the second reviewer (§165 approval matrix).
    public static readonly Dictionary<string, string> ApprovalPermission = new()
    {
        ["freeze_user"] = "admin.freeze",
        ["unfreeze_user"] = "admin.freeze",
        ["restrict_user"] = "admin.restrict",
        ["close_user"] = "admin.freeze",
        ["restrict_org"] = "admin.merchants.decide",
        ["suspend_org"] = "admin.merchants.decide",
        ["release_payout_hold"] = "admin.payouts.hold",
        ["ledger_adjustment"] = "admin.ledger.adjust",
        ["confirm_sanctions_match"] = "admin.sanctions.decide",
        ["release_transfer"] = "admin.aml.write",
        ["reject_transfer"] = "admin.aml.write",
        ["close_case"] = "admin.cases.decide",
        ["regulatory_report"] = "admin.regulatory.report",
    };

    public static int SlaDays(string priority) => priority switch { "CRITICAL" => 1, "HIGH" => 3, "MEDIUM" => 7, _ => 14 };

    public async Task<ComplianceCase> OpenCase(string subjectType, string subjectId, string title, string priority, IEnumerable<string> alertIds, string type = "aml")
    {
        return await uow.Run(async () =>
        {
            var c = new ComplianceCase
            {
                Id = Ids.New("case"), CreatedAt = uow.Now, UpdatedAt = uow.Now, Title = title, Type = type, SubjectType = subjectType, SubjectId = subjectId,
                Priority = priority, CreatedBy = uow.Ctx.ActorId, AssignedTo = uow.Ctx.ActorId, DueAt = uow.Now.AddDays(SlaDays(priority)),
            };
            db.Cases.Add(c);
            foreach (var id in alertIds)
            {
                var a = await db.Alerts.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound($"alert {id}");
                a.CaseId = c.Id;
                if (a.Status is "NEW" or "QUEUED") a.Status = "IN_REVIEW";
            }
            uow.Transition("case", c.Id, null, "OPEN");
            uow.Audit("case.open", "case", c.Id, after: new { subjectType, subjectId, priority, alerts = alertIds }, caseId: c.Id);
            return c;
        });
    }

    public async Task<CaseNote> AddNote(string caseId, string kind, string body, bool finalize)
    {
        return await uow.Run(async () =>
        {
            var c = await db.Cases.FirstOrDefaultAsync(x => x.Id == caseId) ?? throw ApiException.NotFound("case");
            if (c.Status == "CLOSED") throw ApiException.Conflict("case_closed", "Closed cases are read-only.");
            if (string.IsNullOrWhiteSpace(body)) throw ApiException.Invalid("Note body is required.");
            var n = new CaseNote { Id = Ids.New("cnote"), CreatedAt = uow.Now, CaseId = caseId, AuthorId = uow.Ctx.ActorId, Kind = kind, Body = body.Trim(), Finalized = finalize, FinalizedAt = finalize ? uow.Now : null };
            db.CaseNotes.Add(n);
            c.UpdatedAt = uow.Now;
            if (c.Status == "OPEN") { uow.Transition("case", c.Id, "OPEN", "IN_REVIEW"); c.Status = "IN_REVIEW"; }
            uow.Audit("case.note", "case", caseId, after: new { n.Id, kind, finalize }, caseId: caseId);
            await Task.CompletedTask;
            return n;
        });
    }

    public async Task<CaseNote> FinalizeNote(string noteId)
    {
        return await uow.Run(async () =>
        {
            var n = await db.CaseNotes.FirstOrDefaultAsync(x => x.Id == noteId) ?? throw ApiException.NotFound("note");
            if (n.Finalized) throw ApiException.Conflict("note_finalized", "Finalized notes are immutable.");
            if (n.AuthorId != uow.Ctx.ActorId) throw ApiException.Forbidden("Only the author can finalize a draft note.");
            n.Finalized = true;
            n.FinalizedAt = uow.Now;
            uow.Audit("case.note_finalize", "case_note", n.Id, caseId: n.CaseId);
            return n;
        });
    }

    /// <summary>Captures a point-in-time snapshot of any platform object, hashed for chain of custody (§99).</summary>
    public async Task<CaseEvidence> AddEvidence(string caseId, string refType, string refId, string description)
    {
        using var _ = db.Tenant.Elevate();
        object? snapshot = refType switch
        {
            "transfer" => await db.Transfers.AsNoTracking().FirstOrDefaultAsync(x => x.Id == refId),
            "payment" => await db.Payments.AsNoTracking().FirstOrDefaultAsync(x => x.Id == refId),
            "user" => await db.Users.AsNoTracking().FirstOrDefaultAsync(x => x.Id == refId),
            "bank_account" => await db.BankAccounts.AsNoTracking().FirstOrDefaultAsync(x => x.Id == refId),
            "alert" => await db.Alerts.AsNoTracking().FirstOrDefaultAsync(x => x.Id == refId),
            "screening_check" => await db.ScreeningChecks.AsNoTracking().FirstOrDefaultAsync(x => x.Id == refId),
            "organization" => await db.Organizations.AsNoTracking().FirstOrDefaultAsync(x => x.Id == refId),
            "kyc_check" => await db.KycChecks.AsNoTracking().FirstOrDefaultAsync(x => x.Id == refId),
            "ledger_transaction" => await db.LedgerTransactions.AsNoTracking().FirstOrDefaultAsync(x => x.Id == refId),
            "device" => await db.Devices.AsNoTracking().FirstOrDefaultAsync(x => x.Id == refId),
            _ => throw ApiException.Invalid("Unsupported evidence type."),
        };
        if (snapshot == null) throw ApiException.NotFound(refType);
        var json = Json.Serialize(snapshot);
        return await uow.Run(async () =>
        {
            var c = await db.Cases.FirstOrDefaultAsync(x => x.Id == caseId) ?? throw ApiException.NotFound("case");
            if (c.Status == "CLOSED") throw ApiException.Conflict("case_closed", "Closed cases are read-only.");
            var ev = new CaseEvidence
            {
                Id = Ids.New("cev"), CreatedAt = uow.Now, CaseId = caseId, Type = refType, RefType = refType, RefId = refId, Description = description,
                SnapshotJson = json, Sha256 = Crypto.Sha256Hex(json), CapturedBy = uow.Ctx.ActorId, Source = "platform_record",
            };
            db.CaseEvidence.Add(ev);
            uow.Audit("case.evidence", "case", caseId, after: new { ev.Id, refType, refId, ev.Sha256 }, caseId: caseId);
            await Task.CompletedTask;
            return ev;
        });
    }

    /// <summary>
    /// Records a case decision. Outcomes without customer impact close directly; restrictive or
    /// reporting outcomes open an approval request for a second reviewer (§68, §156).
    /// </summary>
    public async Task<object> Decide(string caseId, string decision, string reason)
    {
        var allowed = new[] { "FALSE_POSITIVE", "NO_FURTHER_ACTION", "CONTINUE_MONITORING", "REQUEST_INFORMATION", "RESTRICT", "FREEZE", "ESCALATE", "REPORT_WHERE_REQUIRED", "CLOSE" };
        if (!allowed.Contains(decision)) throw ApiException.Invalid("Unknown decision.");
        if (string.IsNullOrWhiteSpace(reason) || reason.Length < 10) throw ApiException.Invalid("Document the reasoning (at least 10 characters).");
        var c = await db.Cases.FirstOrDefaultAsync(x => x.Id == caseId) ?? throw ApiException.NotFound("case");
        if (c.Status == "CLOSED") throw ApiException.Conflict("case_closed", "Case is already closed.");
        switch (decision)
        {
            case "RESTRICT":
                return await RequestApproval(c.SubjectType == "org" ? "restrict_org" : "restrict_user", c.SubjectType, c.SubjectId, new { status = "TRANSFERS_DISABLED" }, reason, c.Id);
            case "FREEZE":
                return await RequestApproval("freeze_user", c.SubjectType, c.SubjectId, new { }, reason, c.Id);
            case "REPORT_WHERE_REQUIRED":
                return await RequestApproval("regulatory_report", "case", c.Id, new { }, reason, c.Id);
            case "CLOSE":
                return await RequestApproval("close_case", "case", c.Id, new { decision = "CLOSE" }, reason, c.Id);
        }
        return await uow.Run(async () =>
        {
            var closing = decision is "FALSE_POSITIVE" or "NO_FURTHER_ACTION" or "CONTINUE_MONITORING";
            var to = decision switch { "ESCALATE" => "ESCALATED", "REQUEST_INFORMATION" => "ACTION_REQUIRED", _ => "CLOSED" };
            uow.Transition("case", c.Id, c.Status, to, reason: decision);
            c.Status = to;
            c.Decision = decision;
            c.DecisionReason = reason;
            c.DecidedBy = uow.Ctx.ActorId;
            c.UpdatedAt = uow.Now;
            if (closing)
            {
                c.ClosedAt = uow.Now;
                foreach (var a in await db.Alerts.Where(a => a.CaseId == c.Id).ToListAsync())
                {
                    a.Status = decision == "FALSE_POSITIVE" ? "FALSE_POSITIVE" : "CLOSED";
                    a.Conclusion = decision == "FALSE_POSITIVE" ? "FALSE_POSITIVE" : "INCONCLUSIVE";
                    a.ResolvedAt = uow.Now;
                    a.ResolvedBy = uow.Ctx.ActorId;
                }
            }
            if (decision == "ESCALATE") c.Priority = c.Priority == "CRITICAL" ? "CRITICAL" : "HIGH";
            uow.Audit("case.decide", "case", c.Id, after: new { decision }, reason: reason, caseId: c.Id);
            await Task.CompletedTask;
            return (object)c;
        });
    }

    public async Task<ApprovalRequest> RequestApproval(string action, string targetType, string targetId, object payload, string reason, string? caseId)
    {
        if (!ApprovalPermission.ContainsKey(action)) throw ApiException.Invalid("Unknown action.");
        if (string.IsNullOrWhiteSpace(reason)) throw ApiException.Invalid("A reason is required.");
        return await uow.Run(async () =>
        {
            if (await db.Approvals.AnyAsync(a => a.Action == action && a.TargetId == targetId && a.Status == "pending"))
                throw ApiException.Conflict("approval_pending", "An identical request is already awaiting approval.");
            var a = new ApprovalRequest
            {
                Id = Ids.New("apr"), CreatedAt = uow.Now, Action = action, TargetType = targetType, TargetId = targetId, PayloadJson = Json.Serialize(payload),
                Reason = reason, CaseId = caseId, RequestedBy = uow.Ctx.ActorId,
            };
            db.Approvals.Add(a);
            uow.Audit("approval.request", "approval_request", a.Id, after: new { action, targetType, targetId }, reason: reason, caseId: caseId, approvalId: a.Id);
            await Task.CompletedTask;
            return a;
        });
    }

    public async Task<ApprovalRequest> DecideApproval(string approvalId, bool approve, string? note, RequestContext ctx)
    {
        var a = await db.Approvals.FirstOrDefaultAsync(x => x.Id == approvalId) ?? throw ApiException.NotFound("approval request");
        if (a.Status != "pending") throw ApiException.Conflict("approval_decided", "This request was already decided.");
        if (a.RequestedBy == ctx.ActorId) throw ApiException.Forbidden("Four-eyes control: you cannot approve your own request.");
        if (!ctx.AdminPermissions.Contains("admin.approve") || !ctx.AdminPermissions.Contains(ApprovalPermission[a.Action]))
            throw ApiException.Forbidden($"Approving '{a.Action}' requires admin.approve and {ApprovalPermission[a.Action]}.");
        await uow.Run(async () =>
        {
            a.Status = approve ? "approved" : "rejected";
            a.DecidedBy = ctx.ActorId;
            a.DecidedAt = uow.Now;
            a.DecisionNote = note;
            uow.Audit(approve ? "approval.approve" : "approval.reject", "approval_request", a.Id, reason: note, caseId: a.CaseId, approvalId: a.Id);
            await Task.CompletedTask;
        });
        if (!approve) return a;
        try
        {
            var result = await Execute(a);
            await uow.Run(async () => { a.Status = "executed"; a.ExecutedAt = uow.Now; a.ExecutionResult = result; await Task.CompletedTask; });
        }
        catch (ApiException ex)
        {
            await uow.Run(async () => { a.Status = "failed"; a.ExecutionResult = ex.Message; await Task.CompletedTask; });
        }
        return a;
    }

    private async Task<string> Execute(ApprovalRequest a)
    {
        var payload = System.Text.Json.JsonDocument.Parse(a.PayloadJson).RootElement;
        string? P(string key) => payload.TryGetProperty(key, out var v) ? v.ToString() : null;
        switch (a.Action)
        {
            case "freeze_user":
            case "unfreeze_user":
            case "restrict_user":
            case "close_user":
            {
                var status = a.Action switch { "freeze_user" => "FROZEN", "unfreeze_user" => "NORMAL", "close_user" => "CLOSED", _ => P("status") ?? "LIMITED" };
                await SetUserStatus(a.TargetId, status, a.Reason, a.CaseId, a.Id);
                return $"User {a.TargetId} is now {status}.";
            }
            case "restrict_org":
            case "suspend_org":
            {
                await uow.Run(async () =>
                {
                    var org = await db.Organizations.FirstOrDefaultAsync(o => o.Id == a.TargetId) ?? throw ApiException.NotFound("organization");
                    var before = new { org.Status, org.Restriction };
                    if (a.Action == "suspend_org") { uow.Transition("organization", org.Id, org.Status, "SUSPENDED", org.Id, a.Reason); org.Status = "SUSPENDED"; org.Restriction = "SUSPENDED"; }
                    else org.Restriction = P("restriction") ?? "PAYOUT_HOLD";
                    uow.Audit("organization.restrict", "organization", org.Id, before, new { org.Status, org.Restriction }, a.Reason, org.Id, a.CaseId, a.Id);
                });
                return $"Organization {a.TargetId} restricted.";
            }
            case "release_payout_hold":
            {
                await uow.Run(async () =>
                {
                    using var _ = db.Tenant.Elevate();
                    var p = await db.Payouts.FirstOrDefaultAsync(x => x.Id == a.TargetId) ?? throw ApiException.NotFound("payout");
                    if (p.Status != "ON_HOLD") throw ApiException.Conflict("invalid_state", "Payout is not on hold.");
                    uow.Transition("payout", p.Id, "ON_HOLD", "PENDING", p.OrgId, a.Reason);
                    p.Status = "PENDING";
                    p.HoldReason = null;
                    uow.Audit("payout.release_hold", "payout", p.Id, reason: a.Reason, orgId: p.OrgId, approvalId: a.Id);
                });
                return "Payout released.";
            }
            case "release_transfer":
            case "reject_transfer":
            {
                var wallet = services.GetRequiredService<Wallet.WalletService>();
                var t = await wallet.DecideHeld(a.TargetId, a.Action == "release_transfer", a.Reason);
                return $"Transfer {t.Id} is {t.Status}.";
            }
            case "ledger_adjustment":
                return await ExecuteAdjustment(a, P("org_id"), P("wallet_id"), long.Parse(P("amount")!), P("currency")!, bool.Parse(P("livemode") ?? "false"));
            case "confirm_sanctions_match":
            {
                await uow.Run(async () =>
                {
                    var alert = await db.Alerts.FirstOrDefaultAsync(x => x.Id == a.TargetId) ?? throw ApiException.NotFound("alert");
                    alert.Status = "ESCALATED";
                    alert.Conclusion = "TRUE_MATCH";
                    alert.ResolvedBy = a.DecidedBy;
                    alert.ResolvedAt = uow.Now;
                    var check = await db.ScreeningChecks.FirstOrDefaultAsync(s => s.AlertId == alert.Id);
                    if (check != null) { check.Result = "confirmed_match"; check.ReviewedBy = a.DecidedBy; }
                    uow.Audit("sanctions.confirm", "alert", alert.Id, reason: a.Reason, caseId: a.CaseId, approvalId: a.Id);
                });
                if (a.TargetType == "alert")
                {
                    var alert = await db.Alerts.FirstAsync(x => x.Id == a.TargetId);
                    if (alert.SubjectType == "user") await SetUserStatus(alert.SubjectId, "FROZEN", "Confirmed sanctions match: " + a.Reason, a.CaseId, a.Id);
                    if (alert.TransferId != null)
                    {
                        var wallet = services.GetRequiredService<Wallet.WalletService>();
                        var t = await db.Transfers.FirstAsync(x => x.Id == alert.TransferId);
                        if (t.Status == "HELD") await wallet.DecideHeld(t.Id, false, "Blocked: confirmed screening match");
                    }
                }
                return "Match confirmed; subject frozen and held funds blocked per policy.";
            }
            case "close_case":
            {
                await uow.Run(async () =>
                {
                    var c = await db.Cases.FirstAsync(x => x.Id == a.TargetId);
                    uow.Transition("case", c.Id, c.Status, "CLOSED", reason: a.Reason);
                    c.Status = "CLOSED";
                    c.Decision = "CLOSE";
                    c.DecisionReason = a.Reason;
                    c.DecidedBy = a.DecidedBy;
                    c.ClosedAt = uow.Now;
                    uow.Audit("case.close", "case", c.Id, reason: a.Reason, caseId: c.Id, approvalId: a.Id);
                    await Task.CompletedTask;
                });
                return "Case closed.";
            }
            case "regulatory_report":
            {
                var report = await BuildReportPackage(a.TargetId);
                await uow.Run(async () =>
                {
                    var c = await db.Cases.FirstAsync(x => x.Id == a.TargetId);
                    uow.Transition("case", c.Id, c.Status, "ESCALATED", reason: "report prepared");
                    c.Status = "ESCALATED";
                    c.Decision = "REPORT_WHERE_REQUIRED";
                    c.LegalHold = true;
                    foreach (var al in await db.Alerts.Where(x => x.CaseId == c.Id).ToListAsync()) al.Status = "REPORTED";
                    uow.Audit("regulatory.report_prepared", "case", c.Id, after: new { sha256 = Crypto.Sha256Hex(report) }, reason: a.Reason, caseId: c.Id, approvalId: a.Id);
                });
                return "Report package prepared for filing by the regulated entity's reporting officer; case placed on legal hold.";
            }
        }
        throw ApiException.Invalid("Unsupported action.");
    }

    public async Task SetUserStatus(string userId, string status, string reason, string? caseId, string? approvalId)
    {
        await uow.Run(async () =>
        {
            var u = await db.Users.FirstOrDefaultAsync(x => x.Id == userId) ?? throw ApiException.NotFound("user");
            var before = u.Status;
            uow.Transition("user", u.Id, u.Status, status, reason: reason);
            u.Status = status;
            var w = await db.Wallets.FirstOrDefaultAsync(x => x.OwnerType == "user" && x.OwnerId == u.Id);
            if (w != null) w.Status = status is "FROZEN" or "CLOSED" ? "frozen" : "active";
            if (status is "FROZEN" or "CLOSED")
                foreach (var s in await db.Sessions.Where(s => s.UserId == u.Id && s.RevokedAt == null && status == "CLOSED").ToListAsync()) s.RevokedAt = uow.Now;
            uow.Audit("user.status", "user", u.Id, new { status = before }, new { status }, reason, null, caseId, approvalId);
            db.Notifications.Add(new Notification
            {
                Id = Ids.New("ntf"), CreatedAt = uow.Now, UserId = u.Id, Channel = "in_app", Recipient = u.Email, Template = "account_review",
                Subject = "Your account needs attention",
                // Neutral wording: no reference to investigations or detection logic (§71, §128).
                Body = status == "NORMAL" ? "Your account is fully available again." : "Some account features are temporarily unavailable while we complete a review. Contact support if you have questions.",
                Category = "security",
            });
        });
    }

    private async Task<string> ExecuteAdjustment(ApprovalRequest a, string? orgId, string? walletId, long amount, string currency, bool livemode)
    {
        // Manual adjustments are always explicit ledger transactions with an approval reference (§204, §218).
        return await uow.Run(async () =>
        {
            using var _ = db.Tenant.Elevate();
            var adj = new Adjustment
            {
                Id = Ids.New("adj"), CreatedAt = uow.Now, OrgId = orgId, WalletId = walletId, Livemode = livemode, Amount = amount, Currency = currency,
                Reason = a.Reason, RequestedBy = a.RequestedBy, ApprovalId = a.Id, CaseId = a.CaseId,
            };
            var adjustAcct = await ledger.Platform(Accounts.Adjustments, currency, walletId != null ? Accounts.WalletLivemode : livemode);
            LedgerAccount target = walletId != null
                ? await ledger.WalletAccount(walletId, currency)
                : await ledger.Merchant(orgId ?? throw ApiException.Invalid("org_id or wallet_id required"), Accounts.MerchantAvailable, currency, livemode);
            var legs = amount >= 0
                ? new[] { Leg.Debit(adjustAcct, amount), Leg.Credit(target, amount) }
                : new[] { Leg.Debit(target, -amount), Leg.Credit(adjustAcct, -amount) };
            var ltx = await ledger.Post("adjustment", $"adjustment:{adj.Id}", $"Manual adjustment: {a.Reason}", "adjustment", adj.Id, orgId, walletId != null ? Accounts.WalletLivemode : livemode, legs);
            adj.LedgerTransactionId = ltx.Id;
            db.Adjustments.Add(adj);
            if (orgId != null)
                db.BalanceTransactions.Add(new BalanceTransaction
                {
                    Id = Ids.New("txn"), CreatedAt = uow.Now, OrgId = orgId, Livemode = livemode, Type = "adjustment", Amount = amount, Net = amount, Currency = currency,
                    SourceType = "adjustment", SourceId = adj.Id, Status = "available", AvailableOn = uow.Now, LedgerTransactionId = ltx.Id, Description = a.Reason,
                });
            uow.Audit("ledger.adjustment", "adjustment", adj.Id, after: new { amount, currency, orgId, walletId }, reason: a.Reason, orgId: orgId, caseId: a.CaseId, approvalId: a.Id);
            return $"Adjustment {adj.Id} posted as {ltx.Id}.";
        });
    }

    /// <summary>Evidence-linked case package (§100): summary, chronology, evidence index with hashes, decisions, approvals.</summary>
    public async Task<string> BuildReportPackage(string caseId)
    {
        using var _ = db.Tenant.Elevate();
        var c = await db.Cases.AsNoTracking().FirstAsync(x => x.Id == caseId);
        var alerts = await db.Alerts.AsNoTracking().Where(a => a.CaseId == caseId).ToListAsync();
        var notes = await db.CaseNotes.AsNoTracking().Where(n => n.CaseId == caseId && n.Finalized).OrderBy(n => n.CreatedAt).ToListAsync();
        var evidence = await db.CaseEvidence.AsNoTracking().Where(e => e.CaseId == caseId).OrderBy(e => e.CreatedAt).ToListAsync();
        var approvals = await db.Approvals.AsNoTracking().Where(a => a.CaseId == caseId).OrderBy(a => a.CreatedAt).ToListAsync();
        var transferIds = alerts.Where(a => a.TransferId != null).Select(a => a.TransferId!).ToList();
        var transfers = await db.Transfers.AsNoTracking().Where(t => transferIds.Contains(t.Id)).OrderBy(t => t.CreatedAt).ToListAsync();
        return Json.Serialize(new
        {
            @object = "case_report_package", generated_at = uow.Now, @case = c,
            alerts = alerts.Select(a => new { a.Id, a.RuleKey, a.Summary, a.Severity, a.Status, a.Reasons, a.CreatedAt }),
            chronology = transfers.Select(t => new { t.Id, t.CreatedAt, t.Type, t.Status, t.SourceAmount, t.SourceCurrency, t.DestinationAmount, t.DestinationCurrency, t.SenderWalletId, t.RecipientWalletId, t.BankAccountId }),
            notes = notes.Select(n => new { n.Id, n.Kind, n.Body, n.AuthorId, n.FinalizedAt }),
            evidence_index = evidence.Select(e => new { e.Id, e.Type, e.RefId, e.Description, e.Sha256, e.CapturedBy, e.CreatedAt }),
            approvals = approvals.Select(a => new { a.Id, a.Action, a.RequestedBy, a.DecidedBy, a.Status, a.DecidedAt }),
            disclaimer = "Prepared for review by the regulated entity's reporting officer. Contains no determination of wrongdoing.",
        });
    }
}

/// <summary>
/// Fund-flow investigation (§51-§53, §101-§105, §146-§148). Built from transfers and ledger lineage.
/// Direct movements are "actual"; onward movement of pooled balances is "inferred" and labelled so,
/// because fiat in a wallet is fungible and the platform must not claim to trace specific units.
/// </summary>
public class FundFlowService(AppDb db)
{
    public record Node(string Id, string Type, string Label, string? Country, string? OwnerType = null, string? OwnerId = null, string? Handle = null);
    public record Edge(string Id, string From, string To, string Type, long Amount, string Currency, DateTime At, string Status, string Relation, string? Note);

    public async Task<object> Graph(string userId, DateTime from, DateTime to)
    {
        var wallet = await db.Wallets.FirstOrDefaultAsync(w => w.OwnerType == "user" && w.OwnerId == userId) ?? throw ApiException.NotFound("wallet");
        var nodes = new Dictionary<string, Node>();
        var edges = new List<Edge>();
        await AddWalletNode(nodes, wallet);
        var transfers = await db.Transfers.Where(t => (t.SenderWalletId == wallet.Id || t.RecipientWalletId == wallet.Id) && t.CreatedAt >= from && t.CreatedAt <= to).OrderBy(t => t.CreatedAt).ToListAsync();
        foreach (var t in transfers) await AddTransferEdge(nodes, edges, t, "actual", null);
        var devices = await db.Devices.Where(d => d.UserId == userId).ToListAsync();
        foreach (var d in devices)
        {
            nodes.TryAdd(d.Id, new Node(d.Id, "device", d.Platform ?? d.UserAgent?.Split(' ').FirstOrDefault() ?? "device", d.LastCountry));
            edges.Add(new Edge($"uses:{d.Id}", wallet.Id, d.Id, "uses_device", 0, "", d.LastSeenAt, "", "signal", null));
        }
        return new
        {
            @object = "fund_flow_graph", subject = userId, period_start = from, period_end = to,
            nodes = nodes.Values, edges,
            totals = new
            {
                incoming = transfers.Where(t => t.RecipientWalletId == wallet.Id && t.Status == "COMPLETED").GroupBy(t => t.DestinationCurrency).ToDictionary(g => g.Key, g => g.Sum(t => t.DestinationAmount)),
                outgoing = transfers.Where(t => t.SenderWalletId == wallet.Id && t.Status is "COMPLETED" or "PROCESSING").GroupBy(t => t.SourceCurrency).ToDictionary(g => g.Key, g => g.Sum(t => t.SourceAmount)),
            },
        };
    }

    /// <summary>Follows money from one transfer: backwards to its funding and forwards through subsequent outflows.</summary>
    public async Task<object> Trace(string transferId, int maxHops = 3, int windowDays = 7)
    {
        var root = await db.Transfers.FirstOrDefaultAsync(t => t.Id == transferId) ?? throw ApiException.NotFound("transfer");
        var nodes = new Dictionary<string, Node>();
        var edges = new List<Edge>();
        await AddTransferEdge(nodes, edges, root, "actual", "Selected transaction");

        // Backwards: what funded the sender before this transfer.
        if (root.SenderWalletId != null)
        {
            var inflows = await db.Transfers.Where(t => t.RecipientWalletId == root.SenderWalletId && t.Status == "COMPLETED" && t.CreatedAt <= root.CreatedAt && t.CreatedAt >= root.CreatedAt.AddDays(-windowDays))
                .OrderByDescending(t => t.CreatedAt).Take(10).ToListAsync();
            foreach (var t in inflows) await AddTransferEdge(nodes, edges, t, "inferred_source", "Funds received by the sender before this transaction (pooled balance)");
        }
        // Forwards: breadth-first through later outflows of each recipient.
        var frontier = new List<(string Wallet, DateTime After)>();
        if (root.RecipientWalletId != null) frontier.Add((root.RecipientWalletId, root.CreatedAt));
        var seen = new HashSet<string> { root.Id };
        for (var hop = 1; hop <= maxHops && frontier.Count > 0 && edges.Count < 60; hop++)
        {
            var next = new List<(string, DateTime)>();
            foreach (var (walletId, after) in frontier)
            {
                var outs = await db.Transfers.Where(t => t.SenderWalletId == walletId && t.CreatedAt >= after && t.CreatedAt <= after.AddDays(windowDays) && t.Status != "CANCELLED" && t.Status != "FAILED")
                    .OrderBy(t => t.CreatedAt).Take(10).ToListAsync();
                foreach (var t in outs.Where(t => seen.Add(t.Id)))
                {
                    await AddTransferEdge(nodes, edges, t, "inferred_onward", $"Subsequent outflow, hop {hop} (pooled balance — not a claim that these are the same funds)");
                    if (t.RecipientWalletId != null) next.Add((t.RecipientWalletId, t.CreatedAt));
                }
            }
            frontier = next;
        }
        var ledgerTx = root.LedgerTransactionId == null ? null : await db.LedgerTransactions.FirstOrDefaultAsync(l => l.Id == root.LedgerTransactionId);
        return new
        {
            @object = "fund_trace", root = root.Id, window_days = windowDays, max_hops = maxHops, nodes = nodes.Values, edges,
            ledger_transaction = ledgerTx?.Id,
            legend = new { actual = "Recorded movement of this transaction", inferred_source = "Earlier inflows into the sender's pooled balance", inferred_onward = "Later outflows from the recipient's pooled balance" },
        };
    }

    /// <summary>Shared-signal network (§57, §102): investigation signals with strength, not proof.</summary>
    public async Task<object> Network(string userId)
    {
        var links = new List<object>();
        var myDevices = await db.Devices.Where(d => d.UserId == userId).Select(d => d.Fingerprint).ToListAsync();
        foreach (var d in await db.Devices.Where(d => myDevices.Contains(d.Fingerprint) && d.UserId != userId).ToListAsync())
            links.Add(new { user = d.UserId, signal = "shared_device", strength = "strong", detail = $"Same device fingerprint (last seen {d.LastSeenAt:yyyy-MM-dd})" });
        var myBanks = await db.BankAccounts.Where(b => b.OwnerId == userId).Select(b => b.Fingerprint).ToListAsync();
        foreach (var b in await db.BankAccounts.Where(b => myBanks.Contains(b.Fingerprint) && b.OwnerId != userId).ToListAsync())
            links.Add(new { user = b.OwnerId, signal = "shared_bank_account", strength = "strong", detail = $"Same destination account ****{b.Last4}" });
        var myIps = await db.Sessions.Where(s => s.UserId == userId && s.Ip != null).Select(s => s.Ip).Distinct().ToListAsync();
        foreach (var g in (await db.Sessions.Where(s => myIps.Contains(s.Ip) && s.UserId != userId).Select(s => new { s.UserId, s.Ip }).Distinct().ToListAsync()).GroupBy(x => x.UserId))
            links.Add(new { user = g.Key, signal = "shared_ip", strength = "weak", detail = $"{g.Count()} shared IP address(es) — may be a shared network, VPN or office" });
        var wallet = await db.Wallets.FirstOrDefaultAsync(w => w.OwnerType == "user" && w.OwnerId == userId);
        if (wallet != null)
        {
            var counterparties = await db.Transfers.Where(t => t.SenderWalletId == wallet.Id || t.RecipientWalletId == wallet.Id)
                .Select(t => t.SenderWalletId == wallet.Id ? t.RecipientWalletId : t.SenderWalletId).Where(x => x != null).Distinct().ToListAsync();
            var owners = await db.Wallets.Where(w => counterparties.Contains(w.Id)).ToListAsync();
            foreach (var o in owners) links.Add(new { user = o.OwnerId, signal = "direct_counterparty", strength = "direct", detail = $"Transacted with wallet {o.Handle}" });
        }
        var staff = (await db.Users.Where(u => u.PlatformRole != null).Select(u => u.Id).ToListAsync()).ToHashSet();
        var distinct = links.Select(l => System.Text.Json.JsonSerializer.SerializeToElement(l))
            .Where(l => !staff.Contains(l.GetProperty("user").GetString() ?? ""))
            .GroupBy(l => (l.GetProperty("user").GetString(), l.GetProperty("signal").GetString())).Select(g => g.First()).ToList();
        return new { @object = "counterparty_network", subject = userId, links = distinct, caution = "Shared signals are investigation leads. They are not evidence of wrongdoing on their own." };
    }

    private async Task AddWalletNode(Dictionary<string, Node> nodes, Data.Wallet w)
    {
        if (nodes.ContainsKey(w.Id)) return;
        string label = w.Handle;
        string? country = null;
        if (w.OwnerType == "user")
        {
            var u = await db.Users.FirstOrDefaultAsync(x => x.Id == w.OwnerId);
            label = $"{u?.Name} ({w.Handle})";
            country = u?.Country;
        }
        else
        {
            var o = await db.Organizations.FirstOrDefaultAsync(x => x.Id == w.OwnerId);
            label = $"{o?.Name} (business wallet)";
            country = o?.Country;
        }
        nodes[w.Id] = new Node(w.Id, w.OwnerType == "user" ? "user_wallet" : "merchant_wallet", label, country, w.OwnerType, w.OwnerId, w.Handle);
    }

    private async Task AddTransferEdge(Dictionary<string, Node> nodes, List<Edge> edges, Transfer t, string relation, string? note)
    {
        string from, to;
        if (t.SenderWalletId != null) { var w = await db.Wallets.FirstAsync(x => x.Id == t.SenderWalletId); await AddWalletNode(nodes, w); from = w.Id; }
        else if (t.SourceOrgId != null) { from = t.SourceOrgId; var o = await db.Organizations.FirstAsync(x => x.Id == t.SourceOrgId); nodes.TryAdd(from, new Node(from, "merchant", o.Name, o.Country)); }
        else { from = $"src:{t.FundingSource ?? "external"}:{t.Id}"; nodes.TryAdd(from, new Node(from, "funding_source", t.FundingSource ?? "external", t.SenderCountry)); }
        if (t.RecipientWalletId != null) { var w = await db.Wallets.FirstAsync(x => x.Id == t.RecipientWalletId); await AddWalletNode(nodes, w); to = w.Id; }
        else if (t.BankAccountId != null) { var b = await db.BankAccounts.FirstAsync(x => x.Id == t.BankAccountId); to = b.Id; nodes.TryAdd(to, new Node(to, "bank_account", $"{b.BankName} ****{b.Last4}", b.Country)); }
        else { to = $"dst:{t.Id}"; nodes.TryAdd(to, new Node(to, "external", "external", t.RecipientCountry)); }
        edges.Add(new Edge(t.Id, from, to, t.Type, t.SourceAmount, t.SourceCurrency, t.CreatedAt, t.Status, relation, note));
    }
}
