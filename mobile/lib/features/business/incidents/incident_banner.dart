import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../core/api/api.dart';
import '../../../core/format/dates.dart';
import '../../../theme/kit.dart';

/// Platform incident banner fed by `GET /v1/incidents` (`data: [{incident, updates}]`). Only unresolved
/// incidents are shown; tapping one opens its update timeline. Failures stay silent: the banner is
/// informational and must never block the dashboard.
class IncidentBanner extends StatefulWidget {
  const IncidentBanner({super.key});

  @override
  State<IncidentBanner> createState() => IncidentBannerState();
}

class IncidentBannerState extends State<IncidentBanner> {
  List<Json> _active = [];

  @override
  void initState() {
    super.initState();
    reload();
  }

  static List<Json> unresolved(dynamic data) =>
      ApiList.from(data).data.where((e) => e.obj('incident') != null && e.obj('incident')!.s('status') != 'resolved').toList();

  Future<void> reload() async {
    try {
      final res = await context.read<Api>().get('/v1/incidents');
      if (mounted) setState(() => _active = unresolved(res));
    } catch (_) {
      // Keep whatever was shown last.
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_active.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(children: [
        for (final e in _active) ...[
          _IncidentCard(entry: e),
          if (e != _active.last) const SizedBox(height: 8),
        ],
      ]),
    );
  }
}

Tone _toneFor(String severity) => switch (severity) {
      'critical' => Tone.rose,
      'major' => Tone.peach,
      _ => Tone.lemon,
    };

List<String> _affected(Json incident) =>
    incident.s('affected_services_csv').split(',').map((s) => s.trim()).where((s) => s.isNotEmpty).toList();

class _IncidentCard extends StatelessWidget {
  const _IncidentCard({required this.entry});

  final Json entry;

  @override
  Widget build(BuildContext context) {
    final i = entry.obj('incident')!;
    final updates = entry.list('updates');
    final latest = updates.isEmpty ? null : updates.last;
    final tone = _toneFor(i.s('severity'));
    return Material(
      key: Key('incident-${i.s('id')}'),
      color: tone.background,
      borderRadius: BorderRadius.circular(AppRadius.inner),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => showModalBottomSheet<void>(context: context, isScrollControlled: true, builder: (_) => _IncidentSheet(entry: entry)),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Icon(i.s('severity') == 'minor' ? Icons.info_outline_rounded : Icons.warning_amber_rounded, size: 18, color: tone.foreground),
            const SizedBox(width: 10),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(i.s('title'), style: AppType.bodyMedium(tone.foreground)),
                const SizedBox(height: 2),
                Text(
                  latest?.s('message').isNotEmpty == true ? latest!.s('message') : i.s('customer_impact'),
                  style: AppType.small(tone.foreground),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 6),
                Text(
                  '${humanize(latest?.str('status') ?? i.str('status'))} · updated ${fmtRelative(latest?.str('created_at') ?? i.str('started_at'))}',
                  style: AppType.caption(tone.foreground),
                ),
              ]),
            ),
            Icon(Icons.chevron_right_rounded, color: tone.foreground),
          ]),
        ),
      ),
    );
  }
}

class _IncidentSheet extends StatelessWidget {
  const _IncidentSheet({required this.entry});

  final Json entry;

  @override
  Widget build(BuildContext context) {
    final i = entry.obj('incident')!;
    final updates = entry.list('updates').reversed.toList();
    final tone = _toneFor(i.s('severity'));
    return SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.8),
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(22, 0, 22, 22),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Wrap(spacing: 6, runSpacing: 6, children: [
              AppChip(humanize(i.str('severity')), tone: tone, dense: true),
              AppChip(humanize(i.str('status')), tone: Tone.neutral, dense: true),
            ]),
            const SizedBox(height: 10),
            Text(i.s('title'), style: AppType.h2()),
            const SizedBox(height: 6),
            Text('Started ${fmtDateTime(i.str('started_at'))}', style: AppType.label()),
            if (i.s('customer_impact').isNotEmpty) ...[
              const SizedBox(height: 14),
              InnerPanel(child: Text(i.s('customer_impact'), style: AppType.body(AppColors.text2))),
            ],
            if (_affected(i).isNotEmpty) ...[
              const SizedBox(height: 12),
              Wrap(spacing: 6, runSpacing: 6, children: [for (final s in _affected(i)) AppChip(humanize(s), tone: Tone.neutral, dense: true)]),
            ],
            const SizedBox(height: 18),
            Text('Updates', style: AppType.h3()),
            const SizedBox(height: 10),
            if (updates.isEmpty) Text('No updates yet.', style: AppType.small(AppColors.muted)),
            for (final u in updates)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Padding(
                    padding: const EdgeInsets.only(top: 5),
                    child: Container(width: 8, height: 8, decoration: BoxDecoration(color: toneForStatus(u.s('status') == 'resolved' ? 'COMPLETED' : 'PENDING').foreground, shape: BoxShape.circle)),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Row(children: [
                        Expanded(child: Text(humanize(u.str('status')), style: AppType.bodyMedium())),
                        Text(fmtDateTime(u.str('created_at')), style: AppType.caption()),
                      ]),
                      const SizedBox(height: 2),
                      Text(u.s('message'), style: AppType.small()),
                    ]),
                  ),
                ]),
              ),
          ]),
        ),
      ),
    );
  }
}
