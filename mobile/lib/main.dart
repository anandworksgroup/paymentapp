import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'app.dart';
import 'core/api/http_api.dart';
import 'core/auth/auth_controller.dart';
import 'core/cache/cache_store.dart';
import 'core/config.dart';
import 'core/offline/online_status.dart';
import 'core/security/app_lock.dart';
import 'core/security/biometrics.dart';
import 'core/storage/secure_store.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(SystemUiOverlayStyle.dark.copyWith(statusBarColor: Colors.transparent));

  final store = DeviceSecureStore();
  final cache = PrefsCacheStore();
  final online = OnlineStatus();
  final context = ApiContext();
  final api = HttpApi(baseUrl: AppConfig.apiUrl, context: context, online: online);
  online.probe = api.health;
  final auth = AuthController(api: api, context: context, store: store, cache: cache);
  api.onSessionExpired = (e) => auth.sessionExpired(e.message);
  final biometrics = Biometrics();
  final lock = AppLock(store: store, biometrics: biometrics, timeout: const Duration(minutes: AppConfig.sessionTimeoutMinutes));
  await lock.init();

  runApp(PaymentApp(
    services: AppServices(api: api, auth: auth, online: online, cache: cache, lock: lock, biometrics: biometrics),
  ));
  await auth.bootstrap();
}
