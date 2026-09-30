import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:paymentapp_mobile/core/api/api.dart';
import 'package:paymentapp_mobile/core/offline/online_status.dart';
import 'package:paymentapp_mobile/features/wallet/send/send_money_screen.dart';
import 'package:paymentapp_mobile/features/wallet/wallet_model.dart';
import 'package:paymentapp_mobile/theme/theme.dart';
import 'package:paymentapp_mobile/theme/widgets/amount_text.dart';
import 'package:provider/provider.dart';

class ApiCall {
  ApiCall(this.method, this.path, this.query, this.body, this.idempotencyKey);
  final String method;
  final String path;
  final Map<String, String?>? query;
  final Object? body;
  final String? idempotencyKey;
}

/// In-memory stand-in for the API used by widget tests.
class FakeApi implements Api {
  FakeApi(this.handler);

  final dynamic Function(ApiCall call) handler;
  final calls = <ApiCall>[];

  Future<dynamic> _run(ApiCall c) async {
    calls.add(c);
    final r = handler(c);
    if (r is ApiException) throw r;
    return r;
  }

  @override
  Future<dynamic> get(String path, {Map<String, String?>? query}) => _run(ApiCall('GET', path, query, null, null));

  @override
  Future<dynamic> post(String path, {Object? body, String? idempotencyKey}) => _run(ApiCall('POST', path, null, body, idempotencyKey ?? newUuid()));

  @override
  Future<dynamic> patch(String path, {Object? body}) => _run(ApiCall('PATCH', path, null, body, null));

  @override
  Future<dynamic> delete(String path) => _run(ApiCall('DELETE', path, null, null, null));
}

final wallet = {
  'object': 'wallet_balances',
  'wallet': 'wal_test',
  'handle': '@alice7479',
  'status': 'active',
  'balances': [
    {'currency': 'INR', 'available': 21495500, 'held': 0, 'pending_incoming': 0, 'ledger_balance': 21495500},
    {'currency': 'USD', 'available': 20000, 'held': 0, 'pending_incoming': 0, 'ledger_balance': 20000},
  ],
  'estimated_total_usd': 277431,
  'estimate_note': 'Estimated at mid-market reference rates.',
};

final quote = {
  'object': 'fx_quote',
  'id': 'fxq_test123',
  'user_id': 'usr_alice',
  'from_currency': 'INR',
  'to_currency': 'GBP',
  'source_amount': 500000,
  'destination_amount': 4450,
  'mid_rate_e9': 8946000,
  'customer_rate_e9': 8901270,
  'spread_bps': 50,
  'spread_amount': 22,
  'fee_amount': 1500,
  'rate_timestamp': '2026-09-30T08:40:54.000Z',
  'rate_source': 'reference_table',
  'expires_at': '2026-09-30T09:05:00.000Z',
  'used_at': null,
  'created_at': '2026-09-30T09:00:00.000Z',
};

dynamic Function(ApiCall) handler({String transferStatus = 'COMPLETED', String message = 'Sent.'}) => (c) {
      if (c.path == '/v1/wallet/recipients/lookup') return {'handle': '@bob8239', 'display_name': 'Bob C.', 'type': 'user'};
      if (c.path == '/v1/wallet/fx/quotes') return quote;
      if (c.path == '/v1/wallet/transfers') {
        return {
          'id': 'tr_test',
          'object': 'transfer',
          'type': 'internal',
          'status': transferStatus,
          'direction': 'out',
          'source_amount': 500000,
          'source_currency': 'INR',
          'destination_amount': 4450,
          'destination_currency': 'GBP',
          'fee_amount': 1500,
          'fx_rate': 0.00890127,
          'message': message,
        };
      }
      if (c.path == '/v1/wallet') return wallet;
      return const ApiException(status: 404, code: 'resource_missing', message: 'No such thing.');
    };

String plainAmount(WidgetTester tester, Key key) => tester.widget<AmountText>(find.byKey(key)).plain;

