import 'package:flutter/material.dart';

import '../../core/api/api.dart';
import '../../core/format/dates.dart';
import '../../theme/kit.dart';

/// Merchant sessions always run in test mode on this build; the label is always visible.
class TestModeChip extends StatelessWidget {
  const TestModeChip({super.key});

  @override
  Widget build(BuildContext context) => const AppChip('Test mode', tone: Tone.peach, icon: Icons.science_outlined, dense: true);
}

/// Earlier amounts from the same customer (oldest → this payment), for the barcode sparkline.
List<double> customerHistory(Json payment, List<Json> all) {
  final customer = payment.str('customer_id');
  if (customer == null) return [payment.i('amount').toDouble()];
  final created = payment.s('created_at');
  final same = all.where((p) => p.str('customer_id') == customer && p.s('created_at').compareTo(created) <= 0 && p.s('currency') == payment.s('currency')).toList()
    ..sort((a, b) => a.s('created_at').compareTo(b.s('created_at')));
  return same.map((p) => p.i('amount').toDouble()).toList();
}

class PaymentRow extends StatelessWidget {
  const PaymentRow({super.key, required this.payment, this.history = const [], this.onTap});

  final Json payment;
  final List<Json> history;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final p = payment;
    final label = p.str('customer_email') ?? p.str('description') ?? 'Payment';
    final method = p.str('last4') != null ? '${humanize(p.str('card_brand') ?? p.str('payment_method_type'))} •• ${p.s('last4')}' : humanize(p.str('payment_method_type'));
    return TransactionRow(
      label: label,
      amount: p.i('amount'),
      currency: p.s('currency', 'USD'),
      status: p.str('status'),
      meta: '${fmtRelative(p.str('created_at'))} · $method',
      sparkline: customerHistory(p, history.isEmpty ? [p] : history),
      countries: [p.str('country')],
      onTap: onTap,
      muted: p.s('status') == 'FAILED',
    );
  }
}

/// State-transition timeline (from/to, actor, reason) used by payment, subscription and payout detail.
class TimelineList extends StatelessWidget {
  const TimelineList({super.key, required this.items});

  final List<Json> items;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) return Text('No state changes recorded yet.', style: AppType.small(AppColors.muted));
    return Column(children: [
      for (var i = 0; i < items.length; i++)
        IntrinsicHeight(
          child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            SizedBox(
              width: 22,
              child: Column(children: [
                const SizedBox(height: 4),
                Container(
                  width: 10,
                  height: 10,
                  decoration: BoxDecoration(color: toneForStatus(items[i].str('to_state')).foreground, shape: BoxShape.circle),
                ),
                if (i < items.length - 1) Expanded(child: Container(width: 1.5, color: AppColors.line)),
              ]),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.only(bottom: 14),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Expanded(
                      child: Text(
                        items[i].str('from_state') == null ? humanize(items[i].str('to_state')) : '${humanize(items[i].str('from_state'))} → ${humanize(items[i].str('to_state'))}',
                        style: AppType.bodyMedium(),
                      ),
                    ),
                    Text(fmtDateTime(items[i].str('created_at')), style: AppType.caption()),
                  ]),
                  if (items[i].str('reason') != null) ...[
                    const SizedBox(height: 2),
                    Text(humanize(items[i].str('reason')), style: AppType.label()),
                  ],
                  if (items[i].str('object_type') != null && items[i].s('object_type') != 'payment')
                    Text(humanize(items[i].str('object_type')), style: AppType.caption(AppColors.faint)),
                ]),
              ),
            ),
          ]),
        ),
    ]);
  }
}

/// Horizontal row of filter chips.
class FilterChips extends StatelessWidget {
  const FilterChips({super.key, required this.options, required this.selected, required this.onChanged});

  /// value → label; a null value means "All".
  final Map<String?, String> options;
  final String? selected;
  final ValueChanged<String?> onChanged;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(children: [
        for (final e in options.entries) ...[
          AppChip(e.value, tone: Tone.neutral, selected: selected == e.key, dense: true, onTap: () => onChanged(e.key)),
          const SizedBox(width: 6),
        ],
      ]),
    );
  }
}
