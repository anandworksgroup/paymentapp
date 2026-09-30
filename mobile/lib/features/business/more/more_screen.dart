import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../core/auth/auth_controller.dart';
import '../../../shared/offline.dart';
import '../../../theme/kit.dart';
import '../../common/mode_switcher.dart';
import '../../common/navigation.dart';
import '../../common/notifications_screen.dart';
import '../../common/security_screen.dart';
import '../../common/settings_screen.dart';
import '../widgets.dart';
import 'analytics_screen.dart';
import 'disputes_screen.dart';
import 'payment_links_screen.dart';
import 'payouts_screen.dart';
import 'team_screen.dart';

class MoreScreen extends StatelessWidget {
  const MoreScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthController>();
    return AppPage(
      title: 'More',
      banner: const OfflineBanner(),
      children: [
        AppCard(
          child: Row(children: [
            CircleAvatar(
              radius: 24,
              backgroundColor: AppColors.sage100,
              child: Text(auth.userName.isEmpty ? '?' : auth.userName[0], style: AppType.h3(AppColors.sage700)),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(auth.userName, style: AppType.bodyMedium()),
                Text('${auth.org?.name ?? ''} · ${auth.org?.role ?? ''}', style: AppType.label()),
              ]),
            ),
            const TestModeChip(),
          ]),
        ),
        const SizedBox(height: 12),
        if (auth.canSwitchMode)
          AppCard(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
            child: NavRow(
              icon: Icons.swap_horiz_rounded,
              tone: Tone.lemon,
              title: 'Switch to Global Wallet',
              subtitle: auth.hasWallet ? 'Your personal multi-currency wallet' : 'Verify your identity to activate a wallet',
              onTap: () => showModeSwitcher(context),
            ),
          ),
        const SectionHeader('Money'),
        AppCard(
          padding: const EdgeInsets.fromLTRB(16, 6, 16, 6),
          child: Column(children: [
            NavRow(icon: Icons.account_balance_outlined, title: 'Payouts', subtitle: 'Transfers to your bank', onTap: () => push(context, const PayoutsScreen())),
            const Hairline(indent: 54),
            NavRow(icon: Icons.gavel_rounded, tone: Tone.peach, title: 'Disputes', subtitle: 'Respond with evidence', onTap: () => push(context, const DisputesScreen())),
            const Hairline(indent: 54),
            NavRow(icon: Icons.link_rounded, tone: Tone.lemon, title: 'Payment links', subtitle: 'Create, share and show as QR', onTap: () => push(context, const PaymentLinksScreen())),
            const Hairline(indent: 54),
            NavRow(icon: Icons.insights_rounded, title: 'Analytics', subtitle: 'Revenue, MRR, churn and conversion', onTap: () => push(context, const AnalyticsScreen())),
          ]),
        ),
        const SectionHeader('Account'),
        AppCard(
          padding: const EdgeInsets.fromLTRB(16, 6, 16, 6),
          child: Column(children: [
            NavRow(icon: Icons.notifications_none_rounded, tone: Tone.lemon, title: 'Notifications', onTap: () => push(context, const NotificationsScreen(businessMode: true))),
            const Hairline(indent: 54),
            NavRow(icon: Icons.groups_outlined, title: 'Team', subtitle: 'Members and roles (read-only)', onTap: () => push(context, const TeamScreen())),
            const Hairline(indent: 54),
            NavRow(icon: Icons.shield_outlined, title: 'Security', subtitle: 'Sessions, devices and events', onTap: () => push(context, const SecurityScreen())),
            const Hairline(indent: 54),
            NavRow(icon: Icons.settings_outlined, tone: Tone.neutral, title: 'Settings', subtitle: 'App lock, organization and sign out', onTap: () => push(context, const SettingsScreen())),
          ]),
        ),
        const SizedBox(height: 16),
        SecondaryButton('Sign out', icon: Icons.logout_rounded, onPressed: () => auth.logout()),
      ],
    );
  }
}
