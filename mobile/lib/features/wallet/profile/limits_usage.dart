import 'package:flutter/material.dart';

import '../../../core/api/api.dart';
import '../../../theme/kit.dart';

/// Per-type limit usage from `GET /v1/wallet/limits` (`usage.{type}.last_24h_usd / last_30d_usd` against
/// `current.daily_usd / monthly_usd`). Limits apply to each movement type separately, over a rolling 24
/// hours and a rolling 30 days, measured in USD at mid-market rates.
class LimitsUsageCard extends StatelessWidget {
  const LimitsUsageCard({super.key, required this.limits});

  final Json limits;

  static const types = <String, (String, IconData)>{
    'internal_transfers': ('Sending money', Icons.north_east_rounded),
    'conversions': ('Exchanges', Icons.currency_exchange_rounded),
    'withdrawals': ('Withdrawals', Icons.account_balance_outlined),
    'funding': ('Adding money', Icons.add_rounded),
  };

  @override
  Widget build(BuildContext context) {
    // `current` is the tier in force; older responses only list the tiers, so fall back to the highest
    // tier at or below the user's KYC level (the same rule the API applies).
    final level = limits.i('kyc_level');
    final current = limits.obj('current') ??
        limits.list('limits').where((x) => x.i('kyc_level') <= level).fold<Json?>(null, (a, b) => a == null || b.i('kyc_level') >= a.i('kyc_level') ? b : a);
    final usage = limits.obj('usage') ?? const <String, dynamic>{};
    final cur = limits.s('currency', 'USD');
    if (current == null) {
      return AppCard(child: Text('Verify your identity to unlock wallet limits.', style: AppType.small(AppColors.muted)));
    }
    final rows = [
      for (final e in types.entries)
        if (usage[e.key] is Map) (e.key, e.value.$1, e.value.$2, Json.from(usage[e.key] as Map)),
    ];
    if (rows.isEmpty) {
      return AppCard(child: Text('Usage isn’t available right now.', style: AppType.small(AppColors.muted)));
    }
    return AppCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        for (var i = 0; i < rows.length; i++) ...[
          if (i > 0) const Padding(padding: EdgeInsets.symmetric(vertical: 14), child: Hairline()),
          _UsageBlock(
            key: Key('limit-usage-${rows[i].$1}'),
            title: rows[i].$2,
            icon: rows[i].$3,
            usage: rows[i].$4,
            daily: current.i('daily_usd'),
            monthly: current.i('monthly_usd'),
            currency: cur,
          ),
        ],
        const SizedBox(height: 14),
        Text(
          'Per transaction up to ${Money.format(current.i('per_transaction_usd'), cur, withCode: true)}. '
          'Each type has its own allowance over a rolling 24 hours and 30 days, measured in $cur at mid-market rates.',
          style: AppType.caption(),
        ),
      ]),
    );
  }
}

class _UsageBlock extends StatelessWidget {
  const _UsageBlock({super.key, required this.title, required this.icon, required this.usage, required this.daily, required this.monthly, required this.currency});

  final String title;
  final IconData icon;
  final Json usage;
  final int daily;
  final int monthly;
  final String currency;

  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [
        Container(
          width: 30,
          height: 30,
          decoration: const BoxDecoration(color: AppColors.sage100, shape: BoxShape.circle),
          child: Icon(icon, size: 15, color: AppColors.sage700),
        ),
        const SizedBox(width: 10),
        Expanded(child: Text(title, style: AppType.bodyMedium())),
      ]),
      const SizedBox(height: 12),
      _line('Last 24 hours', usage.i('last_24h_usd'), daily, usage.iOrNull('remaining_24h_usd')),
      const SizedBox(height: 12),
      _line('Last 30 days', usage.i('last_30d_usd'), monthly, usage.iOrNull('remaining_30d_usd')),
    ]);
  }

  Widget _line(String label, int used, int limit, int? remaining) {
    final left = remaining ?? (limit - used).clamp(0, limit);
    final full = limit > 0 && used >= limit;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
        Expanded(child: Text(label, style: AppType.label())),
        Flexible(
          child: FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerRight,
            child: Text.rich(TextSpan(children: [
              TextSpan(text: Money.format(used, currency), style: AppType.small(AppColors.text).copyWith(fontWeight: FontWeight.w500)),
              TextSpan(text: ' of ${Money.format(limit, currency)}', style: AppType.small(AppColors.muted)),
            ])),
          ),
        ),
      ]),
      const SizedBox(height: 6),
      UsageBar(used: used, limit: limit),
      const SizedBox(height: 4),
      Text(
        full ? 'Limit reached — it frees up as older activity rolls off.' : '${Money.format(left, currency)} left',
        style: AppType.caption(full ? AppColors.roseInk : AppColors.muted),
      ),
    ]);
  }
}
