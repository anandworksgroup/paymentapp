import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'core/api/api.dart';
import 'core/auth/auth_controller.dart';
import 'core/cache/cache_store.dart';
import 'core/offline/online_status.dart';
import 'core/security/app_lock.dart';
import 'core/security/biometrics.dart';
import 'features/auth/lock_screen.dart';
import 'features/auth/login_screen.dart';
import 'features/business/business_shell.dart';
import 'features/wallet/wallet_shell.dart';
import 'theme/kit.dart';
import 'theme/theme.dart';

class AppServices {
  AppServices({required this.api, required this.auth, required this.online, required this.cache, required this.lock, required this.biometrics});

  final Api api;
  final AuthController auth;
  final OnlineStatus online;
  final CacheStore cache;
  final AppLock lock;
  final Biometrics biometrics;
}

class PaymentApp extends StatefulWidget {
  const PaymentApp({super.key, required this.services});

  final AppServices services;

  @override
  State<PaymentApp> createState() => _PaymentAppState();
}

class _PaymentAppState extends State<PaymentApp> {
  AuthStatus? _last;
  AppMode? _lastMode;
  final _navigator = GlobalKey<NavigatorState>();

  @override
  void initState() {
    super.initState();
    widget.services.auth.addListener(_onAuth);
  }

  @override
  void dispose() {
    widget.services.auth.removeListener(_onAuth);
    super.dispose();
  }

  /// Starts the inactivity lock when a session begins and stops it on sign-out.
  void _onAuth() {
    final auth = widget.services.auth;
    final s = auth.status;
    // Mode switches and sign-out replace the root screen; drop any pushed detail screens too.
    if (s == AuthStatus.signedIn && _lastMode != null && _lastMode != auth.mode) {
      _navigator.currentState?.popUntil((r) => r.isFirst);
    }
    _lastMode = auth.mode;
    if (s == _last) return;
    if (s == AuthStatus.signedIn) {
      widget.services.lock.start(coldStart: _last == AuthStatus.loading);
    } else if (s == AuthStatus.signedOut) {
      widget.services.lock.stop();
      _navigator.currentState?.popUntil((r) => r.isFirst);
    }
    _last = s;
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.services;
    return MultiProvider(
      providers: [
        Provider<Api>.value(value: s.api),
        Provider<CacheStore>.value(value: s.cache),
        Provider<Biometrics>.value(value: s.biometrics),
        ChangeNotifierProvider<OnlineStatus>.value(value: s.online),
        ChangeNotifierProvider<AuthController>.value(value: s.auth),
        ChangeNotifierProvider<AppLock>.value(value: s.lock),
      ],
      child: Listener(
        behavior: HitTestBehavior.translucent,
        onPointerDown: (_) => s.lock.touch(),
        child: MaterialApp(
          title: 'Payments',
          navigatorKey: _navigator,
          debugShowCheckedModeBanner: false,
          theme: buildAppTheme(),
          home: const RootGate(),
          // The lock sits above the navigator so pushed detail screens are covered too.
          builder: (context, child) => _LockLayer(child: child ?? const SizedBox.shrink()),
        ),
      ),
    );
  }
}

/// Chooses sign-in, Business mode or Wallet mode, with the lock screen on top when locked.
class RootGate extends StatelessWidget {
  const RootGate({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthController>();
    switch (auth.status) {
      case AuthStatus.loading:
        return const _Splash();
      case AuthStatus.signedOut:
      case AuthStatus.mfaRequired:
        return const LoginScreen();
      case AuthStatus.signedIn:
        return auth.mode == AppMode.business ? BusinessShell(key: ValueKey('biz-${auth.orgId}')) : const WalletShell(key: ValueKey('wallet'));
    }
  }
}

class _LockLayer extends StatelessWidget {
  const _LockLayer({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final locked = context.watch<AppLock>().locked && context.watch<AuthController>().status == AuthStatus.signedIn;
    return Stack(children: [
      child,
      if (locked)
        Positioned.fill(
          child: Overlay(initialEntries: [OverlayEntry(builder: (_) => const LockScreen())]),
        ),
    ]);
  }
}

class _Splash extends StatelessWidget {
  const _Splash();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: CanvasBackground(
        child: Center(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const BrandMark(size: 64),
            const SizedBox(height: 18),
            Text('Payments', style: AppType.h2()),
          ]),
        ),
      ),
    );
  }
}

class BrandMark extends StatelessWidget {
  const BrandMark({super.key, this.size = 48});

  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: const LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [AppColors.sage300, AppColors.lemon]),
        boxShadow: AppShadows.card,
      ),
      child: Icon(Icons.blur_on_rounded, color: AppColors.ink, size: size * 0.5),
    );
  }
}
