import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../core/api/api.dart';
import '../../../core/security/secure_screen.dart';
import '../../../shared/offline.dart';
import '../../../shared/step_up.dart';
import '../../../theme/kit.dart';
import '../wallet_model.dart';
import '../widgets.dart';
import 'quote_view.dart';

enum SendStep { recipient, amount, review, result }

/// Send money: look up the recipient (masked name), choose currencies and amount, review the binding
/// quote (rate, spread, fee, exact amount received, expiry countdown), then confirm.
class SendMoneyScreen extends StatefulWidget {
  const SendMoneyScreen({super.key, this.embedded = false, this.onDone, this.clock});

  /// True when shown as the Send tab (no back button).
  final bool embedded;
  final VoidCallback? onDone;

  /// Test hook for the countdown.
  final DateTime Function()? clock;

  @override
  State<SendMoneyScreen> createState() => SendMoneyScreenState();
}

class SendMoneyScreenState extends State<SendMoneyScreen> {
  SendStep step = SendStep.recipient;
  final _recipient = TextEditingController();
  final _amount = TextEditingController();
  final _note = TextEditingController();
  Json? _match;
  String? _source;
  String? _dest;
  String _purpose = 'Personal support';
  QuoteState? _quote;
  Json? _result;
  bool _busy = false;
  Object? _error;
  Timer? _ticker;

  static const _purposes = ['Personal support', 'Family', 'Gift', 'Rent', 'Services', 'Other'];

  DateTime _now() => widget.clock?.call() ?? DateTime.now();

  @override
  void dispose() {
    _ticker?.cancel();
    _recipient.dispose();
    _amount.dispose();
    _note.dispose();
    super.dispose();
  }

  void _reset() {
    _ticker?.cancel();
    setState(() {
      step = SendStep.recipient;
      _recipient.clear();
      _amount.clear();
      _note.clear();
      _match = null;
      _quote = null;
      _result = null;
      _error = null;
    });
  }

  Future<void> _lookup() async {
    final q = _recipient.text.trim();
    if (q.isEmpty) return;
    setState(() {
      _busy = true;
      _error = null;
      _match = null;
    });
    try {
      final res = Json.from(await context.read<Api>().get('/v1/wallet/recipients/lookup', query: {'q': q}) as Map);
      if (mounted) setState(() => _match = res);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _toAmount(WalletModel w) {
    final currencies = w.currencies;
    setState(() {
      _source ??= currencies.isNotEmpty ? currencies.first : 'USD';
      _dest ??= _source;
      step = SendStep.amount;
      _error = null;
    });
  }

  Future<void> _getQuote() async {
    final src = _source;
    final dst = _dest;
    if (src == null || dst == null) return;
    final amount = Money.parseInput(_amount.text, src);
    if (amount == null || amount <= 0) {
      setState(() => _error = 'Enter a valid amount in $src.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final q = Json.from(await context.read<Api>().post('/v1/wallet/fx/quotes', body: {'from_currency': src, 'to_currency': dst, 'amount': amount}) as Map);
      if (!mounted) return;
      setState(() {
        _quote = QuoteState(q, receivedAt: _now());
        step = SendStep.review;
      });
      _ticker?.cancel();
      _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
        if (mounted && step == SendStep.review) setState(() {});
      });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _confirm() async {
    final q = _quote;
    if (q == null || q.expired(_now())) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    final api = context.read<Api>();
    final wallet = context.read<WalletModel>();
    try {
      final res = await withStepUp(context, (key) => api.post('/v1/wallet/transfers', idempotencyKey: key, body: {
            'recipient': _match!.s('handle'),
            'source_currency': q.from,
            'amount': q.quote.i('source_amount'),
            'destination_currency': q.to,
            if (q.crossCurrency) 'quote_id': q.id,
            'purpose': _purpose,
            if (_note.text.trim().isNotEmpty) 'note': _note.text.trim(),
          }));
      if (!mounted) return;
      if (res == null) {
        setState(() => _busy = false);
        return;
      }
      _ticker?.cancel();
      setState(() {
        _result = Json.from(res as Map);
        step = SendStep.result;
        _busy = false;
      });
      unawaited(wallet.refresh());
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e;
          _busy = false;
        });
      }
    }
  }

