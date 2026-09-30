import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../colors.dart';

/// Mini "barcode" sparkline: thin grey bars with the last bar in charcoal.
class BarcodeSparkline extends StatelessWidget {
  const BarcodeSparkline({super.key, required this.values, this.width = 58, this.height = 24});

  final List<double> values;
  final double width;
  final double height;

  @override
  Widget build(BuildContext context) {
    return ExcludeSemantics(
      child: CustomPaint(size: Size(width, height), painter: BarcodeSparklinePainter(values)),
    );
  }
}

class BarcodeSparklinePainter extends CustomPainter {
  BarcodeSparklinePainter(this.values);

  final List<double> values;

  @override
  void paint(Canvas canvas, Size size) {
    if (values.isEmpty) return;
    const maxBars = 16;
    final vals = values.length > maxBars ? values.sublist(values.length - maxBars) : values;
    final maxV = vals.fold<double>(0, (a, b) => math.max(a, b.abs()));
    final gap = 2.2;
    final barW = 1.6;
    final total = vals.length * barW + (vals.length - 1) * gap;
    var x = size.width - total;
    for (var i = 0; i < vals.length; i++) {
      final t = maxV == 0 ? 0.3 : (vals[i].abs() / maxV);
      final h = math.max(3.0, size.height * (0.25 + 0.75 * t));
      final last = i == vals.length - 1;
      final paint = Paint()
        ..color = last ? AppColors.ink : AppColors.faint
        ..strokeCap = StrokeCap.round
        ..strokeWidth = last ? 2.2 : barW;
      canvas.drawLine(Offset(x + barW / 2, size.height), Offset(x + barW / 2, size.height - h), paint);
      x += barW + gap;
    }
  }

  @override
  bool shouldRepaint(covariant BarcodeSparklinePainter old) => old.values != values;
}
