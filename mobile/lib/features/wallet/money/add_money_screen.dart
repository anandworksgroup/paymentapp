import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../core/api/api.dart';
import '../../../shared/offline.dart';
import '../../../shared/step_up.dart';
import '../../../theme/kit.dart';
import '../wallet_model.dart';
import '../widgets.dart';

/// Add money via the sandbox bank-transfer rail (`POST /v1/wallet/fund`).
class AddMoneyScreen extends StatefulWidget {
  const AddMoneyScreen({super.key});

  @override
  State<AddMoneyScreen> createState() => _AddMoneyScreenState();
}

class _AddMoneyScreenState extends State<AddMoneyScreen> {
  String? _currency;
  final _amount = TextEditingController();
  bool _busy = false;
  Object? _error;
  Json? _result;

  @override
  void dispose() {
    _amount.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final cur = _currency;
    if (cur == null) return;
    final amount = Money.parseInput(_amount.text, cur);
    if (amount == null || amount <= 0) {
      setState(() => _error = 'Enter a valid amount in $cur.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final api = context.read<Api>();
    final wallet = context.read<WalletModel>();
    try {
      final res = await withStepUp(context, (key) => api.post('/v1/wallet/fund', idempotencyKey: key, body: {'currency': cur, 'amount': amount, 'source': 'bank_transfer'}));
      if (!mounted) return;
      if (res != null) {
        setState(() => _result = Json.from(res as Map));
        await wallet.refresh();
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final w = context.watch<WalletModel>();
    _currency ??= w.currencies.isNotEmpty ? w.currencies.first : 'USD';
    if (_result != null) {
      return AppPage(
        title: 'Add money',
        bottomInset: 24,
        footer: PrimaryButton('Done', onPressed: () => Navigator.of(context).pop(true)),
        children: [TransferResultCard(transfer: _result!, title: 'Money added')],
      );
    }
    final options = {...w.currencies, ...allCurrencies}.toList();
    return AppPage(
      title: 'Add money',
      subtitle: 'Bank transfer',
      bottomInset: 24,
      banner: const OfflineBanner(),
      footer: PrimaryButton('Add money', key: const Key('fund-submit'), loading: _busy, onPressed: canWrite(context) ? _submit : null),
      children: [
        const NoticePanel(
          'Sandbox rail: this simulates an incoming bank transfer. No real money moves.',
          title: 'Test mode',
          tone: Tone.peach,
          icon: Icons.science_outlined,
        ),
        const SizedBox(height: 14),
        AppCard(
          child: Column(children: [
            CurrencyDropdown(value: _currency, options: options, onChanged: (v) => setState(() => _currency = v)),
            const SizedBox(height: 14),
            TextField(
              key: const Key('fund-amount'),
              controller: _amount,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              style: AppType.h1().copyWith(fontWeight: FontWeight.w300),
              decoration: InputDecoration(hintText: '0.00', suffixText: _currency),
            ),
            const SizedBox(height: 12),
            const KeyValueRow('Source', value: 'Bank transfer (sandbox)'),
          ]),
        ),
        InlineError(_error),
      ],
    );
  }
}
