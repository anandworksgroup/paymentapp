import 'package:flutter/material.dart';

import '../colors.dart';
import '../typography.dart';
import 'amount_text.dart';
import 'barcode_sparkline.dart';
import 'buttons.dart';
import 'chip.dart';
import 'flag_avatar.dart';

/// Misty sage canvas with the faint sage (top-left) and lemon (right) washes.
class CanvasBackground extends StatelessWidget {
  const CanvasBackground({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(color: AppColors.bg),
      child: Stack(children: [
        const Positioned.fill(
          child: DecoratedBox(
            decoration: BoxDecoration(
              gradient: RadialGradient(center: Alignment(-1.1, -1.0), radius: 1.1, colors: [AppColors.washSage, Color(0x00DCEBD4)]),
            ),
          ),
        ),
        const Positioned.fill(
          child: DecoratedBox(
            decoration: BoxDecoration(
              gradient: RadialGradient(center: Alignment(1.2, -0.2), radius: 0.9, colors: [AppColors.washLemon, Color(0x00F6F2D6)]),
            ),
          ),
        ),
        child,
      ]),
    );
  }
}

/// Standard page: canvas, header (back button, large regular title, actions), scrolling content,
/// pull-to-refresh and room for the floating bottom nav.
class AppPage extends StatelessWidget {
  const AppPage({
    super.key,
    required this.title,
    required this.children,
    this.subtitle,
    this.actions = const [],
    this.onRefresh,
    this.leading,
    this.bottomInset = 110,
    this.banner,
    this.footer,
    this.controller,
  });

  final String title;
  final String? subtitle;
  final List<Widget> children;
  final List<Widget> actions;
  final Future<void> Function()? onRefresh;
  final Widget? leading;
  final double bottomInset;
  final Widget? banner;

  /// Pinned bottom area (e.g. a primary action) outside the scroll view.
  final Widget? footer;
  final ScrollController? controller;

  @override
  Widget build(BuildContext context) {
    final canPop = Navigator.of(context).canPop();
    final header = Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 14),
      child: Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
        if (leading != null) ...[leading!, const SizedBox(width: 12)] else if (canPop) ...[
          CircleIconButton(Icons.arrow_back_rounded, tooltip: 'Back', onPressed: () => Navigator.of(context).maybePop()),
          const SizedBox(width: 12),
        ],
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
            if (subtitle != null) Text(subtitle!, style: AppType.label(), maxLines: 1, overflow: TextOverflow.ellipsis),
            Text(title, style: AppType.h1(), maxLines: 1, overflow: TextOverflow.ellipsis),
          ]),
        ),
        for (final a in actions) ...[const SizedBox(width: 8), a],
      ]),
    );
    Widget list = ListView(
      controller: controller,
      physics: const AlwaysScrollableScrollPhysics(),
      padding: EdgeInsets.fromLTRB(16, 0, 16, footer == null ? bottomInset : 24),
      children: children,
    );
    if (onRefresh != null) list = RefreshIndicator(onRefresh: onRefresh!, color: AppColors.ink, child: list);
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: CanvasBackground(
        child: SafeArea(
          bottom: false,
          child: Column(children: [
            header,
            if (banner != null) banner!,
            Expanded(child: list),
            if (footer != null) SafeArea(top: false, minimum: const EdgeInsets.fromLTRB(16, 8, 16, 16), child: footer!),
          ]),
        ),
      ),
    );
  }
}

class SectionHeader extends StatelessWidget {
  const SectionHeader(this.title, {super.key, this.action, this.onAction, this.padding = const EdgeInsets.fromLTRB(4, 22, 4, 10)});

  final String title;
  final String? action;
  final VoidCallback? onAction;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: padding,
      child: Row(children: [
        Expanded(child: Text(title, style: AppType.h3())),
        if (action != null)
          InkWell(
            onTap: onAction,
            borderRadius: BorderRadius.circular(AppRadius.pill),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              child: Text(action!, style: AppType.small(AppColors.sage700).copyWith(fontWeight: FontWeight.w500)),
            ),
          ),
      ]),
    );
  }
}

