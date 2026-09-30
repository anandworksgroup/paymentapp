import 'package:flutter/foundation.dart';

import '../api/api.dart';
import '../api/http_api.dart';
import '../cache/cache_store.dart';
import '../storage/secure_store.dart';

enum AuthStatus { loading, signedOut, mfaRequired, signedIn }

enum AppMode { business, wallet }

class OrgSummary {
  OrgSummary(this.json);
  final Json json;
  String get id => json.s('id');
  String get name => json.s('name');
  String get role => json.s('role');
  String get currency => json.s('default_currency', 'USD');
  String get country => json.s('country');
  String get status => json.s('status');
}

/// Session, identity and mode (Business vs Wallet). One app, two modes (URS §11, §220, §221).
class AuthController extends ChangeNotifier {
  AuthController({required this.api, required this.context, required this.store, required this.cache});

  final Api api;
  final ApiContext context;
  final SecureStore store;
  final CacheStore cache;

  AuthStatus status = AuthStatus.loading;
  Json? user;
  List<OrgSummary> orgs = [];
  Json? wallet;
  AppMode mode = AppMode.wallet;
  String? orgId;
  String? sessionMessage;

  bool get hasOrgs => orgs.isNotEmpty;
  bool get hasWallet => wallet != null;

  /// Both modes apply when the user belongs to an organization; anyone can activate a wallet.
  bool get canSwitchMode => hasOrgs;
  OrgSummary? get org => orgs.where((o) => o.id == orgId).firstOrNull ?? orgs.firstOrNull;
  String get userName => user?.s('name') ?? '';
  String get userEmail => user?.s('email') ?? '';
  bool get mfaEnabled => user?.b('mfa_enabled') ?? false;

  Future<void> bootstrap() async {
    context.deviceId = await ensureDeviceId(store);
    final token = await store.read(StoreKeys.token);
    if (token == null) {
      status = AuthStatus.signedOut;
      notifyListeners();
      return;
    }
    context.token = token;
    final savedMode = await store.read(StoreKeys.mode);
    orgId = await store.read(StoreKeys.orgId);
    try {
      await refreshMe(preferredMode: savedMode);
      status = AuthStatus.signedIn;
    } on ApiException catch (e) {
      if (e.isNetwork) {
        // Offline start: keep the session and show cached summaries.
        status = AuthStatus.signedIn;
        mode = savedMode == 'business' ? AppMode.business : AppMode.wallet;
        context.orgId = mode == AppMode.business ? orgId : null;
      } else {
        await _clearLocal();
        status = AuthStatus.signedOut;
      }
    }
    notifyListeners();
  }

  Future<void> login(String email, String password) async {
    final res = Json.from(await api.post('/v1/auth/login', body: {'email': email.trim(), 'password': password}) as Map);
    context.token = res.s('token');
    await store.write(StoreKeys.token, context.token);
    if (res.b('mfa_required')) {
      status = AuthStatus.mfaRequired;
      notifyListeners();
      return;
    }
    await refreshMe();
    sessionMessage = null;
    status = AuthStatus.signedIn;
    notifyListeners();
  }

  Future<void> verifyMfa(String code) async {
    await api.post('/v1/auth/mfa/verify', body: {'code': code.trim()});
    await refreshMe();
    status = AuthStatus.signedIn;
    notifyListeners();
  }

  Future<void> refreshMe({String? preferredMode}) async {
    context.orgId = null;
    final me = Json.from(await api.get('/v1/me') as Map);
    user = me.obj('user');
    orgs = me.list('organizations').map(OrgSummary.new).toList();
    wallet = me.obj('wallet');
    if (orgId == null || !orgs.any((o) => o.id == orgId)) orgId = orgs.firstOrNull?.id;
    mode = _decideMode(preferredMode);
    _applyContext();
    notifyListeners();
  }

  /// Organizations → Business mode first; wallet-only users → Wallet mode. A saved choice wins.
  AppMode _decideMode(String? preferred) {
    if (!hasOrgs) return AppMode.wallet;
    if (preferred == 'wallet') return AppMode.wallet;
    if (preferred == 'business') return AppMode.business;
    return status == AuthStatus.signedIn ? mode : AppMode.business;
  }

  void _applyContext() {
    context.orgId = mode == AppMode.business ? orgId : null;
    store.write(StoreKeys.mode, mode.name);
    store.write(StoreKeys.orgId, orgId);
  }

  Future<void> switchMode(AppMode m) async {
    if (m == AppMode.business && !hasOrgs) return;
    mode = m;
    _applyContext();
    notifyListeners();
  }

  Future<void> selectOrg(String id) async {
    orgId = id;
    _applyContext();
    notifyListeners();
  }

  /// Wallet summary changed (activated): re-read /v1/me without changing mode.
  Future<void> reloadWallet() async {
    final keepOrg = context.orgId;
    context.orgId = null;
    try {
      final me = Json.from(await api.get('/v1/me') as Map);
      wallet = me.obj('wallet');
      user = me.obj('user') ?? user;
    } finally {
      context.orgId = keepOrg;
    }
    notifyListeners();
  }

  Future<void> logout({String? message}) async {
    try {
      if (context.token != null) await api.post('/v1/auth/logout');
    } catch (_) {}
    await _clearLocal();
    sessionMessage = message;
    status = AuthStatus.signedOut;
    notifyListeners();
  }

  /// Server rejected the token (expired or revoked).
  Future<void> sessionExpired(String message) async {
    if (status == AuthStatus.signedOut) return;
    await _clearLocal();
    sessionMessage = message;
    status = AuthStatus.signedOut;
    notifyListeners();
  }

  Future<void> _clearLocal() async {
    context.token = null;
    context.orgId = null;
    user = null;
    orgs = [];
    wallet = null;
    await store.write(StoreKeys.token, null);
    await cache.clear();
  }

  /// Cache keys are scoped per user and org so one account never sees another's summaries.
  String cacheKey(String name) => '${user?.s('id') ?? 'anon'}.${mode == AppMode.business ? orgId : 'wallet'}.$name';
}
