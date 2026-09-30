import 'package:flutter/material.dart';

import '../../theme/kit.dart';
import 'customers/customers_screen.dart';
import 'home/business_home_screen.dart';
import 'more/more_screen.dart';
import 'payments/payments_screen.dart';
import 'subscriptions/subscriptions_screen.dart';

/// Business mode: Home, Payments, Customers, Subscriptions, More.
class BusinessShell extends StatefulWidget {
  const BusinessShell({super.key});

  @override
  State<BusinessShell> createState() => _BusinessShellState();
}

class _BusinessShellState extends State<BusinessShell> {
  int _index = 0;
  final _visited = <int>{0};

  static const _items = [
    BottomNavItem(icon: Icons.space_dashboard_outlined, label: 'Home'),
    BottomNavItem(icon: Icons.receipt_long_outlined, label: 'Payments'),
    BottomNavItem(icon: Icons.people_outline_rounded, label: 'Customers'),
    BottomNavItem(icon: Icons.autorenew_rounded, label: 'Subscriptions'),
    BottomNavItem(icon: Icons.more_horiz_rounded, label: 'More'),
  ];

  Widget _tab(int i) => switch (i) {
        0 => BusinessHomeScreen(onOpenTab: _go),
        1 => const PaymentsScreen(),
        2 => const CustomersScreen(),
        3 => const SubscriptionsScreen(),
        _ => const MoreScreen(),
      };

  void _go(int i) => setState(() {
        _index = i;
        _visited.add(i);
      });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      extendBody: true,
      backgroundColor: AppColors.bg,
      body: IndexedStack(
        index: _index,
        children: [for (var i = 0; i < _items.length; i++) _visited.contains(i) ? _tab(i) : const SizedBox.shrink()],
      ),
      bottomNavigationBar: BottomNav(items: _items, index: _index, onChanged: _go),
    );
  }
}
