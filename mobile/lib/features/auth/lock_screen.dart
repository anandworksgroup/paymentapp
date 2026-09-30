import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../app.dart';
import '../../core/api/api.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/security/app_lock.dart';
import '../../theme/kit.dart';

/// Shown after the inactivity timeout or when returning to the app with the lock enabled.
///
/// Biometrics (when enabled and available) are offered first. The password path is always verified by
/// the API (`POST /v1/auth/verify_password`, which does not grant step-up privileges) — never checked
/// locally. Wrong passwords count towards [AppLock.maxPasswordAttempts]; reaching it, or the server's own
/// `too_many_attempts` answer, signs the user out.
class LockScreen extends StatefulWidget {
  const LockScreen({super.key});

  @override
  State<LockScreen> createState() => _LockScreenState();
}

class _LockScreenState extends State<LockScreen> {
  final _password = TextEditingController();
  bool _busy = false;
  bool _biometricFailed = false;
  Object? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final lock = context.read<AppLock>();
      if (lock.enabled && lock.biometricsAvailable) _biometrics();
    });
  }

  @override
  void dispose() {
    _password.dispose();
    super.dispose();
  }

  Future<void> _biometrics() async {
    final ok = await context.read<AppLock>().unlockWithBiometrics();
    if (!ok && mounted) setState(() => _biometricFailed = true);
  }

  Future<void> _signOut([String? message]) async {
    final auth = context.read<AuthController>();
    await context.read<AppLock>().resetFailures();
    await auth.logout(message: message);
  }

  Future<void> _unlock() async {
    final password = _password.text;
    if (password.isEmpty || _busy) return;
    final lock = context.read<AppLock>();
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final res = await context.read<Api>().post('/v1/auth/verify_password', body: {'password': password});
      if (!mounted) return;
      if (res is Map && res['verified'] == true) {
        _password.clear();
        lock.unlock();
      } else {
        setState(() => _error = 'We could not verify your password. Try again.');
      }
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.code == 'too_many_attempts') {
        await _signOut('Too many incorrect password attempts. Sign in again to continue.');
        return;
      }
      if (e.code == 'invalid_credentials') {
        _password.clear();
        final left = await lock.recordFailedPassword();
        if (!mounted) return;
        if (left <= 0) {
          await _signOut('Too many incorrect password attempts. Sign in again to continue.');
          return;
        }
        setState(() => _error = 'Password is incorrect. $left ${left == 1 ? 'attempt' : 'attempts'} left before you are signed out.');
      } else {
        // Network and server errors do not count as wrong passwords.
        setState(() => _error = e);
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final lock = context.watch<AppLock>();
    final auth = context.watch<AuthController>();
    final bio = lock.enabled && lock.biometricsAvailable;
    final used = lock.failedPasswordAttempts;
    return Material(
      child: CanvasBackground(
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 420),
                child: Column(children: [
                  const BrandMark(size: 60),
                  const SizedBox(height: 18),
                  Text('Locked', style: AppType.h1()),
                  const SizedBox(height: 6),
                  Text('Signed in as ${auth.userEmail}', style: AppType.small(AppColors.muted)),
                  const SizedBox(height: 22),
                  AppCard(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                      if (bio) ...[
                        PrimaryButton('Unlock with biometrics', key: const Key('unlock-biometrics'), icon: Icons.fingerprint_rounded, onPressed: _busy ? null : _biometrics),
                        if (_biometricFailed) ...[
                          const SizedBox(height: 10),
                          Text('Biometrics didn’t work. Use your password instead.', style: AppType.small(AppColors.muted), textAlign: TextAlign.center),
                        ],
                        const SizedBox(height: 14),
                        Text('or use your password', style: AppType.label(), textAlign: TextAlign.center),
                        const SizedBox(height: 10),
                      ] else ...[
                        Text('Enter your password to continue.', style: AppType.small(AppColors.muted)),
                        const SizedBox(height: 12),
                      ],
                      TextField(
                        key: const Key('unlock-password'),
                        controller: _password,
                        obscureText: true,
                        enabled: !_busy,
                        autofillHints: const [AutofillHints.password],
                        onSubmitted: (_) => _unlock(),
                        decoration: const InputDecoration(labelText: 'Password'),
                      ),
                      if (used > 0 && _error == null) ...[
                        const SizedBox(height: 10),
                        Align(
                          child: AppChip(
                            '${lock.attemptsLeft} of ${AppLock.maxPasswordAttempts} attempts left',
                            key: const Key('unlock-attempts'),
                            tone: Tone.peach,
                            icon: Icons.warning_amber_rounded,
                            dense: true,
                          ),
                        ),
                      ],
                      InlineError(_error),
                      const SizedBox(height: 14),
                      bio
                          ? SecondaryButton(_busy ? 'Checking…' : 'Unlock', key: const Key('unlock-submit'), onPressed: _busy ? null : _unlock, icon: Icons.lock_open_rounded)
                          : PrimaryButton('Unlock', key: const Key('unlock-submit'), loading: _busy, onPressed: _unlock, icon: Icons.lock_open_rounded),
                    ]),
                  ),
                  const SizedBox(height: 12),
                  TextButton(onPressed: _busy ? null : () => _signOut(), child: Text('Sign out', style: AppType.small(AppColors.muted))),
                ]),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
