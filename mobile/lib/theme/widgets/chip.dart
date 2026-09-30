import 'package:flutter/material.dart';

import '../colors.dart';
import '../typography.dart';

/// Pastel pill chip ("+1.6%", "Custom ▾"). Lemon by default; ink when [selected].
class AppChip extends StatelessWidget {
  const AppChip(
    this.label, {
    super.key,
    this.tone = Tone.lemon,
    this.selected = false,
    this.onTap,
    this.icon,
    this.dropdown = false,
    this.dense = false,
  });

  final String label;
  final Tone tone;
  final bool selected;
  final VoidCallback? onTap;
  final IconData? icon;
  final bool dropdown;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final t = selected ? Tone.ink : tone;
    final fg = t.foreground;
    final pad = dense ? const EdgeInsets.symmetric(horizontal: 10, vertical: 5) : const EdgeInsets.symmetric(horizontal: 14, vertical: 8);
    return Semantics(
      button: onTap != null,
      selected: selected,
      child: Material(
        color: t.background,
        shape: const StadiumBorder(),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: pad,
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              if (icon != null) ...[Icon(icon, size: dense ? 13 : 15, color: fg), const SizedBox(width: 5)],
              Flexible(
                child: Text(
                  label,
                  style: (dense ? AppType.caption(fg) : AppType.small(fg)).copyWith(fontWeight: FontWeight.w500),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              if (dropdown) ...[const SizedBox(width: 3), Icon(Icons.keyboard_arrow_down_rounded, size: dense ? 14 : 17, color: fg)],
            ]),
          ),
        ),
      ),
    );
  }
}

/// Maps API status strings to a calm tone. Risk states stay neutral in wording.
Tone toneForStatus(String? status) {
  switch ((status ?? '').toUpperCase()) {
    case 'SUCCEEDED':
    case 'COMPLETED':
    case 'ACTIVE':
    case 'PAID':
    case 'WON':
    case 'VERIFIED':
    case 'APPROVED':
    case 'DELIVERED':
    case 'ENABLED':
      return Tone.sage;
    case 'PROCESSING':
    case 'PENDING':
    case 'TRIALING':
    case 'UNDER_REVIEW':
    case 'SCREENING':
    case 'CREATED':
    case 'REQUESTED':
    case 'IN_TRANSIT':
    case 'OPEN':
    case 'DRAFT':
      return Tone.lemon;
    case 'HELD':
    case 'ON_HOLD':
    case 'NEEDS_RESPONSE':
    case 'PAST_DUE':
    case 'PAUSED':
    case 'REVIEW':
    case 'REQUIRES_ACTION':
    case 'PARTIALLY_REFUNDED':
    case 'VERIFICATION_REQUIRED':
      return Tone.peach;
    case 'FAILED':
    case 'CANCELLED':
    case 'RETURNED':
    case 'LOST':
    case 'DISPUTED':
    case 'CHARGEBACK':
    case 'EXPIRED':
    case 'INCOMPLETE':
      return Tone.rose;
    default:
      return Tone.neutral;
  }
}

class StatusPill extends StatelessWidget {
  const StatusPill(this.status, {super.key, this.label});

  final String? status;
  final String? label;

  @override
  Widget build(BuildContext context) {
    final raw = (status ?? '').replaceAll('_', ' ').toLowerCase();
    final text = label ?? (raw.isEmpty ? '—' : raw[0].toUpperCase() + raw.substring(1));
    final tone = toneForStatus(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(color: tone.background, borderRadius: BorderRadius.circular(AppRadius.pill)),
      child: Text(text, style: AppType.caption(tone.foreground)),
    );
  }
}
