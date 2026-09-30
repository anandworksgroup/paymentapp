import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../colors.dart';
import '../typography.dart';

class PillBarDatum {
  const PillBarDatum({required this.label, required this.value, this.line, this.bubble});

  final String label;

  /// Bar height input (display only; any unit).
  final double value;

  /// Optional second series drawn as the smooth charcoal line. Defaults to [value].
  final double? line;

  /// Text shown in the white value bubble when this bar is highlighted.
  final String? bubble;
}

/// "Weekly Rate" chart: pill-shaped gradient bars in sage/lemon/peach, a smooth charcoal line across them
/// and a white value bubble on the highlighted bar. Tap or drag to move the highlight.
class PillBarChart extends StatelessWidget {
  const PillBarChart({super.key, required this.data, this.selectedIndex, this.onSelect, this.height = 210});

  final List<PillBarDatum> data;
  final int? selectedIndex;
  final ValueChanged<int>? onSelect;
  final double height;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(builder: (context, c) {
      final width = c.maxWidth.isFinite ? c.maxWidth : 320.0;
      void pick(Offset p) {
        if (onSelect == null || data.isEmpty) return;
        onSelect!(PillBarChartPainter.indexForDx(p.dx, width, data.length));
      }

      return Semantics(
        label: 'Bar chart with ${data.length} bars',
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTapDown: (d) => pick(d.localPosition),
          onHorizontalDragUpdate: (d) => pick(d.localPosition),
          child: CustomPaint(
            size: Size(width, height),
            painter: PillBarChartPainter(data: data, selectedIndex: selectedIndex, textDirection: Directionality.of(context)),
          ),
        ),
      );
    });
  }
}

class PillBarChartPainter extends CustomPainter {
  PillBarChartPainter({required this.data, this.selectedIndex, this.textDirection = TextDirection.ltr});

  final List<PillBarDatum> data;
  final int? selectedIndex;
  final TextDirection textDirection;

  static const double topPad = 46;
  static const List<Color> _cycle = [AppColors.sage500, AppColors.lemon, AppColors.sage300];

  static int indexForDx(double dx, double width, int count) {
    if (count <= 0 || width <= 0) return 0;
    final slot = width / count;
    return (dx / slot).floor().clamp(0, count - 1);
  }

  double _barWidth(double slot) => (slot * 0.62).clamp(4.0, 34.0);

  @override
  void paint(Canvas canvas, Size size) {
    if (data.isEmpty || size.width <= 0 || size.height <= topPad) return;
    final n = data.length;
    final slot = size.width / n;
    final barW = _barWidth(slot);
    final chartH = size.height - topPad;
    final minH = math.min(barW * 1.3, chartH * 0.25);
    final maxV = data.map((d) => d.value).fold<double>(0, math.max);
    final lineVals = data.map((d) => d.line ?? d.value).toList();
    final maxL = lineVals.fold<double>(0, math.max);
    final minL = lineVals.fold<double>(double.infinity, math.min);

    final tops = <double>[];
    final linePts = <Offset>[];
    for (var i = 0; i < n; i++) {
      final cx = slot * i + slot / 2;
      final v = data[i].value;
      final h = maxV <= 0 ? minH : minH + (chartH - minH) * (v / maxV);
      final top = size.height - h;
      tops.add(top);
      final rect = RRect.fromRectAndRadius(Rect.fromLTWH(cx - barW / 2, top, barW, h), Radius.circular(barW / 2));
      final selected = i == selectedIndex;
      final color = selected ? AppColors.peach : (v <= 0 ? AppColors.faint : _cycle[i % _cycle.length]);
      final paint = Paint()
        ..shader = LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [color.withValues(alpha: selected ? 1 : 0.85), color.withValues(alpha: 0.05)],
        ).createShader(rect.outerRect);
      canvas.drawRRect(rect, paint);

      // Line series normalised into the upper two thirds of the chart.
      final span = (maxL - minL).abs() < 1e-9 ? 1.0 : (maxL - minL);
      final t = (maxL - minL).abs() < 1e-9 ? 0.5 : (lineVals[i] - minL) / span;
      final ly = topPad + 10 + (1 - t) * (chartH * 0.62);
      linePts.add(Offset(cx, ly));
    }

    if (n > 1) {
      final path = Path()..moveTo(linePts.first.dx, linePts.first.dy);
      for (var i = 0; i < n - 1; i++) {
        final p0 = i == 0 ? linePts[i] : linePts[i - 1];
        final p1 = linePts[i];
        final p2 = linePts[i + 1];
        final p3 = i + 2 < n ? linePts[i + 2] : p2;
        final c1 = p1 + (p2 - p0) / 6;
        final c2 = p2 - (p3 - p1) / 6;
        path.cubicTo(c1.dx, c1.dy, c2.dx, c2.dy, p2.dx, p2.dy);
      }
      canvas.drawPath(
        path,
        Paint()
          ..color = AppColors.ink
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2
          ..strokeCap = StrokeCap.round,
      );
    }

    final sel = selectedIndex;
    if (sel != null && sel >= 0 && sel < n) {
      final p = linePts[sel];
      canvas.drawCircle(p, 5.5, Paint()..color = AppColors.surface);
      canvas.drawCircle(
        p,
        5.5,
        Paint()
          ..color = AppColors.ink
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2,
      );
      final label = data[sel].bubble;
      if (label != null && label.isNotEmpty) _bubble(canvas, size, label, Offset(p.dx, math.min(p.dy, tops[sel])));
    }
  }

  void _bubble(Canvas canvas, Size size, String text, Offset anchor) {
    final tp = TextPainter(
      text: TextSpan(text: text, style: AppType.small(AppColors.text).copyWith(fontWeight: FontWeight.w500)),
      textDirection: textDirection,
      maxLines: 1,
    )..layout(maxWidth: size.width);
    final w = tp.width + 22;
    const h = 30.0;
    final left = (anchor.dx - w / 2).clamp(0.0, math.max(0.0, size.width - w)).toDouble();
    final top = math.max(0.0, anchor.dy - h - 12);
    final rect = RRect.fromRectAndRadius(Rect.fromLTWH(left, top, w, h), const Radius.circular(h / 2));
    canvas.drawRRect(rect.shift(const Offset(0, 4)), Paint()
      ..color = const Color(0x1A1E281E)
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 8));
    canvas.drawRRect(rect, Paint()..color = AppColors.surface);
    final tip = Path()
      ..moveTo(anchor.dx - 5, top + h - 0.5)
      ..lineTo(anchor.dx, top + h + 5)
      ..lineTo(anchor.dx + 5, top + h - 0.5)
      ..close();
    canvas.drawPath(tip, Paint()..color = AppColors.surface);
    tp.paint(canvas, Offset(left + 11, top + (h - tp.height) / 2));
  }

  @override
  bool shouldRepaint(covariant PillBarChartPainter old) => old.data != data || old.selectedIndex != selectedIndex;
}
