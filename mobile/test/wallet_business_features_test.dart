// Exchange, notifications read state, limit usage, password-verified lock, incidents, support tickets
// and flag-gated business features, driven through the FakeApi against sandbox-shaped responses.
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:paymentapp_mobile/core/api/api.dart';
import 'package:paymentapp_mobile/core/api/http_api.dart';
import 'package:paymentapp_mobile/core/auth/auth_controller.dart';
import 'package:paymentapp_mobile/core/cache/cache_store.dart';
import 'package:paymentapp_mobile/core/flags/feature_flags.dart';
import 'package:paymentapp_mobile/core/offline/online_status.dart';
import 'package:paymentapp_mobile/core/security/app_lock.dart';
import 'package:paymentapp_mobile/core/security/biometrics.dart';
import 'package:paymentapp_mobile/core/storage/secure_store.dart';
import 'package:paymentapp_mobile/features/auth/lock_screen.dart';
import 'package:paymentapp_mobile/features/business/home/business_home_screen.dart';
import 'package:paymentapp_mobile/features/business/more/more_screen.dart';
import 'package:paymentapp_mobile/features/business/support/support_screens.dart';
import 'package:paymentapp_mobile/features/common/notification_center.dart';
import 'package:paymentapp_mobile/features/common/notifications_screen.dart';
import 'package:paymentapp_mobile/features/wallet/money/exchange_screen.dart';
import 'package:paymentapp_mobile/features/wallet/profile/profile_screen.dart';
import 'package:paymentapp_mobile/features/wallet/wallet_model.dart';
import 'package:paymentapp_mobile/features/wallet/wallet_shell.dart';
import 'package:paymentapp_mobile/theme/theme.dart';
import 'package:paymentapp_mobile/theme/widgets/amount_text.dart';
import 'package:paymentapp_mobile/theme/widgets/usage_bar.dart';
import 'package:provider/provider.dart';

import 'send_money_quote_test.dart' show ApiCall, FakeApi;

Map<String, dynamic> _fixture(String name) => jsonDecode(File('test/fixtures/$name.json').readAsStringSync()) as Map<String, dynamic>;

final _walletFx = _fixture('wallet');
final _businessFx = _fixture('business');

/// Fixture lookup with per-test overrides (path → value or function).
dynamic Function(ApiCall) _handler(Map<String, dynamic> fx, [Map<String, dynamic Function(ApiCall)> overrides = const {}]) => (c) {
      final key = '${c.method} ${c.path}';
      if (overrides.containsKey(key)) return overrides[key]!(c);
      if (c.method != 'GET') return {'object': 'ok'};
      if (fx.containsKey(c.path)) return fx[c.path];
      for (final k in fx.keys) {
        if (k.split('?').first == c.path) return fx[k];
      }
      if (c.path.startsWith('/v1/reports/dashboard')) return fx['/v1/reports/dashboard'];
      return {'object': 'list', 'data': [], 'has_more': false};
    };

class _Env {
  _Env(this.api, this.auth, this.lock, this.flags, this.notifications, this.wallet);
  final FakeApi api;
  final AuthController auth;
  final AppLock lock;
  final FeatureFlags flags;
  final NotificationCenter notifications;
  final WalletModel wallet;
}

Future<_Env> _env(Map<String, dynamic> fx, [Map<String, dynamic Function(ApiCall)> overrides = const {}]) async {
  final api = FakeApi(_handler(fx, overrides));
  final store = MemorySecureStore()..values[StoreKeys.token] = 'ses_test';
  final cache = MemoryCacheStore();
  final auth = AuthController(api: api, context: ApiContext()..token = 'ses_test', store: store, cache: cache);
  await auth.bootstrap();
  final lock = AppLock(store: store, biometrics: Biometrics(), timeout: const Duration(minutes: 5));
  final flags = FeatureFlags(api: api, auth: auth, cache: cache);
  final notifications = NotificationCenter(api: api, auth: auth, cache: cache);
  final wallet = WalletModel(api: api);
  if (fx.containsKey('/v1/wallet')) wallet.data = Json.from(fx['/v1/wallet'] as Map);
  return _Env(api, auth, lock, flags, notifications, wallet);
}

