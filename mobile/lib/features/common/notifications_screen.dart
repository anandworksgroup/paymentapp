import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api/api.dart';
import '../../core/format/dates.dart';
import '../../shared/offline.dart';
import '../../theme/kit.dart';
import 'navigation.dart';
import 'notification_center.dart';

/// In-app notification feed (`GET /v1/me/notifications`). Tapping one marks it read
/// (`POST /v1/me/notifications/{id}/read`) and opens the object it refers to; "Mark all read" calls
/// `POST /v1/me/notifications/read_all`. Unread counts on the header bells update from the same model.
class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key, required this.businessMode});

  final bool businessMode;

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) context.read<NotificationCenter>().refresh();
    });
  }

  Future<void> _markAll() async {
    final center = context.read<NotificationCenter>();
    try {
      final n = await center.markAllRead();
      if (mounted) showToast(context, n == 0 ? 'Everything was already read' : 'Marked $n as read');
    } catch (e) {
      if (mounted) showToast(context, e is ApiException ? e.message : 'Could not mark notifications as read.');
    }
  }

  Future<void> _open(Json n) async {
    final center = context.read<NotificationCenter>();
    if (!n.b('read')) {
      // Fire and forget: the row updates immediately and reverts if the API refuses.
      center.markRead(n.s('id')).catchError((Object e) {
        if (mounted) showToast(context, e is ApiException ? e.message : 'Could not mark the notification as read.');
      });
    }
    final opened = openObject(context, n.str('object_type'), n.str('object_id'), businessMode: widget.businessMode);
    if (!opened) {
      await showDialog<void>(
        context: context,
        builder: (c) => AlertDialog(
          title: Text(n.s('subject')),
          content: Text(n.s('body')),
          actions: [TextButton(onPressed: () => Navigator.pop(c), child: const Text('OK'))],
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final center = context.watch<NotificationCenter>();
    final items = center.items;
    final unread = center.unread;
    final List<Widget> children;
    if (items.isEmpty && (center.loading || !center.loadedOnce) && center.error == null) {
      children = [const LoadingView()];
    } else if (items.isEmpty && center.error != null) {
      children = [ErrorView(error: center.error!, onRetry: center.refresh)];
    } else if (items.isEmpty) {
      children = [
        const AppCard(
          child: EmptyView(
            title: 'You’re all caught up',
            message: 'Payment, payout, dispute and transfer updates appear here.',
            icon: Icons.notifications_none_rounded,
          ),
        ),
      ];
    } else {
      children = [
        if (center.fromCache && center.error != null) const Padding(padding: EdgeInsets.only(bottom: 12), child: CachedDataNotice()),
        if (!center.fromCache && center.error != null) Padding(padding: const EdgeInsets.only(bottom: 12), child: ErrorView(error: center.error!, onRetry: center.refresh)),
        Padding(
          padding: const EdgeInsets.fromLTRB(4, 0, 4, 12),
          child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
            AppChip(
              unread == 0 ? 'All read' : '$unread${center.unreadMayBeMore ? '+' : ''} unread',
              key: const Key('notifications-unread'),
              tone: unread == 0 ? Tone.sage : Tone.lemon,
              icon: unread == 0 ? Icons.done_all_rounded : Icons.markunread_outlined,
              dense: true,
            ),
            const SizedBox(width: 10),
            Flexible(
              child: SecondaryButton(
                'Mark all read',
                key: const Key('notifications-mark-all'),
                dense: true,
                expand: false,
                onPressed: unread > 0 && !center.markingAll && canWrite(context) ? _markAll : null,
              ),
            ),
          ]),
        ),
        AppCard(
          padding: const EdgeInsets.fromLTRB(16, 6, 16, 6),
          child: Column(children: [
            for (var i = 0; i < items.length; i++) ...[
              if (i > 0) const Hairline(indent: 54),
              _NotificationRow(key: Key('notification-${items[i].s('id')}'), n: items[i], onTap: () => _open(items[i])),
            ],
          ]),
        ),
      ];
    }
    return AppPage(
      title: 'Notifications',
      bottomInset: 32,
      onRefresh: center.refresh,
      banner: const OfflineBanner(),
      children: children,
    );
  }
}

class _NotificationRow extends StatelessWidget {
  const _NotificationRow({super.key, required this.n, required this.onTap});

  final Json n;
  final VoidCallback onTap;

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
    final unread = !n.b('read');
    return Semantics(
      label: unread ? 'Unread' : null,
      child: InkWell(
        borderRadius: BorderRadius.circular(AppRadius.inner),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 4),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Stack(children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(color: unread ? AppColors.sage100 : AppColors.surface3, shape: BoxShape.circle),
                child: Icon(_icon, size: 19, color: unread ? AppColors.sage700 : AppColors.muted),
              ),
              if (unread)
                Positioned(
                  right: 0,
                  top: 0,
                  child: Container(
                    width: 10,
                    height: 10,
                    decoration: BoxDecoration(color: AppColors.peach, shape: BoxShape.circle, border: Border.all(color: AppColors.surface, width: 2)),
                  ),
                ),
            ]),
            const SizedBox(width: 14),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Expanded(
                    child: Text(
                      n.s('subject'),
                      style: unread ? AppType.bodyMedium() : AppType.body(AppColors.text2),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  Text(fmtRelative(n.str('created_at')), style: AppType.caption()),
                ]),
                const SizedBox(height: 2),
                Text(n.s('body'), style: AppType.small(AppColors.muted), maxLines: 2, overflow: TextOverflow.ellipsis),
              ]),
            ),
          ]),
        ),
      ),
    );
  }
}
