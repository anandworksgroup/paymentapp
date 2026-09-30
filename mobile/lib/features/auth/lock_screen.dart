import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../app.dart';
import '../../core/api/api.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/security/app_lock.dart';
import '../../theme/kit.dart';

/// Shown after the inactivity timeout or when returning to the app with the lock enabled.
class LockScreen extends StatefulWidget {
  const LockScreen({super.key});

  @override
  State<LockScreen> createState() => _LockScreenState();
}

class _LockScreenState extends State<LockScreen> {
  final _password = TextEditingController();
  bool _busy = false;
  Object? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final lock = context.read<AppLock>();
      if (lock.enabled && lock.biometricsAvailable) lock.unlockWithBiometrics();
    });
  }

  @override
  void dispose() {
    _password.dispose();
    super.dispose();
  }

  /// Password unlock re-verifies against the current session (POST /v1/auth/step-up).
  Future<void> _unlock() async {
    if (_password.text.isEmpty) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await context.read<Api>().post('/v1/auth/step-up', body: {'password': _password.text});
      if (mounted) context.read<AppLock>().unlock();
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
                    child: Column(children: [
                      if (lock.enabled && lock.biometricsAvailable) ...[
                        PrimaryButton('Unlock with biometrics', icon: Icons.fingerprint_rounded, onPressed: lock.unlockWithBiometrics),
                        const SizedBox(height: 14),
                        Text('or use your password', style: AppType.label()),
                        const SizedBox(height: 10),
                      ],
                      TextField(
                        controller: _password,
                        obscureText: true,
                        onSubmitted: (_) => _unlock(),
                        decoration: const InputDecoration(labelText: 'Password'),
                      ),
                      InlineError(_error),
                      const SizedBox(height: 14),
                      SecondaryButton(_busy ? 'Checking…' : 'Unlock', onPressed: _busy ? null : _unlock, icon: Icons.lock_open_rounded),
                    ]),
                  ),
                  const SizedBox(height: 12),
                  TextButton(onPressed: () => auth.logout(), child: Text('Sign out', style: AppType.small(AppColors.muted))),
                ]),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
