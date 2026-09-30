import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:paymentapp_mobile/theme/theme.dart';
import 'package:paymentapp_mobile/theme/widgets/barcode_sparkline.dart';
import 'package:paymentapp_mobile/theme/widgets/pill_bar_chart.dart';

List<PillBarDatum> _data(int n, {double Function(int i)? v}) => [
      for (var i = 0; i < n; i++) PillBarDatum(label: 'd$i', value: v?.call(i) ?? (i * 37 % 11).toDouble(), line: (i % 4).toDouble(), bubble: '€${i * 10}'),
    ];

void _paint(CustomPainter p, Size size) {
  final recorder = ui.PictureRecorder();
  final canvas = Canvas(recorder);
  p.paint(canvas, size);
  recorder.endRecording().dispose();
}

void main() {
  group('PillBarChartPainter smoke', () {
    test('paints typical, empty, flat and dense data without throwing', () {
      const size = Size(340, 210);
      for (final data in [
        _data(7),
        <PillBarDatum>[],
        _data(1),
        _data(7, v: (_) => 0),
        _data(31),
        _data(5, v: (i) => i == 2 ? 1e9 : 1),
      ]) {
        for (final sel in [null, 0, data.length - 1, 99]) {
          expect(() => _paint(PillBarChartPainter(data: data, selectedIndex: sel), size), returnsNormally);
        }
      }
      // Degenerate canvas sizes.
      expect(() => _paint(PillBarChartPainter(data: _data(7), selectedIndex: 3), Size.zero), returnsNormally);
      expect(() => _paint(PillBarChartPainter(data: _data(7), selectedIndex: 3), const Size(20, 40)), returnsNormally);
    });

    test('shouldRepaint reacts to data and selection', () {
      final d = _data(7);
      final a = PillBarChartPainter(data: d, selectedIndex: 1);
      expect(a.shouldRepaint(PillBarChartPainter(data: d, selectedIndex: 1)), isFalse);
      expect(a.shouldRepaint(PillBarChartPainter(data: d, selectedIndex: 2)), isTrue);
      expect(a.shouldRepaint(PillBarChartPainter(data: _data(7), selectedIndex: 1)), isTrue);
    });

    test('indexForDx maps x positions to bars and clamps', () {
      expect(PillBarChartPainter.indexForDx(0, 350, 7), 0);
      expect(PillBarChartPainter.indexForDx(349, 350, 7), 6);
      expect(PillBarChartPainter.indexForDx(175, 350, 7), 3);
      expect(PillBarChartPainter.indexForDx(-10, 350, 7), 0);
      expect(PillBarChartPainter.indexForDx(900, 350, 7), 6);
      expect(PillBarChartPainter.indexForDx(10, 350, 0), 0);
    });

    test('barcode sparkline paints', () {
      expect(() => _paint(BarcodeSparklinePainter([1, 5, 3, 8]), const Size(58, 24)), returnsNormally);
      expect(() => _paint(BarcodeSparklinePainter([]), const Size(58, 24)), returnsNormally);
      expect(() => _paint(BarcodeSparklinePainter(List.generate(40, (i) => i.toDouble())), const Size(58, 24)), returnsNormally);
    });
  });

  testWidgets('PillBarChart widget selects the tapped bar', (tester) async {
    int? selected;
    await tester.pumpWidget(MaterialApp(
      theme: buildAppTheme(),
      home: Scaffold(
        body: Center(
          child: SizedBox(
            width: 350,
            child: StatefulBuilder(
              builder: (context, setState) => PillBarChart(
                key: const Key('chart'),
                data: _data(7),
                selectedIndex: selected,
                onSelect: (i) => setState(() => selected = i),
              ),
            ),
          ),
        ),
      ),
    ));
    final box = tester.getRect(find.byKey(const Key('chart')));
    await tester.tapAt(Offset(box.left + 350 * 5.5 / 7, box.center.dy));
    await tester.pump();
    expect(selected, 5);
    await tester.tapAt(Offset(box.left + 4, box.center.dy));
    await tester.pump();
    expect(selected, 0);
    expect(tester.takeException(), isNull);
  });
}
