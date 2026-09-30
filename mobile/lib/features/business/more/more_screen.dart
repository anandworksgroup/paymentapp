import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../core/auth/auth_controller.dart';
import '../../../core/flags/feature_flags.dart';
import '../../../shared/offline.dart';
import '../../../theme/kit.dart';
import '../../common/mode_switcher.dart';
import '../../common/navigation.dart';
import '../../common/notification_center.dart';
import '../../common/notifications_screen.dart';
import '../../common/security_screen.dart';
import '../../common/settings_screen.dart';
import '../support/support_screens.dart';
import '../widgets.dart';
import 'analytics_screen.dart';
import 'disputes_screen.dart';
import 'payment_links_screen.dart';
import 'payouts_screen.dart';
import 'platform_screens.dart';
import 'team_screen.dart';

class MoreScreen extends StatelessWidget {
  const MoreScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthController>();
    final flags = context.watch<FeatureFlags>();
    final unread = context.watch<NotificationCenter>().unread;
    // Flag-gated platform features: only entries whose flag is on for this organization are listed.
    final platform = <Widget>[
      if (flags.isOn(FeatureFlags.marketplace))
        NavRow(key: const Key('more-marketplace'), icon: Icons.storefront_outlined, title: 'Marketplace sellers', subtitle: 'Connected sellers and commissions', onTap: () => push(context, const SellersScreen())),
      if (flags.isOn(FeatureFlags.customDomains))
        NavRow(key: const Key('more-domains'), icon: Icons.language_rounded, tone: Tone.lemon, title: 'Custom domains', subtitle: 'Checkout and portal domains', onTap: () => push(context, const DomainsScreen())),
      if (flags.isOn(FeatureFlags.experiments))
        NavRow(key: const Key('more-experiments'), icon: Icons.science_outlined, tone: Tone.peach, title: 'Experiments', subtitle: 'Checkout A/B tests', onTap: () => push(context, const ExperimentsScreen())),
      if (flags.isOn(FeatureFlags.copilot))
        NavRow(key: const Key('more-copilot'), icon: Icons.auto_awesome_outlined, title: 'Copilot', subtitle: 'AI copilot status and drafted actions', onTap: () => push(context, const CopilotScreen())),
    ];
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
        if (platform.isNotEmpty) ...[
          const SectionHeader('Platform'),
          AppCard(
            padding: const EdgeInsets.fromLTRB(16, 6, 16, 6),
            child: Column(children: [
              for (var i = 0; i < platform.length; i++) ...[if (i > 0) const Hairline(indent: 54), platform[i]],
            ]),
          ),
        ],
        const SectionHeader('Account'),
        AppCard(
          padding: const EdgeInsets.fromLTRB(16, 6, 16, 6),
          child: Column(children: [
            NavRow(
              icon: Icons.notifications_none_rounded,
              tone: Tone.lemon,
              title: 'Notifications',
              trailing: unread > 0 ? Row(mainAxisSize: MainAxisSize.min, children: [CountBadge(unread, plus: context.watch<NotificationCenter>().unreadMayBeMore), const Icon(Icons.chevron_right_rounded, color: AppColors.faint)]) : null,
              onTap: () => push(context, const NotificationsScreen(businessMode: true)),
            ),
            const Hairline(indent: 54),
            NavRow(
              key: const Key('more-support'),
              icon: Icons.support_agent_rounded,
              tone: Tone.peach,
              title: 'Help & support',
              subtitle: 'Tickets with our support team',
              onTap: () => push(context, const SupportTicketsScreen()),
            ),
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
