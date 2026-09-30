using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using PaymentApp.Api.Common;
using PaymentApp.Api.Data;

namespace PaymentApp.Api.Infrastructure;

/// <summary>
/// The authoritative write boundary (§82, §83, §197). Everything a financial operation touches —
/// operational state, ledger entries, audit log, state transitions and outbox events — commits in one
/// database transaction or not at all. Side effects (webhooks, notifications, monitoring) run later
/// from the outbox.
/// </summary>
public class Uow(AppDb db, RequestContext ctx, IClock clock)
{
    private IDbContextTransaction? _tx;
    private readonly List<AuditLog> _audits = [];
    private readonly List<(Event Event, Entity Source)> _events = [];

    public AppDb Db => db;
    public RequestContext Ctx => ctx;
    public DateTime Now => clock.UtcNow;
    public bool InTransaction => _tx != null;

    public async Task<T> Run<T>(Func<Task<T>> work)
    {
        if (_tx != null) return await work();
        // SQLite: BEGIN IMMEDIATE (serialized writers). Postgres: SERIALIZABLE.
        _tx = db.Database.IsSqlite()
            ? await db.Database.BeginTransactionAsync()
            : await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
        try
        {
            var result = await work();
            await FlushAsync();
            await _tx.CommitAsync();
            return result;
        }
        catch
        {
            await _tx.RollbackAsync();
            _audits.Clear();
            _events.Clear();
            db.ChangeTracker.Clear();
            throw;
        }
        finally
        {
            await _tx.DisposeAsync();
            _tx = null;
        }
    }

    public Task Run(Func<Task> work) => Run<bool>(async () => { await work(); return true; });

    /// <summary>Immutable, hash-chained audit record (§43, §87, §140).</summary>
    public void Audit(string action, string? objectType, string? objectId, object? before = null, object? after = null,
        string? reason = null, string? orgId = null, string? caseId = null, string? approvalId = null)
    {
        _audits.Add(new AuditLog
        {
            Id = Ids.New("aud"),
            At = clock.UtcNow,
            ActorType = ctx.ActorType,
            ActorId = ctx.ActorId,
            ActorRole = ctx.ActorRole,
            OrgId = orgId ?? ctx.OrgId,
            Action = action,
            ObjectType = objectType,
            ObjectId = objectId,
            BeforeJson = before == null ? null : Json.Serialize(before),
            AfterJson = after == null ? null : Json.Serialize(after),
            Reason = reason,
            Ip = ctx.Ip,
            RequestId = ctx.RequestId,
            CaseId = caseId,
            ApprovalId = approvalId,
        });
    }

    /// <summary>Every status change is timestamped and attributed (§19).</summary>
    public void Transition(string objectType, string objectId, string? from, string to, string? orgId = null, string? reason = null)
    {
        if (from == to) return;
        db.StateTransitions.Add(new StateTransition
        {
            Id = Ids.New("st"),
            CreatedAt = clock.UtcNow,
            ObjectType = objectType,
            ObjectId = objectId,
            OrgId = orgId ?? ctx.OrgId,
            FromState = from,
            ToState = to,
            ActorId = ctx.ActorId,
            Reason = reason,
            RequestId = ctx.RequestId,
        });
    }

    /// <summary>Domain event written to the outbox inside the same transaction (§58, §83).</summary>
    public Event Emit(string type, Entity obj, string? orgId, bool livemode, string? userId = null)
    {
        var e = new Event
        {
            Id = Ids.New("evt"),
            CreatedAt = clock.UtcNow,
            OrgId = orgId,
            Livemode = livemode,
            UserId = userId,
            Type = type,
            ObjectType = obj.Object,
            ObjectId = obj.Id,
            RequestId = ctx.RequestId,
        };
        _events.Add((e, obj));
        return e;
    }

    public Event Emit(string type, TenantEntity obj) => Emit(type, obj, obj.OrgId, obj.Livemode);

    private async Task FlushAsync()
    {
        await db.SaveChangesAsync();

        if (_events.Count > 0)
        {
            // Tenant fields are assigned on save, so take them from the persisted source object.
            foreach (var (e, source) in _events)
                if (source is TenantEntity t) { e.OrgId = t.OrgId; e.Livemode = t.Livemode; }
            foreach (var group in _events.GroupBy(x => (x.Event.OrgId, x.Event.Livemode)))
            {
                var (orgId, livemode) = group.Key;
                var seq = await db.Events.Where(e => e.OrgId == orgId && e.Livemode == livemode)
                    .Select(e => (long?)e.Sequence).MaxAsync() ?? 0;
                foreach (var (e, source) in group)
                {
                    // Snapshot at commit so the payload reflects the final state of this unit of work.
                    e.DataJson = Json.Serialize((object)source);
                    e.Sequence = ++seq;
                    db.Events.Add(e);
                    db.Outbox.Add(new OutboxMessage { EventId = e.Id, CreatedAt = e.CreatedAt });
                }
            }
            _events.Clear();
        }

        if (_audits.Count > 0)
        {
            var prev = await db.AuditLogs.OrderByDescending(a => a.Seq).Select(a => a.Hash).FirstOrDefaultAsync() ?? "genesis";
            foreach (var a in _audits)
            {
                a.PrevHash = prev;
                a.Hash = AuditChain.Hash(a);
                prev = a.Hash;
                db.AuditLogs.Add(a);
            }
            _audits.Clear();
        }
        await db.SaveChangesAsync();
    }
}

public static class AuditChain
{
    public static string Hash(AuditLog a) => Crypto.Sha256Hex(string.Join("|",
        a.PrevHash, a.Id, a.At.ToString("O"), a.ActorType, a.ActorId, a.OrgId, a.Action, a.ObjectType, a.ObjectId,
        a.BeforeJson, a.AfterJson, a.Reason, a.RequestId, a.CaseId, a.ApprovalId));

    /// <summary>Recomputes the chain; any edited, deleted or reordered row breaks verification.</summary>
    public static async Task<(bool Valid, long Checked, long? BrokenAtSeq)> VerifyAsync(AppDb db)
    {
        var prev = "genesis";
        long count = 0;
        await foreach (var a in db.AuditLogs.AsNoTracking().OrderBy(a => a.Seq).AsAsyncEnumerable())
        {
            if (a.PrevHash != prev || Hash(a) != a.Hash) return (false, count, a.Seq);
            prev = a.Hash;
            count++;
        }
        return (true, count, null);
    }
}
