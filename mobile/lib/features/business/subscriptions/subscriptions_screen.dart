import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../core/api/api.dart';
import '../../../core/format/dates.dart';
import '../../../shared/loaded_page.dart';
import '../../../shared/offline.dart';
import '../../../theme/kit.dart';
import '../../common/navigation.dart';
import '../widgets.dart';
import 'subscription_detail_screen.dart';

class SubscriptionsScreen extends StatefulWidget {
  const SubscriptionsScreen({super.key, this.initialStatus});

  final String? initialStatus;

  @override
  State<SubscriptionsScreen> createState() => _SubscriptionsScreenState();
}

class _SubscriptionsScreenState extends State<SubscriptionsScreen> {
  late final PagedController _c;
  String? _status;

  static const _filters = <String?, String>{
    null: 'All',
    'ACTIVE': 'Active',
    'TRIALING': 'Trialing',
    'PAST_DUE': 'Past due',
    'PAUSED': 'Paused',
    'CANCELLED': 'Cancelled',
  };

  @override
  void initState() {
    super.initState();
    _status = widget.initialStatus;
    _c = PagedController(api: context.read<Api>(), path: '/v1/subscriptions', query: {'status': _status})..refresh();
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AppPage(
      title: 'Subscriptions',
      onRefresh: _c.refresh,
      banner: const OfflineBanner(),
      children: [
        FilterChips(
          options: _filters,
          selected: _status,
          onChanged: (v) {
            setState(() => _status = v);
            _c.query = {'status': v};
            _c.refresh();
          },
        ),
        const SizedBox(height: 14),
        PagedListBody(
          controller: _c,
          emptyTitle: 'No subscriptions',
          emptyMessage: 'Recurring prices sold through checkout create subscriptions.',
          emptyIcon: Icons.autorenew_rounded,
          itemBuilder: (context, s, i) => NavRow(
            icon: s.b('cancel_at_period_end') ? Icons.event_busy_outlined : Icons.autorenew_rounded,
            tone: toneForStatus(s.str('status')),
            title: s.s('customer_id'),
            subtitle: s.s('status') == 'PAUSED'
                ? 'Paused ${fmtDate(s.str('paused_at'))}'
                : '${s.b('cancel_at_period_end') ? 'Ends' : 'Renews'} ${fmtDate(s.str('current_period_end'))} · ${s.s('currency')}',
            trailing: StatusPill(s.str('status')),
            onTap: () async {
              await push(context, SubscriptionDetailScreen(id: s.s('id')));
              _c.refresh();
            },
          ),
        ),
      ],
    );
  }
}
