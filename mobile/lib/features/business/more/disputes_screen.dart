import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../core/api/api.dart';
import '../../../core/format/dates.dart';
import '../../../shared/loaded_page.dart';
import '../../../shared/offline.dart';
import '../../../shared/step_up.dart';
import '../../../theme/kit.dart';
import '../../common/navigation.dart';
import '../payments/payment_detail_screen.dart';
import '../widgets.dart';

class DisputesScreen extends StatefulWidget {
  const DisputesScreen({super.key});

  @override
  State<DisputesScreen> createState() => _DisputesScreenState();
}

class _DisputesScreenState extends State<DisputesScreen> {
  late final PagedController _c;

  @override
  void initState() {
    super.initState();
    _c = PagedController(api: context.read<Api>(), path: '/v1/disputes')..refresh();
  }
  String? _status;

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AppPage(
      title: 'Disputes',
      bottomInset: 32,
      onRefresh: _c.refresh,
      banner: const OfflineBanner(),
      children: [
        FilterChips(
          options: const {null: 'All', 'needs_response': 'Needs response', 'under_review': 'Under review', 'won': 'Won', 'lost': 'Lost'},
          selected: _status,
          onChanged: (v) {
            setState(() => _status = v);
            _c.query = {'status': v};
            _c.refresh();
          },
        ),
        const SizedBox(height: 14),
        PagedListBody(
          controller: _c,
          emptyTitle: 'No disputes',
          emptyMessage: 'Chargebacks from card networks appear here.',
          emptyIcon: Icons.gavel_rounded,
          itemBuilder: (context, d, i) => TransactionRow(
            label: humanize(d.str('reason')),
            amount: d.i('amount'),
            currency: d.s('currency', 'USD'),
            status: d.str('status'),
            meta: d.s('status') == 'needs_response' ? 'Respond by ${fmtDate(d.str('evidence_due_by'))}' : 'Opened ${fmtDate(d.str('created_at'))}',
            onTap: () async {
              await push(context, DisputeDetailScreen(id: d.s('id')));
              _c.refresh();
            },
          ),
        ),
      ],
    );
  }
}

class DisputeDetailScreen extends StatelessWidget {
  const DisputeDetailScreen({super.key, required this.id});

  final String id;

  @override
  Widget build(BuildContext context) {
    return LoadedPage(
      title: 'Dispute',
      subtitle: id,
      bottomInset: 24,
      load: (api) => api.get('/v1/disputes/$id'),
      footerBuilder: (context, data, reload) {
        final d = Json.from(data as Map).obj('dispute') ?? {};
        if (d.s('status') != 'needs_response') return null;
        return PrimaryButton(
          'Respond with evidence',
          icon: Icons.upload_file_rounded,
          onPressed: canWrite(context)
              ? () async {
                  final done = await push<bool>(context, DisputeRespondScreen(dispute: Json.from(data)));
                  if (done == true) await reload();
                }
              : null,
        );
      },
      builder: (context, data, reload) {
        final all = Json.from(data as Map);
        final d = all.obj('dispute') ?? {};
        final p = all.obj('payment') ?? {};
        final ev = all.list('evidence');
        final sug = all.obj('suggested_evidence') ?? {};
        final purchase = sug.obj('purchase') ?? {};
        final cur = d.s('currency', 'USD');
        return [
          AppCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [Expanded(child: Text(humanize(d.str('reason')), style: AppType.label())), StatusPill(d.str('status'))]),
              const SizedBox(height: 8),
              AmountText(d.i('amount'), cur, size: AmountSize.hero),
              const SizedBox(height: 8),
              Text('Dispute fee ${Money.format(d.i('fee_amount'), cur)}', style: AppType.small(AppColors.muted)),
              if (d.s('status') == 'needs_response') ...[
                const SizedBox(height: 12),
                NoticePanel('Submit evidence by ${fmtDateTime(d.str('evidence_due_by'))}.', tone: Tone.peach, icon: Icons.schedule_rounded),
              ],
            ]),
          ),
          const SectionHeader('Payment'),
          AppCard(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
            child: PaymentRow(payment: p, onTap: () => push(context, PaymentDetailScreen(id: p.s('id')))),
          ),
          const SectionHeader('Evidence we already hold'),
          AppCard(
            child: Column(children: [
              KeyValueRow('Purchase', value: '${Money.format(purchase.i('amount'), purchase.s('currency', cur))} on ${fmtDate(purchase.str('created_at'))}'),
              KeyValueRow('Card', value: purchase.str('last4') == null ? '—' : '${humanize(purchase.str('card_brand'))} •••• ${purchase.s('last4')}'),
              KeyValueRow('3-D Secure', value: humanize(purchase.str('three_ds_result'))),
              KeyValueRow('Terms accepted', value: sug.str('terms_accepted') ?? '—'),
              KeyValueRow('Entitlements granted', value: '${sug.list('entitlements').length}'),
              KeyValueRow('Usage events', value: '${sug.i('usage_events')}'),
            ]),
          ),
          const SectionHeader('Submitted evidence'),
          if (ev.isEmpty)
            const AppCard(child: EmptyView(title: 'No evidence yet', icon: Icons.description_outlined))
          else
            AppCard(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                for (final e in ev)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(humanize(e.str('type')), style: AppType.bodyMedium()),
                      const SizedBox(height: 2),
                      Text(e.str('text') ?? '', style: AppType.small()),
                      Text(fmtDateTime(e.str('created_at')), style: AppType.caption()),
                    ]),
                  ),
              ]),
            ),
        ];
      },
    );
  }
}

