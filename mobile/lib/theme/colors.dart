import 'package:flutter/widgets.dart';

/// Design tokens from docs/DESIGN.md. Reuse these; do not introduce new colours.
abstract final class AppColors {
  // Canvas and surfaces
  static const bg = Color(0xFFEEF1EC);
  static const washSage = Color(0xFFDCEBD4);
  static const washLemon = Color(0xFFF6F2D6);
  static const surface = Color(0xFFFFFFFF);
  static const surface2 = Color(0xFFF6F7F4);
  static const surface3 = Color(0xFFEEF0EC);
  static const line = Color(0xFFE6E9E4);

  // Copy hierarchy
  static const text = Color(0xFF1D1F1E);
  static const text2 = Color(0xFF4B504C);
  static const muted = Color(0xFF8B918C);
  static const faint = Color(0xFFB9BEB9);

  // Sage (success, bars, focus)
  static const sage100 = Color(0xFFDFEFD8);
  static const sage300 = Color(0xFFA9D59E);
  static const sage500 = Color(0xFF7DBB78);
  static const sage700 = Color(0xFF4E8F55);

  // Accents
  static const lemon = Color(0xFFF2E35A);
  static const lemonSoft = Color(0xFFF8F1B8);
  static const lemonInk = Color(0xFF5F5410);
  static const peach = Color(0xFFF6C79A);
  static const peachSoft = Color(0xFFFBE6D2);
  static const peachInk = Color(0xFF8A4A1C);
  static const roseSoft = Color(0xFFFBE1DA);
  static const roseInk = Color(0xFF8E2F1C);

  /// Primary buttons, active nav pill, chart line.
  static const ink = Color(0xFF2D2E30);
}

abstract final class AppRadius {
  static const double card = 28;
  static const double inner = 20;
  static const double field = 14;
  static const double pill = 999;
}

abstract final class AppShadows {
  /// `0 1px 2px rgba(20,30,20,.04), 0 12px 32px rgba(30,40,30,.06)`
  static const card = [
    BoxShadow(color: Color(0x0A141E14), offset: Offset(0, 1), blurRadius: 2),
    BoxShadow(color: Color(0x0F1E281E), offset: Offset(0, 12), blurRadius: 32),
  ];
}

/// Semantic tone used by chips and status pills.
enum Tone { neutral, sage, lemon, peach, rose, ink }

extension ToneColors on Tone {
  Color get background => switch (this) {
        Tone.neutral => AppColors.surface3,
        Tone.sage => AppColors.sage100,
        Tone.lemon => AppColors.lemonSoft,
        Tone.peach => AppColors.peachSoft,
        Tone.rose => AppColors.roseSoft,
        Tone.ink => AppColors.ink,
      };

  Color get foreground => switch (this) {
        Tone.neutral => AppColors.text2,
        Tone.sage => AppColors.sage700,
        Tone.lemon => AppColors.lemonInk,
        Tone.peach => AppColors.peachInk,
        Tone.rose => AppColors.roseInk,
        Tone.ink => AppColors.surface,
      };
}
