import 'dart:async';

import 'package:flutter/widgets.dart';

import '../storage/secure_store.dart';
import 'biometrics.dart';

/// Optional biometric app lock plus an inactivity session timeout (URS §211).
/// When locked, the user unlocks with biometrics (if enabled) or their password.
class AppLock extends ChangeNotifier with WidgetsBindingObserver {
  AppLock({required this.store, required this.biometrics, required this.timeout, this.backgroundGrace = const Duration(seconds: 30)});

  final SecureStore store;
  final Biometrics biometrics;
  final Duration timeout;
  final Duration backgroundGrace;

  bool enabled = false;
  bool biometricsAvailable = false;
  bool _locked = false;
  bool _active = false;
  DateTime _lastActivity = DateTime.now();
  DateTime? _pausedAt;
  Timer? _timer;

  bool get locked => _locked;

  Future<void> init() async {
    enabled = await store.read(StoreKeys.lockEnabled) == 'true';
    biometricsAvailable = await biometrics.available();
    WidgetsBinding.instance.addObserver(this);
  }

  /// Called when a session becomes active (sign-in or cold start with a stored token).
  void start({required bool coldStart}) {
    _active = true;
    _lastActivity = DateTime.now();
    if (coldStart && enabled) _locked = true;
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 15), (_) => _check());
    notifyListeners();
  }

  void stop() {
    _active = false;
    _locked = false;
    _timer?.cancel();
    notifyListeners();
  }

  void touch() => _lastActivity = DateTime.now();

  void _check() {
    if (_active && !_locked && DateTime.now().difference(_lastActivity) >= timeout) lock();
  }

  void lock() {
    if (!_active || _locked) return;
    _locked = true;
    notifyListeners();
  }

  void unlock() {
    _locked = false;
    _lastActivity = DateTime.now();
    notifyListeners();
  }

  Future<bool> unlockWithBiometrics() async {
    if (!enabled || !biometricsAvailable) return false;
    final ok = await biometrics.authenticate('Unlock the app');
    if (ok) unlock();
    return ok;
  }

  Future<void> setEnabled(bool v) async {
    enabled = v;
    await store.write(StoreKeys.lockEnabled, v ? 'true' : 'false');
    notifyListeners();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused || state == AppLifecycleState.hidden) {
      _pausedAt ??= DateTime.now();
    } else if (state == AppLifecycleState.resumed) {
      final away = _pausedAt == null ? Duration.zero : DateTime.now().difference(_pausedAt!);
      _pausedAt = null;
      if ((enabled && away >= backgroundGrace) || DateTime.now().difference(_lastActivity) >= timeout) lock();
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }
}
