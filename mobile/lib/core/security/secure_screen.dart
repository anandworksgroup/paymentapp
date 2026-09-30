import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

/// Screenshot protection for sensitive screens (URS §212). On Android this sets FLAG_SECURE through a
/// small method channel implemented in MainActivity. Other platforms: no-op.
/// TODO(ios): blur the app switcher snapshot via a native overlay; iOS has no FLAG_SECURE equivalent.
class SecureScreen extends StatefulWidget {
  const SecureScreen({super.key, required this.child});

  final Widget child;

  static const channel = MethodChannel('paymentapp/secure_screen');
  static int _depth = 0;

  static Future<void> _apply(bool secure) async {
    if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) return;
    try {
      await channel.invokeMethod('setSecure', secure);
    } catch (_) {}
  }

  @override
  State<SecureScreen> createState() => _SecureScreenState();
}

class _SecureScreenState extends State<SecureScreen> {
  @override
  void initState() {
    super.initState();
    if (SecureScreen._depth++ == 0) SecureScreen._apply(true);
  }

  @override
  void dispose() {
    if (--SecureScreen._depth == 0) SecureScreen._apply(false);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
