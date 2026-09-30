import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../core/api/api.dart';
import '../../../core/format/dates.dart';
import '../../../shared/loaded_page.dart';
import '../../../shared/offline.dart';
import '../../../theme/kit.dart';
import '../../common/navigation.dart';
import '../widgets.dart';

class PayoutsScreen extends StatefulWidget {
  const PayoutsScreen({super.key});

  @override
  State<PayoutsScreen> createState() => _PayoutsScreenState();
}

class _PayoutsScreenState extends State<PayoutsScreen> {
  late final PagedController _c;

  @override
  void initState() {
    super.initState();
    _c = PagedController(api: context.read<Api>(), path: '/v1/payouts')..refresh();
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AppPage(
      title: 'Payouts',
      bottomInset: 32,
      onRefresh: _c.refresh,
      banner: const OfflineBanner(),
      children: [
        PagedListBody(
          controller: _c,
          emptyTitle: 'No payouts yet',
          emptyMessage: 'Available funds are paid out on your payout schedule.',
          emptyIcon: Icons.account_balance_outlined,
          itemBuilder: (context, p, i) => TransactionRow(
            label: '${p.b('automatic') ? 'Automatic' : 'Manual'} payout${p.str('destination_last4') != null ? ' · •••• ${p.s('destination_last4')}' : ''}',
            amount: p.i('amount'),
            currency: p.s('currency', 'USD'),
            status: p.str('status'),
            meta: p.str('arrival_date') != null ? 'Arrives ${fmtDate(p.str('arrival_date'))}' : fmtDate(p.str('created_at')),
            sparkline: [for (final x in _c.items.reversed) if (x.s('currency') == p.s('currency')) x.i('amount').toDouble()],
            onTap: () => push(context, PayoutDetailScreen(id: p.s('id'))),
          ),
        ),
      ],
    );
  }
}

class PayoutDetailScreen extends StatelessWidget {
  const PayoutDetailScreen({super.key, required this.id});

  final String id;

  @override
  Widget build(BuildContext context) {
    return LoadedPage(
      title: 'Payout',
      subtitle: id,
      bottomInset: 32,
      load: (api) => api.get('/v1/payouts/$id'),
      builder: (context, data, reload) {
        final d = Json.from(data as Map);
        final p = d.obj('payout') ?? {};
        final dest = d.obj('destination');
        final cur = p.s('currency', 'USD');
        final txns = d.list('balance_transactions');
        return [
          AppCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [Expanded(child: Text('Payout amount', style: AppType.label())), StatusPill(p.str('status'))]),
              const SizedBox(height: 8),
              AmountText(p.i('amount'), cur, size: AmountSize.hero),
              const SizedBox(height: 10),
              if (p.str('failure_reason') != null) NoticePanel(p.s('failure_reason'), tone: Tone.rose),
              if (p.str('hold_reason') != null) NoticePanel('This payout requires additional review.', tone: Tone.peach),
            ]),
          ),
          const SizedBox(height: 14),
          AppCard(
            child: Column(children: [
              KeyValueRow('Created', value: fmtDateTime(p.str('created_at'))),
              KeyValueRow('Expected arrival', value: fmtDate(p.str('arrival_date'))),
              if (p.str('paid_at') != null) KeyValueRow('Paid', value: fmtDateTime(p.str('paid_at'))),
              KeyValueRow('Bank reference', value: p.str('bank_reference'), selectable: true),
              if (dest != null) KeyValueRow('Destination', value: '${dest.s('bank_name')} •••• ${dest.str('last4') ?? p.s('destination_last4')}'),
              KeyValueRow('Type', value: p.b('automatic') ? 'Automatic' : 'Manual'),
            ]),
          ),
          const SectionHeader('Included transactions'),
          if (txns.isEmpty)
            const AppCard(child: EmptyView(title: 'No balance transactions', icon: Icons.list_alt_rounded))
          else
            AppCard(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
              child: Column(children: [
                for (var i = 0; i < txns.length; i++) ...[
                  if (i > 0) const Hairline(),
                  TransactionRow(
                    label: '${humanize(txns[i].str('type'))} · ${txns[i].str('description') ?? txns[i].s('source_id')}',
                    amount: txns[i].i('net'),
                    currency: txns[i].s('currency', cur),
                    meta: 'Fee ${Money.format(txns[i].i('fee'), txns[i].s('currency', cur))}',
                  ),
                ],
              ]),
            ),
          const SectionHeader('Timeline'),
          AppCard(child: TimelineList(items: d.list('timeline'))),
        ];
      },
    );
  }
}
