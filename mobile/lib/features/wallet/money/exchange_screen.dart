import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../core/api/api.dart';
import '../../../core/flags/feature_flags.dart';
import '../../../core/offline/online_status.dart';
import '../../../core/security/app_lock.dart';
import '../../../core/security/biometrics.dart';
import '../../../core/security/secure_screen.dart';
import '../../../shared/offline.dart';
import '../../../shared/step_up.dart';
import '../../../theme/kit.dart';
import '../../common/navigation.dart';
import '../activity/transfer_detail_screen.dart';
import '../send/quote_view.dart';
import '../wallet_model.dart';
import '../widgets.dart';

enum ExchangeStep { amount, review, result }

/// Convert between your own balances: binding quote (`POST /v1/wallet/fx/quotes`) with rate, fee, amount
/// received and a live expiry countdown, then `POST /v1/wallet/exchanges {quote_id}`.
///
/// Each quote gets its own Idempotency-Key, reused if the user retries the same confirmation (after a
/// network failure or step-up) so a conversion can never be applied twice. Gated by the `wallet_exchange`
/// feature flag.
class ExchangeScreen extends StatefulWidget {
  const ExchangeScreen({super.key, this.clock});

  /// Test hook for the countdown.
  final DateTime Function()? clock;

  @override
  State<ExchangeScreen> createState() => ExchangeScreenState();
}

class ExchangeScreenState extends State<ExchangeScreen> {
  /// Quotes refreshed automatically when they expire on the review step before asking the user.
  static const maxAutoRequotes = 3;

  ExchangeStep step = ExchangeStep.amount;
  String? _from;
  String? _to;
  final _amount = TextEditingController();
  QuoteState? _quote;
  String? _attemptKey;
  int _autoRequotes = 0;
  bool _requoted = false;
  Json? _result;
  List<Json> _resultRows = [];
  bool _rowsLoading = false;
  bool _busy = false;
  Object? _error;
  Timer? _ticker;

  DateTime _now() => widget.clock?.call() ?? DateTime.now();

  @override
  void dispose() {
    _ticker?.cancel();
    _amount.dispose();
    super.dispose();
  }

