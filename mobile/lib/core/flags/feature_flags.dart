import 'package:flutter/foundation.dart';

import '../api/api.dart';
import '../auth/auth_controller.dart';
import '../cache/cache_store.dart';

/// Server-evaluated feature flags (`GET /v1/features`). Flags are evaluated for the current scope: the
/// organization in Business mode (X-Org-Id) or the user alone in Wallet mode, so they reload whenever the
/// mode, organization or user changes.
///
/// Semantics mirror the API's FlagService: a key the server does not list does not gate anything, while
/// a listed key that evaluates false hides the feature. Until the first answer arrives (and with no cached
/// copy) gated features stay hidden rather than flashing in and out.
class FeatureFlags extends ChangeNotifier {
  FeatureFlags({required this.api, required this.auth, required this.cache}) {
    auth.addListener(_onAuth);
    _onAuth();
  }

  final Api api;
  final AuthController auth;
  final CacheStore cache;

  static const walletExchange = 'wallet_exchange';
  static const marketplace = 'marketplace';
  static const copilot = 'copilot';
  static const customDomains = 'custom_domains';
  static const experiments = 'experiments';

  Map<String, bool>? _flags;
  String? _scope;
  int _generation = 0;
  bool loading = false;
  Object? error;

  bool get loaded => _flags != null;

  /// True when [key] is enabled for the current scope.
  bool isOn(String key) {
    final f = _flags;
    if (f == null) return false;
    return f[key] ?? true;
  }

  String _scopeFor() => '${auth.status.name}|${auth.user?.s('id')}|${auth.mode.name}|${auth.mode == AppMode.business ? auth.orgId : ''}';

  void _onAuth() {
    final scope = _scopeFor();
    if (scope == _scope) return;
    _scope = scope;
    _generation++;
    _flags = null;
    error = null;
    notifyListeners();
    if (auth.status == AuthStatus.signedIn) refresh();
  }

  static Map<String, bool>? _parse(dynamic json) {
    if (json is! Map) return null;
    final f = json['features'];
    if (f is! Map) return <String, bool>{};
    return {for (final e in f.entries) e.key.toString(): e.value == true};
  }

  Future<void> refresh() async {
    if (auth.status != AuthStatus.signedIn) return;
    final gen = _generation;
    final key = auth.cacheKey('features');
    if (_flags == null) {
      final cached = _parse(await cache.read(key));
      if (gen != _generation) return;
      if (cached != null && _flags == null) {
        _flags = cached;
        notifyListeners();
      }
    }
    loading = true;
    try {
      final res = await api.get('/v1/features');
      if (gen != _generation) return;
      _flags = _parse(res) ?? <String, bool>{};
      error = null;
      await cache.write(key, res);
    } catch (e) {
      if (gen != _generation) return;
      error = e;
    } finally {
      if (gen == _generation) {
        loading = false;
        notifyListeners();
      }
    }
  }

  @override
  void dispose() {
    auth.removeListener(_onAuth);
    super.dispose();
  }
}
