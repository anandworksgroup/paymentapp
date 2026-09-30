import 'dart:async';

import 'package:flutter/foundation.dart';

/// Tracks whether the API is reachable. Flips offline on network failures, probes `/health` while
/// offline, and flips back on the first successful response. Write actions are disabled while offline.
class OnlineStatus extends ChangeNotifier {
  OnlineStatus({this.probe, this.probeEvery = const Duration(seconds: 8)});

  /// Returns true when the server answers. Injected so tests and the HTTP layer stay decoupled.
  Future<bool> Function()? probe;
  final Duration probeEvery;

  bool _online = true;
  Timer? _timer;

  bool get isOnline => _online;

  void reportSuccess() => _set(true);

  void reportNetworkFailure() => _set(false);

  void _set(bool v) {
    if (_online == v) return;
    _online = v;
    _timer?.cancel();
    if (!v && probe != null) {
      _timer = Timer.periodic(probeEvery, (_) async {
        try {
          if (await probe!()) _set(true);
        } catch (_) {}
      });
    }
    notifyListeners();
  }

  /// Manual retry from the offline banner.
  Future<void> checkNow() async {
    if (probe == null) return;
    try {
      _set(await probe!());
    } catch (_) {
      _set(false);
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }
}