Future<void> _pump(WidgetTester tester, _Env env, Widget screen, {double height = 1400}) async {
  tester.view.physicalSize = Size(430 * 3, height * 3);
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
      ChangeNotifierProvider<FeatureFlags>.value(value: env.flags),
      ChangeNotifierProvider<NotificationCenter>.value(value: env.notifications),
    ],
    child: MaterialApp(theme: buildAppTheme(), home: screen),
  ));
  await tester.pumpAndSettle();
}

Iterable<ApiCall> _calls(FakeApi api, String method, String path) => api.calls.where((c) => c.method == method && c.path == path);

final _exchangeQuote = {
  'object': 'fx_quote',
  'id': 'fxq_ex1',
  'from_currency': 'INR',
  'to_currency': 'USD',
  'source_amount': 500000,
  'destination_amount': 5958,
  'mid_rate_e9': 11976048,
  'customer_rate_e9': 11916168,
  'spread_bps': 50,
  'spread_amount': 29,
  'fee_amount': 1500,
  'rate_timestamp': '2026-09-30T14:23:56.752Z',
  'rate_source': 'sandbox_reference_rates',
  'expires_at': '2026-09-30T17:23:47.502Z',
  'used_at': null,
  'created_at': '2026-09-30T17:18:47.502Z',
};

final _exchangeResult = {
  'id': 'tr_ex1',
  'object': 'transfer',
  'type': 'conversion',
  'status': 'COMPLETED',
  'direction': 'out',
  'counterparty': 'Exchange INR → USD',
  'source_amount': 500000,
  'source_currency': 'INR',
  'destination_amount': 5958,
  'destination_currency': 'USD',
  'fee_amount': 1500,
  'spread_amount': 29,
  'fx_rate': 0.011916168,
  'message': 'Converted to USD.',
  'created_at': '2026-09-30T17:18:47.947Z',
};

