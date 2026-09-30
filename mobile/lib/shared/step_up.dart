import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/api/api.dart';
import '../core/auth/auth_controller.dart';
import '../core/security/app_lock.dart';
import '../core/security/biometrics.dart';
import '../theme/kit.dart';

/// Runs a high-risk action. If the API answers `step_up_required`, asks for the password (optionally
/// gated by biometrics first), calls `POST /v1/auth/step-up`, then retries with the same
/// Idempotency-Key. Returns null when the user cancels.
Future<T?> withStepUp<T>(BuildContext context, Future<T> Function(String idempotencyKey) action) async {
  final key = newUuid();
  try {
    return await action(key);
  } on ApiException catch (e) {
    if (!e.isStepUp || !context.mounted) rethrow;
    final ok = await confirmStepUp(context);
    if (!ok) return null;
    return await action(key);
  }
}

Future<bool> confirmStepUp(BuildContext context) async {
  final lock = context.read<AppLock>();
  if (lock.enabled && lock.biometricsAvailable) {
    final ok = await context.read<Biometrics>().authenticate('Confirm it is you');
    if (!ok) return false;
  }
  if (!context.mounted) return false;
  final result = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    builder: (_) => const StepUpSheet(),
  );
  return result ?? false;
}

class StepUpSheet extends StatefulWidget {
  const StepUpSheet({super.key});

  @override
  State<StepUpSheet> createState() => _StepUpSheetState();
}

class _StepUpSheetState extends State<StepUpSheet> {
  final _password = TextEditingController();
  final _code = TextEditingController();
  bool _busy = false;
  Object? _error;

  @override
  void dispose() {
    _password.dispose();
    _code.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_password.text.isEmpty) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final mfa = context.read<AuthController>().mfaEnabled;
      await context.read<Api>().post('/v1/auth/step-up', body: {
        'password': _password.text,
        if (mfa && _code.text.isNotEmpty) 'code': _code.text.trim(),
      });
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e;
          _busy = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final mfa = context.watch<AuthController>().mfaEnabled;
    return Padding(
      padding: EdgeInsets.fromLTRB(22, 0, 22, 22 + MediaQuery.viewInsetsOf(context).bottom),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('Confirm it’s you', style: AppType.h2()),
        const SizedBox(height: 6),
        Text('This action needs recent re-authentication. Enter your password to continue.', style: AppType.small(AppColors.muted)),
        const SizedBox(height: 18),
        TextField(
          controller: _password,
          obscureText: true,
          autofocus: true,
          autofillHints: const [AutofillHints.password],
          decoration: const InputDecoration(labelText: 'Password'),
          onSubmitted: (_) => _submit(),
        ),
        if (mfa) ...[
          const SizedBox(height: 12),
          TextField(controller: _code, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Authentication code')),
        ],
        InlineError(_error),
        const SizedBox(height: 18),
        PrimaryButton('Confirm', loading: _busy, onPressed: _submit, icon: Icons.lock_open_rounded),
        const SizedBox(height: 8),
        Center(child: TextButton(onPressed: () => Navigator.of(context).pop(false), child: Text('Cancel', style: AppType.small(AppColors.muted)))),
      ]),
    );
  }
}
