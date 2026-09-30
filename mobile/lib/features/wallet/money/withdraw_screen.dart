import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../core/api/api.dart';
import '../../../core/auth/auth_controller.dart';
import '../../../core/security/secure_screen.dart';
import '../../../shared/offline.dart';
import '../../../shared/step_up.dart';
import '../../../theme/kit.dart';
import '../send/quote_view.dart';
import '../wallet_model.dart';
import '../widgets.dart';

/// Withdraw to a bank account (`/v1/wallet/bank_accounts`, `POST /v1/wallet/withdrawals`).
/// A quote is required when the wallet currency differs from the bank account currency.
class WithdrawScreen extends StatefulWidget {
  const WithdrawScreen({super.key});

  @override
  State<WithdrawScreen> createState() => _WithdrawScreenState();
}

class _WithdrawScreenState extends State<WithdrawScreen> {
  List<Json>? _banks;
  Json? _bank;
  String? _currency;
  final _amount = TextEditingController();
  QuoteState? _quote;
  Json? _result;
  bool _busy = false;
  Object? _error;
  Object? _loadError;
  Timer? _ticker;

  @override
  void initState() {
    super.initState();
    _loadBanks();
  }

  @override
  void dispose() {
    _ticker?.cancel();
    _amount.dispose();
    super.dispose();
  }

  Future<void> _loadBanks({String? select}) async {
    try {
      final banks = ApiList.from(await context.read<Api>().get('/v1/wallet/bank_accounts')).data;
      if (!mounted) return;
      setState(() {
        _banks = banks;
        _loadError = null;
        _bank = banks.where((b) => b.s('id') == (select ?? _bank?.s('id'))).firstOrNull ?? banks.firstOrNull;
      });
    } catch (e) {
      if (mounted) setState(() => _loadError = e);
    }
  }

  bool get _cross => _bank != null && _currency != null && _bank!.s('currency') != _currency;

  void _invalidateQuote() {
    _ticker?.cancel();
    _quote = null;
  }

  Future<void> _getQuote() async {
    final amount = _parsedAmount();
    if (amount == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final q = Json.from(await context.read<Api>().post('/v1/wallet/fx/quotes', body: {'from_currency': _currency, 'to_currency': _bank!.s('currency'), 'amount': amount}) as Map);
      if (!mounted) return;
      setState(() => _quote = QuoteState(q));
      _ticker?.cancel();
      _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
        if (mounted) setState(() {});
      });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  int? _parsedAmount() {
    final cur = _currency;
    if (cur == null || _bank == null) return null;
    final amount = Money.parseInput(_amount.text, cur);
    if (amount == null || amount <= 0) {
      setState(() => _error = 'Enter a valid amount in $cur.');
      return null;
    }
    return amount;
  }

