import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../core/api/api.dart';
import '../../../core/auth/auth_controller.dart';
import '../../../shared/loaded_page.dart';
import '../../../theme/kit.dart';
import '../../common/mode_switcher.dart';
import '../../common/navigation.dart';
import '../../common/notification_center.dart';
import '../../common/notifications_screen.dart';
import '../../common/security_screen.dart';
import '../../common/settings_screen.dart';
import '../kyc/kyc_screen.dart';
import '../wallet_model.dart';
import 'limits_usage.dart';

/// Profile: KYC level, limits and how much of them is used (`GET /v1/wallet/limits`), security, mode
/// switch and sign out.
class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthController>();
    final w = context.watch<WalletModel>();
    final user = auth.user ?? const <String, dynamic>{};
    return LoadedPage(
      title: 'Profile',
      cacheName: 'wallet.limits',
      load: (api) => api.get('/v1/wallet/limits'),
      builder: (context, data, reload) {
        final l = Json.from(data as Map);
        final level = l.i('kyc_level');
        final limits = l.list('limits');
        final cur = l.s('currency', 'USD');
        final current = limits.where((x) => x.i('kyc_level') <= level).fold<Json?>(null, (a, b) => a == null || b.i('kyc_level') >= a.i('kyc_level') ? b : a);
        final next = limits.where((x) => x.i('kyc_level') > level).fold<Json?>(null, (a, b) => a == null || b.i('kyc_level') < a.i('kyc_level') ? b : a);
        return [
          AppCard(
            child: Row(children: [
              CircleAvatar(
                radius: 28,
                backgroundColor: AppColors.lemonSoft,
                child: Text(auth.userName.isEmpty ? '?' : auth.userName[0], style: AppType.h2(AppColors.lemonInk)),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(auth.userName, style: AppType.h3()),
                  Text(auth.userEmail, style: AppType.label()),
                  if (w.handle.isNotEmpty) Text(w.handle, style: AppType.small(AppColors.sage700)),
                ]),
              ),
              FlagAvatar(user.str('country'), size: 34),
            ]),
          ),
          const SizedBox(height: 12),
          const Align(alignment: Alignment.centerLeft, child: ModeChip()),
          const SectionHeader('Verification and limits'),
          AppCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(child: Text('KYC level $level', style: AppType.h2(), key: const Key('kyc-level'))),
                StatusPill(user.str('kyc_status')),
              ]),
              const SizedBox(height: 12),
              if (current == null)
                Text('Verify your identity to unlock wallet limits.', style: AppType.small(AppColors.muted))
              else
                InnerPanel(
                  child: Column(children: [
                    KeyValueRow('Per transaction', child: AmountText(current.i('per_transaction_usd'), cur, size: AmountSize.small)),
                    KeyValueRow('Daily', child: AmountText(current.i('daily_usd'), cur, size: AmountSize.small)),
                    KeyValueRow('30 days', child: AmountText(current.i('monthly_usd'), cur, size: AmountSize.small)),
                    KeyValueRow('Max balance', child: AmountText(current.i('max_balance_usd'), cur, size: AmountSize.small)),
                  ]),
                ),
              const SizedBox(height: 8),
              Text('Limits are measured in $cur at mid-market rates.', style: AppType.caption()),
              if (next != null) ...[
                const SizedBox(height: 14),
                Text('Level ${next.i('kyc_level')} raises your per-transaction limit to ${Money.format(next.i('per_transaction_usd'), cur, withCode: true)}.', style: AppType.small()),
                const SizedBox(height: 10),
                SecondaryButton('Verify to level ${next.i('kyc_level')}', icon: Icons.verified_user_outlined, onPressed: () async {
                  final done = await pushWithWallet<bool>(context, KycScreen(level: next.i('kyc_level')));
                  if (done == true) {
                    await auth.reloadWallet();
                    await reload();
                  }
                }),
              ],
            ]),
          ),
          const SectionHeader('Limit usage'),
          LimitsUsageCard(limits: l),
          const SectionHeader('Account'),
          AppCard(
            padding: const EdgeInsets.fromLTRB(16, 6, 16, 6),
            child: Column(children: [
              NavRow(
                icon: Icons.notifications_none_rounded,
                tone: Tone.lemon,
                title: 'Notifications',
                trailing: context.watch<NotificationCenter>().unread > 0
                    ? Row(mainAxisSize: MainAxisSize.min, children: [CountBadge(context.watch<NotificationCenter>().unread, plus: context.watch<NotificationCenter>().unreadMayBeMore), const Icon(Icons.chevron_right_rounded, color: AppColors.faint)])
                    : null,
                onTap: () => push(context, const NotificationsScreen(businessMode: false)),
              ),
              const Hairline(indent: 54),
              NavRow(icon: Icons.shield_outlined, title: 'Security', subtitle: 'Sessions, devices and events', onTap: () => push(context, const SecurityScreen())),
              const Hairline(indent: 54),
              NavRow(icon: Icons.settings_outlined, tone: Tone.neutral, title: 'Settings', subtitle: 'App lock and sign out', onTap: () => push(context, const SettingsScreen())),
            ]),
          ),
          const SizedBox(height: 16),
          SecondaryButton('Sign out', icon: Icons.logout_rounded, onPressed: () => auth.logout()),
        ];
      },
    );
  }
}
