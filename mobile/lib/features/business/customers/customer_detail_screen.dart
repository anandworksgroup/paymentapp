import 'package:flutter/material.dart';

import '../../../core/api/api.dart';
import '../../../core/format/dates.dart';
import '../../../core/security/secure_screen.dart';
import '../../../shared/loaded_page.dart';
import '../../../theme/kit.dart';
import '../../common/navigation.dart';
import '../payments/payment_detail_screen.dart';
import '../subscriptions/subscription_detail_screen.dart';
import '../subscriptions/subscriptions_screen.dart';
import '../widgets.dart';

class CustomerDetailScreen extends StatelessWidget {
  const CustomerDetailScreen({super.key, required this.id});

  final String id;

  @override
  Widget build(BuildContext context) {
    return SecureScreen(
      child: LoadedPage(
        title: 'Customer',
        subtitle: id,
        bottomInset: 32,
        load: (api) => api.get('/v1/customers/$id'),
        builder: (context, data, reload) {
          final d = Json.from(data as Map);
          final c = d.obj('customer') ?? {};
          final subs = d.list('subscriptions');
          final payments = d.list('payments');
          final credits = d.obj('credits') ?? {};
          return [
            AppCard(
              child: Row(children: [
                FlagAvatar(c.str('country'), size: 52),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(c.str('name') ?? 'Unnamed customer', style: AppType.h2()),
                    const SizedBox(height: 2),
                    Text(c.str('email') ?? '—', style: AppType.small(AppColors.muted)),
                    const SizedBox(height: 8),
                    Wrap(spacing: 6, runSpacing: 6, children: [
                      AppChip(c.s('customer_type').toUpperCase(), dense: true, tone: Tone.neutral),
                      AppChip(humanize(c.str('tax_status')), dense: true, tone: Tone.sage),
                      if (c.str('anonymized_at') != null) const AppChip('Anonymized', dense: true, tone: Tone.peach),
                    ]),
                  ]),
                ),
              ]),
            ),
            const SizedBox(height: 14),
            AppCard(
              child: Column(children: [
                KeyValueRow('Customer since', value: fmtDate(c.str('created_at'))),
                KeyValueRow('Country', value: c.str('country')),
                if (c.str('tax_id') != null) KeyValueRow('Tax ID', value: c.str('tax_id')),
                if (c.str('external_id') != null) KeyValueRow('External id', value: c.str('external_id'), selectable: true),
                KeyValueRow('Payment methods', value: '${d.list('payment_methods').length}'),
                KeyValueRow('Credits available', value: '${credits.i('available')}'),
                KeyValueRow('Customer id', value: c.s('id'), selectable: true),
              ]),
            ),
            SectionHeader('Subscriptions', action: subs.isEmpty ? null : 'Filter', onAction: () => push(context, const SubscriptionsScreen())),
            if (subs.isEmpty)
              const AppCard(child: EmptyView(title: 'No subscriptions', icon: Icons.autorenew_rounded))
            else
              AppCard(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
                child: Column(children: [
                  for (var i = 0; i < subs.length; i++) ...[
                    if (i > 0) const Hairline(),
                    NavRow(
                      icon: Icons.autorenew_rounded,
                      title: humanize(subs[i].str('status')),
                      subtitle: 'Renews ${fmtDate(subs[i].str('current_period_end'))} · ${subs[i].s('currency')}',
                      trailing: StatusPill(subs[i].str('status')),
                      onTap: () => push(context, SubscriptionDetailScreen(id: subs[i].s('id'))),
                    ),
                  ],
                ]),
              ),
            const SectionHeader('Payments'),
            if (payments.isEmpty)
              const AppCard(child: EmptyView(title: 'No payments', icon: Icons.receipt_long_outlined))
            else
              AppCard(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
                child: Column(children: [
                  for (var i = 0; i < payments.length; i++) ...[
                    if (i > 0) const Hairline(),
                    PaymentRow(payment: payments[i], history: payments, onTap: () => push(context, PaymentDetailScreen(id: payments[i].s('id')))),
                  ],
                ]),
              ),
          ];
        },
      ),
    );
  }
}
