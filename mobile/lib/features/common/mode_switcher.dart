import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/auth/auth_controller.dart';
import '../../theme/kit.dart';

/// Header chip showing the current mode ("Business ▾" / "Wallet ▾"); opens the switcher sheet.
class ModeChip extends StatelessWidget {
  const ModeChip({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthController>();
    if (!auth.canSwitchMode) return const SizedBox.shrink();
    final business = auth.mode == AppMode.business;
    return AppChip(
      business ? 'Business' : 'Wallet',
      key: const Key('mode-chip'),
      tone: business ? Tone.lemon : Tone.sage,
      icon: business ? Icons.storefront_outlined : Icons.account_balance_wallet_outlined,
      dropdown: true,
      dense: true,
      onTap: () => showModeSwitcher(context),
    );
  }
}

Future<void> showModeSwitcher(BuildContext context) {
  return showModalBottomSheet<void>(
    context: context,
    builder: (sheetContext) {
      final auth = sheetContext.watch<AuthController>();
      return SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Switch mode', style: AppType.h2()),
            const SizedBox(height: 14),
            for (final o in auth.orgs)
              NavRow(
                icon: Icons.storefront_outlined,
                tone: Tone.lemon,
                title: o.name,
                subtitle: 'Business · ${o.role} · test mode',
                trailing: auth.mode == AppMode.business && auth.orgId == o.id ? const Icon(Icons.check_circle, color: AppColors.sage700) : null,
                onTap: () async {
                  Navigator.of(sheetContext).pop();
                  await auth.selectOrg(o.id);
                  await auth.switchMode(AppMode.business);
                },
              ),
            const Hairline(),
            NavRow(
              icon: Icons.account_balance_wallet_outlined,
              title: 'Global Wallet',
              subtitle: auth.hasWallet ? 'Send, receive and hold money in multiple currencies' : 'Verify your identity to activate a wallet',
              trailing: auth.mode == AppMode.wallet ? const Icon(Icons.check_circle, color: AppColors.sage700) : null,
              onTap: () async {
                Navigator.of(sheetContext).pop();
                await auth.switchMode(AppMode.wallet);
              },
            ),
          ]),
        ),
      );
    },
  );
}
