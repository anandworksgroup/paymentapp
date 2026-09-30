import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../core/api/api.dart';
import '../../../shared/offline.dart';
import '../../../theme/kit.dart';
import '../send/quote_view.dart';
import '../wallet_model.dart';
import '../widgets.dart';

/// Exchange preview. The API has no endpoint to convert between your own balances, so this shows a live
/// quote only (`POST /v1/wallet/fx/quotes`); conversion itself is "coming soon".
class ExchangeScreen extends StatefulWidget {
  const ExchangeScreen({super.key});

  @override
  State<ExchangeScreen> createState() => _ExchangeScreenState();
}

class _ExchangeScreenState extends State<ExchangeScreen> {
  String? _from;
  String? _to;
  final _amount = TextEditingController();
  QuoteState? _quote;
  bool _busy = false;
  Object? _error;
  Timer? _ticker;

  @override
  void dispose() {
    _ticker?.cancel();
    _amount.dispose();
    super.dispose();
  }

  Future<void> _preview() async {
    final from = _from, to = _to;
    if (from == null || to == null) return;
    if (from == to) {
      setState(() => _error = 'Choose two different currencies.');
      return;
    }
    final amount = Money.parseInput(_amount.text, from);
    if (amount == null || amount <= 0) {
      setState(() => _error = 'Enter a valid amount in $from.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final q = Json.from(await context.read<Api>().post('/v1/wallet/fx/quotes', body: {'from_currency': from, 'to_currency': to, 'amount': amount}) as Map);
      if (!mounted) return;
      setState(() => _quote = QuoteState(q));
      _ticker?.cancel();
      _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
        if (mounted) setState(() {});
      });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final w = context.watch<WalletModel>();
    final mine = w.currencies;
    _from ??= mine.isNotEmpty ? mine.first : 'USD';
    _to ??= allCurrencies.firstWhere((c) => c != _from, orElse: () => 'EUR');
    return AppPage(
      title: 'Exchange',
      subtitle: 'Rate preview',
      bottomInset: 24,
      banner: const OfflineBanner(),
      footer: PrimaryButton(_quote == null ? 'Preview rate' : 'Refresh quote', icon: Icons.currency_exchange_rounded, loading: _busy, onPressed: canWrite(context) ? _preview : null),
      children: [
        const NoticePanel('Conversion to your own balances is coming soon. You can preview today’s rate below.', title: 'Coming soon', icon: Icons.schedule_rounded),
        const SizedBox(height: 14),
        AppCard(
          child: Column(children: [
            CurrencyDropdown(label: 'From', value: _from, options: mine.isEmpty ? allCurrencies : mine, onChanged: (v) => setState(() => _from = v)),
            const SizedBox(height: 12),
            TextField(
              controller: _amount,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              style: AppType.h1().copyWith(fontWeight: FontWeight.w300),
              decoration: InputDecoration(hintText: '0.00', suffixText: _from),
            ),
            const SizedBox(height: 12),
            CurrencyDropdown(label: 'To', value: _to, options: allCurrencies, onChanged: (v) => setState(() => _to = v)),
          ]),
        ),
        if (_quote != null) ...[
          const SizedBox(height: 14),
          QuoteView(state: _quote!, receiverLabel: 'You would get'),
        ],
        InlineError(_error),
      ],
    );
  }
}
