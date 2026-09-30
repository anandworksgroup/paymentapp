import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../core/api/api.dart';
import '../../../core/format/dates.dart';
import '../../../core/security/secure_screen.dart';
import '../../../shared/loaded_page.dart';
import '../../../shared/offline.dart';
import '../../../shared/step_up.dart';
import '../../../theme/kit.dart';
import '../../common/navigation.dart';
import '../customers/customer_detail_screen.dart';
import '../more/disputes_screen.dart';
import '../widgets.dart';

class PaymentDetailScreen extends StatelessWidget {
  const PaymentDetailScreen({super.key, required this.id});

  final String id;

  @override
  Widget build(BuildContext context) {
    return SecureScreen(
      child: LoadedPage(
        title: 'Payment',
        subtitle: id,
        bottomInset: 24,
        load: (api) => api.get('/v1/payments/$id'),
        builder: (context, data, reload) => _body(context, Json.from(data as Map)),
        footerBuilder: (context, data, reload) {
          final p = Json.from(data as Map).obj('payment') ?? {};
          final refundable = p.s('status') == 'SUCCEEDED' || p.s('status') == 'PARTIALLY_REFUNDED';
          if (!refundable) return null;
          return _RefundButton(payment: p, onDone: reload);
        },
      ),
    );
  }

  List<Widget> _body(BuildContext context, Json d) {
    final p = d.obj('payment') ?? {};
    final cur = p.s('currency', 'USD');
    final fb = d.obj('fee_breakdown') ?? {};
    final fbCur = fb.s('currency', cur);
    final customer = d.obj('customer');
    return [
      AppCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text(p.str('description') ?? 'Payment', style: AppType.label(), maxLines: 1, overflow: TextOverflow.ellipsis)),
            StatusPill(p.str('status')),
          ]),
          const SizedBox(height: 8),
          AmountText(p.i('amount'), cur, size: AmountSize.hero),
          const SizedBox(height: 8),
          Text(fmtDateTime(p.str('created_at')), style: AppType.small(AppColors.muted)),
          if (p.str('failure_message') != null) ...[
            const SizedBox(height: 12),
            NoticePanel(p.s('failure_message'), tone: Tone.rose, title: humanize(p.str('failure_code'))),
          ],
          if (p.s('review_status') == 'pending') ...[
            const SizedBox(height: 12),
            const NoticePanel('This payment is held for risk review. Funds settle after it is approved.', tone: Tone.peach, icon: Icons.shield_outlined),
          ],
        ]),
      ),
      const SectionHeader('Fee breakdown'),
      AppCard(
        child: Column(children: [
          KeyValueRow('Customer paid', value: Money.format(fb.i('customer_paid'), fbCur)),
          KeyValueRow('Tax (remitted by us as Merchant of Record)', value: Money.format(fb.i('tax'), fbCur)),
          KeyValueRow('Platform fee', value: Money.format(fb.i('platform_fee'), fbCur)),
          if (fb.i('refunded') != 0) KeyValueRow('Refunded', value: Money.format(fb.i('refunded'), fbCur)),
          if (fb.i('disputed') != 0) KeyValueRow('Disputed', value: Money.format(fb.i('disputed'), fbCur)),
          const Hairline(),
          const SizedBox(height: 4),
          KeyValueRow('Net to you', emphasize: true, child: AmountText(fb.i('net_to_merchant'), fbCur, size: AmountSize.small)),
        ]),
      ),
      const SectionHeader('Details'),
      AppCard(
        child: Column(children: [
          KeyValueRow('Method', value: p.str('last4') != null ? '${humanize(p.str('card_brand'))} •••• ${p.s('last4')}' : humanize(p.str('payment_method_type'))),
          KeyValueRow('Country', child: Row(mainAxisSize: MainAxisSize.min, children: [
            Text(p.str('country') ?? '—', style: AppType.body(AppColors.text2)),
            const SizedBox(width: 8),
            FlagAvatar(p.str('country'), size: 24),
          ])),
          KeyValueRow('Provider', value: p.str('provider_id')),
          KeyValueRow('Risk', value: '${p.i('risk_score')} · ${humanize(p.str('risk_action'))}'),
          if (p.str('three_ds_result') != null) KeyValueRow('3-D Secure', value: humanize(p.str('three_ds_result'))),
          if (p.str('invoice_id') != null) KeyValueRow('Invoice', value: p.str('invoice_id'), selectable: true),
          if (p.str('order_id') != null) KeyValueRow('Order', value: p.str('order_id'), selectable: true),
          KeyValueRow('Payment id', value: p.s('id'), selectable: true),
        ]),
      ),
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
      const SectionHeader('Attempts'),
      AppCard(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
        child: Column(children: [
          if (d.list('attempts').isEmpty) Padding(padding: const EdgeInsets.all(8), child: Text('No attempts recorded.', style: AppType.small(AppColors.muted))),
          for (final a in d.list('attempts'))
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Row(children: [
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(a.s('provider_id'), style: AppType.bodyMedium()),
                    Text(
                      [
                        if (a.str('routing_reason') != null) humanize(a.str('routing_reason')),
                        if (a.str('error_code') != null) humanize(a.str('error_code')),
                        '${a.i('latency_ms')} ms',
                      ].join(' · '),
                      style: AppType.label(),
                    ),
                  ]),
                ),
                StatusPill(a.str('status')),
              ]),
            ),
        ]),
      ),
      if (d.list('refunds').isNotEmpty) ...[
        const SectionHeader('Refunds'),
        AppCard(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
          child: Column(children: [
            for (final r in d.list('refunds'))
              TransactionRow(
                label: '${humanize(r.str('reason') ?? 'refund')} · ${fmtDate(r.str('created_at'))}',
                amount: r.i('amount'),
                currency: r.s('currency', cur),
                status: r.str('status'),
                meta: r.str('failure_reason'),
              ),
          ]),
        ),
      ],
      if (d.list('disputes').isNotEmpty) ...[
        const SectionHeader('Disputes'),
        AppCard(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
          child: Column(children: [
            for (final x in d.list('disputes'))
              TransactionRow(
                label: humanize(x.str('reason')),
                amount: x.i('amount'),
                currency: x.s('currency', cur),
                status: x.str('status'),
                meta: 'Evidence due ${fmtDate(x.str('evidence_due_by'))}',
                onTap: () => push(context, DisputeDetailScreen(id: x.s('id'))),
              ),
          ]),
        ),
      ],
      const SectionHeader('Timeline'),
      AppCard(child: TimelineList(items: d.list('timeline'))),
    ];
  }
}