  Future<void> _confirm() async {
    final amount = _parsedAmount();
    if (amount == null) return;
    if (_cross && (_quote == null || _quote!.expired())) return;
    final bank = _bank!;
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Confirm withdrawal'),
        content: Text('Withdraw ${Money.format(amount, _currency!, withCode: true)} to ${bank.s('bank_name')} •••• ${bank.s('last4')}?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(c, true), child: const Text('Withdraw')),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    final api = context.read<Api>();
    final wallet = context.read<WalletModel>();
    try {
      final res = await withStepUp(context, (key) => api.post('/v1/wallet/withdrawals', idempotencyKey: key, body: {
            'currency': _currency,
            'amount': amount,
            'bank_account': bank.s('id'),
            if (_cross) 'quote_id': _quote!.id,
          }));
      if (!mounted) return;
      if (res != null) {
        _ticker?.cancel();
        setState(() => _result = Json.from(res as Map));
        unawaited(wallet.refresh());
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _addBank() async {
    final created = await showModalBottomSheet<Json>(
      context: context,
      isScrollControlled: true,
      builder: (_) => AddBankAccountSheet(holderName: context.read<AuthController>().userName, api: context.read<Api>()),
    );
    if (created != null && mounted) await _loadBanks(select: created.s('id'));
  }

  @override
  Widget build(BuildContext context) {
    final w = context.watch<WalletModel>();
    final online = canWrite(context);
    _currency ??= w.currencies.isNotEmpty ? w.currencies.first : null;
    if (_result != null) {
      return AppPage(
        title: 'Withdraw',
        bottomInset: 24,
        footer: PrimaryButton('Done', onPressed: () => Navigator.of(context).pop(true)),
        children: [TransferResultCard(transfer: _result!, title: 'Withdrawal on its way')],
      );
    }
    final bal = _currency == null ? null : w.balanceFor(_currency!);
    final bankUnverified = _bank != null && _bank!.s('verification_status') != 'verified';
    final canConfirm = online && _bank != null && !bankUnverified && (!_cross || (_quote != null && !_quote!.expired()));
    return SecureScreen(
      child: AppPage(
        title: 'Withdraw',
        subtitle: 'To your bank',
        bottomInset: 24,
        banner: const OfflineBanner(),
        footer: _cross && (_quote == null || _quote!.expired())
            ? PrimaryButton(_quote == null ? 'Get quote' : 'Get a new quote', loading: _busy, onPressed: online && _bank != null ? _getQuote : null)
            : PrimaryButton('Withdraw', key: const Key('withdraw-submit'), loading: _busy, onPressed: canConfirm ? _confirm : null),
        children: [
          const SectionHeader('Bank account', padding: EdgeInsets.fromLTRB(4, 0, 4, 10)),
          if (_banks == null && _loadError == null) const LoadingView(compact: true),
          if (_loadError != null) ErrorView(error: _loadError!, onRetry: _loadBanks),
          if (_banks != null)
            AppCard(
              padding: const EdgeInsets.fromLTRB(16, 6, 16, 6),
              child: Column(children: [
                if (_banks!.isEmpty) Padding(padding: const EdgeInsets.all(12), child: Text('No bank accounts yet.', style: AppType.small(AppColors.muted))),
                for (final b in _banks!)
                  NavRow(
                    icon: Icons.account_balance_outlined,
                    tone: _bank?.s('id') == b.s('id') ? Tone.sage : Tone.neutral,
                    title: '${b.s('bank_name')} •••• ${b.s('last4')}',
                    subtitle: '${b.s('account_holder')} · ${b.s('currency')} · ${b.s('country')}',
                    trailing: _bank?.s('id') == b.s('id')
                        ? const Icon(Icons.radio_button_checked_rounded, color: AppColors.sage700)
                        : const Icon(Icons.radio_button_off_rounded, color: AppColors.faint),
                    onTap: () => setState(() {
                      _bank = b;
                      _invalidateQuote();
                    }),
                  ),
                const Hairline(),
                NavRow(icon: Icons.add_rounded, tone: Tone.lemon, title: 'Add bank account', onTap: online ? _addBank : null),
              ]),
            ),
          if (bankUnverified) ...[
            const SizedBox(height: 10),
            const NoticePanel('This bank account needs verification before you can withdraw to it.', tone: Tone.peach),
          ],
          const SectionHeader('Amount'),
          AppCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              CurrencyDropdown(
                label: 'From balance',
                value: _currency,
                options: w.currencies,
                onChanged: (v) => setState(() {
                  _currency = v;
                  _invalidateQuote();
                }),
              ),
              if (bal != null) ...[
                const SizedBox(height: 6),
                Row(children: [Text('Available ', style: AppType.label()), Flexible(child: AmountText(bal.i('available'), _currency!, size: AmountSize.small))]),
              ],
              const SizedBox(height: 14),
              TextField(
                key: const Key('withdraw-amount'),
                controller: _amount,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                style: AppType.h1().copyWith(fontWeight: FontWeight.w300),
                decoration: InputDecoration(hintText: '0.00', suffixText: _currency),
                onChanged: (_) {
                  if (_quote != null) setState(_invalidateQuote);
                },
              ),
              const SizedBox(height: 10),
              if (!_cross) Text('Any withdrawal fee is calculated by the server and shown on the receipt.', style: AppType.caption()),
              if (_cross) Text('Your bank account is in ${_bank!.s('currency')}; we’ll convert at a quoted rate.', style: AppType.caption()),
            ]),
          ),
          if (_quote != null) ...[
            const SizedBox(height: 14),
            QuoteView(state: _quote!, receiverLabel: 'Your bank receives exactly'),
          ],
          const SizedBox(height: 10),
          Text('Sandbox rail: payouts settle on the next job run. No real money moves.', style: AppType.caption()),
          InlineError(_error),
        ],
      ),
    );
  }
}

class AddBankAccountSheet extends StatefulWidget {
  const AddBankAccountSheet({super.key, required this.holderName, required this.api});