  void _back() {
    setState(() {
      _error = null;
      step = switch (step) {
        SendStep.amount => SendStep.recipient,
        SendStep.review => SendStep.amount,
        _ => SendStep.recipient,
      };
    });
    if (step != SendStep.review) _ticker?.cancel();
  }

  @override
  Widget build(BuildContext context) {
    final w = context.watch<WalletModel>();
    final online = canWrite(context);
    final Widget? footer;
    final List<Widget> body;
    switch (step) {
      case SendStep.recipient:
        body = _recipientStep(w);
        footer = PrimaryButton(
          'Continue',
          key: const Key('send-continue'),
          onPressed: _match != null && w.activated ? () => _toAmount(w) : null,
        );
      case SendStep.amount:
        body = _amountStep(w);
        footer = PrimaryButton('Review', key: const Key('send-review'), loading: _busy, onPressed: online ? _getQuote : null);
      case SendStep.review:
        final expired = _quote?.expired(_now()) ?? true;
        body = _reviewStep();
        footer = expired
            ? PrimaryButton('Get a new quote', key: const Key('send-requote'), icon: Icons.refresh_rounded, loading: _busy, onPressed: online ? _getQuote : null)
            : PrimaryButton('Confirm and send', key: const Key('send-confirm'), icon: Icons.lock_outline_rounded, loading: _busy, onPressed: online ? _confirm : null);
      case SendStep.result:
        body = [TransferResultCard(transfer: _result!, title: 'Sent')];
        footer = Row(children: [
          Expanded(child: SecondaryButton('Send again', onPressed: _reset)),
          const SizedBox(width: 10),
          Expanded(
            child: PrimaryButton('View activity', onPressed: () {
              _reset();
              if (widget.onDone != null) {
                widget.onDone!();
              } else {
                Navigator.of(context).pop(true);
              }
            }),
          ),
        ]);
    }
    final titles = {
      SendStep.recipient: 'Send money',
      SendStep.amount: 'How much?',
      SendStep.review: 'Review',
      SendStep.result: 'Done',
    };
    return SecureScreen(
      child: AppPage(
        title: titles[step]!,
        subtitle: 'Step ${step.index + 1} of 4',
        leading: step == SendStep.recipient || step == SendStep.result
            ? (widget.embedded ? null : CircleIconButton(Icons.close_rounded, tooltip: 'Close', onPressed: () => Navigator.of(context).maybePop()))
            : CircleIconButton(Icons.arrow_back_rounded, tooltip: 'Back', onPressed: _back),
        banner: const OfflineBanner(),
        bottomInset: widget.embedded ? 110 : 24,
        footer: widget.embedded ? Padding(padding: const EdgeInsets.only(bottom: 82), child: footer) : footer,
        children: [...body, InlineError(_error)],
      ),
    );
  }