/// Respond-with-evidence form: add text evidence items, then save as draft or submit.
class DisputeRespondScreen extends StatefulWidget {
  const DisputeRespondScreen({super.key, required this.dispute});

  final Json dispute;

  @override
  State<DisputeRespondScreen> createState() => _DisputeRespondScreenState();
}

class _EvidenceItem {
  String type = 'product_description';
  final text = TextEditingController();
}

class _DisputeRespondScreenState extends State<DisputeRespondScreen> {
  final List<_EvidenceItem> _items = [_EvidenceItem()];
  bool _busy = false;
  Object? _error;

  static const _types = {
    'product_description': 'Product or service description',
    'customer_communication': 'Customer communication',
    'access_activity_log': 'Access / usage log',
    'refund_policy': 'Refund policy',
    'receipt': 'Receipt',
    'shipping_documentation': 'Delivery confirmation',
    'uncategorized_text': 'Other',
  };

  @override
  void initState() {
    super.initState();
    final sug = widget.dispute.obj('suggested_evidence') ?? {};
    final purchase = sug.obj('purchase') ?? {};
    // Prefill a summary of what the platform already holds; the merchant reviews it before sending.
    _items.first
      ..type = 'access_activity_log'
      ..text.text = 'Purchase ${purchase.s('id')} on ${fmtDate(purchase.str('created_at'))}. '
          '${sug.list('entitlements').length} entitlement(s) granted; ${sug.i('usage_events')} usage event(s) recorded.'
          '${sug.str('terms_accepted') != null ? ' Terms version ${sug.s('terms_accepted')} accepted at checkout.' : ''}';
  }

  @override
  void dispose() {
    for (final i in _items) {
      i.text.dispose();
    }
    super.dispose();
  }

  Future<void> _send(bool submit) async {
    final evidence = [
      for (final i in _items)
        if (i.text.text.trim().isNotEmpty) {'type': i.type, 'text': i.text.text.trim()},
    ];
    if (evidence.isEmpty) {
      setState(() => _error = 'Add at least one piece of evidence.');
      return;
    }
    if (submit) {
      final ok = await showDialog<bool>(
        context: context,
        builder: (c) => AlertDialog(
          title: const Text('Submit evidence?'),
          content: const Text('After submitting you cannot add more evidence. The card network reviews it and decides the outcome.'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
            TextButton(onPressed: () => Navigator.pop(c, true), child: const Text('Submit')),
          ],
        ),
      );
      if (ok != true || !mounted) return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final api = context.read<Api>();
    final id = (widget.dispute.obj('dispute') ?? {}).s('id');
    try {
      final res = await withStepUp(context, (key) => api.post('/v1/disputes/$id/evidence', idempotencyKey: key, body: {'evidence': evidence, 'submit': submit}));
      if (!mounted) return;
      if (res != null) {
        showToast(context, submit ? 'Evidence submitted for review' : 'Evidence saved');
        Navigator.of(context).pop(true);
      } else {
        setState(() => _busy = false);
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e;
          _busy = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final online = canWrite(context);
    return AppPage(
      title: 'Respond',
      subtitle: 'Dispute evidence',
      bottomInset: 24,
      banner: const OfflineBanner(),
      footer: Row(children: [
        Expanded(child: SecondaryButton('Save draft', onPressed: online && !_busy ? () => _send(false) : null)),
        const SizedBox(width: 10),
        Expanded(child: PrimaryButton('Submit', loading: _busy, onPressed: online ? () => _send(true) : null)),
      ]),
      children: [
        const NoticePanel('Be factual and specific. Evidence is shared with the card network and the cardholder’s bank.', icon: Icons.info_outline_rounded),
        const SizedBox(height: 14),
        for (var i = 0; i < _items.length; i++) ...[
          AppCard(
            child: Column(children: [
              Row(children: [
                Expanded(
                  child: DropdownButtonFormField<String>(
                    value: _items[i].type,
                    isExpanded: true,
                    decoration: InputDecoration(labelText: 'Evidence ${i + 1}'),
                    items: [for (final e in _types.entries) DropdownMenuItem(value: e.key, child: Text(e.value, overflow: TextOverflow.ellipsis))],
                    onChanged: (v) => setState(() => _items[i].type = v ?? _items[i].type),
                  ),
                ),
                if (_items.length > 1)
                  IconButton(
                    tooltip: 'Remove',
                    onPressed: () => setState(() => _items.removeAt(i).text.dispose()),
                    icon: const Icon(Icons.close_rounded, color: AppColors.muted),
                  ),
              ]),
              const SizedBox(height: 10),
              TextField(controller: _items[i].text, minLines: 3, maxLines: 8, decoration: const InputDecoration(hintText: 'Describe the evidence')),
            ]),
          ),
          const SizedBox(height: 12),
        ],
        SecondaryButton('Add evidence', icon: Icons.add_rounded, onPressed: () => setState(() => _items.add(_EvidenceItem()))),
        InlineError(_error),
      ],
    );
  }
}