  final String holderName;
  final Api api;

  @override
  State<AddBankAccountSheet> createState() => _AddBankAccountSheetState();
}

class _AddBankAccountSheetState extends State<AddBankAccountSheet> {
  final _bankName = TextEditingController();
  late final _holder = TextEditingController(text: widget.holderName);
  final _number = TextEditingController();
  final _routing = TextEditingController();
  final _country = TextEditingController();
  String _currency = 'USD';
  bool _busy = false;
  Object? _error;

  @override
  void dispose() {
    for (final c in [_bankName, _holder, _number, _routing, _country]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    if (_bankName.text.trim().isEmpty || _number.text.trim().isEmpty || _country.text.trim().length != 2) {
      setState(() => _error = 'Enter the bank name, account number and a 2-letter country code.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final res = await withStepUp(context, (key) => widget.api.post('/v1/wallet/bank_accounts', idempotencyKey: key, body: {
            'country': _country.text.trim().toUpperCase(),
            'currency': _currency,
            'bank_name': _bankName.text.trim(),
            'account_holder': _holder.text.trim(),
            'account_number': _number.text.trim(),
            if (_routing.text.trim().isNotEmpty) 'routing': _routing.text.trim(),
          }));
      if (!mounted) return;
      if (res == null) {
        setState(() => _busy = false);
        return;
      }
      Navigator.of(context).pop(Json.from(res as Map));
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
    return Padding(
      padding: EdgeInsets.fromLTRB(22, 0, 22, 22 + MediaQuery.viewInsetsOf(context).bottom),
      child: SingleChildScrollView(
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('Add bank account', style: AppType.h2()),
          const SizedBox(height: 4),
          Text('The account holder name must match your verified name.', style: AppType.small(AppColors.muted)),
          const SizedBox(height: 14),
          TextField(controller: _bankName, decoration: const InputDecoration(labelText: 'Bank name')),
          const SizedBox(height: 10),
          TextField(controller: _holder, decoration: const InputDecoration(labelText: 'Account holder')),
          const SizedBox(height: 10),
          TextField(controller: _number, keyboardType: TextInputType.text, decoration: const InputDecoration(labelText: 'Account number / IBAN')),
          const SizedBox(height: 10),
          TextField(controller: _routing, decoration: const InputDecoration(labelText: 'Routing / sort code / IFSC (optional)')),
          const SizedBox(height: 10),
          Row(children: [
            Expanded(
              child: TextField(
                controller: _country,
                maxLength: 2,
                textCapitalization: TextCapitalization.characters,
                decoration: const InputDecoration(labelText: 'Country', hintText: 'IN', counterText: ''),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(child: CurrencyDropdown(value: _currency, options: allCurrencies, onChanged: (v) => setState(() => _currency = v ?? _currency))),
          ]),
          InlineError(_error),
          const SizedBox(height: 16),
          PrimaryButton('Save bank account', loading: _busy, onPressed: canWrite(context) ? _submit : null),
        ]),
      ),
    );
  }
}
