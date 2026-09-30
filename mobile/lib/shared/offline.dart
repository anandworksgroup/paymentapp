import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/offline/online_status.dart';
import '../theme/kit.dart';

/// True when write actions are allowed (the API is reachable). Use to disable buttons (URS §212).
bool canWrite(BuildContext context) => context.watch<OnlineStatus>().isOnline;

class OfflineBanner extends StatelessWidget {
  const OfflineBanner({super.key});

  @override
  Widget build(BuildContext context) {
    final online = context.watch<OnlineStatus>();
    if (online.isOnline) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
      child: Material(
        color: AppColors.lemonSoft,
        borderRadius: BorderRadius.circular(AppRadius.inner),
        child: InkWell(
          borderRadius: BorderRadius.circular(AppRadius.inner),
          onTap: online.checkNow,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            child: Row(children: [
              const Icon(Icons.cloud_off_rounded, size: 18, color: AppColors.lemonInk),
              const SizedBox(width: 10),
              Expanded(
                child: Text("You're offline. Showing saved data; payments and changes are paused.", style: AppType.small(AppColors.lemonInk)),
              ),
              Text('Retry', style: AppType.small(AppColors.lemonInk).copyWith(fontWeight: FontWeight.w600)),
            ]),
          ),
        ),
      ),
    );
  }
}

class CachedDataNotice extends StatelessWidget {
  const CachedDataNotice({super.key});

  @override
  Widget build(BuildContext context) =>
      const NoticePanel('Showing the last saved copy. Pull to refresh when you are back online.', icon: Icons.history_rounded);
}

void showToast(BuildContext context, String message) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(message)));
}
