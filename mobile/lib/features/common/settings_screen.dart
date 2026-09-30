import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/config.dart';
import '../../core/security/app_lock.dart';
import '../../theme/kit.dart';
import 'navigation.dart';
import 'security_screen.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthController>();
    final lock = context.watch<AppLock>();
    final org = auth.mode == AppMode.business ? auth.org : null;
    return AppPage(
      title: 'Settings',
      bottomInset: 32,
      children: [
        if (org != null) ...[
          const SectionHeader('Organization', padding: EdgeInsets.fromLTRB(4, 4, 4, 10)),
          AppCard(
            child: Column(children: [
              KeyValueRow('Name', value: org.name),
              KeyValueRow('Your role', value: org.role),
              KeyValueRow('Country', value: org.country),
              KeyValueRow('Default currency', value: org.currency),
              KeyValueRow('Status', child: StatusPill(org.status)),
              const KeyValueRow('Mode', child: AppChip('Test mode', dense: true, tone: Tone.peach)),
            ]),
          ),
        ],
        const SectionHeader('App security'),
        AppCard(
          child: Column(children: [
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: lock.enabled,
              onChanged: lock.biometricsAvailable ? (v) => lock.setEnabled(v) : null,
              title: Text('Biometric app lock', style: AppType.bodyMedium()),
              subtitle: Text(
                lock.biometricsAvailable ? 'Require Face ID / fingerprint when you return to the app.' : 'Biometrics are not available on this device.',
                style: AppType.label(),
              ),
            ),
            const Hairline(),
            KeyValueRow('Auto-lock after inactivity', value: '${AppConfig.sessionTimeoutMinutes} min'),
            KeyValueRow('Screenshot protection', value: 'On for sensitive screens (Android)'),
            const Hairline(),
            NavRow(icon: Icons.shield_outlined, title: 'Sessions and devices', onTap: () => push(context, const SecurityScreen())),
            NavRow(icon: Icons.lock_outline_rounded, tone: Tone.neutral, title: 'Lock now', onTap: lock.lock),
          ]),
        ),
        const SectionHeader('About'),
        AppCard(
          child: Column(children: [
            KeyValueRow('Signed in as', value: auth.userEmail),
            KeyValueRow('API', value: AppConfig.apiUrl),
            const KeyValueRow('Version', value: '0.1.0 (sandbox)'),
          ]),
        ),
        const SizedBox(height: 16),
        SecondaryButton('Sign out', icon: Icons.logout_rounded, onPressed: () {
          Navigator.of(context).popUntil((r) => r.isFirst);
          auth.logout();
        }),
      ],
    );
  }
}
