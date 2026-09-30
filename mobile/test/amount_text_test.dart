import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:paymentapp_mobile/core/format/money.dart';
import 'package:paymentapp_mobile/theme/theme.dart';
import 'package:paymentapp_mobile/theme/widgets/amount_text.dart';

String _richText(WidgetTester tester, Finder f) {
  final rich = tester.widget<RichText>(find.descendant(of: f, matching: find.byType(RichText)));
  return rich.text.toPlainText();
}

void main() {
  group('Money.format', () {
    test('formats minor units with symbol, grouping and exponent', () {
      expect(Money.format(849900, 'EUR'), '€8,499.00');
      expect(Money.format(849900, 'EUR', withCode: true), '€8,499.00 EUR');
      expect(Money.format(524000, 'USD', withCode: true), r'$5,240.00 USD');
      expect(Money.format(5, 'USD'), r'$0.05');
      expect(Money.format(0, 'GBP'), '£0.00');
      expect(Money.format(123456789, 'INR'), '₹1,234,567.89');
    });

    test('respects zero and three-decimal currencies', () {
      expect(Money.format(1500, 'JPY', withCode: true), '¥1,500 JPY');
      expect(Money.format(1234, 'BHD'), 'BD 1.234');
    });

    test('negative and signed values', () {
      expect(Money.format(-2450, 'USD'), r'−$24.50');
      expect(Money.format(2450, 'USD', signed: true), r'+$24.50');
      expect(Money.format(0, 'USD', signed: true), r'$0.00');
    });

    test('parseInput converts user text to minor units without floating point', () {
      expect(Money.parseInput('1,234.5', 'USD'), 123450);
      expect(Money.parseInput('0.07', 'USD'), 7);
      expect(Money.parseInput('.5', 'EUR'), 50);
      expect(Money.parseInput('1500', 'JPY'), 1500);
      expect(Money.parseInput('1.5', 'JPY'), isNull, reason: 'JPY has no minor unit');
      expect(Money.parseInput('1.001', 'USD'), isNull);
      expect(Money.parseInput('abc', 'USD'), isNull);
      expect(Money.parseInput('', 'USD'), isNull);
      expect(Money.parseInput('0.123', 'BHD'), 123);
      // 0.1 + 0.2 style inputs stay exact.
      expect(Money.parseInput('0.30', 'USD'), 30);
    });

    test('rates and bps are display-only helpers', () {
      expect(formatBps(50), '0.50%');
      expect(formatBps(1234), '12.34%');
      expect(formatRate(0.011916167), '0.011916');
      expect(formatRate(83.25), '83.2500');
    });
  });

  group('AmountText', () {
    Future<void> pump(WidgetTester tester, Widget w) =>
        tester.pumpWidget(MaterialApp(theme: buildAppTheme(), home: Scaffold(body: Center(child: w))));

    testWidgets('renders large numeral, smaller fraction and grey currency code', (tester) async {
      await pump(tester, const AmountText(849900, 'EUR', key: Key('a'), size: AmountSize.hero));
      final f = find.byKey(const Key('a'));
      expect(_richText(tester, f), '€8,499.00  EUR');
      expect(tester.widget<AmountText>(f).plain, '€8,499.00 EUR');

      final rich = tester.widget<RichText>(find.descendant(of: f, matching: find.byType(RichText)));
      // Text.rich wraps our span in the ambient DefaultTextStyle span; unwrap to the three parts.
      var root = rich.text as TextSpan;
      while (root.children != null && root.children!.length == 1) {
        root = root.children!.single as TextSpan;
      }
      final spans = root.children!.cast<TextSpan>();
      expect(spans[0].text, '€8,499');
      expect(spans[1].text, '.00');
      expect(spans[2].text!.trim(), 'EUR');
      expect(spans[1].style!.fontSize, lessThan(spans[0].style!.fontSize!));
      expect(spans[2].style!.fontSize, lessThan(spans[1].style!.fontSize!));
      expect(spans[0].style!.fontWeight, FontWeight.w300, reason: 'money numerals are light');
      expect(spans[2].style!.color, isNot(spans[0].style!.color), reason: 'currency code is grey');
    });

    testWidgets('hides the code and fraction when not applicable', (tester) async {
      await pump(tester, const AmountText(1500, 'JPY', key: Key('a'), showCode: false));
      expect(_richText(tester, find.byKey(const Key('a'))), '¥1,500');
    });

    testWidgets('signed incoming amounts get a plus; negatives a minus', (tester) async {
      await pump(tester, const Column(children: [
        AmountText(2000, 'USD', key: Key('in'), signed: true),
        AmountText(-2000, 'USD', key: Key('neg')),
      ]));
      expect(_richText(tester, find.byKey(const Key('in'))), r'+$20.00  USD');
      expect(_richText(tester, find.byKey(const Key('neg'))), r'−$20.00  USD');
    });

    testWidgets('exposes an accessible label', (tester) async {
      await pump(tester, const AmountText(524000, 'USD'));
      expect(find.bySemanticsLabel(r'$5,240.00 USD'), findsOneWidget);
    });
  });
}
