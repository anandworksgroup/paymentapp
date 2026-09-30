import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../colors.dart';
import '../typography.dart';

/// Circular country-flag avatar. Flags are drawn locally (simplified) so nothing is fetched at runtime;
/// unknown countries fall back to a sage disc with the country code.
class FlagAvatar extends StatelessWidget {
  const FlagAvatar(this.country, {super.key, this.size = 34});

  final String? country;
  final double size;

  @override
  Widget build(BuildContext context) {
    final code = (country ?? '').toUpperCase();
    final known = FlagPainter.supports(code);
    return Semantics(
      label: code.isEmpty ? 'Unknown country' : 'Flag $code',
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          border: Border.all(color: AppColors.surface, width: 2),
          boxShadow: const [BoxShadow(color: Color(0x14000000), blurRadius: 4, offset: Offset(0, 1))],
        ),
        child: ClipOval(
          child: known
              ? CustomPaint(painter: FlagPainter(code))
              : Container(
                  color: AppColors.sage100,
                  alignment: Alignment.center,
                  child: Text(code.isEmpty ? '?' : code, style: AppType.caption(AppColors.sage700).copyWith(fontSize: size * 0.3)),
                ),
        ),
      ),
    );
  }
}

/// Overlapping flag avatars on a hairline, as in the reference transaction rows.
class FlagStack extends StatelessWidget {
  const FlagStack(this.countries, {super.key, this.size = 30});

  final List<String?> countries;
  final double size;

  @override
  Widget build(BuildContext context) {
    final list = countries.where((c) => c != null && c.isNotEmpty).toSet().toList();
    if (list.isEmpty) return SizedBox(width: size, height: size);
    final overlap = size * 0.62;
    return SizedBox(
      width: size + overlap * (list.length - 1),
      height: size,
      child: Stack(children: [
        Positioned(
          left: size / 2,
          right: size / 2,
          top: size / 2,
          child: Container(height: 1, color: AppColors.line),
        ),
        for (var i = 0; i < list.length; i++) Positioned(left: i * overlap, child: FlagAvatar(list[i], size: size)),
      ]),
    );
  }
}

class FlagPainter extends CustomPainter {
  FlagPainter(this.code);

  final String code;

  // Flag imagery colours (content, not UI chrome).
  static const _red = Color(0xFFD33A2C);
  static const _blue = Color(0xFF203E8C);
  static const _white = Color(0xFFFFFFFF);
  static const _green = Color(0xFF1E8B4E);
  static const _saffron = Color(0xFFF29A3A);
  static const _gold = Color(0xFFF4C430);
  static const _black = Color(0xFF1D1F1E);
  static const _euBlue = Color(0xFF1F3F99);

  static const _supported = {'US', 'GB', 'IN', 'DE', 'FR', 'EU', 'SG', 'JP', 'CA', 'AU', 'BR', 'AE', 'IT', 'ES', 'NL', 'IE', 'BH'};

  static bool supports(String code) => _supported.contains(code);