class _RefundButton extends StatelessWidget {
  const _RefundButton({required this.payment, required this.onDone});

  final Json payment;
  final Future<void> Function() onDone;

  @override
  Widget build(BuildContext context) {
    final online = canWrite(context);
    return PrimaryButton(
      online ? 'Refund' : 'Refund (offline)',
      key: const Key('refund-button'),
      icon: Icons.undo_rounded,
      onPressed: online
          ? () async {
              final done = await showModalBottomSheet<bool>(
                context: context,
                isScrollControlled: true,
                builder: (_) => RefundSheet(payment: payment),
              );
              if (done == true) await onDone();
            }
          : null,
    );
  }
}

class RefundSheet extends StatefulWidget {
  const RefundSheet({super.key, required this.payment});

  final Json payment;

  @override
  State<RefundSheet> createState() => _RefundSheetState();
}

class _RefundSheetState extends State<RefundSheet> {
  bool _full = true;
  final _amount = TextEditingController();
  String _reason = 'requested_by_customer';
  bool _busy = false;
  Object? _error;

  @override
  void dispose() {
    _amount.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final cur = widget.payment.s('currency', 'USD');
    int? amount;
    if (!_full) {
      amount = Money.parseInput(_amount.text, cur);
      if (amount == null || amount <= 0) {
        setState(() => _error = 'Enter a valid amount in $cur.');
        return;
      }
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final api = context.read<Api>();
    try {
      final res = await withStepUp(context, (key) => api.post('/v1/refunds',
          idempotencyKey: key, body: {'payment': widget.payment.s('id'), 'amount': amount, 'reason': _reason}));
      if (!mounted) return;
      if (res == null) {
        setState(() => _busy = false);
        return;
      }
      final r = Json.from(res as Map);
      Navigator.of(context).pop(true);
      showToast(context, 'Refund ${humanize(r.str('status')).toLowerCase()}: ${Money.format(r.i('amount'), r.s('currency', cur))}');
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
    final p = widget.payment;
    final cur = p.s('currency', 'USD');
    return Padding(
      padding: EdgeInsets.fromLTRB(22, 0, 22, 22 + MediaQuery.viewInsetsOf(context).bottom),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('Refund payment', style: AppType.h2()),
        const SizedBox(height: 4),
        Row(children: [
          Text('Original ', style: AppType.small(AppColors.muted)),
          Flexible(child: AmountText(p.i('amount'), cur, size: AmountSize.small)),
        ]),
        const SizedBox(height: 16),
        Row(children: [
          AppChip('Full refund', tone: Tone.neutral, selected: _full, onTap: () => setState(() => _full = true)),
          const SizedBox(width: 8),
          AppChip('Partial', tone: Tone.neutral, selected: !_full, onTap: () => setState(() => _full = false)),
        ]),
        if (_full) ...[
          const SizedBox(height: 10),
          Text('Refunds whatever is still refundable. The server works out the exact amount and tax.', style: AppType.label()),
        ] else ...[
          const SizedBox(height: 12),
          TextField(
            controller: _amount,
            autofocus: true,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: InputDecoration(labelText: 'Amount', suffixText: cur),
          ),
        ],
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(
          value: _reason,
          decoration: const InputDecoration(labelText: 'Reason'),
          items: const [
            DropdownMenuItem(value: 'requested_by_customer', child: Text('Requested by customer')),
            DropdownMenuItem(value: 'duplicate', child: Text('Duplicate')),
            DropdownMenuItem(value: 'fraudulent', child: Text('Fraudulent')),
          ],
          onChanged: (v) => setState(() => _reason = v ?? _reason),
        ),
        const SizedBox(height: 10),
        Text('Large refunds ask you to confirm your password.', style: AppType.caption()),
        InlineError(_error),
        const SizedBox(height: 16),
        PrimaryButton('Confirm refund', key: const Key('confirm-refund'), loading: _busy, onPressed: canWrite(context) ? _submit : null),
      ]),
    );
  }
}
