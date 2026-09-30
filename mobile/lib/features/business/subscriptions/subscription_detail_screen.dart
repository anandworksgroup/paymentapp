import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../core/api/api.dart';
import '../../../core/format/dates.dart';
import '../../../shared/loaded_page.dart';
import '../../../shared/offline.dart';
import '../../../shared/step_up.dart';
import '../../../theme/kit.dart';
import '../../common/navigation.dart';
import '../customers/customer_detail_screen.dart';
import '../widgets.dart';

class SubscriptionDetailScreen extends StatelessWidget {
  const SubscriptionDetailScreen({super.key, required this.id});

  final String id;

  @override
  Widget build(BuildContext context) {
    return LoadedPage(
      title: 'Subscription',
      subtitle: id,
      bottomInset: 24,
      load: (api) => api.get('/v1/subscriptions/$id'),
      builder: (context, data, reload) => _body(context, Json.from(data as Map)),
      footerBuilder: (context, data, reload) {
        final s = Json.from(data as Map).obj('subscription') ?? {};
        final status = s.s('status');
        if (status != 'ACTIVE' && status != 'PAUSED') return null;
        return _PauseResumeButton(id: id, paused: status == 'PAUSED', onDone: reload);
      },
    );
  }

  List<Widget> _body(BuildContext context, Json d) {
    final s = d.obj('subscription') ?? {};
    final customer = d.obj('customer');
    final prices = {for (final p in d.list('prices')) p.s('id'): p};
    return [
      AppCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text('Current period', style: AppType.label())),
            StatusPill(s.str('status')),
          ]),
          const SizedBox(height: 8),
          Text('${fmtDate(s.str('current_period_start'))} – ${fmtDate(s.str('current_period_end'))}', style: AppType.h2()),
          const SizedBox(height: 10),
          Wrap(spacing: 6, runSpacing: 6, children: [
            AppChip(humanize(s.str('collection_method')), dense: true, tone: Tone.neutral),
            if (s.b('cancel_at_period_end')) const AppChip('Cancels at period end', dense: true, tone: Tone.peach),
            if (s.str('trial_end') != null) AppChip('Trial ends ${fmtDate(s.str('trial_end'))}', dense: true),
            if (s.i('dunning_attempts') > 0) AppChip('${s.i('dunning_attempts')} retry attempts', dense: true, tone: Tone.rose),
          ]),
          if (s.s('status') == 'PAUSED') ...[
            const SizedBox(height: 12),
            NoticePanel('Paused on ${fmtDate(s.str('paused_at'))}. Resuming starts a fresh billing period from today.', icon: Icons.pause_circle_outline),
          ],
        ]),
      ),
      const SectionHeader('Items'),
      AppCard(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
        child: Column(children: [
          for (final item in d.list('items'))
            Builder(builder: (context) {
              final p = prices[item.s('price_id')] ?? {};
              final interval = p.str('interval') == null ? 'one-time' : 'every ${p.i('interval_count', 1) > 1 ? '${p.i('interval_count')} ' : ''}${p.s('interval')}';
              return TransactionRow(
                label: '${p.str('nickname') ?? p.s('id')} · qty ${item.i('quantity')}',
                amount: p.i('unit_amount'),
                currency: p.s('currency', s.s('currency', 'USD')),
                meta: '${humanize(p.str('scheme'))} · $interval${p.s('usage_type') == 'metered' ? ' · metered' : ''}',
              );
            }),
        ]),
      ),
      if (d.list('current_usage').isNotEmpty) ...[
        const SectionHeader('Unbilled usage'),
        AppCard(child: Column(children: [
          for (final u in d.list('current_usage')) KeyValueRow(u.s('event_name'), value: '${u.i('quantity')}'),
        ])),
      ],
      if (customer != null) ...[
        const SectionHeader('Customer'),
        AppCard(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
          child: NavRow(
            icon: Icons.person_outline_rounded,
            title: customer.str('name') ?? customer.str('email') ?? customer.s('id'),
            subtitle: customer.str('email'),
            onTap: () => push(context, CustomerDetailScreen(id: customer.s('id'))),
          ),
        ),
      ],
      const SectionHeader('Invoices'),
      if (d.list('invoices').isEmpty)
        const AppCard(child: EmptyView(title: 'No invoices yet', icon: Icons.description_outlined))
      else
        AppCard(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
          child: Column(children: [
            for (final inv in d.list('invoices'))
              TransactionRow(
                label: '${inv.str('number') ?? inv.s('id')} · ${fmtDate(inv.str('created_at'))}',
                amount: inv.i('total'),
                currency: inv.s('currency', 'USD'),
                status: inv.str('status'),
              ),
          ]),
        ),
      const SectionHeader('Timeline'),
      AppCard(child: TimelineList(items: d.list('timeline'))),
    ];
  }
}

class _PauseResumeButton extends StatefulWidget {
  const _PauseResumeButton({required this.id, required this.paused, required this.onDone});

  final String id;
  final bool paused;
  final Future<void> Function() onDone;

  @override
  State<_PauseResumeButton> createState() => _PauseResumeButtonState();
}

class _PauseResumeButtonState extends State<_PauseResumeButton> {
  bool _busy = false;

  Future<void> _run() async {
    final verb = widget.paused ? 'resume' : 'pause';
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(widget.paused ? 'Resume subscription?' : 'Pause subscription?'),
        content: Text(widget.paused
            ? 'Billing restarts with a fresh period from today.'
            : 'No invoices are created while paused. You can resume at any time.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(c, true), child: Text(widget.paused ? 'Resume' : 'Pause')),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    setState(() => _busy = true);
    final api = context.read<Api>();
    try {
      final res = await withStepUp(context, (key) => api.post('/v1/subscriptions/${widget.id}/$verb', idempotencyKey: key));
      if (res != null && mounted) showToast(context, widget.paused ? 'Subscription resumed' : 'Subscription paused');
      await widget.onDone();
    } catch (e) {
      if (mounted) showToast(context, e is ApiException ? e.message : 'Could not $verb the subscription.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final online = canWrite(context);
    return PrimaryButton(
      widget.paused ? 'Resume subscription' : 'Pause subscription',
      icon: widget.paused ? Icons.play_arrow_rounded : Icons.pause_rounded,
      loading: _busy,
      onPressed: online ? _run : null,
    );
  }
}