  @override
  void paint(Canvas canvas, Size s) {
    final w = s.width, h = s.height;
    final p = Paint();
    void rect(double l, double t, double rw, double rh, Color c) => canvas.drawRect(Rect.fromLTWH(l, t, rw, rh), p..color = c);
    void hStripes(List<Color> cs) {
      for (var i = 0; i < cs.length; i++) {
        rect(0, h * i / cs.length, w, h / cs.length + 0.5, cs[i]);
      }
    }

    void vStripes(List<Color> cs) {
      for (var i = 0; i < cs.length; i++) {
        rect(w * i / cs.length, 0, w / cs.length + 0.5, h, cs[i]);
      }
    }

    switch (code) {
      case 'US':
        for (var i = 0; i < 7; i++) {
          rect(0, h * i / 7, w, h / 7 + 0.5, i.isEven ? _red : _white);
        }
        rect(0, 0, w * 0.5, h * 4 / 7, _blue);
        for (var r = 0; r < 3; r++) {
          for (var c = 0; c < 3; c++) {
            canvas.drawCircle(Offset(w * (0.09 + c * 0.16), h * (0.1 + r * 0.17)), w * 0.028, p..color = _white);
          }
        }
      case 'GB':
        rect(0, 0, w, h, _blue);
        final diag = Paint()
          ..color = _white
          ..strokeWidth = h * 0.2;
        canvas.drawLine(Offset.zero, Offset(w, h), diag);
        canvas.drawLine(Offset(w, 0), Offset(0, h), diag);
        diag
          ..color = _red
          ..strokeWidth = h * 0.07;
        canvas.drawLine(Offset.zero, Offset(w, h), diag);
        canvas.drawLine(Offset(w, 0), Offset(0, h), diag);
        rect(w * 0.4, 0, w * 0.2, h, _white);
        rect(0, h * 0.4, w, h * 0.2, _white);
        rect(w * 0.44, 0, w * 0.12, h, _red);
        rect(0, h * 0.44, w, h * 0.12, _red);
      case 'IN':
        hStripes([_saffron, _white, _green]);
        canvas.drawCircle(
          Offset(w / 2, h / 2),
          h * 0.12,
          Paint()
            ..color = _blue
            ..style = PaintingStyle.stroke
            ..strokeWidth = 1.2,
        );
      case 'DE':
        hStripes([_black, _red, _gold]);
      case 'FR':
        vStripes([_blue, _white, _red]);
      case 'IT':
        vStripes([_green, _white, _red]);
      case 'IE':
        vStripes([_green, _white, _saffron]);
      case 'NL':
        hStripes([_red, _white, _blue]);
      case 'ES':
        rect(0, 0, w, h, _red);
        rect(0, h * 0.25, w, h * 0.5, _gold);
      case 'EU':
        rect(0, 0, w, h, _euBlue);
        for (var i = 0; i < 12; i++) {
          final a = i * math.pi / 6;
          canvas.drawCircle(Offset(w / 2 + math.cos(a) * w * 0.28, h / 2 + math.sin(a) * h * 0.28), w * 0.035, p..color = _gold);
        }
      case 'SG':
        hStripes([_red, _white]);
        canvas.drawCircle(Offset(w * 0.3, h * 0.25), h * 0.13, p..color = _white);
        canvas.drawCircle(Offset(w * 0.35, h * 0.25), h * 0.12, p..color = _red);
      case 'JP':
        rect(0, 0, w, h, _white);
        canvas.drawCircle(Offset(w / 2, h / 2), h * 0.24, p..color = _red);
      case 'CA':
        vStripes([_red, _white, _white, _red]);
        final leaf = Path()
          ..moveTo(w / 2, h * 0.24)
          ..lineTo(w * 0.62, h * 0.52)
          ..lineTo(w * 0.54, h * 0.52)
          ..lineTo(w * 0.54, h * 0.72)
          ..lineTo(w * 0.46, h * 0.72)
          ..lineTo(w * 0.46, h * 0.52)
          ..lineTo(w * 0.38, h * 0.52)
          ..close();
        canvas.drawPath(leaf, p..color = _red);
      case 'AU':
        rect(0, 0, w, h, _blue);
        rect(0, h * 0.2, w * 0.5, h * 0.08, _white);
        rect(w * 0.21, 0, w * 0.08, h * 0.48, _white);
        rect(0, h * 0.215, w * 0.5, h * 0.05, _red);
        rect(w * 0.225, 0, w * 0.05, h * 0.48, _red);
        for (final o in [const Offset(0.72, 0.3), const Offset(0.62, 0.55), const Offset(0.8, 0.62), const Offset(0.72, 0.82), const Offset(0.28, 0.75)]) {
          canvas.drawCircle(Offset(w * o.dx, h * o.dy), w * 0.04, p..color = _white);
        }
      case 'BR':
        rect(0, 0, w, h, _green);
        final d = Path()
          ..moveTo(w / 2, h * 0.14)
          ..lineTo(w * 0.9, h / 2)
          ..lineTo(w / 2, h * 0.86)
          ..lineTo(w * 0.1, h / 2)
          ..close();
        canvas.drawPath(d, p..color = _gold);
        canvas.drawCircle(Offset(w / 2, h / 2), h * 0.18, p..color = _blue);
      case 'AE':
        hStripes([_green, _white, _black]);
        rect(0, 0, w * 0.28, h, _red);
      case 'BH':
        rect(0, 0, w, h, _red);
        rect(0, 0, w * 0.3, h, _white);
    }
  }

  @override
  bool shouldRepaint(covariant FlagPainter old) => old.code != code;
}
