import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

/// Offline cache for dashboard summaries and recent lists only (URS §212). Never secrets: tokens live in
/// secure storage, and personal fields are stripped before anything is written here.
abstract class CacheStore {
  Future<dynamic> read(String key);
  Future<void> write(String key, dynamic json);
  Future<void> clear();
}

const _prefix = 'cache.v1.';
const _stripKeys = {'customer_email', 'email', 'ip', 'device_id', 'phone', 'address', 'token', 'secret', 'account_number'};

dynamic sanitizeForCache(dynamic v) {
  if (v is Map) {
    return {
      for (final e in v.entries)
        if (!_stripKeys.contains(e.key)) e.key.toString(): sanitizeForCache(e.value),
    };
  }
  if (v is List) return v.map(sanitizeForCache).toList();
  return v;
}

class PrefsCacheStore implements CacheStore {
  SharedPreferences? _prefs;

  Future<SharedPreferences> get _p async => _prefs ??= await SharedPreferences.getInstance();

  @override
  Future<dynamic> read(String key) async {
    try {
      final s = (await _p).getString('$_prefix$key');
      return s == null ? null : jsonDecode(s);
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> write(String key, dynamic json) async {
    try {
      await (await _p).setString('$_prefix$key', jsonEncode(sanitizeForCache(json)));
    } catch (_) {}
  }

  @override
  Future<void> clear() async {
    try {
      final p = await _p;
      for (final k in p.getKeys().where((k) => k.startsWith(_prefix)).toList()) {
        await p.remove(k);
      }
    } catch (_) {}
  }
}

class MemoryCacheStore implements CacheStore {
  final Map<String, dynamic> values = {};

  @override
  Future<dynamic> read(String key) async => values[key];

  @override
  Future<void> write(String key, dynamic json) async => values[key] = sanitizeForCache(json);

  @override
  Future<void> clear() async => values.clear();
}
