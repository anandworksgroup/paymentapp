// Renders every screen at a phone viewport against API responses captured from the sandbox
// (test/fixtures/*.json) to catch layout overflows, provider misuse and shape mismatches.
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:paymentapp_mobile/core/api/api.dart';
import 'package:paymentapp_mobile/core/api/http_api.dart';
import 'package:paymentapp_mobile/core/auth/auth_controller.dart';
import 'package:paymentapp_mobile/core/cache/cache_store.dart';
import 'package:paymentapp_mobile/core/offline/online_status.dart';
import 'package:paymentapp_mobile/core/security/app_lock.dart';
import 'package:paymentapp_mobile/core/security/biometrics.dart';
import 'package:paymentapp_mobile/core/storage/secure_store.dart';
import 'package:paymentapp_mobile/features/auth/lock_screen.dart';
import 'package:paymentapp_mobile/features/auth/login_screen.dart';
import 'package:paymentapp_mobile/features/business/business_shell.dart';
import 'package:paymentapp_mobile/features/business/customers/customer_detail_screen.dart';
import 'package:paymentapp_mobile/features/business/customers/customers_screen.dart';
import 'package:paymentapp_mobile/features/business/more/analytics_screen.dart';
import 'package:paymentapp_mobile/features/business/more/disputes_screen.dart';
import 'package:paymentapp_mobile/features/business/more/more_screen.dart';
import 'package:paymentapp_mobile/features/business/more/payment_links_screen.dart';
import 'package:paymentapp_mobile/features/business/more/payouts_screen.dart';
import 'package:paymentapp_mobile/features/business/more/team_screen.dart';
import 'package:paymentapp_mobile/features/business/payments/payment_detail_screen.dart';
import 'package:paymentapp_mobile/features/business/payments/payments_screen.dart';
import 'package:paymentapp_mobile/features/business/subscriptions/subscription_detail_screen.dart';
import 'package:paymentapp_mobile/features/business/subscriptions/subscriptions_screen.dart';
import 'package:paymentapp_mobile/features/common/notifications_screen.dart';
import 'package:paymentapp_mobile/features/common/security_screen.dart';
import 'package:paymentapp_mobile/features/common/settings_screen.dart';
import 'package:paymentapp_mobile/features/wallet/activity/activity_screen.dart';
import 'package:paymentapp_mobile/features/wallet/activity/transfer_detail_screen.dart';
import 'package:paymentapp_mobile/features/wallet/kyc/kyc_screen.dart';
import 'package:paymentapp_mobile/features/wallet/money/add_money_screen.dart';
import 'package:paymentapp_mobile/features/wallet/money/exchange_screen.dart';
import 'package:paymentapp_mobile/features/wallet/money/receive_screen.dart';
import 'package:paymentapp_mobile/features/wallet/money/withdraw_screen.dart';
import 'package:paymentapp_mobile/features/wallet/profile/profile_screen.dart';
import 'package:paymentapp_mobile/features/wallet/wallet_model.dart';
import 'package:paymentapp_mobile/features/wallet/wallet_shell.dart';
import 'package:paymentapp_mobile/theme/theme.dart';
import 'package:provider/provider.dart';

import 'send_money_quote_test.dart' show ApiCall, FakeApi;

Map<String, dynamic> _load(String name) => jsonDecode(File('test/fixtures/$name.json').readAsStringSync()) as Map<String, dynamic>;

final _detail = RegExp(r'^/v1/(payments|customers|subscriptions|payouts|disputes|wallet/transfers)/[^/]+$');

dynamic Function(ApiCall) fixtureHandler(Map<String, dynamic> fx) => (c) {
      if (c.method != 'GET') return {'object': 'ok'};
      final m = _detail.firstMatch(c.path);
      if (m != null && fx.containsKey('/v1/${m.group(1)}/{id}')) return fx['/v1/${m.group(1)}/{id}'];
      if (fx.containsKey(c.path)) return fx[c.path];
      for (final k in fx.keys) {
        if (k.split('?').first == c.path) return fx[k];
      }
      if (c.path.startsWith('/v1/reports/dashboard')) return fx['/v1/reports/dashboard'];
      return {'object': 'list', 'data': [], 'has_more': false};
    };

class _Env {
  _Env(this.api, this.auth, this.wallet, this.lock);
  final FakeApi api;
  final AuthController auth;
  final WalletModel wallet;
  final AppLock lock;
}

Future<_Env> _env(Map<String, dynamic> fx) async {
  final api = FakeApi(fixtureHandler(fx));
  final store = MemorySecureStore()..values[StoreKeys.token] = 'ses_test';
  final auth = AuthController(api: api, context: ApiContext()..token = 'ses_test', store: store, cache: MemoryCacheStore());
  await auth.bootstrap();
  final wallet = WalletModel(api: api);
  if (fx.containsKey('/v1/wallet')) wallet.data = Json.from(fx['/v1/wallet'] as Map);
  final lock = AppLock(store: store, biometrics: Biometrics(), timeout: const Duration(minutes: 5));
  return _Env(api, auth, wallet, lock);
}

/// Layout overflows and other framework errors fail the test on their own (with full diagnostics);
/// this only makes the intent explicit at each checkpoint.
void _noException(WidgetTester tester) {}

