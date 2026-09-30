import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api/api.dart';
import '../../core/cache/cache_store.dart';

/// Shared wallet state for the Wallet tabs: balances, handle and activation status (`GET /v1/wallet`).
class WalletModel extends ChangeNotifier {
  WalletModel({required this.api, this.cache, this.cacheKey});

  final Api api;
  final CacheStore? cache;
  final String? cacheKey;

  Json? data;
  bool loading = false;
  bool fromCache = false;
  Object? error;

  bool get loaded => data != null;
  bool get activated => data != null && data!['activated'] != false && data!.s('object') == 'wallet_balances';
  String get handle => data?.s('handle') ?? '';
  String get walletId => data?.s('wallet') ?? '';
  String get status => data?.s('status', 'active') ?? 'active';
  int get kycLevel => data?.i('kyc_level') ?? 0;
  String get kycStatus => data?.s('kyc_status', 'NOT_STARTED') ?? 'NOT_STARTED';
  List<Json> get balances => data?.list('balances') ?? const [];
  List<String> get currencies => balances.map((b) => b.s('currency')).toList();

  Json? balanceFor(String currency) => balances.where((b) => b.s('currency') == currency).firstOrNull;

  /// Masked digits for the card visual, derived from the handle ("@alice7479" → "•••• 7479").
  String get maskedDigits {
    final digits = handle.replaceAll(RegExp(r'[^0-9]'), '');
    final tail = digits.length >= 4 ? digits.substring(digits.length - 4) : walletId.length >= 4 ? walletId.substring(walletId.length - 4) : '0000';
    return '•••• •••• $tail';
  }

  Future<void> loadCached() async {
    if (cache == null || cacheKey == null || data != null) return;
    final c = await cache!.read(cacheKey!);
    if (c is Map && data == null) {
      data = Json.from(c);
      fromCache = true;
      notifyListeners();
    }
  }

  Future<void> refresh() async {
    loading = true;
    error = null;
    notifyListeners();
    try {
      final res = Json.from(await api.get('/v1/wallet') as Map);
      data = res;
      fromCache = false;
      if (cache != null && cacheKey != null) await cache!.write(cacheKey!, res);
    } catch (e) {
      error = e;
    }
    loading = false;
    notifyListeners();
  }

  Future<void> activate() async {
    final res = Json.from(await api.post('/v1/wallet/activate') as Map);
    data = res;
    notifyListeners();
  }
}

/// Pushes a wallet screen on the root navigator while keeping the shell's [WalletModel] in scope.
Future<T?> pushWithWallet<T>(BuildContext context, Widget screen) {
  final w = context.read<WalletModel>();
  return Navigator.of(context).push<T>(MaterialPageRoute(builder: (_) => ChangeNotifierProvider<WalletModel>.value(value: w, child: screen)));
}
