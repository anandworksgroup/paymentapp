import 'package:flutter/foundation.dart';

/// Build-time configuration. Override with `--dart-define=API_URL=...`.
abstract final class AppConfig {
  static const _apiUrl = String.fromEnvironment('API_URL');
  static const _checkoutUrl = String.fromEnvironment('CHECKOUT_URL');

  /// Minutes of inactivity before the app locks (URS §211).
  static const sessionTimeoutMinutes = int.fromEnvironment('SESSION_TIMEOUT_MIN', defaultValue: 5);

  /// ASP.NET Core API. The Android emulator reaches the host's localhost through 10.0.2.2.
  static String get apiUrl {
    if (_apiUrl.isNotEmpty) return _apiUrl;
    if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) return 'http://10.0.2.2:5080';
    return 'http://localhost:5080';
  }

  /// Hosted checkout (web app) used to build shareable payment-link URLs.
  static String get checkoutUrl {
    if (_checkoutUrl.isNotEmpty) return _checkoutUrl;
    if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) return 'http://10.0.2.2:3000';
    return 'http://localhost:3000';
  }
}
