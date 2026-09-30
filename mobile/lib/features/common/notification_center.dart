import 'package:flutter/foundation.dart';

import '../../core/api/api.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/cache/cache_store.dart';

/// In-app notification feed plus read state, shared by the header bell badges and the Notifications
/// screen so a read in one place updates the count everywhere.
///
/// Wallet mode asks for personal notices only (`scope=personal`); Business mode is scoped by X-Org-Id.
/// Reads go to `POST /v1/me/notifications/{id}/read` and `POST /v1/me/notifications/read_all`.
class NotificationCenter extends ChangeNotifier {
  NotificationCenter({required this.api, required this.auth, required this.cache}) {
    auth.addListener(_onAuth);
    _onAuth();
  }

  final Api api;
  final AuthController auth;
  final CacheStore cache;

  List<Json> items = [];
  bool loading = false;
  bool loadedOnce = false;
  bool fromCache = false;
  Object? error;
  bool markingAll = false;

  String? _scope;
  int _generation = 0;

  bool get _wallet => auth.mode == AppMode.wallet;

  /// Unread notices among the latest page the API returns (it caps the feed at 50).
  int get unread => items.where((n) => !n.b('read')).length;

  /// The feed is capped server-side, so when the page is full and its oldest notice is still unread
  /// there may be more unread notices than [unread] counts ("50+").
  bool get unreadMayBeMore => items.length >= feedPageSize && !items.last.b('read');

  static const feedPageSize = 50;

  String _scopeFor() => '${auth.status.name}|${auth.user?.s('id')}|${auth.mode.name}|${auth.mode == AppMode.business ? auth.orgId : ''}';

  void _onAuth() {
    final scope = _scopeFor();
    if (scope == _scope) return;
    _scope = scope;
    _generation++;
    items = [];
    loadedOnce = false;
    fromCache = false;
    error = null;
    notifyListeners();
    if (auth.status == AuthStatus.signedIn) refresh();
  }

  List<Json> _filter(dynamic data) {
    final all = ApiList.from(data).data;
    // Personal notices only in Wallet mode (the server already filters with scope=personal).
    return _wallet ? all.where((n) => n.str('org_id') == null).toList() : all;
  }

  Future<void> refresh() async {
    if (auth.status != AuthStatus.signedIn) return;
    final gen = _generation;
    final key = auth.cacheKey('notifications');
    if (!loadedOnce && items.isEmpty) {
      final cached = await cache.read(key);
      if (gen != _generation) return;
      if (cached != null && items.isEmpty) {
        items = _filter(cached);
        fromCache = true;
        notifyListeners();
      }
    }
    loading = true;
    error = null;
    notifyListeners();
    try {
      final res = await api.get('/v1/me/notifications', query: {'scope': _wallet ? 'personal' : null});
      if (gen != _generation) return;
      items = _filter(res);
      fromCache = false;
      await cache.write(key, res);
    } catch (e) {
      if (gen != _generation) return;
      error = e;
    } finally {
      if (gen == _generation) {
        loading = false;
        loadedOnce = true;
        notifyListeners();
      }
    }
  }

  void _setRead(Set<String> ids, bool read) {
    items = [
      for (final n in items) ids.contains(n.s('id')) ? (Json.from(n)..['read'] = read) : n,
    ];
    notifyListeners();
  }

  /// Marks one notice read (optimistically). Throws after reverting when the API refuses.
  Future<void> markRead(String id) async {
    final n = items.where((x) => x.s('id') == id).firstOrNull;
    if (n == null || n.b('read')) return;
    final gen = _generation;
    _setRead({id}, true);
    try {
      await api.post('/v1/me/notifications/$id/read');
    } catch (_) {
      if (gen == _generation) _setRead({id}, false);
      rethrow;
    }
  }

  /// Marks every notice in the current scope read. Returns how many the server updated.
  Future<int> markAllRead() async {
    final unreadIds = items.where((n) => !n.b('read')).map((n) => n.s('id')).toSet();
    final gen = _generation;
    markingAll = true;
    _setRead(unreadIds, true);
    try {
      final res = await api.post('/v1/me/notifications/read_all', query: {'scope': _wallet ? 'personal' : null});
      return res is Map ? Json.from(res).i('marked_read', unreadIds.length) : unreadIds.length;
    } catch (_) {
      if (gen == _generation) _setRead(unreadIds, false);
      rethrow;
    } finally {
      if (gen == _generation) {
        markingAll = false;
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
