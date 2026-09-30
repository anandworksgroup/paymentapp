import 'package:flutter/material.dart';

import '../../../core/api/api.dart';
import '../../../shared/loaded_page.dart';
import '../../../theme/kit.dart';
import '../../business/widgets.dart' show FilterChips;
import '../../common/navigation.dart';
import '../widgets.dart';
import 'transfer_detail_screen.dart';

/// Wallet activity (`GET /v1/wallet/transactions`) in the reference transaction-row style.
class ActivityScreen extends StatefulWidget {
  const ActivityScreen({super.key});

  @override
  State<ActivityScreen> createState() => ActivityScreenState();
}

class ActivityScreenState extends State<ActivityScreen> {
  final _page = GlobalKey<LoadedPageState>();
  String? _filter;

  void reload() => _page.currentState?.reload();

  bool _matches(Json t) => switch (_filter) {
        'in' => t.s('direction') == 'in',
        'out' => t.s('direction') == 'out' && t.s('type') != 'withdrawal',
        'withdrawal' => t.s('type') == 'withdrawal',
        'review' => t.s('status') == 'HELD',
        _ => true,
      };

  @override
  Widget build(BuildContext context) {
    return LoadedPage(
      key: _page,
      title: 'Activity',
      cacheName: 'wallet.activity',
      load: (api) => api.get('/v1/wallet/transactions', query: {'limit': '100'}),
      emptyTitle: 'No activity yet',
      emptyMessage: 'Money you add, send, receive or withdraw shows up here.',
      emptyIcon: Icons.receipt_long_outlined,
      isEmpty: (d) => ApiList.from(d).data.isEmpty,
      builder: (context, data, reload) {
        final all = ApiList.from(data).data;
        final shown = all.where(_matches).toList();
        return [
          FilterChips(
            options: const {null: 'All', 'in': 'Received', 'out': 'Sent', 'withdrawal': 'Withdrawals', 'review': 'Under review'},
            selected: _filter,
            onChanged: (v) => setState(() => _filter = v),
          ),
          const SizedBox(height: 14),
          if (shown.isEmpty)
            const AppCard(child: EmptyView(title: 'Nothing matches this filter', icon: Icons.filter_alt_off_outlined))
          else
            AppCard(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
              child: Column(children: [
                for (var i = 0; i < shown.length; i++) ...[
                  if (i > 0) const Hairline(),
                  WalletTxRow(
                    key: Key('tx-${shown[i].s('id')}'),
                    tx: shown[i],
                    history: all,
                    onTap: () => push(context, TransferDetailScreen(id: shown[i].s('id'), summary: shown[i])),
                  ),
                ],
              ]),
            ),
        ];
      },
    );
  }
}