  List<Widget> _recipientStep(WalletModel w) {
    return [
      if (w.loaded && !w.activated)
        const Padding(
          padding: EdgeInsets.only(bottom: 12),
          child: NoticePanel('Activate your wallet on the Wallet tab before sending money.', tone: Tone.peach),
        ),
      AppCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('Recipient', style: AppType.label()),
          const SizedBox(height: 10),
          TextField(
            key: const Key('send-recipient'),
            controller: _recipient,
            keyboardType: TextInputType.emailAddress,
            textInputAction: TextInputAction.search,
            onSubmitted: (_) => _lookup(),
            decoration: InputDecoration(
              hintText: '@handle or email',
              prefixIcon: const Icon(Icons.alternate_email_rounded, color: AppColors.muted),
              suffixIcon: _busy
                  ? const Padding(padding: EdgeInsets.all(14), child: SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)))
                  : IconButton(key: const Key('send-find'), tooltip: 'Find', icon: const Icon(Icons.search_rounded), onPressed: _lookup),
            ),
          ),
          if (_match != null) ...[
            const SizedBox(height: 14),
            InnerPanel(
              key: const Key('recipient-match'),
              child: Row(children: [
                CircleAvatar(
                  radius: 22,
                  backgroundColor: AppColors.sage100,
                  child: Text(_match!.s('display_name', '?')[0], style: AppType.h3(AppColors.sage700)),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(_match!.s('display_name'), style: AppType.bodyMedium()),
                    Text('${_match!.s('handle')} · ${_match!.s('type') == 'org' ? 'Business' : 'Personal'}', style: AppType.label()),
                  ]),
                ),
                const Icon(Icons.check_circle_rounded, color: AppColors.sage700),
              ]),
            ),
            const SizedBox(height: 8),
            Text('Check the name before you continue. We only show a masked name for privacy.', style: AppType.caption()),
          ],
        ]),
      ),
    ];
  }

  List<Widget> _amountStep(WalletModel w) {
    final src = _source ?? 'USD';
    final bal = w.balanceFor(src);
    return [
      AppCard(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
        child: Row(children: [
          CircleAvatar(radius: 18, backgroundColor: AppColors.sage100, child: Text(_match!.s('display_name', '?')[0], style: AppType.bodyMedium(AppColors.sage700))),
          const SizedBox(width: 12),
          Expanded(child: Text('To ${_match!.s('display_name')} · ${_match!.s('handle')}', style: AppType.body(AppColors.text2))),
        ]),
      ),
      const SizedBox(height: 12),
      AppCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          CurrencyDropdown(
            key: const Key('send-source'),
            label: 'From balance',
            value: _source,
            options: w.currencies.isEmpty ? allCurrencies : w.currencies,
            onChanged: (v) => setState(() => _source = v),
          ),
          if (bal != null) ...[
            const SizedBox(height: 6),
            Row(children: [
              Text('Available ', style: AppType.label()),
              Flexible(child: AmountText(bal.i('available'), src, size: AmountSize.small)),
            ]),
          ],
          const SizedBox(height: 14),
          TextField(
            key: const Key('send-amount'),
            controller: _amount,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            style: AppType.h1().copyWith(fontWeight: FontWeight.w300),
            decoration: InputDecoration(hintText: '0.00', suffixText: src, fillColor: AppColors.surface2),
          ),
          const SizedBox(height: 14),
          CurrencyDropdown(
            key: const Key('send-dest'),
            label: 'Recipient receives in',
            value: _dest,
            options: allCurrencies,
            helper: _dest != null && _dest != _source ? 'Converted at a quoted rate you see before confirming.' : null,
            onChanged: (v) => setState(() => _dest = v),
          ),
        ]),
      ),
      const SizedBox(height: 12),
      AppCard(
        child: Column(children: [
          DropdownButtonFormField<String>(
            value: _purpose,
            decoration: const InputDecoration(labelText: 'Purpose'),
            items: [for (final p in _purposes) DropdownMenuItem(value: p, child: Text(p))],
            onChanged: (v) => setState(() => _purpose = v ?? _purpose),
          ),
          const SizedBox(height: 12),
          TextField(controller: _note, maxLength: 140, decoration: const InputDecoration(labelText: 'Note (optional)', counterText: '')),
        ]),
      ),
    ];
  }

  List<Widget> _reviewStep() {
    final q = _quote!;
    return [
      AppCard(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
        child: Row(children: [
          FlagStack([Money.countryFor(q.from), Money.countryFor(q.to)], size: 30),
          const SizedBox(width: 12),
          Expanded(child: Text('To ${_match!.s('display_name')} · ${_match!.s('handle')}', style: AppType.body(AppColors.text2))),
        ]),
      ),
      const SizedBox(height: 12),
      QuoteView(state: q, now: _now()),
      const SizedBox(height: 12),
      InnerPanel(
        color: AppColors.surface,
        child: Column(children: [
          KeyValueRow('Purpose', value: _purpose),
          if (_note.text.trim().isNotEmpty) KeyValueRow('Note', value: _note.text.trim()),
        ]),
      ),
      const SizedBox(height: 10),
      Text('Transfers are screened before they complete. Some may need additional review.', style: AppType.caption()),
    ];
  }
}
