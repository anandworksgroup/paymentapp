import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../app.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/config.dart';
import '../../shared/offline.dart';
import '../../theme/kit.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _code = TextEditingController();
  bool _busy = false;
  bool _obscure = true;
  Object? _error;

  static bool get _sandbox =>
      kDebugMode || AppConfig.apiUrl.contains('localhost') || AppConfig.apiUrl.contains('10.0.2.2') || AppConfig.apiUrl.contains('127.0.0.1');

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _code.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final auth = context.read<AuthController>();
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (auth.status == AuthStatus.mfaRequired) {
        await auth.verifyMfa(_code.text);
      } else {
        if (_email.text.trim().isEmpty || _password.text.isEmpty) throw 'Enter your email and password.';
        await auth.login(_email.text, _password.text);
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _fillDemo(String email) {
    setState(() {
      _email.text = email;
      // Sandbox demo password (dev only; the seeded accounts share it).
      _password.text = 'DemoPass!2026';
    });
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthController>();
    final mfa = auth.status == AuthStatus.mfaRequired;
    return Scaffold(
      body: CanvasBackground(
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 460),
                child: AutofillGroup(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    const SizedBox(height: 12),
                    const BrandMark(size: 52),
                    const SizedBox(height: 22),
                    Text(mfa ? 'Two-step verification' : 'Welcome back', style: AppType.h1()),
                    const SizedBox(height: 6),
                    Text(
                      mfa ? 'Enter the 6-digit code from your authenticator app.' : 'Sign in to your business dashboard or Global Wallet.',
                      style: AppType.body(AppColors.muted),
                    ),
                    const SizedBox(height: 22),
                    if (auth.sessionMessage != null) ...[
                      NoticePanel(auth.sessionMessage!, icon: Icons.lock_clock_outlined),
                      const SizedBox(height: 14),
                    ],
                    const OfflineBanner(),
                    AppCard(
                      child: Column(children: [
                        if (!mfa) ...[
                          TextField(
                            key: const Key('login-email'),
                            controller: _email,
                            keyboardType: TextInputType.emailAddress,
                            autofillHints: const [AutofillHints.email, AutofillHints.username],
                            textInputAction: TextInputAction.next,
                            decoration: const InputDecoration(labelText: 'Email'),
                          ),
                          const SizedBox(height: 12),
                          TextField(
                            key: const Key('login-password'),
                            controller: _password,
                            obscureText: _obscure,
                            autofillHints: const [AutofillHints.password],
                            onSubmitted: (_) => _submit(),
                            decoration: InputDecoration(
                              labelText: 'Password',
                              suffixIcon: IconButton(
                                tooltip: _obscure ? 'Show password' : 'Hide password',
                                icon: Icon(_obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined, color: AppColors.muted),
                                onPressed: () => setState(() => _obscure = !_obscure),
                              ),
                            ),
                          ),
                        ] else
                          TextField(
                            controller: _code,
                            autofocus: true,
                            keyboardType: TextInputType.number,
                            autofillHints: const [AutofillHints.oneTimeCode],
                            onSubmitted: (_) => _submit(),
                            decoration: const InputDecoration(labelText: 'Authentication code'),
                          ),
                        InlineError(_error),
                        const SizedBox(height: 18),
                        PrimaryButton(mfa ? 'Verify' : 'Sign in', key: const Key('login-submit'), loading: _busy, onPressed: _submit),
                        if (mfa)
                          TextButton(onPressed: () => auth.logout(), child: Text('Use a different account', style: AppType.small(AppColors.muted))),
                      ]),
                    ),
                    if (_sandbox && !mfa) ...[
                      const SizedBox(height: 18),
                      Text('Sandbox demo accounts', style: AppType.label()),
                      const SizedBox(height: 8),
                      Wrap(spacing: 8, runSpacing: 8, children: [
                        AppChip('owner@acme.test', icon: Icons.storefront_outlined, onTap: () => _fillDemo('owner@acme.test')),
                        AppChip('alice@wallet.test', tone: Tone.sage, icon: Icons.account_balance_wallet_outlined, onTap: () => _fillDemo('alice@wallet.test')),
                        AppChip('bob@wallet.test', tone: Tone.sage, icon: Icons.account_balance_wallet_outlined, onTap: () => _fillDemo('bob@wallet.test')),
                      ]),
                      const SizedBox(height: 8),
                      Text('Test mode only. No real money moves.', style: AppType.caption()),
                    ],
                  ]),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
