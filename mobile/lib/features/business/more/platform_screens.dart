import 'package:flutter/material.dart';

import '../../../core/api/api.dart';
import '../../../core/format/dates.dart';
import '../../../shared/loaded_page.dart';
import '../../../theme/kit.dart';

/// Read-only mobile views of flag-gated platform features (marketplace, custom domains, experiments,
/// copilot). Each entry is only reachable when its flag is on (see MoreScreen); changes are made on the
/// web dashboard.
const _webNote = 'Manage this on the web dashboard. The app shows a read-only summary.';

String _pct(int bps) => formatBps(bps);

class SellersScreen extends StatelessWidget {
  const SellersScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return LoadedPage(
      title: 'Marketplace sellers',
      subtitle: 'Connected sellers with split settlement',
      bottomInset: 32,
      cacheName: 'platform.sellers',
      load: (api) => api.get('/v1/sellers'),
      isEmpty: (d) => ApiList.from(d).data.isEmpty,
      emptyTitle: 'No sellers yet',
      emptyMessage: _webNote,
      emptyIcon: Icons.storefront_outlined,
      builder: (context, data, reload) {
        final items = ApiList.from(data).data;
        return [
          AppCard(
            padding: const EdgeInsets.fromLTRB(16, 6, 16, 6),
            child: Column(children: [
              for (var i = 0; i < items.length; i++) ...[
                if (i > 0) const Hairline(indent: 54),
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 4),
                  child: Row(children: [
                    FlagAvatar(items[i].str('country'), size: 38),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(items[i].s('name'), style: AppType.bodyMedium()),
                        Text(
                          '${items[i].s('default_currency')} · commission ${_pct(items[i].i('commission_bps'))}'
                          '${items[i].str('payout_last4') != null ? ' · payouts •• ${items[i].s('payout_last4')}' : ''}',
                          style: AppType.label(),
                        ),
                      ]),
                    ),
                    StatusPill(items[i].s('status').toUpperCase(), label: humanize(items[i].str('status'))),
                  ]),
                ),
              ],
            ]),
          ),
          const SizedBox(height: 10),
          Text(_webNote, style: AppType.caption()),
        ];
      },
    );
  }
}

class DomainsScreen extends StatelessWidget {
  const DomainsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return LoadedPage(
      title: 'Custom domains',
      subtitle: 'Verified checkout and portal domains',
      bottomInset: 32,
      cacheName: 'platform.domains',
      load: (api) => api.get('/v1/domains'),
      isEmpty: (d) => ApiList.from(d).data.isEmpty,
      emptyTitle: 'No custom domains',
      emptyMessage: _webNote,
      emptyIcon: Icons.language_rounded,
      builder: (context, data, reload) {
        // Entries are {domain, dns}; tolerate a bare domain object too.
        final items = ApiList.from(data).data.map((e) => e.obj('domain') ?? e).toList();
        return [
          for (final d in items) ...[
            AppCard(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Expanded(child: Text(humanize(d.str('purpose')), style: AppType.label())),
                  StatusPill(d.s('status')),
                ]),
                const SizedBox(height: 6),
                Text(d.s('hostname'), style: AppType.h3()),
                const SizedBox(height: 10),
                KeyValueRow('Last checked', value: fmtRelative(d.str('last_checked_at'))),
                if (d.str('verified_at') != null) KeyValueRow('Verified', value: fmtDateTime(d.str('verified_at'))),
                if (d.str('last_error') != null && d.s('status') != 'VERIFIED') ...[
                  const SizedBox(height: 6),
                  NoticePanel(d.s('last_error'), tone: Tone.peach, icon: Icons.dns_outlined),
                ],
              ]),
            ),
            const SizedBox(height: 12),
          ],
          Text(_webNote, style: AppType.caption()),
        ];
      },
    );
  }
}