void main() {
  late DateTime now;

  Future<FakeApi> pumpSend(WidgetTester tester, {dynamic Function(ApiCall)? h}) async {
    tester.view.physicalSize = const Size(430 * 3, 1700 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    now = DateTime(2026, 9, 30, 14, 30);
    final api = FakeApi(h ?? handler());
    final model = WalletModel(api: api)..data = Json.from(wallet);
    await tester.pumpWidget(MultiProvider(
      providers: [
        Provider<Api>.value(value: api),
        ChangeNotifierProvider<OnlineStatus>(create: (_) => OnlineStatus()),
        ChangeNotifierProvider<WalletModel>.value(value: model),
      ],
      child: MaterialApp(theme: buildAppTheme(), home: SendMoneyScreen(clock: () => now)),
    ));
    return api;
  }

  Future<void> goToReview(WidgetTester tester) async {
    await tester.enterText(find.byKey(const Key('send-recipient')), 'bob@wallet.test');
    await tester.tap(find.byKey(const Key('send-find')));
    await tester.pumpAndSettle();
    expect(find.text('Bob C.'), findsOneWidget, reason: 'lookup shows the masked name');
    await tester.tap(find.byKey(const Key('send-continue')));
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const Key('send-amount')), '5,000');
    await tester.tap(find.byKey(const Key('send-dest')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('GBP').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('send-review')));
    await tester.pump();
    await tester.pump();
  }

  testWidgets('shows rate, spread, fee, exact received amount and countdown before confirm', (tester) async {
    final api = await pumpSend(tester);
    await goToReview(tester);

    final quoteCall = api.calls.singleWhere((c) => c.path == '/v1/wallet/fx/quotes');
    expect(quoteCall.body, {'from_currency': 'INR', 'to_currency': 'GBP', 'amount': 500000}, reason: 'amount sent as integer minor units');
    expect(quoteCall.idempotencyKey, isNotNull);

    expect(find.byKey(const Key('quote-view')), findsOneWidget);
    expect(plainAmount(tester, const Key('quote-received')), '£44.50 GBP');
    expect(plainAmount(tester, const Key('quote-send')), '₹5,000.00 INR');
    expect(plainAmount(tester, const Key('quote-fee')), '₹15.00 INR');
    expect(find.text('1 INR = 0.008901 GBP'), findsOneWidget);
    expect(find.text('0.50% · £0.22'), findsOneWidget);
    expect(find.text('Expires in 5:00'), findsOneWidget);
    expect(find.byKey(const Key('send-confirm')), findsOneWidget);
    expect(api.calls.where((c) => c.path == '/v1/wallet/transfers'), isEmpty, reason: 'nothing is sent before confirm');

    now = now.add(const Duration(minutes: 4, seconds: 30));
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('Expires in 0:30'), findsOneWidget);

    now = now.add(const Duration(seconds: 31));
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('Quote expired'), findsOneWidget);
    expect(find.byKey(const Key('send-confirm')), findsNothing, reason: 'an expired quote cannot be confirmed');
    expect(find.byKey(const Key('send-requote')), findsOneWidget);
  });

  testWidgets('confirm sends the quote id and shows the neutral review message for HELD', (tester) async {
    final api = await pumpSend(tester, h: handler(transferStatus: 'HELD', message: 'This transaction requires additional review. We\'ll update you soon.'));
    await goToReview(tester);
    await tester.tap(find.byKey(const Key('send-confirm')));
    await tester.pumpAndSettle();

    final call = api.calls.singleWhere((c) => c.path == '/v1/wallet/transfers');
    final body = call.body as Map;
    expect(body['recipient'], '@bob8239');
    expect(body['source_currency'], 'INR');
    expect(body['destination_currency'], 'GBP');
    expect(body['amount'], 500000);
    expect(body['quote_id'], 'fxq_test123');
    expect(call.idempotencyKey, matches(RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')));

    expect(find.text('Under review'), findsOneWidget);
    expect(find.text("This transaction requires additional review. We'll update you soon."), findsOneWidget);
  });

  testWidgets('same-currency transfers do not send a quote id', (tester) async {
    final api = await pumpSend(tester, h: (c) {
      if (c.path == '/v1/wallet/fx/quotes') {
        return {...quote, 'to_currency': 'INR', 'destination_amount': 500000, 'customer_rate_e9': 1000000000, 'mid_rate_e9': 1000000000, 'spread_bps': 0, 'spread_amount': 0, 'fee_amount': 0};
      }
      return handler()(c);
    });
    await tester.enterText(find.byKey(const Key('send-recipient')), '@bob8239');
    await tester.tap(find.byKey(const Key('send-find')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('send-continue')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('send-amount')), '5000');
    await tester.tap(find.byKey(const Key('send-review')));
    await tester.pump();
    await tester.pump();
    expect(find.text('1 INR = 1.0000 INR'), findsNothing, reason: 'no FX rows for same currency');
    await tester.tap(find.byKey(const Key('send-confirm')));
    await tester.pumpAndSettle();
    final body = api.calls.singleWhere((c) => c.path == '/v1/wallet/transfers').body as Map;
    expect(body.containsKey('quote_id'), isFalse);
    expect(find.text('Sent'), findsWidgets);
  });
}
