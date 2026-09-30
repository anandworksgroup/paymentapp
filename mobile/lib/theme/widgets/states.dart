import 'package:flutter/material.dart';

import '../../core/api/api.dart';
import '../colors.dart';
import '../typography.dart';
import 'app_card.dart';
import 'buttons.dart';

class LoadingView extends StatelessWidget {
  const LoadingView({super.key, this.label = 'Loading…', this.compact = false});

  final String label;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.symmetric(vertical: compact ? 20 : 64),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        const SizedBox(width: 26, height: 26, child: CircularProgressIndicator(strokeWidth: 2.2)),
        const SizedBox(height: 14),
        Text(label, style: AppType.label()),
      ]),
    );
  }
}

class EmptyView extends StatelessWidget {
  const EmptyView({super.key, required this.title, this.message, this.icon = Icons.inbox_outlined, this.action, this.actionLabel});

  final String title;
  final String? message;
  final IconData icon;
  final VoidCallback? action;
  final String? actionLabel;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 36, horizontal: 12),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Container(
          width: 64,
          height: 64,
          decoration: const BoxDecoration(color: AppColors.sage100, shape: BoxShape.circle),
          child: Icon(icon, color: AppColors.sage700, size: 28),
        ),
        const SizedBox(height: 16),
        Text(title, style: AppType.h3(), textAlign: TextAlign.center),
        if (message != null) ...[
          const SizedBox(height: 6),
          Text(message!, style: AppType.small(AppColors.muted), textAlign: TextAlign.center),
        ],
        if (action != null) ...[
          const SizedBox(height: 18),
          SecondaryButton(actionLabel ?? 'Try again', onPressed: action, expand: false),
        ],
      ]),
    );
  }
}

class ErrorView extends StatelessWidget {
  const ErrorView({super.key, required this.error, this.onRetry});

  final Object error;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final api = error is ApiException ? error as ApiException : null;
    final offline = api?.isNetwork ?? false;
    return AppCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(color: offline ? AppColors.lemonSoft : AppColors.roseSoft, shape: BoxShape.circle),
            child: Icon(offline ? Icons.cloud_off_rounded : Icons.error_outline_rounded, color: offline ? AppColors.lemonInk : AppColors.roseInk, size: 20),
          ),
          const SizedBox(width: 12),
          Expanded(child: Text(offline ? "You're offline" : 'Something went wrong', style: AppType.h3())),
        ]),
        const SizedBox(height: 10),
        Text(api?.message ?? 'Unexpected error. Please try again.', style: AppType.small()),
        if (api?.requestId != null) ...[
          const SizedBox(height: 6),
          SelectableText('Request ${api!.requestId}', style: AppType.caption(AppColors.faint)),
        ],
        if (onRetry != null) ...[
          const SizedBox(height: 14),
          SecondaryButton('Try again', onPressed: onRetry, expand: false, dense: true, icon: Icons.refresh_rounded),
        ],
      ]),
    );
  }
}

/// Inline error text for forms.
class InlineError extends StatelessWidget {
  const InlineError(this.error, {super.key});

  final Object? error;

  @override
  Widget build(BuildContext context) {
    if (error == null) return const SizedBox.shrink();
    final msg = error is ApiException ? (error as ApiException).message : error.toString();
    return Container(
      margin: const EdgeInsets.only(top: 12),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(color: AppColors.roseSoft, borderRadius: BorderRadius.circular(AppRadius.field)),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Icon(Icons.info_outline_rounded, size: 17, color: AppColors.roseInk),
        const SizedBox(width: 8),
        Expanded(child: Text(msg, style: AppType.small(AppColors.roseInk))),
      ]),
    );
  }
}

/// Neutral notice panel (sandbox labels, review messages, info).
class NoticePanel extends StatelessWidget {
  const NoticePanel(this.text, {super.key, this.tone = Tone.lemon, this.icon = Icons.info_outline_rounded, this.title});

  final String text;
  final String? title;
  final Tone tone;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: tone.background, borderRadius: BorderRadius.circular(AppRadius.inner)),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(icon, size: 18, color: tone.foreground),
        const SizedBox(width: 10),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            if (title != null) ...[Text(title!, style: AppType.bodyMedium(tone.foreground)), const SizedBox(height: 2)],
            Text(text, style: AppType.small(tone.foreground)),
          ]),
        ),
      ]),
    );
  }
}
