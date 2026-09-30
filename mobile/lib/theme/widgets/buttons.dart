import 'package:flutter/material.dart';

import '../colors.dart';
import '../typography.dart';

/// Charcoal pill button. Shows a spinner while [loading]; disabled when [onPressed] is null.
class PrimaryButton extends StatelessWidget {
  const PrimaryButton(this.label, {super.key, this.onPressed, this.loading = false, this.icon, this.expand = true, this.tone});

  final String label;
  final VoidCallback? onPressed;
  final bool loading;
  final IconData? icon;
  final bool expand;

  /// Optional destructive styling (rose) for irreversible actions.
  final Tone? tone;

  @override
  Widget build(BuildContext context) {
    final enabled = onPressed != null && !loading;
    final bg = !enabled ? AppColors.surface3 : (tone == Tone.rose ? AppColors.roseInk : AppColors.ink);
    final fg = enabled ? AppColors.surface : AppColors.muted;
    final child = Row(
      mainAxisSize: expand ? MainAxisSize.max : MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        if (loading)
          SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: fg))
        else if (icon != null)
          Icon(icon, size: 19, color: fg),
        if (loading || icon != null) const SizedBox(width: 10),
        Flexible(child: Text(label, style: AppType.button(fg), overflow: TextOverflow.ellipsis)),
      ],
    );
    return Semantics(
      button: true,
      enabled: enabled,
      child: Material(
        color: bg,
        shape: const StadiumBorder(),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: enabled ? onPressed : null,
          child: Container(height: 54, padding: const EdgeInsets.symmetric(horizontal: 22), alignment: Alignment.center, child: child),
        ),
      ),
    );
  }
}

/// Quiet pill button on a light surface.
class SecondaryButton extends StatelessWidget {
  const SecondaryButton(this.label, {super.key, this.onPressed, this.icon, this.expand = true, this.dense = false});

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final bool expand;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final enabled = onPressed != null;
    final fg = enabled ? AppColors.text : AppColors.faint;
    return Material(
      color: AppColors.surface3,
      shape: const StadiumBorder(),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onPressed,
        child: Container(
          height: dense ? 40 : 50,
          padding: EdgeInsets.symmetric(horizontal: dense ? 14 : 20),
          child: Row(
            mainAxisSize: expand ? MainAxisSize.max : MainAxisSize.min,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (icon != null) ...[Icon(icon, size: 18, color: fg), const SizedBox(width: 8)],
              Flexible(child: Text(label, style: (dense ? AppType.small(fg) : AppType.bodyMedium(fg)).copyWith(fontWeight: FontWeight.w500), overflow: TextOverflow.ellipsis)),
            ],
          ),
        ),
      ),
    );
  }
}

/// Round white icon button used for back/close and header actions. [badge] shows a peach dot;
/// [badgeCount] (when > 0) shows a small peach count pill instead, e.g. unread notifications.
class CircleIconButton extends StatelessWidget {
  const CircleIconButton(this.icon, {super.key, this.onPressed, this.tooltip, this.badge = false, this.badgeCount = 0, this.badgePlus = false, this.size = 44, this.dark = false});

  final IconData icon;
  final VoidCallback? onPressed;
  final String? tooltip;
  final bool badge;
  final int badgeCount;

  /// Shows "N+" when the count is a lower bound.
  final bool badgePlus;
  final double size;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    final btn = Material(
      color: dark ? AppColors.ink : AppColors.surface,
      shape: const CircleBorder(),
      elevation: 0,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onPressed,
        child: SizedBox(
          width: size,
          height: size,
          child: Stack(alignment: Alignment.center, children: [
            Icon(icon, size: size * 0.46, color: dark ? AppColors.surface : AppColors.text),
            if (badge && badgeCount <= 0)
              Positioned(
                top: size * 0.24,
                right: size * 0.26,
                child: Container(width: 8, height: 8, decoration: const BoxDecoration(color: AppColors.peach, shape: BoxShape.circle)),
              ),
          ]),
        ),
      ),
    );
    final Widget withBadge = badgeCount <= 0
        ? btn
        : Stack(clipBehavior: Clip.none, children: [
            btn,
            Positioned(top: -4, right: -8, child: CountBadge(badgeCount, plus: badgePlus)),
          ]);
    return tooltip == null ? withBadge : Tooltip(message: badgeCount > 0 ? '$tooltip ($badgeCount unread)' : tooltip!, child: withBadge);
  }
}

/// Circular quick action with a label beneath (Add money, Send, Receive, …).
class QuickAction extends StatelessWidget {
  const QuickAction({super.key, required this.icon, required this.label, this.onTap, this.highlight = false});

  final IconData icon;
  final String label;
  final VoidCallback? onTap;
  final bool highlight;

  @override
  Widget build(BuildContext context) {
    final enabled = onTap != null;
    return Semantics(
      button: true,
      enabled: enabled,
      label: label,
      excludeSemantics: true,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppRadius.inner),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 2),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Container(
              width: 54,
              height: 54,
              decoration: BoxDecoration(
                color: !enabled ? AppColors.surface3 : (highlight ? AppColors.ink : AppColors.surface),
                shape: BoxShape.circle,
                boxShadow: enabled ? AppShadows.card : null,
              ),
              child: Icon(icon, size: 22, color: !enabled ? AppColors.faint : (highlight ? AppColors.surface : AppColors.text)),
            ),
            const SizedBox(height: 8),
            FittedBox(
              fit: BoxFit.scaleDown,
              child: Text(label, style: AppType.caption(enabled ? AppColors.text2 : AppColors.faint), textAlign: TextAlign.center, maxLines: 1),
            ),
          ]),
        ),
      ),
    );
  }
}

/// Small peach count pill ("3", "99+") for unread badges.
class CountBadge extends StatelessWidget {
  const CountBadge(this.count, {super.key, this.plus = false});

  final int count;
  final bool plus;

  @override
  Widget build(BuildContext context) {
    final text = count > 99 ? '99+' : '$count${plus ? '+' : ''}';
    return Semantics(
      label: '$count unread',
      excludeSemantics: true,
      child: Container(
        constraints: const BoxConstraints(minWidth: 20),
        height: 20,
        padding: const EdgeInsets.symmetric(horizontal: 6),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: AppColors.peach,
          borderRadius: BorderRadius.circular(AppRadius.pill),
          border: Border.all(color: AppColors.surface, width: 2),
        ),
        child: Text(text, style: AppType.caption(AppColors.peachInk).copyWith(fontWeight: FontWeight.w600, height: 1)),
      ),
    );
  }
}
