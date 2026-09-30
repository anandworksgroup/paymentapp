import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api/api.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/format/dates.dart';
import '../../shared/loaded_page.dart';
import '../../theme/kit.dart';
import 'navigation.dart';

/// In-app notification feed (`GET /v1/me/notifications`). Tapping one opens the object it refers to.
class NotificationsScreen extends StatelessWidget {
  const NotificationsScreen({super.key, required this.businessMode});

  final bool businessMode;

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthController>();
    List<Json> filter(dynamic data) {
      final all = ApiList.from(data).data;
      // Wallet mode shows personal notifications only; business mode is already scoped by X-Org-Id.
      return businessMode ? all : all.where((n) => n.str('org_id') == null).toList();
    }

    return LoadedPage(
      title: 'Notifications',
      bottomInset: 32,
      cacheName: 'notifications.${businessMode ? auth.orgId : 'wallet'}',
      load: (api) => api.get('/v1/me/notifications'),
      isEmpty: (d) => filter(d).isEmpty,
      emptyTitle: 'You’re all caught up',
      emptyMessage: 'Payment, payout, dispute and transfer updates appear here.',
      emptyIcon: Icons.notifications_none_rounded,
      builder: (context, data, reload) {
        final items = filter(data);
        return [
          AppCard(
            padding: const EdgeInsets.fromLTRB(16, 6, 16, 6),
            child: Column(children: [
              for (var i = 0; i < items.length; i++) ...[
                if (i > 0) const Hairline(indent: 54),
                _NotificationRow(n: items[i], businessMode: businessMode),
              ],
            ]),
          ),
        ];
      },
    );
  }
}

class _NotificationRow extends StatelessWidget {
  const _NotificationRow({required this.n, required this.businessMode});

  final Json n;
  final bool businessMode;

  IconData get _icon => switch (n.str('object_type')) {
        'payment' => Icons.receipt_long_outlined,
        'dispute' => Icons.gavel_rounded,
        'payout' => Icons.account_balance_outlined,
        'transfer' => Icons.swap_horiz_rounded,
        'subscription' => Icons.autorenew_rounded,
        _ => Icons.notifications_none_rounded,
      };

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(AppRadius.inner),
      onTap: () {
        final opened = openObject(context, n.str('object_type'), n.str('object_id'), businessMode: businessMode);
        if (!opened) {
          showDialog<void>(
            context: context,
            builder: (c) => AlertDialog(
              title: Text(n.s('subject')),
              content: Text(n.s('body')),
              actions: [TextButton(onPressed: () => Navigator.pop(c), child: const Text('OK'))],
            ),
          );
        }
      },
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 4),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Stack(children: [
            Container(
              width: 40,
              height: 40,
              decoration: const BoxDecoration(color: AppColors.sage100, shape: BoxShape.circle),
              child: Icon(_icon, size: 19, color: AppColors.sage700),
            ),
            if (!n.b('read'))
              Positioned(right: 0, top: 0, child: Container(width: 10, height: 10, decoration: BoxDecoration(color: AppColors.peach, shape: BoxShape.circle, border: Border.all(color: AppColors.surface, width: 2)))),
          ]),
          const SizedBox(width: 14),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(child: Text(n.s('subject'), style: AppType.bodyMedium(), maxLines: 1, overflow: TextOverflow.ellipsis)),
                Text(fmtRelative(n.str('created_at')), style: AppType.caption()),
              ]),
              const SizedBox(height: 2),
              Text(n.s('body'), style: AppType.small(AppColors.muted), maxLines: 2, overflow: TextOverflow.ellipsis),
            ]),
          ),
        ]),
      ),
    );
  }
}
