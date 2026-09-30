import 'package:flutter/material.dart';

import '../../core/format/money.dart';
import '../colors.dart';
import '../typography.dart';

enum AmountSize { hero, large, medium, small }

/// Large light numeral with a small grey currency code after it: "€8,499.00 EUR".
/// The fraction is rendered smaller so the whole units read like the reference ("€8,499").
class AmountText extends StatelessWidget {
  const AmountText(
    this.amount,
    this.currency, {
    super.key,
    this.size = AmountSize.large,
    this.showCode = true,
    this.signed = false,
    this.color,
    this.strike = false,
  });

  /// Integer minor units.
  final int amount;
  final String currency;
  final AmountSize size;
  final bool showCode;

  /// Prefix "+" for positive amounts (incoming money).
  final bool signed;
  final Color? color;
  final bool strike;

  double get _fontSize => switch (size) {
        AmountSize.hero => 44,
        AmountSize.large => 32,
        AmountSize.medium => 22,
        AmountSize.small => 16,
      };

  /// Plain-text rendering used for semantics and tests.
  String get plain => Money.format(amount, currency, withCode: showCode, signed: signed);

  @override
  Widget build(BuildContext context) {
    final p = Money.parts(amount, currency);
    final fs = _fontSize;
    final c = color ?? AppColors.text;
    final weight = size == AmountSize.small ? FontWeight.w400 : FontWeight.w300;
    final main = TextStyle(
      fontFamily: AppType.family,
      fontSize: fs,
      fontWeight: weight,
      color: c,
      letterSpacing: -0.03 * fs,
      height: 1.1,
      decoration: strike ? TextDecoration.lineThrough : null,
      fontFeatures: const [FontFeature.tabularFigures()],
    );
    final frac = main.copyWith(fontSize: fs * (size == AmountSize.small ? 1 : 0.55), letterSpacing: -0.01 * fs);
    final code = TextStyle(
      fontFamily: AppType.family,
      fontSize: (fs * 0.34).clamp(11, 15).toDouble(),
      fontWeight: FontWeight.w400,
      color: AppColors.muted,
      letterSpacing: 0.2,
    );
    final sign = p.negative ? '−' : (signed && amount > 0 ? '+' : '');
    return Semantics(
      label: plain,
      excludeSemantics: true,
      // Money is never ellipsized: long values scale down to fit instead.
      child: FittedBox(
        fit: BoxFit.scaleDown,
        alignment: AlignmentDirectional.centerStart,
        child: Text.rich(
          TextSpan(children: [
            TextSpan(text: '$sign${p.symbol}${p.whole}', style: main),
            if (p.fraction.isNotEmpty) TextSpan(text: '.${p.fraction}', style: frac),
            if (showCode) TextSpan(text: '  ${p.code}', style: code),
          ]),
          maxLines: 1,
          softWrap: false,
        ),
      ),
    );
  }
}
