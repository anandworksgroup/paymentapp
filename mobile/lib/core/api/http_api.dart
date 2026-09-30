import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../offline/online_status.dart';
import 'api.dart';

/// Per-request headers that depend on the signed-in state.
class ApiContext {
  String? token;
  String? deviceId;

  /// Sent as X-Org-Id for merchant endpoints; null in wallet mode.
  String? orgId;
}

class HttpApi implements Api {
  HttpApi({
    required this.baseUrl,
    required this.context,
    required this.online,
    http.Client? client,
    this.timeout = const Duration(seconds: 20),
  }) : _client = client ?? http.Client();

  final String baseUrl;
  final ApiContext context;
  final OnlineStatus online;
  final Duration timeout;
  final http.Client _client;

  /// Called when the server says the session is gone (401), so the app can return to sign-in.
  void Function(ApiException e)? onSessionExpired;

  Uri _uri(String path, [Map<String, String?>? query]) {
    final q = <String, String>{};
    query?.forEach((k, v) {
      if (v != null && v.isNotEmpty) q[k] = v;
    });
    final base = Uri.parse(baseUrl.endsWith('/') ? baseUrl.substring(0, baseUrl.length - 1) : baseUrl);
    return base.replace(path: '${base.path}$path', queryParameters: q.isEmpty ? null : q);
  }

  Map<String, String> _headers({String? idempotencyKey, bool json = false}) => {
        'Accept': 'application/json',
        if (json) 'Content-Type': 'application/json',
        if (context.token != null) 'Authorization': 'Bearer ${context.token}',
        if (context.orgId != null) 'X-Org-Id': context.orgId!,
        if (context.deviceId != null) 'X-Device-Id': context.deviceId!,
        if (idempotencyKey != null) 'Idempotency-Key': idempotencyKey,
      };

  Future<dynamic> _send(Future<http.Response> Function() call) async {
    http.Response res;
    try {
      res = await call().timeout(timeout);
    } on TimeoutException {
      online.reportNetworkFailure();
      throw ApiException.network();
    } on http.ClientException {
      online.reportNetworkFailure();
      throw ApiException.network();
    } catch (e) {
      // SocketException and friends (dart:io is unavailable on web, so match loosely).
      if (e is ApiException) rethrow;
      online.reportNetworkFailure();
      throw ApiException.network();
    }
    online.reportSuccess();
    final body = res.body.isEmpty ? null : _decode(res.body);
    if (res.statusCode >= 200 && res.statusCode < 300) return body;
    final err = body is Map && body['error'] is Map ? Json.from(body['error'] as Map) : const <String, dynamic>{};
    final e = ApiException(
      status: res.statusCode,
      code: err['code']?.toString() ?? 'http_${res.statusCode}',
      message: err['message']?.toString() ?? 'Request failed (${res.statusCode}).',
      requestId: err['request_id']?.toString() ?? res.headers['request-id'],
    );
    if (e.isSessionExpired && context.token != null) onSessionExpired?.call(e);
    throw e;
  }

  dynamic _decode(String s) {
    try {
      return jsonDecode(s);
    } catch (_) {
      return s;
    }
  }

  @override
  Future<dynamic> get(String path, {Map<String, String?>? query}) =>
      _send(() => _client.get(_uri(path, query), headers: _headers()));

  @override
  Future<dynamic> post(String path, {Object? body, String? idempotencyKey}) => _send(() => _client.post(
        _uri(path),
        headers: _headers(idempotencyKey: idempotencyKey ?? newUuid(), json: true),
        body: jsonEncode(body ?? const {}),
      ));

  @override
  Future<dynamic> patch(String path, {Object? body}) =>
      _send(() => _client.patch(_uri(path), headers: _headers(json: true), body: jsonEncode(body ?? const {})));

  @override
  Future<dynamic> delete(String path) => _send(() => _client.delete(_uri(path), headers: _headers()));

  /// Liveness probe used by [OnlineStatus] while offline.
  Future<bool> health() async {
    try {
      final r = await _client.get(_uri('/health')).timeout(const Duration(seconds: 5));
      return r.statusCode < 500;
    } catch (_) {
      return false;
    }
  }
}