Future<void> _pump(WidgetTester tester, _Env env, Widget screen) async {
  tester.view.physicalSize = const Size(390 * 3, 844 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MultiProvider(
    providers: [
      Provider<Api>.value(value: env.api),
      Provider<CacheStore>.value(value: MemoryCacheStore()),
      Provider<Biometrics>.value(value: Biometrics()),
      ChangeNotifierProvider<OnlineStatus>(create: (_) => OnlineStatus()),
      ChangeNotifierProvider<AuthController>.value(value: env.auth),
      ChangeNotifierProvider<AppLock>.value(value: env.lock),
      ChangeNotifierProvider<WalletModel>.value(value: env.wallet),
    ],
    child: MaterialApp(theme: buildAppTheme(), home: screen),
  ));
  await tester.pumpAndSettle();
  _noException(tester);
  // Scroll to the end to build (and lay out) everything below the fold.
  final scrollables = find.byType(Scrollable);
  if (scrollables.evaluate().isNotEmpty) {
    await tester.drag(scrollables.first, const Offset(0, -3000));
    await tester.pumpAndSettle();
    _noException(tester);
  }
}

void main() {
  final business = _load('business');
  final wallet = _load('wallet');

  group('business screens', () {
    final screens = <String, Widget Function()>{
      'shell/home': () => const BusinessShell(),
      'payments': () => const PaymentsScreen(),
      'payment detail': () => const PaymentDetailScreen(id: 'pay_x'),
      'customers': () => const CustomersScreen(),
      'customer detail': () => const CustomerDetailScreen(id: 'cus_x'),
      'subscriptions': () => const SubscriptionsScreen(),
      'subscription detail': () => const SubscriptionDetailScreen(id: 'sub_x'),
      'more': () => const MoreScreen(),
      'payouts': () => const PayoutsScreen(),
      'payout detail': () => const PayoutDetailScreen(id: 'po_x'),
      'disputes': () => const DisputesScreen(),
      'dispute detail': () => const DisputeDetailScreen(id: 'dp_x'),
      'dispute respond': () => DisputeRespondScreen(dispute: Json.from(business['/v1/disputes/{id}'] as Map)),
      'payment links': () => const PaymentLinksScreen(),
      'analytics': () => const AnalyticsScreen(),
      'team': () => const TeamScreen(),
      'notifications': () => const NotificationsScreen(businessMode: true),
      'security': () => const SecurityScreen(),
      'settings': () => const SettingsScreen(),
    };
    for (final e in screens.entries) {
      testWidgets(e.key, (tester) async {
        final env = await _env(business);
        expect(env.auth.mode, AppMode.business);
        await _pump(tester, env, e.value());
      });
    }

    testWidgets('home shows balance hero, revenue chart and recent payments', (tester) async {
      final env = await _env(business);
      await _pump(tester, env, const BusinessShell());
      await tester.drag(find.byType(Scrollable).first, const Offset(0, 5000));
      await tester.pumpAndSettle();
      expect(find.text('Your available balance'), findsOneWidget);
      expect(find.byKey(const Key('revenue-chart')), findsOneWidget);
      expect(env.api.calls.map((c) => c.path), containsAll(['/v1/balance', '/v1/reports/dashboard', '/v1/reports/attention', '/v1/payments']));
    });
  });

  group('wallet screens', () {
    final screens = <String, Widget Function()>{
      'shell/home': () => const WalletShell(),
      'activity': () => const ActivityScreen(),
      'transfer detail': () => const TransferDetailScreen(id: 'tr_x'),
      'profile': () => const ProfileScreen(),
      'add money': () => const AddMoneyScreen(),
      'receive': () => const ReceiveScreen(),
      'exchange': () => const ExchangeScreen(),
      'withdraw': () => const WithdrawScreen(),
      'kyc': () => const KycScreen(level: 3),
      'notifications': () => const NotificationsScreen(businessMode: false),
    };
    for (final e in screens.entries) {
      testWidgets(e.key, (tester) async {
        final env = await _env(wallet);
        expect(env.auth.mode, AppMode.wallet);
        await _pump(tester, env, e.value());
      });
    }

    testWidgets('home shows stacked currency cards and quick actions', (tester) async {
      final env = await _env(wallet);
      await _pump(tester, env, const WalletShell());
      await tester.drag(find.byType(Scrollable).first, const Offset(0, 5000));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('card-INR')), findsOneWidget);
      expect(find.byKey(const Key('card-USD')), findsOneWidget);
      for (final label in ['Add money', 'Send', 'Receive', 'Exchange', 'Withdraw']) {
        expect(find.bySemanticsLabel(label), findsWidgets);
      }
    });

    testWidgets('unactivated wallet shows the KYC flow entry', (tester) async {
      final fx = {...wallet, '/v1/wallet': {'object': 'wallet', 'activated': false, 'kyc_level': 0, 'kyc_status': 'NOT_STARTED'}};
      final env = await _env(fx);
      await _pump(tester, env, const WalletShell());
      expect(find.byKey(const Key('start-kyc')), findsOneWidget);
    });
  });

  testWidgets('login and lock screens render', (tester) async {
    final env = await _env(wallet);
    await _pump(tester, env, const LoginScreen());
    await _pump(tester, env, const LockScreen());
  });
}