class ExperimentsScreen extends StatelessWidget {
  const ExperimentsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return LoadedPage(
      title: 'Experiments',
      subtitle: 'Checkout A/B tests on payment links',
      bottomInset: 32,
      cacheName: 'platform.experiments',
      load: (api) => api.get('/v1/experiments', query: {'limit': '50'}),
      isEmpty: (d) => ApiList.from(d).data.isEmpty,
      emptyTitle: 'No experiments yet',
      emptyMessage: _webNote,
      emptyIcon: Icons.science_outlined,
      builder: (context, data, reload) {
        final items = ApiList.from(data).data;
        return [
          AppCard(
            padding: const EdgeInsets.fromLTRB(16, 6, 16, 6),
            child: Column(children: [
              for (var i = 0; i < items.length; i++) ...[
                if (i > 0) const Hairline(indent: 54),
                NavRow(
                  icon: Icons.science_outlined,
                  tone: items[i].s('status') == 'running' ? Tone.sage : Tone.neutral,
                  title: items[i].s('name', 'Experiment'),
                  subtitle: [
                    '${items[i].list('variants').length} variants',
                    if (items[i].str('started_at') != null) 'started ${fmtRelative(items[i].str('started_at'))}',
                    if (items[i].str('hypothesis') != null) items[i].s('hypothesis'),
                  ].join(' · '),
                  trailing: StatusPill(items[i].s('status') == 'running' ? 'ACTIVE' : items[i].s('status').toUpperCase(), label: humanize(items[i].str('status'))),
                ),
              ],
            ]),
          ),
          const SizedBox(height: 10),
          Text(_webNote, style: AppType.caption()),
        ];
      },
    );
  }
}

class CopilotScreen extends StatelessWidget {
  const CopilotScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return LoadedPage(
      title: 'Copilot',
      subtitle: 'AI financial copilot',
      bottomInset: 32,
      load: (api) async {
        final r = await Future.wait([api.get('/v1/copilot/status'), api.get('/v1/copilot/actions', query: {'limit': '25'})]);
        return {'status': r[0], 'actions': r[1]};
      },
      builder: (context, data, reload) {
        final d = Json.from(data as Map);
        final status = d['status'] is Map ? Json.from(d['status'] as Map) : const <String, dynamic>{};
        final actions = ApiList.from(d['actions']).data;
        return [
          AppCard(
            child: Row(children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(color: status.b('configured') ? AppColors.sage100 : AppColors.surface3, shape: BoxShape.circle),
                child: Icon(Icons.auto_awesome_outlined, color: status.b('configured') ? AppColors.sage700 : AppColors.muted, size: 20),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(status.b('configured') ? 'Copilot is ready' : 'Copilot isn’t configured', style: AppType.bodyMedium()),
                  Text('Ask questions and approve drafted actions on the web dashboard.', style: AppType.label()),
                ]),
              ),
            ]),
          ),
          const SectionHeader('Drafted actions'),
          if (actions.isEmpty)
            const AppCard(child: EmptyView(title: 'No actions yet', message: 'Actions Copilot drafts for your approval appear here.', icon: Icons.auto_awesome_outlined))
          else
            AppCard(
              padding: const EdgeInsets.fromLTRB(16, 6, 16, 6),
              child: Column(children: [
                for (var i = 0; i < actions.length; i++) ...[
                  if (i > 0) const Hairline(indent: 54),
                  NavRow(
                    icon: Icons.bolt_rounded,
                    tone: actions[i].s('risk_level') == 'high' ? Tone.peach : Tone.lemon,
                    title: actions[i].s('summary', humanize(actions[i].str('kind'))),
                    subtitle: '${humanize(actions[i].str('kind'))} · ${humanize(actions[i].str('risk_level'))} risk · ${fmtRelative(actions[i].str('created_at'))}',
                    trailing: StatusPill(actions[i].s('status') == 'applied' ? 'COMPLETED' : actions[i].s('status') == 'draft' ? 'DRAFT' : 'CANCELLED', label: humanize(actions[i].str('status'))),
                  ),
                ],
              ]),
            ),
        ];
      },
    );
  }
}
