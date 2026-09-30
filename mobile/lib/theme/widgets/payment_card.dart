import 'dart:ui';

import 'package:flutter/material.dart';

import '../colors.dart';
import '../typography.dart';
import 'amount_text.dart';
import 'flag_avatar.dart';

enum PaymentCardStyle { yellow, dark, glass }

/// A wallet balance rendered as a payment card: yellow, dark, or frosted sage glass with masked digits.
class PaymentCard extends StatelessWidget {
  const PaymentCard({
    super.key,
    required this.style,
    required this.currency,
    required this.available,
    required this.maskedDigits,
    this.caption = 'Available',
    this.footer,
    this.country,
  });

  final PaymentCardStyle style;
  final String currency;
  final int available;
  final String maskedDigits;
  final String caption;
  final Widget? footer;
  final String? country;

  static const double height = 196;

  @override
  Widget build(BuildContext context) {
    final dark = style == PaymentCardStyle.dark;
    final fg = dark ? AppColors.surface : AppColors.text;
    final sub = dark ? const Color(0xB3FFFFFF) : AppColors.text2;
    final radius = BorderRadius.circular(AppRadius.card);
    final content = Padding(
      padding: const EdgeInsets.fromLTRB(22, 20, 22, 18),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          FlagAvatar(country, size: 30),
          const SizedBox(width: 10),
          Text(currency, style: AppType.bodyMedium(fg)),
          const Spacer(),
          Icon(Icons.contactless_outlined, color: sub, size: 22),
        ]),
        const Spacer(),
        Text(caption, style: AppType.label(sub)),
        const SizedBox(height: 4),
        AmountText(available, currency, size: AmountSize.large, color: fg),
        const SizedBox(height: 10),
        Row(children: [
          Text(maskedDigits, style: AppType.small(sub).copyWith(letterSpacing: 2, fontFeatures: const [FontFeature.tabularFigures()])),
          const Spacer(),
          if (footer != null) footer!,
        ]),
      ]),
    );

    final decoration = switch (style) {
      PaymentCardStyle.yellow => BoxDecoration(
          borderRadius: radius,
          gradient: const LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [AppColors.lemon, AppColors.lemonSoft]),
          boxShadow: AppShadows.card,
        ),
      PaymentCardStyle.dark => BoxDecoration(
          borderRadius: radius,
          gradient: const LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [AppColors.ink, Color(0xFF3C3E41)]),
          boxShadow: AppShadows.card,
        ),
      PaymentCardStyle.glass => BoxDecoration(
          borderRadius: radius,
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [AppColors.sage300.withValues(alpha: 0.55), AppColors.sage100.withValues(alpha: 0.72)],
          ),
          border: Border.all(color: AppColors.surface.withValues(alpha: 0.6)),
          boxShadow: AppShadows.card,
        ),
    };

    Widget card = Container(height: height, decoration: decoration, child: content);
    if (style == PaymentCardStyle.glass) {
      card = ClipRRect(
        borderRadius: radius,
        child: BackdropFilter(filter: ImageFilter.blur(sigmaX: 14, sigmaY: 14), child: card),
      );
    }
    return card;
  }
}

/// Cards stacked like a wallet: the selected card sits in front, the others peek out above it.
class PaymentCardStack extends StatelessWidget {
  const PaymentCardStack({super.key, required this.cards, required this.selected, required this.onSelect, this.peek = 58});

  final List<Widget> cards;
  final int selected;
  final ValueChanged<int> onSelect;
  final double peek;

  @override
  Widget build(BuildContext context) {
    if (cards.isEmpty) return const SizedBox.shrink();
    final order = [for (var i = 0; i < cards.length; i++) if (i != selected) i, selected];
    final backCount = cards.length - 1;
    return SizedBox(
      height: PaymentCard.height + peek * backCount,
      child: Stack(children: [
        for (var pos = 0; pos < order.length; pos++)
          AnimatedPositioned(
            key: ValueKey(order[pos]),
            duration: const Duration(milliseconds: 320),
            curve: Curves.easeOutCubic,
            top: pos * peek,
            left: pos == order.length - 1 ? 0 : 10.0 * (order.length - 1 - pos),
            right: pos == order.length - 1 ? 0 : 10.0 * (order.length - 1 - pos),
            child: GestureDetector(
              onTap: () => onSelect(order[pos]),
              child: Semantics(button: true, selected: order[pos] == selected, child: cards[order[pos]]),
            ),
          ),
      ]),
    );
  }
}