/// Label/value line used in detail cards and breakdowns.
class KeyValueRow extends StatelessWidget {
  const KeyValueRow(this.label, {super.key, this.value, this.child, this.emphasize = false, this.selectable = false});

  final String label;
  final String? value;
  final Widget? child;
  final bool emphasize;
  final bool selectable;

  @override
  Widget build(BuildContext context) {
    final style = emphasize ? AppType.bodyMedium() : AppType.body(AppColors.text2);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
        Expanded(flex: 5, child: Text(label, style: AppType.small(AppColors.muted))),
        const SizedBox(width: 12),
        Flexible(
          flex: 7,
          child: Align(
            alignment: Alignment.centerRight,
            child: child ??
                (selectable
                    ? SelectableText(value ?? '—', style: style, textAlign: TextAlign.right)
                    : Text(value ?? '—', style: style, textAlign: TextAlign.right, maxLines: 2, overflow: TextOverflow.ellipsis)),
          ),
        ),
      ]),
    );
  }
}

/// Reference-style transaction row: small grey label, large amount + code, barcode sparkline and flag avatars.
class TransactionRow extends StatelessWidget {
  const TransactionRow({
    super.key,
    required this.label,
    required this.amount,
    required this.currency,
    this.meta,
    this.status,
    this.sparkline = const [],
    this.countries = const [],
    this.onTap,
    this.signed = false,
    this.muted = false,
  });

  final String label;
  final int amount;
  final String currency;
  final String? meta;
  final String? status;
  final List<double> sparkline;
  final List<String?> countries;
  final VoidCallback? onTap;
  final bool signed;
  final bool muted;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppRadius.inner),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 4),
        child: Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(label, style: AppType.label(), maxLines: 1, overflow: TextOverflow.ellipsis),
              const SizedBox(height: 4),
              AmountText(amount, currency, size: AmountSize.medium, signed: signed, color: muted ? AppColors.muted : null),
              if (meta != null || status != null) ...[
                const SizedBox(height: 6),
                Row(children: [
                  if (status != null) ...[StatusPill(status), const SizedBox(width: 8)],
                  if (meta != null) Flexible(child: Text(meta!, style: AppType.caption(), maxLines: 1, overflow: TextOverflow.ellipsis)),
                ]),
              ],
            ]),
          ),
          const SizedBox(width: 10),
          Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
            if (sparkline.isNotEmpty) BarcodeSparkline(values: sparkline),
            if (countries.isNotEmpty) ...[const SizedBox(height: 8), FlagStack(countries, size: 26)],
          ]),
        ]),
      ),
    );
  }
}

/// Simple navigation row inside a card.
class NavRow extends StatelessWidget {
  const NavRow({super.key, required this.icon, required this.title, this.subtitle, this.onTap, this.trailing, this.tone = Tone.sage});

  final IconData icon;
  final String title;
  final String? subtitle;
  final VoidCallback? onTap;
  final Widget? trailing;
  final Tone tone;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppRadius.inner),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 4),
        child: Row(children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(color: tone.background, shape: BoxShape.circle),
            child: Icon(icon, size: 19, color: tone.foreground),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(title, style: AppType.bodyMedium()),
              if (subtitle != null) ...[
                const SizedBox(height: 2),
                Text(subtitle!, style: AppType.label(), maxLines: 2, overflow: TextOverflow.ellipsis),
              ],
            ]),
          ),
          trailing ?? (onTap != null ? const Icon(Icons.chevron_right_rounded, color: AppColors.faint) : const SizedBox.shrink()),
        ]),
      ),
    );
  }
}

class Hairline extends StatelessWidget {
  const Hairline({super.key, this.indent = 0});

  final double indent;

  @override
  Widget build(BuildContext context) => Padding(padding: EdgeInsets.only(left: indent), child: const Divider(height: 1));
}