void main() {
  group('exchange', () {
    late DateTime now;
    late int quoteCount;
    late Map<String, dynamic> walletState;

    Map<String, dynamic Function(ApiCall)> overrides({dynamic Function(ApiCall)? exchange}) => {
          'POST /v1/wallet/fx/quotes': (c) {
            quoteCount++;
            return {..._exchangeQuote, 'id': 'fxq_ex$quoteCount'};
          },
          'POST /v1/wallet/exchanges': exchange ?? (c) => _exchangeResult,
          'GET /v1/wallet': (c) => walletState,
          'GET /v1/wallet/transactions': (c) => {
                'object': 'list',
                'has_more': false,
                'data': [
                  {
                    'id': 'tr_ex1',
                    'type': 'conversion',
                    'status': 'COMPLETED',
                    'direction': 'out',
                    'counterparty': 'Exchange INR → USD',
                    'amount': 500000,
                    'currency': 'INR',
                    'fee': 1500,
                    'fx': {'rate': 0.011916168, 'from': 'INR', 'to': 'USD', 'received': 5958},
                    'created_at': '2026-09-30T17:18:47.947Z',
                  },
                ],
              },
        };

    setUp(() {
      now = DateTime(2026, 9, 30, 17, 19);
      quoteCount = 0;
      walletState = Json.from(_walletFx['/v1/wallet'] as Map);
    });

    Future<void> toReview(WidgetTester tester) async {
      await tester.enterText(find.byKey(const Key('exchange-amount')), '5,000');
      await tester.tap(find.byKey(const Key('exchange-quote')));
      await tester.pump();
      await tester.pump();
    }

    testWidgets('quotes, counts down, confirms with one idempotency key and shows the result', (tester) async {
      final env = await _env(_walletFx, overrides());
      await _pump(tester, env, ExchangeScreen(clock: () => now));
      await toReview(tester);

      final q = _calls(env.api, 'POST', '/v1/wallet/fx/quotes').single;
      expect(q.body, {'from_currency': 'INR', 'to_currency': 'USD', 'amount': 500000});
      expect(tester.widget<AmountText>(find.byKey(const Key('quote-received'))).plain, r'$59.58 USD');
      expect(tester.widget<AmountText>(find.byKey(const Key('quote-fee'))).plain, '₹15.00 INR');
      expect(tester.widget<AmountText>(find.byKey(const Key('exchange-total'))).plain, '₹5,015.00 INR');
      expect(find.text('1 INR = 0.011916 USD'), findsOneWidget);
      expect(find.text('Expires in 5:00'), findsOneWidget);
      expect(_calls(env.api, 'POST', '/v1/wallet/exchanges'), isEmpty);

      now = now.add(const Duration(minutes: 2));
      await tester.pump(const Duration(seconds: 1));
      expect(find.text('Expires in 3:00'), findsOneWidget);

      walletState = {
        ...walletState,
        'balances': [
          {'currency': 'INR', 'available': 20994000, 'held': 0, 'pending_incoming': 0, 'ledger_balance': 20994000},
          {'currency': 'USD', 'available': 25958, 'held': 0, 'pending_incoming': 0, 'ledger_balance': 25958},
        ],
      };
      await tester.tap(find.byKey(const Key('exchange-confirm')));
      await tester.pumpAndSettle();

      final ex = _calls(env.api, 'POST', '/v1/wallet/exchanges').single;
      expect(ex.body, {'quote_id': 'fxq_ex1'});
      expect(ex.idempotencyKey, matches(RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')));
      expect(find.text('Exchanged'), findsOneWidget);
      expect(_calls(env.api, 'GET', '/v1/wallet'), isNotEmpty, reason: 'balances refresh after the exchange');
      expect(tester.widget<AmountText>(find.byKey(const Key('exchange-balance-USD'))).plain, r'$259.58 USD');
      expect(find.byKey(const Key('exchange-row-tr_ex1')), findsOneWidget, reason: 'the resulting transaction is listed');
    });

    testWidgets('re-quotes automatically when the quote expires', (tester) async {
      final env = await _env(_walletFx, overrides());
      await _pump(tester, env, ExchangeScreen(clock: () => now));
      await toReview(tester);
      now = now.add(const Duration(minutes: 5, seconds: 1));
      await tester.pump(const Duration(seconds: 1));
      await tester.pump();
      await tester.pump();
      expect(quoteCount, 2);
      expect(find.byKey(const Key('exchange-new-quote')), findsOneWidget);
      expect(find.text('Expires in 5:00'), findsOneWidget);
      expect(find.byKey(const Key('exchange-confirm')), findsOneWidget);
    });

    testWidgets('retrying after a network failure reuses the idempotency key', (tester) async {
      var fail = true;
      final env = await _env(
        _walletFx,
        overrides(exchange: (c) {
          if (fail) {
            fail = false;
            return ApiException.network();
          }
          return _exchangeResult;
        }),
      );
      await _pump(tester, env, ExchangeScreen(clock: () => now));
      await toReview(tester);
      await tester.tap(find.byKey(const Key('exchange-confirm')));
      await tester.pumpAndSettle();
      expect(find.text("Can't reach the server. Check your connection and try again."), findsOneWidget);
      await tester.tap(find.byKey(const Key('exchange-confirm')));
      await tester.pumpAndSettle();
      final keys = _calls(env.api, 'POST', '/v1/wallet/exchanges').map((c) => c.idempotencyKey).toList();
      expect(keys, hasLength(2));
      expect(keys[0], keys[1]);
      expect(find.text('Exchanged'), findsOneWidget);
    });

    testWidgets('wallet_exchange=false hides the Exchange entry', (tester) async {
      final env = await _env(_walletFx, {
        'GET /v1/features': (c) => {
              'object': 'features',
              'features': {'wallet_exchange': false},
            },
      });
      await _pump(tester, env, const WalletShell());
      expect(find.byKey(const Key('quick-exchange')), findsNothing);
      expect(find.bySemanticsLabel('Send'), findsWidgets);
    });

    testWidgets('wallet_exchange=true shows the Exchange entry', (tester) async {
      final env = await _env(_walletFx, {
        'GET /v1/features': (c) => {
              'object': 'features',
              'features': {'wallet_exchange': true},
            },
      });
      await _pump(tester, env, const WalletShell());
      expect(find.byKey(const Key('quick-exchange')), findsOneWidget);
    });
  });

  group('notifications', () {
    final feed = {
      'object': 'list',
      'data': [
        {'id': 'ntf_1', 'org_id': null, 'subject': 'Transfer complete', 'body': 'Sent.', 'read': false, 'created_at': '2026-09-30T14:00:00Z'},
        {'id': 'ntf_2', 'org_id': null, 'subject': 'Money added', 'body': 'Added.', 'read': false, 'created_at': '2026-09-30T13:00:00Z'},
        {'id': 'ntf_3', 'org_id': null, 'subject': 'Old news', 'body': 'Read.', 'read': true, 'created_at': '2026-09-29T13:00:00Z'},
      ],
    };

    testWidgets('tap marks one read, mark-all marks the rest, counts update', (tester) async {
      final env = await _env(_walletFx, {'GET /v1/me/notifications': (c) => feed, 'POST /v1/me/notifications/read_all': (c) => {'marked_read': 1}});
      await _pump(tester, env, const NotificationsScreen(businessMode: false));
      final get = _calls(env.api, 'GET', '/v1/me/notifications').last;
      expect(get.query?['scope'], 'personal');
      expect(env.notifications.unread, 2);
      expect(find.text('2 unread'), findsOneWidget);

      await tester.tap(find.byKey(const Key('notification-ntf_1')));
      await tester.pumpAndSettle();
      expect(_calls(env.api, 'POST', '/v1/me/notifications/ntf_1/read'), hasLength(1));
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();
      expect(env.notifications.unread, 1);
      expect(find.text('1 unread'), findsOneWidget);

      await tester.tap(find.byKey(const Key('notifications-mark-all')));
      await tester.pumpAndSettle();
      final all = _calls(env.api, 'POST', '/v1/me/notifications/read_all').single;
      expect(all.query?['scope'], 'personal');
      expect(env.notifications.unread, 0);
      expect(find.text('All read'), findsOneWidget);
    });

    testWidgets('a refused mark-read is reverted', (tester) async {
      final env = await _env(_walletFx, {
        'GET /v1/me/notifications': (c) => feed,
        'POST /v1/me/notifications/ntf_2/read': (c) => const ApiException(status: 404, code: 'resource_missing', message: 'No such notification.'),
      });
      await _pump(tester, env, const NotificationsScreen(businessMode: false));
      await tester.tap(find.byKey(const Key('notification-ntf_2')));
      await tester.pumpAndSettle();
      expect(env.notifications.unread, 2);
    });

    testWidgets('wallet bell shows the unread count', (tester) async {
      final env = await _env(_walletFx, {'GET /v1/me/notifications': (c) => feed});
      await _pump(tester, env, const WalletShell());
      expect(find.descendant(of: find.byKey(const Key('notifications-bell')), matching: find.text('2')), findsOneWidget);
    });
  });

  testWidgets('profile shows day and 30-day usage per limit type', (tester) async {
    final limits = {
      ...Json.from(_walletFx['/v1/wallet/limits'] as Map),
      'usage': {
        'internal_transfers': {'last_24h_usd': 4500000, 'last_30d_usd': 17964, 'remaining_24h_usd': 500000, 'remaining_30d_usd': 19982036},
        'withdrawals': {'last_24h_usd': 0, 'last_30d_usd': 23952, 'remaining_24h_usd': 5000000, 'remaining_30d_usd': 19976048},
        'conversions': {'last_24h_usd': 5000000, 'last_30d_usd': 5000000, 'remaining_24h_usd': 0, 'remaining_30d_usd': 15000000},
        'funding': {'last_24h_usd': 0, 'last_30d_usd': 299401, 'remaining_24h_usd': 5000000, 'remaining_30d_usd': 19700599},
      },
    };
    final env = await _env(_walletFx, {'GET /v1/wallet/limits': (c) => limits});
    await _pump(tester, env, const ProfileScreen(), height: 5200);
    for (final t in ['internal_transfers', 'withdrawals', 'conversions', 'funding']) {
      expect(find.byKey(Key('limit-usage-$t')), findsOneWidget);
    }
    expect(find.byType(UsageBar), findsNWidgets(8));
    expect(find.text(r'$5,000.00 left'), findsWidgets);
    expect(find.text('Limit reached — it frees up as older activity rolls off.'), findsOneWidget);
  });

  group('lock screen', () {
    Future<_Env> lockedEnv(dynamic Function(ApiCall) verify) async {
      final env = await _env(_walletFx, {'POST /v1/auth/verify_password': verify});
      env.lock.start(coldStart: false);
      env.lock.lock();
      return env;
    }

    dynamic verifier(ApiCall c) =>
        (c.body as Map)['password'] == 'right' ? {'verified': true} : const ApiException(status: 401, code: 'invalid_credentials', message: 'Password is incorrect.');

    testWidgets('verifies the password with the API and unlocks', (tester) async {
      final env = await lockedEnv(verifier);
      await _pump(tester, env, const LockScreen());
      await tester.enterText(find.byKey(const Key('unlock-password')), 'right');
      await tester.tap(find.byKey(const Key('unlock-submit')));
      await tester.pumpAndSettle();
      expect(_calls(env.api, 'POST', '/v1/auth/verify_password').single.body, {'password': 'right'});
      expect(_calls(env.api, 'POST', '/v1/auth/step-up'), isEmpty, reason: 'unlocking must not grant step-up');
      expect(env.lock.locked, isFalse);
      env.lock.stop();
    });

    testWidgets('signs out after five wrong passwords; network errors do not count', (tester) async {
      var offline = true;
      final env = await lockedEnv((c) {
        if (offline) {
          offline = false;
          return ApiException.network();
        }
        return verifier(c);
      });
      await _pump(tester, env, const LockScreen());
      await tester.enterText(find.byKey(const Key('unlock-password')), 'nope');
      await tester.tap(find.byKey(const Key('unlock-submit')));
      await tester.pumpAndSettle();
      expect(env.lock.failedPasswordAttempts, 0);

      for (var i = 1; i <= 4; i++) {
        await tester.enterText(find.byKey(const Key('unlock-password')), 'nope');
        await tester.tap(find.byKey(const Key('unlock-submit')));
        await tester.pumpAndSettle();
        expect(env.lock.failedPasswordAttempts, i);
        expect(find.textContaining('${5 - i} ${5 - i == 1 ? 'attempt' : 'attempts'} left'), findsOneWidget);
      }
      expect(env.auth.status, AuthStatus.signedIn);
      await tester.enterText(find.byKey(const Key('unlock-password')), 'nope');
      await tester.tap(find.byKey(const Key('unlock-submit')));
      await tester.pumpAndSettle();
      expect(env.auth.status, AuthStatus.signedOut);
      expect(_calls(env.api, 'POST', '/v1/auth/logout'), hasLength(1));
      expect(env.auth.sessionMessage, contains('Too many incorrect password attempts'));
      env.lock.stop();
    });

    testWidgets('server lockout (too_many_attempts) signs out', (tester) async {
      final env = await lockedEnv((c) => const ApiException(status: 429, code: 'too_many_attempts', message: 'Too many incorrect attempts.'));
      await _pump(tester, env, const LockScreen());
      await tester.enterText(find.byKey(const Key('unlock-password')), 'whatever');
      await tester.tap(find.byKey(const Key('unlock-submit')));
      await tester.pumpAndSettle();
      expect(env.auth.status, AuthStatus.signedOut);
      env.lock.stop();
    });
  });

  group('business', () {
    testWidgets('incident banner shows unresolved incidents only', (tester) async {
      final env = await _env(_businessFx, {
        'GET /v1/incidents': (c) => {
              'object': 'list',
              'data': [
                {
                  'incident': {'id': 'inc_1', 'title': 'Card payments delayed', 'severity': 'major', 'status': 'identified', 'affected_services_csv': 'checkout,payouts', 'customer_impact': 'Some card payments take longer.', 'started_at': '2026-09-30T12:00:00Z'},
                  'updates': [
                    {'status': 'investigating', 'message': 'Looking into it.', 'created_at': '2026-09-30T12:00:00Z'},
                    {'status': 'identified', 'message': 'Provider issue identified.', 'created_at': '2026-09-30T12:30:00Z'},
                  ],
                },
                {
                  'incident': {'id': 'inc_2', 'title': 'Old outage', 'severity': 'minor', 'status': 'resolved', 'started_at': '2026-09-20T12:00:00Z'},
                  'updates': [],
                },
              ],
            },
      });
      await _pump(tester, env, BusinessHomeScreen(onOpenTab: (_) {}));
      expect(find.byKey(const Key('incident-inc_1')), findsOneWidget);
      expect(find.byKey(const Key('incident-inc_2')), findsNothing);
      expect(find.text('Provider issue identified.'), findsOneWidget);
      await tester.tap(find.byKey(const Key('incident-inc_1')));
      await tester.pumpAndSettle();
      expect(find.text('Looking into it.'), findsOneWidget);
    });

    testWidgets('More hides platform features whose flags are off', (tester) async {
      final env = await _env(_businessFx, {
        'GET /v1/features': (c) => {
              'object': 'features',
              'features': {'marketplace': false, 'copilot': true, 'custom_domains': false, 'experiments': false},
            },
      });
      await _pump(tester, env, const MoreScreen(), height: 2400);
      expect(find.byKey(const Key('more-marketplace')), findsNothing);
      expect(find.byKey(const Key('more-domains')), findsNothing);
      expect(find.byKey(const Key('more-experiments')), findsNothing);
      expect(find.byKey(const Key('more-copilot')), findsOneWidget);
      expect(find.byKey(const Key('more-support')), findsOneWidget);
    });

    testWidgets('support: create, open thread, reply and close', (tester) async {
      final ticket = {
        'id': 'tkt_1',
        'object': 'support_ticket',
        'subject': 'Refund stuck',
        'category': 'payment_issue',
        'status': 'awaiting_merchant',
        'priority': 'normal',
        'created_at': '2026-09-30T10:00:00Z',
        'updated_at': '2026-09-30T11:00:00Z',
      };
      final created = {...ticket, 'id': 'tkt_2', 'subject': 'Tax looks wrong', 'category': 'tax_issue', 'status': 'open'};
      final env = await _env(_businessFx, {
        'GET /v1/support/tickets': (c) => {
              'object': 'list',
              'data': [ticket],
            },
        'POST /v1/support/tickets': (c) => created,
        'GET /v1/support/tickets/tkt_1': (c) => {
              'ticket': ticket,
              'messages': [
                {'id': 'm1', 'author_type': 'merchant', 'author_id': 'usr_x', 'body': 'Refund still processing.', 'created_at': '2026-09-30T10:00:00Z'},
                {'id': 'm2', 'author_type': 'staff', 'author_id': 'usr_staff', 'body': 'Can you share the payment id?', 'created_at': '2026-09-30T11:00:00Z'},
              ],
            },
        'GET /v1/support/tickets/tkt_2': (c) => {'ticket': created, 'messages': []},
        'POST /v1/support/tickets/tkt_1/messages': (c) => {'id': 'm3', 'author_type': 'merchant', 'author_id': 'usr_x', 'body': (c.body as Map)['body'], 'created_at': '2026-09-30T12:00:00Z'},
        'POST /v1/support/tickets/tkt_1/close': (c) => {...ticket, 'status': 'closed'},
      });
      await _pump(tester, env, const SupportTicketsScreen(), height: 1800);
      expect(find.text('Support replied to 1 ticket and is waiting for you.'), findsOneWidget);

      // Create
      await tester.tap(find.byKey(const Key('ticket-new')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('ticket-category-tax_issue')));
      await tester.enterText(find.byKey(const Key('ticket-subject')), 'Tax looks wrong');
      await tester.enterText(find.byKey(const Key('ticket-body')), 'VAT shows 0% for DE.');
      await tester.tap(find.byKey(const Key('ticket-submit')));
      await tester.pumpAndSettle();
      final post = _calls(env.api, 'POST', '/v1/support/tickets').single;
      expect(post.body, {'subject': 'Tax looks wrong', 'category': 'tax_issue', 'body': 'VAT shows 0% for DE.', 'priority': 'normal'});
      expect(find.text('Tax looks wrong'), findsWidgets, reason: 'the new ticket thread opens');
      await tester.tap(find.byTooltip('Back'));
      await tester.pumpAndSettle();

      // Thread, reply, close
      await tester.tap(find.byKey(const Key('ticket-tkt_1')));
      await tester.pumpAndSettle();
      expect(find.text('Can you share the payment id?'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('ticket-reply')), 'pay_123');
      await tester.tap(find.byKey(const Key('ticket-send')));
      await tester.pumpAndSettle();
      expect(_calls(env.api, 'POST', '/v1/support/tickets/tkt_1/messages').single.body, {'body': 'pay_123'});
      expect(find.text('pay_123'), findsOneWidget);
      await tester.tap(find.byKey(const Key('ticket-close')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('ticket-close-confirm')));
      await tester.pumpAndSettle();
      expect(_calls(env.api, 'POST', '/v1/support/tickets/tkt_1/close'), hasLength(1));
      expect(find.byKey(const Key('ticket-reply')), findsNothing, reason: 'closed tickets cannot be replied to');
      expect(find.text('This ticket is closed. Open a new ticket if you need more help.'), findsOneWidget);
    });
  });
}
