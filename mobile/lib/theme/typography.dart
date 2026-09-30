import 'package:flutter/material.dart';

import 'colors.dart';

/// Inter everywhere. Headings are regular weight, large and tight (-0.03em), never bold.
abstract final class AppType {
  static const family = 'Inter';

  static TextStyle _s(double size, FontWeight w, Color c, {double tracking = 0, double? height}) => TextStyle(
        fontFamily: family,
        fontSize: size,
        fontWeight: w,
        color: c,
        letterSpacing: tracking * size,
        height: height,
      );

  /// Hero money numerals: large and light.
  static TextStyle display([Color c = AppColors.text]) => _s(44, FontWeight.w300, c, tracking: -0.03, height: 1.05);
  static TextStyle h1([Color c = AppColors.text]) => _s(30, FontWeight.w400, c, tracking: -0.03, height: 1.1);
  static TextStyle h2([Color c = AppColors.text]) => _s(22, FontWeight.w400, c, tracking: -0.03, height: 1.15);
  static TextStyle h3([Color c = AppColors.text]) => _s(17, FontWeight.w500, c, tracking: -0.02, height: 1.2);
  static TextStyle body([Color c = AppColors.text]) => _s(15, FontWeight.w400, c, height: 1.35);
  static TextStyle bodyMedium([Color c = AppColors.text]) => _s(15, FontWeight.w500, c, height: 1.35);
  static TextStyle small([Color c = AppColors.text2]) => _s(13, FontWeight.w400, c, height: 1.3);

  /// Small grey labels ("Travel Costs", "Your available balance").
  static TextStyle label([Color c = AppColors.muted]) => _s(12.5, FontWeight.w400, c, height: 1.25);
  static TextStyle caption([Color c = AppColors.muted]) => _s(11, FontWeight.w500, c, tracking: 0.02, height: 1.2);
  static TextStyle button([Color c = AppColors.surface]) => _s(15, FontWeight.w500, c);
}