  void _startTicker() {
    _ticker?.cancel();
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) => _tick());
  }

  void _tick() {
    if (!mounted || step != ExchangeStep.review) return;
    final q = _quote;
    if (q != null && q.expired(_now()) && !_busy && _autoRequotes < maxAutoRequotes && context.read<OnlineStatus>().isOnline) {
      _autoRequotes++;
      _getQuote(auto: true);
      return;
    }
    setState(() {});
  }

  Future<void> _getQuote({bool auto = false}) async {
    final from = _from, to = _to;
    if (from == null || to == null) return;
    if (from == to) {
      setState(() => _error = 'Choose two different currencies.');
      return;
    }
    final amount = Money.parseInput(_amount.text, from);
    if (amount == null || amount <= 0) {
      setState(() => _error = 'Enter a valid amount in $from.');
      return;
    }
    if (!auto) _autoRequotes = 0;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final q = Json.from(await context.read<Api>().post('/v1/wallet/fx/quotes', body: {'from_currency': from, 'to_currency': to, 'amount': amount}) as Map);
      if (!mounted) return;
      final hadQuote = _quote != null && step == ExchangeStep.review;
      setState(() {
        _quote = QuoteState(q, receivedAt: _now());
        _attemptKey = newUuid();
        _requoted = hadQuote;
        step = ExchangeStep.review;
      });
      _startTicker();
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Biometric confirmation when the app lock uses biometrics; the API may additionally ask for a
  /// password step-up, which [withStepUp] handles with the same Idempotency-Key.
  Future<bool> _confirmIdentity() async {
    final lock = context.read<AppLock>();
    if (!(lock.enabled && lock.biometricsAvailable)) return true;
    return context.read<Biometrics>().authenticate('Confirm the exchange');
  }

  Future<void> _confirm() async {
    final q = _quote;
    final key = _attemptKey;
    if (q == null || key == null || q.expired(_now()) || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    final api = context.read<Api>();
    final wallet = context.read<WalletModel>();
    try {
      if (!await _confirmIdentity()) {
        if (mounted) setState(() => _busy = false);
        return;
      }
      if (!mounted) return;
      final res = await withStepUp(context, (k) => api.post('/v1/wallet/exchanges', idempotencyKey: k, body: {'quote_id': q.id}), idempotencyKey: key);
      if (!mounted) return;
      if (res == null) {
        setState(() => _busy = false);
        return;
      }
      _ticker?.cancel();
      setState(() {
        _result = Json.from(res as Map);
        step = ExchangeStep.result;
        _busy = false;
        _rowsLoading = true;
      });
      await wallet.refresh();
      await _loadResultRows();
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      if (e.code == 'quote_expired' || e.code == 'quote_used') {
        // The quote can't be used any more: fetch a fresh one for the user to review.
        await _getQuote();
        if (mounted) setState(() => _error = 'That quote is no longer valid. Check the new quote before confirming.');
      } else {
        setState(() => _error = e);
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

  /// The ledger rows the exchange produced, as they appear in Activity.
  Future<void> _loadResultRows() async {
    final id = _result?.s('id');
    try {
      final res = ApiList.from(await context.read<Api>().get('/v1/wallet/transactions', query: {'limit': '20'}));
      if (!mounted) return;
      setState(() {
        _resultRows = res.data.where((t) => t.s('id') == id).toList();
        _rowsLoading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _rowsLoading = false);
    }
  }

  void _back() {
    _ticker?.cancel();
    setState(() {
      step = ExchangeStep.amount;
      _error = null;
      _requoted = false;
    });
  }

  void _reset() {
    _ticker?.cancel();
    setState(() {
      step = ExchangeStep.amount;
      _amount.clear();
      _quote = null;
      _attemptKey = null;
      _result = null;
      _resultRows = [];
      _error = null;
      _requoted = false;
    });
  }

  void _swap() {
    final mine = context.read<WalletModel>().currencies;
    if (_to == null || !mine.contains(_to)) return;
    setState(() {
      final f = _from;
      _from = _to;
      _to = f;
      _error = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final w = context.watch<WalletModel>();
    final flags = context.watch<FeatureFlags>();
    final online = canWrite(context);
    final mine = w.currencies;
    _from ??= mine.isNotEmpty ? mine.first : null;
    if (_from != null && !mine.contains(_from) && mine.isNotEmpty) _from = mine.first;
    _to ??= allCurrencies.firstWhere((c) => c != _from, orElse: () => 'EUR');
    if (_to == _from) _to = allCurrencies.firstWhere((c) => c != _from, orElse: () => 'EUR');

    final enabled = !flags.loaded || flags.isOn(FeatureFlags.walletExchange);
    Widget? footer;
    List<Widget> body;
    if (!enabled && step != ExchangeStep.result) {
      body = [
        const NoticePanel('Converting between your balances isn’t available for your account right now.', title: 'Exchange unavailable', icon: Icons.block_rounded, tone: Tone.peach),
      ];
    } else {
      switch (step) {
        case ExchangeStep.amount:
          body = _amountStep(w);
          footer = PrimaryButton('Get quote', key: const Key('exchange-quote'), icon: Icons.currency_exchange_rounded, loading: _busy, onPressed: online && mine.isNotEmpty ? _getQuote : null);
        case ExchangeStep.review:
          final q = _quote!;
          final expired = q.expired(_now());
          final bal = w.balanceFor(q.from);
          final needed = q.quote.i('source_amount') + q.quote.i('fee_amount');
          final short = bal != null && bal.i('available') < needed;
          body = _reviewStep(q, bal, needed, short);
          footer = expired
              ? PrimaryButton('Get a new quote', key: const Key('exchange-requote'), icon: Icons.refresh_rounded, loading: _busy, onPressed: online ? () => _getQuote() : null)
              : PrimaryButton('Confirm exchange', key: const Key('exchange-confirm'), icon: Icons.lock_outline_rounded, loading: _busy, onPressed: online && !short ? _confirm : null);
        case ExchangeStep.result:
          body = _resultStep(w);
          footer = Row(children: [
            Expanded(child: SecondaryButton('Exchange again', onPressed: _reset)),
            const SizedBox(width: 10),
            Expanded(child: PrimaryButton('Done', key: const Key('exchange-done'), onPressed: () => Navigator.of(context).pop(true))),
          ]);
      }
    }
    final titles = {ExchangeStep.amount: 'Exchange', ExchangeStep.review: 'Review', ExchangeStep.result: 'Done'};
    return SecureScreen(
      child: AppPage(
        title: titles[step]!,
        subtitle: 'Convert between your balances',
        bottomInset: 24,
        leading: step == ExchangeStep.review
            ? CircleIconButton(Icons.arrow_back_rounded, tooltip: 'Back', onPressed: _back)
            : CircleIconButton(Icons.arrow_back_rounded, tooltip: 'Back', onPressed: () => Navigator.of(context).pop(_result != null)),
        banner: const OfflineBanner(),
        footer: footer,
        children: [...body, InlineError(_error)],
      ),
    );
  }

  List<Widget> _amountStep(WalletModel w) {
    final mine = w.currencies;
    final from = _from;
    final bal = from == null ? null : w.balanceFor(from);
    if (mine.isEmpty) {
      return [
        const AppCard(child: EmptyView(title: 'No balances yet', message: 'Add money first, then convert it between currencies here.', icon: Icons.account_balance_wallet_outlined)),
      ];
    }
    return [
      AppCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          CurrencyDropdown(
            key: const Key('exchange-from'),
            label: 'From balance',
            value: _from,
            options: mine,
            onChanged: (v) => setState(() {
              _from = v;
              if (_to == v) _to = allCurrencies.firstWhere((c) => c != v, orElse: () => 'EUR');
            }),
          ),
          if (bal != null) ...[
            const SizedBox(height: 6),
            Row(children: [
              Text('Available ', style: AppType.label()),
              Flexible(child: AmountText(bal.i('available'), from!, size: AmountSize.small)),
            ]),
          ],
          const SizedBox(height: 14),
          TextField(
            key: const Key('exchange-amount'),
            controller: _amount,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            style: AppType.h1().copyWith(fontWeight: FontWeight.w300),
            onSubmitted: (_) => _getQuote(),
            decoration: InputDecoration(hintText: '0.00', suffixText: from, fillColor: AppColors.surface2),
          ),
          const SizedBox(height: 6),
          Center(
            child: CircleIconButton(
              Icons.swap_vert_rounded,
              key: const Key('exchange-swap'),
              tooltip: 'Swap currencies',
              size: 40,
              onPressed: _to != null && mine.contains(_to) ? _swap : null,
            ),
          ),
          const SizedBox(height: 6),
          CurrencyDropdown(
            key: const Key('exchange-to'),
            label: 'To',
            value: _to,
            options: allCurrencies.where((c) => c != _from).toList(),
            helper: 'You’ll see the exact rate before confirming.',
            onChanged: (v) => setState(() => _to = v),
          ),
        ]),
      ),
      const SizedBox(height: 12),
      Row(children: [
        FlagStack([Money.countryFor(_from ?? ''), Money.countryFor(_to ?? '')], size: 28),
        const SizedBox(width: 10),
        Expanded(child: Text('Quotes are held for a few minutes. Nothing moves until you confirm.', style: AppType.caption())),
      ]),
    ];
  }

  List<Widget> _reviewStep(QuoteState q, Json? bal, int needed, bool short) {
    return [
      AppCard(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
        child: Row(children: [
          FlagStack([Money.countryFor(q.from), Money.countryFor(q.to)], size: 30),
          const SizedBox(width: 12),
          Expanded(child: Text('${q.from} → ${q.to}', style: AppType.body(AppColors.text2))),
          if (_requoted) const AppChip('New quote', key: Key('exchange-new-quote'), tone: Tone.sage, icon: Icons.refresh_rounded, dense: true),
        ]),
      ),
      const SizedBox(height: 12),
      QuoteView(state: q, now: _now(), receiverLabel: 'You get exactly'),
      const SizedBox(height: 12),
      InnerPanel(
        color: AppColors.surface,
        child: Column(children: [
          KeyValueRow('Total from ${q.from}', child: AmountText(needed, q.from, size: AmountSize.small, key: const Key('exchange-total'))),
          if (bal != null) KeyValueRow('Available', child: AmountText(bal.i('available'), q.from, size: AmountSize.small)),
        ]),
      ),
      if (short) ...[
        const SizedBox(height: 12),
        NoticePanel('Your ${q.from} balance doesn’t cover this exchange including fees. Go back and enter a smaller amount.', tone: Tone.rose, icon: Icons.info_outline_rounded),
      ],
      if (q.expired(_now()) && _autoRequotes >= maxAutoRequotes) ...[
        const SizedBox(height: 12),
        const NoticePanel('This quote expired. Get a new quote to see the current rate.', icon: Icons.timer_off_outlined),
      ],
      const SizedBox(height: 10),
      Text('Exchanges between your own balances complete instantly and can’t be reversed.', style: AppType.caption()),
    ];
  }

  List<Widget> _resultStep(WalletModel w) {
    final t = _result!;
    final from = t.s('source_currency');
    final to = t.s('destination_currency');
    final fromBal = w.balanceFor(from);
    final toBal = w.balanceFor(to);
    return [
      TransferResultCard(transfer: t, title: 'Exchanged'),
      const SectionHeader('Balances now'),
      AppCard(
        child: Column(children: [
          for (final (cur, b) in [(from, fromBal), (to, toBal)])
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Row(children: [
                FlagAvatar(Money.countryFor(cur), size: 30),
                const SizedBox(width: 12),
                Expanded(child: Text(cur, style: AppType.label())),
                Flexible(
                  child: w.loading && b == null
                      ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                      : AmountText(b?.i('available') ?? 0, cur, size: AmountSize.medium, key: Key('exchange-balance-$cur')),
                ),
              ]),
            ),
        ]),
      ),
      const SectionHeader('Transactions'),
      if (_rowsLoading)
        const LoadingView(compact: true)
      else if (_resultRows.isEmpty)
        AppCard(child: Text('The exchange will appear in Activity shortly.', style: AppType.small(AppColors.muted)))
      else
        AppCard(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
          child: Column(children: [
            for (var i = 0; i < _resultRows.length; i++) ...[
              if (i > 0) const Hairline(),
              WalletTxRow(
                key: Key('exchange-row-${_resultRows[i].s('id')}'),
                tx: _resultRows[i],
                onTap: () => push(context, TransferDetailScreen(id: _resultRows[i].s('id'), summary: _resultRows[i])),
              ),
            ],
          ]),
        ),
    ];
  }
}
