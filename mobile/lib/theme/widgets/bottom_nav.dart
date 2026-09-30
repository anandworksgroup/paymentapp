import 'package:flutter/material.dart';

import '../colors.dart';
import '../typography.dart';

class BottomNavItem {
  const BottomNavItem({required this.icon, required this.label});
  final IconData icon;
  final String label;
}

/// Floating white bottom bar: the active tab is a charcoal pill with icon + label, the rest plain icons.
class BottomNav extends StatelessWidget {
  const BottomNav({super.key, required this.items, required this.index, required this.onChanged});

  final List<BottomNavItem> items;
  final int index;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      minimum: const EdgeInsets.fromLTRB(16, 0, 16, 14),
      child: Container(
        height: 66,
        padding: const EdgeInsets.symmetric(horizontal: 8),
        decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(AppRadius.pill), boxShadow: AppShadows.card),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            for (var i = 0; i < items.length; i++)
              _NavButton(item: items[i], active: i == index, onTap: () => onChanged(i)),
          ],
        ),
      ),
    );
  }
}

class _NavButton extends StatelessWidget {
  const _NavButton({required this.item, required this.active, required this.onTap});

  final BottomNavItem item;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: active,
      label: item.label,
      child: InkWell(
        onTap: onTap,
        customBorder: const StadiumBorder(),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 220),
          curve: Curves.easeOut,
          height: 48,
          padding: EdgeInsets.symmetric(horizontal: active ? 16 : 12),
          decoration: BoxDecoration(color: active ? AppColors.ink : Colors.transparent, borderRadius: BorderRadius.circular(AppRadius.pill)),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            Icon(item.icon, size: 22, color: active ? AppColors.surface : AppColors.muted),
            if (active) ...[
              const SizedBox(width: 8),
              Text(item.label, style: AppType.small(AppColors.surface).copyWith(fontWeight: FontWeight.w500)),
            ],
          ]),
        ),
      ),
    );
  }
}
