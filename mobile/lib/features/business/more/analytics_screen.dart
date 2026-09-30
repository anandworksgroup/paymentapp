import 'package:flutter/material.dart';

import '../../../core/api/api.dart';
import '../../../shared/loaded_page.dart';
import '../../../theme/kit.dart';

class AnalyticsScreen extends StatefulWidget {
  const AnalyticsScreen({super.key});

  @override
  State<AnalyticsScreen> createState() => _AnalyticsScreenState();
}

class _AnalyticsScreenState extends State<AnalyticsScreen> {
  int _days = 30;

  @override
  Widget build(BuildContext context) {
    return LoadedPage(
      key: ValueKey(_days),
      title: 'Analytics',
      subtitle: 'Last $_days days · test mode',
      bottomInset: 32,
      cacheName: 'analytics.$_days',
      load: (api) {
        final now = DateTime.now().toUtc();
        final to = DateTime.utc(now.year, now.month, now.day).add(const Duration(days: 1));
        return api.get('/v1/reports/dashboard', query: {
          'from': to.subtract(Duration(days: _days)).toIso8601String(),
          'to': to.toIso8601String(),
        });
      },
      builder: (context, data, reload) {
        final d = Json.from(data as Map);
        final cur = d.s('reporting_currency', 'USD');
        final defs = d.obj('definitions') ?? {};
        Widget money(String label, String key, {String? def}) => _Metric(label: label, def: def == null ? null : defs.str(def), child: AmountText(d.i(key), cur, size: AmountSize.small));
        Widget number(String label, String value, {String? def}) =>
            _Metric(label: label, def: def == null ? null : defs.str(def), child: Text(value, style: AppType.h3().copyWith(fontWeight: FontWeight.w400)));
        return [
          Row(children: [
            for (final n in [7, 30, 90]) ...[
              AppChip('${n}D', tone: Tone.neutral, selected: _days == n, dense: true, onTap: () => setState(() => _days = n)),
              const SizedBox(width: 6),
            ],
          ]),
          const SizedBox(height: 14),
          AppCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Net revenue', style: AppType.label()),
              const SizedBox(height: 6),
              AmountText(d.i('net_revenue'), cur, size: AmountSize.large),
              const SizedBox(height: 8),
              if (d.d('change_pct') != null)
                AppChip('${d.d('change_pct')! >= 0 ? '+' : ''}${d.d('change_pct')!.toStringAsFixed(1)}% gross vs prior period', dense: true),
              const SizedBox(height: 6),
              Text(defs.s('net_revenue'), style: AppType.caption()),
            ]),
          ),
          const SizedBox(height: 12),
          GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 12,
            crossAxisSpacing: 12,
            childAspectRatio: 1.55,
            children: [
              money('Gross revenue', 'gross_revenue', def: 'gross_revenue'),
              money('MRR', 'mrr', def: 'mrr'),
              money('ARR', 'arr', def: 'arr'),
              money('Taxes collected', 'taxes_collected'),
              money('Platform fees', 'platform_fees'),
              money('Refunds', 'refunds'),
              money('Chargebacks', 'chargebacks'),
              money('ARPU', 'arpu'),
              number('Payments', '${d.i('successful_payments')} / ${d.i('transactions')}'),
              number('Failed', '${d.i('failed_payments')}'),
              number('Conversion', '${d.d('conversion_rate_pct') ?? 0}%', def: 'conversion_rate'),
              number('Churn', '${d.d('churn_rate_pct') ?? 0}%', def: 'churn'),
              number('Customers', '${d.i('customers')} (+${d.i('new_customers')})'),
              number('Active subscriptions', '${d.i('active_subscriptions')}'),
            ],
          ),
          const SectionHeader('By country'),
          AppCard(
            padding: const EdgeInsets.fromLTRB(16, 6, 16, 6),
            child: Column(children: [
              if (d.list('by_country').isEmpty) const EmptyView(title: 'No sales in this period', icon: Icons.public_rounded),
              for (final c in d.list('by_country'))
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: Row(children: [
                    FlagAvatar(c.s('country'), size: 30),
                    const SizedBox(width: 12),
                    Expanded(child: Text('${c.s('country')} · ${c.i('count')} payments', style: AppType.body(AppColors.text2))),
                    AmountText(c.i('gross'), cur, size: AmountSize.small, showCode: false),
                  ]),
                ),
            ]),
          ),
          const SectionHeader('Payment methods'),
          AppCard(
            child: Column(children: [
              for (final m in d.list('by_method'))
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      Expanded(child: Text('${m.s('method')} · ${m.i('count')}', style: AppType.body(AppColors.text2))),
                      Text('${m.d('success_rate') ?? 0}% success', style: AppType.small()),
                    ]),
                    const SizedBox(height: 6),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(AppRadius.pill),
                      child: LinearProgressIndicator(
                        value: ((m.d('success_rate') ?? 0) / 100).clamp(0, 1).toDouble(),
                        minHeight: 8,
                        color: AppColors.sage500,
                        backgroundColor: AppColors.surface3,
                      ),
                    ),
                  ]),
                ),
            ]),
          ),
          const SizedBox(height: 12),
          Text('All figures are computed by the server from payments and the ledger, in $cur at reference FX.', style: AppType.caption()),
        ];
      },
    );
  }
}

class _Metric extends StatelessWidget {
  const _Metric({required this.label, required this.child, this.def});

  final String label;
  final Widget child;
  final String? def;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      padding: const EdgeInsets.all(16),
      onTap: def == null
          ? null
          : () => showDialog<void>(
                context: context,
                builder: (c) => AlertDialog(title: Text(label), content: Text(def!), actions: [TextButton(onPressed: () => Navigator.pop(c), child: const Text('OK'))]),
              ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.center, children: [
        Row(children: [
          Expanded(child: Text(label, style: AppType.label(), maxLines: 1, overflow: TextOverflow.ellipsis)),
          if (def != null) const Icon(Icons.info_outline_rounded, size: 14, color: AppColors.faint),
        ]),
        const SizedBox(height: 8),
        FittedBox(fit: BoxFit.scaleDown, alignment: Alignment.centerLeft, child: child),
      ]),
    );
  }
}
