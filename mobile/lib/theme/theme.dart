import 'package:flutter/material.dart';

import 'colors.dart';
import 'typography.dart';

ThemeData buildAppTheme() {
  const scheme = ColorScheme(
    brightness: Brightness.light,
    primary: AppColors.ink,
    onPrimary: AppColors.surface,
    secondary: AppColors.sage500,
    onSecondary: AppColors.surface,
    tertiary: AppColors.lemon,
    onTertiary: AppColors.lemonInk,
    error: AppColors.roseInk,
    onError: AppColors.surface,
    surface: AppColors.surface,
    onSurface: AppColors.text,
    surfaceContainerHighest: AppColors.surface3,
    outline: AppColors.line,
  );
  final base = ThemeData(useMaterial3: true, colorScheme: scheme, fontFamily: AppType.family);
  final fieldBorder = OutlineInputBorder(
    borderRadius: BorderRadius.circular(AppRadius.field),
    borderSide: BorderSide.none,
  );
  return base.copyWith(
    scaffoldBackgroundColor: AppColors.bg,
    // Dropdown menus and other canvas-typed Material surfaces are white cards.
    canvasColor: AppColors.surface,
    splashFactory: InkSparkle.splashFactory,
    textTheme: base.textTheme.apply(fontFamily: AppType.family, bodyColor: AppColors.text, displayColor: AppColors.text),
    dividerTheme: const DividerThemeData(color: AppColors.line, thickness: 1, space: 1),
    appBarTheme: AppBarTheme(
      backgroundColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      foregroundColor: AppColors.text,
      titleTextStyle: AppType.h3(),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: AppColors.surface2,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
      border: fieldBorder,
      enabledBorder: fieldBorder,
      focusedBorder: fieldBorder.copyWith(borderSide: const BorderSide(color: AppColors.sage500, width: 1.4)),
      errorBorder: fieldBorder.copyWith(borderSide: const BorderSide(color: AppColors.roseInk, width: 1)),
      focusedErrorBorder: fieldBorder.copyWith(borderSide: const BorderSide(color: AppColors.roseInk, width: 1.4)),
      labelStyle: AppType.label(),
      floatingLabelStyle: AppType.label(AppColors.text2),
      hintStyle: AppType.body(AppColors.faint),
      helperStyle: AppType.label(),
      errorStyle: AppType.label(AppColors.roseInk),
    ),
    bottomSheetTheme: const BottomSheetThemeData(
      backgroundColor: AppColors.surface,
      showDragHandle: true,
      dragHandleColor: AppColors.faint,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.card))),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: AppColors.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.card)),
      titleTextStyle: AppType.h2(),
      contentTextStyle: AppType.body(AppColors.text2),
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: AppColors.ink,
      contentTextStyle: AppType.body(AppColors.surface),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.field)),
    ),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? AppColors.surface : AppColors.faint),
      trackColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? AppColors.sage500 : AppColors.surface3),
      trackOutlineColor: WidgetStateProperty.all(Colors.transparent),
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(color: AppColors.ink, linearTrackColor: AppColors.surface3),
    textSelectionTheme: const TextSelectionThemeData(cursorColor: AppColors.ink, selectionColor: AppColors.sage100, selectionHandleColor: AppColors.sage700),
    popupMenuTheme: PopupMenuThemeData(
      color: AppColors.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.inner)),
      textStyle: AppType.body(),
    ),
  );
}
