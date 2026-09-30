import 'package:intl/intl.dart';

DateTime? parseDate(Object? v) {
  if (v is! String || v.isEmpty) return null;
  return DateTime.tryParse(v)?.toLocal();
}

String fmtDate(Object? v) {
  final d = v is DateTime ? v : parseDate(v);
  return d == null ? '—' : DateFormat('d MMM yyyy').format(d);
}

String fmtDateTime(Object? v) {
  final d = v is DateTime ? v : parseDate(v);
  return d == null ? '—' : DateFormat('d MMM yyyy, HH:mm').format(d);
}

String fmtShortDay(DateTime d) => DateFormat('EEE').format(d);

/// "2m ago", "3h ago", "12 Sep".
String fmtRelative(Object? v, {DateTime? now}) {
  final d = v is DateTime ? v : parseDate(v);
  if (d == null) return '—';
  final diff = (now ?? DateTime.now()).difference(d);
  if (diff.inSeconds < 60) return 'just now';
  if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
  if (diff.inHours < 24) return '${diff.inHours}h ago';
  if (diff.inDays < 7) return '${diff.inDays}d ago';
  return DateFormat('d MMM').format(d);
}

/// "SUCCEEDED" / "needs_response" → "Succeeded" / "Needs response".
String humanize(Object? v) {
  final s = (v ?? '').toString().replaceAll('_', ' ').replaceAll('.', ' ').trim().toLowerCase();
  if (s.isEmpty) return '—';
  return s[0].toUpperCase() + s.substring(1);
}
