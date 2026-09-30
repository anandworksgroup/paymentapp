import 'package:flutter/material.dart';

import '../../core/api/api.dart';
import '../../core/format/dates.dart';
import '../../theme/kit.dart';

/// Human label for a wallet transaction type.
String transferTypeLabel(Json t) => switch (t.s('type')) {
      'funding' => 'Added money',
      'withdrawal' => 'Withdrawal',
      'merchant_proceeds' => 'Merchant proceeds',
      'conversion' => 'Conversion',
      _ => t.s('direction') == 'in' ? 'Received' : 'Sent',
    };

/// Amounts previously exchanged with the same counterparty (oldest → this one).
List<double> counterpartyHistory(Json t, List<Json> all) {
  final cp = t.s('counterparty');
  final created = t.s('created_at');
  final same = all.where((x) => x.s('counterparty') == cp && x.s('currency') == t.s('currency') && x.s('created_at').compareTo(created) <= 0).toList()
    ..sort((a, b) => a.s('created_at').compareTo(b.s('created_at')));
  return same.map((x) => x.i('amount').toDouble()).toList();
}

/// A row from `GET /v1/wallet/transactions` in the reference transaction-row style.
class WalletTxRow extends StatelessWidget {
  const WalletTxRow({super.key, required this.tx, this.history = const [], this.onTap});

  final Json tx;
  final List<Json> history;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final t = tx;
    final fx = t.obj('fx');
    final incoming = t.s('direction') == 'in';
    final countries = fx != null
        ? [Money.countryFor(fx.s('from')), Money.countryFor(fx.s('to'))]
        : [Money.countryFor(t.s('currency'))];
    final status = t.s('status');
    return TransactionRow(
      label: '${transferTypeLabel(t)} · ${t.s('counterparty')}',
      amount: t.i('amount'),
      currency: t.s('currency', 'USD'),
      signed: incoming,
      status: status == 'COMPLETED' ? null : status,
      meta: [
        fmtRelative(t.str('created_at')),
        if (fx != null && !incoming) '→ ${Money.format(fx.i('received'), fx.s('to'), withCode: true)}',
        if (t.i('fee') > 0) 'fee ${Money.format(t.i('fee'), t.s('currency'))}',
      ].join(' · '),
      sparkline: counterpartyHistory(t, history.isEmpty ? [t] : history),
      countries: countries,
      onTap: onTap,
      muted: status == 'CANCELLED' || status == 'FAILED' || status == 'RETURNED',
    );
  }
}

/// Supported currencies for pickers (mirrors the API table).
List<String> get allCurrencies => Money.currencies.keys.toList();

/// Dropdown of currencies with a flag.
class CurrencyDropdown extends StatelessWidget {
  const CurrencyDropdown({super.key, required this.value, required this.options, required this.onChanged, this.label = 'Currency', this.helper});

  final String? value;
  final List<String> options;
  final ValueChanged<String?> onChanged;
  final String label;
  final String? helper;

  @override
  Widget build(BuildContext context) {
    return DropdownButtonFormField<String>(
      value: options.contains(value) ? value : null,
      isExpanded: true,
      decoration: InputDecoration(labelText: label, helperText: helper),
      items: [
        for (final c in options)
          DropdownMenuItem(
            value: c,
            child: Row(children: [FlagAvatar(Money.countryFor(c), size: 22), const SizedBox(width: 10), Text(c)]),
          ),
      ],
      onChanged: onChanged,
    );
  }
}

/// Neutral result card for a transfer response (never speculates about review reasons).
class TransferResultCard extends StatelessWidget {
  const TransferResultCard({super.key, required this.transfer, required this.title});

  static String? _message(Json t) => t.str('message') ?? t.str('customer_message');

  final Json transfer;
  final String title;

  @override
  Widget build(BuildContext context) {
    final t = transfer;
    final status = t.s('status');
    final ok = status == 'COMPLETED' || status == 'PROCESSING';
    final held = status == 'HELD';
    final tone = ok ? Tone.sage : held ? Tone.peach : Tone.rose;
    return AppCard(
      child: Column(children: [
        Container(
          width: 64,
          height: 64,
          decoration: BoxDecoration(color: tone.background, shape: BoxShape.circle),
          child: Icon(ok ? Icons.check_rounded : held ? Icons.hourglass_top_rounded : Icons.info_outline_rounded, color: tone.foreground, size: 30),
        ),
        const SizedBox(height: 14),
        Text(ok ? title : held ? 'Under review' : humanize(status), style: AppType.h2(), key: const Key('transfer-result-title')),
        const SizedBox(height: 6),
        if (_message(t) != null && _message(t)!.replaceAll('.', '').trim().toLowerCase() != title.toLowerCase())
          Text(_message(t)!, style: AppType.body(AppColors.text2), textAlign: TextAlign.center, key: const Key('transfer-result-message')),
        const SizedBox(height: 16),
        InnerPanel(
          child: Column(children: [
            KeyValueRow('Amount', child: AmountText(t.i('source_amount'), t.s('source_currency'), size: AmountSize.small)),
            if (t.i('fee_amount') > 0) KeyValueRow('Fee', child: AmountText(t.i('fee_amount'), t.s('source_currency'), size: AmountSize.small)),
            if (t.s('destination_currency') != t.s('source_currency') || t.i('destination_amount') != t.i('source_amount'))
              KeyValueRow('Received', child: AmountText(t.i('destination_amount'), t.s('destination_currency'), size: AmountSize.small)),
            KeyValueRow('Status', child: StatusPill(status)),
            KeyValueRow('Reference', value: t.s('id'), selectable: true),
          ]),
        ),
      ]),
    );
  }
}
