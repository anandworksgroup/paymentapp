import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api/api.dart';
import '../../core/format/dates.dart';
import '../../core/security/secure_screen.dart';
import '../../shared/loaded_page.dart';
import '../../shared/offline.dart';
import '../../shared/step_up.dart';
import '../../theme/kit.dart';

/// Sessions (with revoke), devices and security events.
class SecurityScreen extends StatelessWidget {
  const SecurityScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return SecureScreen(
      child: LoadedPage(
        title: 'Security',
        bottomInset: 32,
        load: (api) async {
          final r = await Future.wait([api.get('/v1/me/sessions'), api.get('/v1/me/devices'), api.get('/v1/me/security_events')]);
          return {'sessions': r[0], 'devices': r[1], 'events': r[2]};
        },
        builder: (context, data, reload) {
          final d = Json.from(data as Map);
          final sessions = ApiList.from(d['sessions']).data;
          final devices = ApiList.from(d['devices']).data;
          final events = ApiList.from(d['events']).data;
          return [
            const SectionHeader('Active sessions', padding: EdgeInsets.fromLTRB(4, 4, 4, 10)),
            AppCard(
              padding: const EdgeInsets.fromLTRB(16, 6, 16, 6),
              child: Column(children: [
                if (sessions.isEmpty) const EmptyView(title: 'No active sessions', icon: Icons.devices_other_rounded),
                for (var i = 0; i < sessions.length; i++) ...[
                  if (i > 0) const Hairline(indent: 54),
                  _SessionRow(session: sessions[i], onRevoked: reload),
                ],
              ]),
            ),
            const SectionHeader('Devices'),
            AppCard(
              padding: const EdgeInsets.fromLTRB(16, 6, 16, 6),
              child: Column(children: [
                if (devices.isEmpty) const EmptyView(title: 'No devices', icon: Icons.phone_iphone_rounded),
                for (var i = 0; i < devices.length; i++) ...[
                  if (i > 0) const Hairline(indent: 54),
                  NavRow(
                    icon: devices[i].s('platform') == 'mobile_app' ? Icons.phone_iphone_rounded : Icons.laptop_mac_rounded,
                    tone: Tone.neutral,
                    title: humanize(devices[i].str('platform') ?? 'device'),
                    subtitle: '${_agent(devices[i].str('user_agent'))} · last seen ${fmtRelative(devices[i].str('last_seen_at'))}${devices[i].str('last_ip') != null ? ' · ${devices[i].s('last_ip')}' : ''}',
                  ),
                ],
              ]),
            ),
            const SectionHeader('Security events'),
            AppCard(
              padding: const EdgeInsets.fromLTRB(16, 6, 16, 6),
              child: Column(children: [
                if (events.isEmpty) const EmptyView(title: 'No events', icon: Icons.shield_outlined),
                for (var i = 0; i < events.length; i++) ...[
                  if (i > 0) const Hairline(indent: 54),
                  NavRow(
                    icon: _eventIcon(events[i].s('type')),
                    tone: events[i].s('type').contains('failed') ? Tone.rose : Tone.sage,
                    title: humanize(events[i].str('type')),
                    subtitle: '${fmtDateTime(events[i].str('created_at'))}${events[i].str('ip') != null ? ' · ${events[i].s('ip')}' : ''}${events[i].str('detail') != null ? ' · ${events[i].s('detail')}' : ''}',
                  ),
                ],
              ]),
            ),
          ];
        },
      ),
    );
  }

  static String _agent(String? ua) {
    if (ua == null || ua.isEmpty) return 'Unknown client';
    if (ua.contains('Dart')) return 'Mobile app';
    if (ua.contains('Chrome')) return 'Chrome';
    if (ua.contains('Safari')) return 'Safari';
    if (ua.contains('Firefox')) return 'Firefox';
    if (ua.contains('python')) return 'Script';
    return ua.length > 24 ? '${ua.substring(0, 24)}…' : ua;
  }

  static IconData _eventIcon(String type) => switch (type) {
        'login' => Icons.login_rounded,
        'login_failed' || 'mfa_failed' => Icons.warning_amber_rounded,
        'new_device' => Icons.phonelink_setup_rounded,
        'session_revoked' => Icons.logout_rounded,
        'step_up' => Icons.verified_user_outlined,
        'bank_account_added' => Icons.account_balance_outlined,
        _ => Icons.shield_outlined,
      };
}

class _SessionRow extends StatefulWidget {
  const _SessionRow({required this.session, required this.onRevoked});

  final Json session;
  final Future<void> Function() onRevoked;

  @override
  State<_SessionRow> createState() => _SessionRowState();
}

class _SessionRowState extends State<_SessionRow> {
  bool _busy = false;

  Future<void> _revoke() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Sign out this session?'),
        content: const Text('The device using it will need to sign in again.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(c, true), child: const Text('Sign out')),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    setState(() => _busy = true);
    final api = context.read<Api>();
    try {
      await withStepUp(context, (_) => api.delete('/v1/me/sessions/${widget.session.s('id')}'));
      if (mounted) showToast(context, 'Session signed out');
      await widget.onRevoked();
    } catch (e) {
      if (mounted) showToast(context, e is ApiException ? e.message : 'Could not revoke the session.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.session;
    final current = s.b('current');
    return NavRow(
      icon: current ? Icons.smartphone_rounded : Icons.devices_other_rounded,
      tone: current ? Tone.sage : Tone.neutral,
      title: current ? 'This device' : SecurityScreen._agent(s.str('user_agent')),
      subtitle: 'Active ${fmtRelative(s.str('last_seen_at'))}${s.str('ip') != null ? ' · ${s.s('ip')}' : ''} · since ${fmtDate(s.str('created_at'))}',
      trailing: current
          ? const AppChip('Current', dense: true, tone: Tone.sage)
          : (_busy
              ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
              : TextButton(onPressed: canWrite(context) ? _revoke : null, child: Text('Revoke', style: AppType.small(AppColors.roseInk)))),
    );
  }
}
