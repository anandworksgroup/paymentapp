import 'package:flutter/material.dart';

import '../colors.dart';

/// Pill-shaped usage meter on a sage track: sage while comfortable, peach from 80%, rose when the
/// limit is reached. [used] and [limit] are in the same unit; the ratio is display-only.
class UsageBar extends StatelessWidget {
  const UsageBar({super.key, required this.used, required this.limit, this.height = 10});

  final int used;
  final int limit;
  final double height;

  double get fraction => limit <= 0 ? (used > 0 ? 1 : 0) : (used / limit).clamp(0.0, 1.0);

  @override
  Widget build(BuildContext context) {
    final f = fraction;
    final color = f >= 1
        ? AppColors.roseInk
        : f >= 0.8
            ? AppColors.peach
            : AppColors.sage500;
    return Semantics(
      value: '${(f * 100).round()}% used',
      child: Container(
        height: height,
        decoration: BoxDecoration(color: AppColors.surface3, borderRadius: BorderRadius.circular(AppRadius.pill)),
        alignment: Alignment.centerLeft,
        child: FractionallySizedBox(
          widthFactor: used > 0 ? f.clamp(0.02, 1.0) : 0,
          child: Container(decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(AppRadius.pill))),
        ),
      ),
    );
  }
}
