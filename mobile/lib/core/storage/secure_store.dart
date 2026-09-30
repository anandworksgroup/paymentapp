import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../api/api.dart';

/// Key-value store for secrets (session token, device id) and security preferences.
abstract class SecureStore {
  Future<String?> read(String key);
  Future<void> write(String key, String? value);
}

class DeviceSecureStore implements SecureStore {
  DeviceSecureStore() : _s = const FlutterSecureStorage(aOptions: AndroidOptions(encryptedSharedPreferences: true));

  final FlutterSecureStorage _s;

  @override
  Future<String?> read(String key) async {
    try {
      return await _s.read(key: key);
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> write(String key, String? value) async {
    if (value == null) {
      await _s.delete(key: key);
    } else {
      await _s.write(key: key, value: value);
    }
  }
}

class MemorySecureStore implements SecureStore {
  final Map<String, String> values = {};

  @override
  Future<String?> read(String key) async => values[key];

  @override
  Future<void> write(String key, String? value) async {
    if (value == null) {
      values.remove(key);
    } else {
      values[key] = value;
    }
  }
}

abstract final class StoreKeys {
  static const token = 'session_token';
  static const deviceId = 'device_id';
  static const lockEnabled = 'app_lock_enabled';
  static const mode = 'app_mode';
  static const orgId = 'org_id';
}

/// Stable per-install device id sent as X-Device-Id.
Future<String> ensureDeviceId(SecureStore store) async {
  final existing = await store.read(StoreKeys.deviceId);
  if (existing != null && existing.isNotEmpty) return existing;
  final id = 'mob_${randomId(16)}';
  await store.write(StoreKeys.deviceId, id);
  return id;
}
