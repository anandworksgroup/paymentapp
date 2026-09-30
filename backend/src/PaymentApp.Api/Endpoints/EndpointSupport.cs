using System.Text;
using Microsoft.EntityFrameworkCore;
using PaymentApp.Api.Common;
using PaymentApp.Api.Data;

namespace PaymentApp.Api.Endpoints;

public static class Paging
{
    /// <summary>Cursor pagination (§235): starting_after / ending_before over (created_at desc, id desc).</summary>
    public static async Task<object> List<T>(IQueryable<T> q, HttpRequest req) where T : Entity
    {
        var take = Math.Clamp(int.TryParse(req.Query["limit"], out var l) ? l : 25, 1, 100);
        var after = req.Query["starting_after"].FirstOrDefault();
        var before = req.Query["ending_before"].FirstOrDefault();
        if (!string.IsNullOrEmpty(after))
        {
            var a = await q.FirstOrDefaultAsync(x => x.Id == after) ?? throw ApiException.Invalid("starting_after refers to an unknown object.");
            q = q.Where(x => x.CreatedAt < a.CreatedAt || (x.CreatedAt == a.CreatedAt && x.Id.CompareTo(a.Id) < 0));
        }
        if (!string.IsNullOrEmpty(before))
        {
            var b = await q.FirstOrDefaultAsync(x => x.Id == before) ?? throw ApiException.Invalid("ending_before refers to an unknown object.");
            var older = await q.Where(x => x.CreatedAt > b.CreatedAt || (x.CreatedAt == b.CreatedAt && x.Id.CompareTo(b.Id) > 0))
                .OrderBy(x => x.CreatedAt).ThenBy(x => x.Id).Take(take + 1).ToListAsync();
            return new { @object = "list", data = older.Take(take).Reverse(), has_more = older.Count > take };
        }
        var items = await q.OrderByDescending(x => x.CreatedAt).ThenByDescending(x => x.Id).Take(take + 1).ToListAsync();
        return new { @object = "list", data = items.Take(take), has_more = items.Count > take };
    }

    /// <summary>Adds extra fields to each serialized row of a list page (opt-in via ?expand=…).</summary>
    public static async Task<object> Expand(object page, Func<IEnumerable<Entity>, Task<Dictionary<string, object>>> extras)
    {
        var node = System.Text.Json.Nodes.JsonNode.Parse(Json.Serialize(page))!;
        var rows = (IEnumerable<Entity>)page.GetType().GetProperty("data")!.GetValue(page)!;
        var extra = await extras(rows.ToList());
        foreach (var row in node["data"]!.AsArray())
        {
            var id = row!["id"]!.GetValue<string>();
            if (!extra.TryGetValue(id, out var add)) continue;
            foreach (var kv in System.Text.Json.Nodes.JsonNode.Parse(Json.Serialize(add))!.AsObject().ToList())
                row[kv.Key] = kv.Value?.DeepClone();
        }
        return node;
    }

    public static DateTime? Date(HttpRequest req, string key) =>
        DateTime.TryParse(req.Query[key], null, System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal, out var d) ? d : null;
}

public static class Csv
{
    public static string Write<T>(IEnumerable<T> rows, params (string Header, Func<T, object?> Value)[] cols)
    {
        var sb = new StringBuilder();
        sb.AppendLine(string.Join(",", cols.Select(c => c.Header)));
        foreach (var r in rows) sb.AppendLine(string.Join(",", cols.Select(c => Escape(c.Value(r)))));
        return sb.ToString();
    }

    private static string Escape(object? v)
    {
        var s = v switch { null => "", DateTime d => d.ToString("yyyy-MM-ddTHH:mm:ssZ"), _ => v.ToString() ?? "" };
        // Neutralise spreadsheet formula injection.
        if (s.Length > 0 && "=+-@".Contains(s[0]) && !long.TryParse(s, out _)) s = "'" + s;
        return s.Contains(',') || s.Contains('"') || s.Contains('\n') ? "\"" + s.Replace("\"", "\"\"") + "\"" : s;
    }
}

/// <summary>
/// Minimal deterministic PDF writer for invoices (§123): identical input produces byte-identical output
/// (no timestamps or random ids), so the archived hash can prove an invoice was not altered.
/// </summary>
public static class Pdf
{
    public static byte[] Text(IReadOnlyList<(string Text, int Size, bool Bold)> lines, string title)
    {
        var content = new StringBuilder();
        var y = 800;
        foreach (var (text, size, bold) in lines)
        {
            var safe = new string(text.Select(c => c < 128 ? c : '?').ToArray()).Replace("\\", "\\\\").Replace("(", "\\(").Replace(")", "\\)");
            content.Append($"BT /{(bold ? "F2" : "F1")} {size} Tf 50 {y} Td ({safe}) Tj ET\n");
            y -= size + 8;
            if (y < 40) break;
        }
        var stream = content.ToString();
        var objects = new List<string>
        {
            "<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>",
            $"<< /Length {Encoding.ASCII.GetByteCount(stream)} >>\nstream\n{stream}endstream",
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
            $"<< /Title ({title.Replace("(", "").Replace(")", "")}) /Producer (PaymentApp) >>",
        };
        var sb = new StringBuilder("%PDF-1.4\n");
        var offsets = new List<int>();
        for (var i = 0; i < objects.Count; i++)
        {
            offsets.Add(Encoding.ASCII.GetByteCount(sb.ToString()));
            sb.Append($"{i + 1} 0 obj\n{objects[i]}\nendobj\n");
        }
        var xref = Encoding.ASCII.GetByteCount(sb.ToString());
        sb.Append($"xref\n0 {objects.Count + 1}\n0000000000 65535 f \n");
        foreach (var o in offsets) sb.Append($"{o:D10} 00000 n \n");
        sb.Append($"trailer\n<< /Size {objects.Count + 1} /Root 1 0 R /Info {objects.Count} 0 R >>\nstartxref\n{xref}\n%%EOF\n");
        return Encoding.ASCII.GetBytes(sb.ToString());
    }
}
