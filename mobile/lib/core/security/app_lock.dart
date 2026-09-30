import 'dart:async';

import 'package:flutter/widgets.dart';

import '../storage/secure_store.dart';
import 'biometrics.dart';

/// Optional biometric app lock plus an inactivity session timeout (URS §211).
/// When locked, the user unlocks with biometrics (if enabled) or their password, which is verified by the
/// API. Wrong passwords are counted (persisted, so restarting the app does not reset them); after
/// [maxPasswordAttempts] the lock screen signs the user out.
class AppLock extends ChangeNotifier with WidgetsBindingObserver {
  AppLock({required this.store, required this.biometrics, required this.timeout, this.backgroundGrace = const Duration(seconds: 30)});

  final SecureStore store;
  final Biometrics biometrics;
  final Duration timeout;
  final Duration backgroundGrace;

  static const maxPasswordAttempts = 5;

  bool enabled = false;
  bool biometricsAvailable = false;
  int failedPasswordAttempts = 0;
  bool _locked = false;
  bool _active = false;
  DateTime _lastActivity = DateTime.now();
  DateTime? _pausedAt;
  Timer? _timer;

  bool get locked => _locked;

  int get attemptsLeft => (maxPasswordAttempts - failedPasswordAttempts).clamp(0, maxPasswordAttempts);

  Future<void> init() async {
    enabled = await store.read(StoreKeys.lockEnabled) == 'true';
    failedPasswordAttempts = int.tryParse(await store.read(StoreKeys.unlockFailures) ?? '') ?? 0;
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
    if (failedPasswordAttempts != 0) resetFailures();
    notifyListeners();
  }

  /// Records a password the API rejected. Returns the attempts left before sign-out.
  Future<int> recordFailedPassword() async {
    failedPasswordAttempts++;
    await store.write(StoreKeys.unlockFailures, '$failedPasswordAttempts');
    notifyListeners();
    return attemptsLeft;
  }

  Future<void> resetFailures() async {
    failedPasswordAttempts = 0;
    await store.write(StoreKeys.unlockFailures, null);
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
