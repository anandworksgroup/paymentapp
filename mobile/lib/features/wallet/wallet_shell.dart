import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api/api.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/cache/cache_store.dart';
import '../../theme/kit.dart';
import 'activity/activity_screen.dart';
import 'home/wallet_home_screen.dart';
import 'profile/profile_screen.dart';
import 'send/send_money_screen.dart';
import 'wallet_model.dart';

/// Wallet mode: Wallet, Send, Activity, Profile.
class WalletShell extends StatefulWidget {
  const WalletShell({super.key});

  @override
  State<WalletShell> createState() => _WalletShellState();
}

class _WalletShellState extends State<WalletShell> {
  int _index = 0;
  final _visited = <int>{0};
  late final WalletModel _wallet;
  final _activityKey = GlobalKey<ActivityScreenState>();

  static const _items = [
    BottomNavItem(icon: Icons.account_balance_wallet_outlined, label: 'Wallet'),
    BottomNavItem(icon: Icons.north_east_rounded, label: 'Send'),
    BottomNavItem(icon: Icons.receipt_long_outlined, label: 'Activity'),
    BottomNavItem(icon: Icons.person_outline_rounded, label: 'Profile'),
  ];

  @override
  void initState() {
    super.initState();
    final auth = context.read<AuthController>();
    _wallet = WalletModel(api: context.read<Api>(), cache: context.read<CacheStore>(), cacheKey: auth.cacheKey('wallet'));
    _wallet.loadCached().then((_) => _wallet.refresh());
  }

  @override
  void dispose() {
    _wallet.dispose();
    super.dispose();
  }

  void _go(int i) {
    setState(() {
      _index = i;
      _visited.add(i);
    });
    if (i == 2) _activityKey.currentState?.reload();
  }

  Widget _tab(int i) => switch (i) {
        0 => WalletHomeScreen(onOpenTab: _go),
        1 => SendMoneyScreen(embedded: true, onDone: () => _go(2)),
        2 => ActivityScreen(key: _activityKey),
        _ => const ProfileScreen(),
      };

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider<WalletModel>.value(
      value: _wallet,
      child: Scaffold(
        extendBody: true,
        backgroundColor: AppColors.bg,
        body: IndexedStack(
          index: _index,
          children: [for (var i = 0; i < _items.length; i++) _visited.contains(i) ? _tab(i) : const SizedBox.shrink()],
        ),
        bottomNavigationBar: BottomNav(items: _items, index: _index, onChanged: _go),
      ),
    );
  }
}
