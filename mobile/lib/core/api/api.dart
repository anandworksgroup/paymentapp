import 'dart:math';

typedef Json = Map<String, dynamic>;

/// Minimal transport used by every feature. [HttpApi] talks to the ASP.NET Core API; tests use fakes.
abstract class Api {
  Future<dynamic> get(String path, {Map<String, String?>? query});

  /// Every POST carries an Idempotency-Key. Pass the same [idempotencyKey] when retrying the same user
  /// action (for example after step-up) so the server can de-duplicate it.
  Future<dynamic> post(String path, {Object? body, String? idempotencyKey, Map<String, String?>? query});
  Future<dynamic> patch(String path, {Object? body});
  Future<dynamic> delete(String path);
}

/// `{error:{code,message,request_id}}` from the API, or a local network failure.
class ApiException implements Exception {
  const ApiException({required this.status, required this.code, required this.message, this.requestId});

  factory ApiException.network() => const ApiException(
        status: 0,
        code: 'network_error',
        message: "Can't reach the server. Check your connection and try again.",
      );

  final int status;
  final String code;
  final String message;
  final String? requestId;

  bool get isNetwork => status == 0;
  bool get isStepUp => code == 'step_up_required';
  bool get isSessionExpired => status == 401 && code != 'invalid_credentials' && code != 'invalid_mfa_code';

  @override
  String toString() => 'ApiException($status $code: $message)';
}

/// A list envelope: `{object:"list", data, has_more}`.
class ApiList {
  ApiList(this.data, this.hasMore);

  factory ApiList.from(dynamic json) {
    final m = json is Map ? json : const {};
    final data = (m['data'] as List?)?.whereType<Map>().map((e) => Json.from(e)).toList() ?? <Json>[];
    return ApiList(data, m['has_more'] == true);
  }

  final List<Json> data;
  final bool hasMore;
}

final _rng = Random.secure();

/// RFC 4122 version-4 UUID for Idempotency-Key headers.
String newUuid() {
  final b = List<int>.generate(16, (_) => _rng.nextInt(256));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  String hex(int i) => b[i].toRadixString(16).padLeft(2, '0');
  final s = List.generate(16, hex).join();
  return '${s.substring(0, 8)}-${s.substring(8, 12)}-${s.substring(12, 16)}-${s.substring(16, 20)}-${s.substring(20)}';
}

String randomId(int bytes) => List.generate(bytes, (_) => _rng.nextInt(256).toRadixString(16).padLeft(2, '0')).join();

/// Typed reads over decoded JSON without throwing on shape drift.
extension JsonRead on Json {
  String? str(String k) {
    final v = this[k];
    return v?.toString();
  }

  String s(String k, [String fallback = '']) => str(k) ?? fallback;

  int i(String k, [int fallback = 0]) {
    final v = this[k];
    if (v is int) return v;
    if (v is num) return v.toInt();
    if (v is String) return int.tryParse(v) ?? fallback;
    return fallback;
  }

  int? iOrNull(String k) {
    final v = this[k];
    if (v is int) return v;
    if (v is num) return v.toInt();
    return null;
  }

  double? d(String k) {
    final v = this[k];
    return v is num ? v.toDouble() : null;
  }

  bool b(String k) => this[k] == true;

  Json? obj(String k) {
    final v = this[k];
    return v is Map ? Json.from(v) : null;
  }

  List<Json> list(String k) {
    final v = this[k];
    return v is List ? v.whereType<Map>().map((e) => Json.from(e)).toList() : <Json>[];
  }
}
