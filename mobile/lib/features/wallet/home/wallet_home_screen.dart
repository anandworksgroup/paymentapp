import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../core/api/api.dart';
import '../../../core/auth/auth_controller.dart';
import '../../../core/cache/cache_store.dart';
import '../../../core/flags/feature_flags.dart';
import '../../../core/security/secure_screen.dart';
import '../../../shared/offline.dart';
import '../../../theme/kit.dart';
import '../../common/mode_switcher.dart';
import '../../common/navigation.dart';
import '../../common/notification_center.dart';
import '../../common/notifications_screen.dart';
import '../activity/transfer_detail_screen.dart';
import '../kyc/kyc_screen.dart';
import '../money/add_money_screen.dart';
import '../money/exchange_screen.dart';
import '../money/receive_screen.dart';
import '../money/withdraw_screen.dart';
import '../wallet_model.dart';
import '../widgets.dart';

class WalletHomeScreen extends StatefulWidget {
  const WalletHomeScreen({super.key, required this.onOpenTab});

  final ValueChanged<int> onOpenTab;

  @override
  State<WalletHomeScreen> createState() => _WalletHomeScreenState();
}

class _WalletHomeScreenState extends State<WalletHomeScreen> {
  int _selected = 0;
  List<Json> _recent = [];
  Object? _recentError;
  bool _recentLoading = true;

  @override
  void initState() {
    super.initState();
    _loadRecent();
  }

  Future<void> _loadRecent() async {
    final auth = context.read<AuthController>();
    final cache = context.read<CacheStore>();
    final key = auth.cacheKey('wallet.recent');
    if (_recent.isEmpty) {
      final c = await cache.read(key);
      if (c is List && mounted) setState(() => _recent = c.whereType<Map>().map((e) => Json.from(e)).toList());
    }
    if (!mounted) return;
    try {
      final res = ApiList.from(await context.read<Api>().get('/v1/wallet/transactions', query: {'limit': '20'}));
      await cache.write(key, res.data);
      if (mounted) {
        setState(() {
          _recent = res.data;
          _recentError = null;
          _recentLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _recentError = e;
          _recentLoading = false;
        });
      }
    }
  }

  Future<void> _refresh() async {
    final w = context.read<WalletModel>();
    final notifications = context.read<NotificationCenter>();
    final flags = context.read<FeatureFlags>();
    await Future.wait([w.refresh(), _loadRecent(), notifications.refresh(), flags.refresh()]);
  }

  Future<void> _open(Widget screen) async {
    final changed = await pushWithWallet<bool>(context, screen);
    if (changed == true && mounted) await _refresh();
  }

  @override
  Widget build(BuildContext context) {
    final w = context.watch<WalletModel>();
    final auth = context.watch<AuthController>();
    final online = canWrite(context);
    final exchangeOn = context.watch<FeatureFlags>().isOn(FeatureFlags.walletExchange);
    final notifications = context.watch<NotificationCenter>();
    final unread = notifications.unread;
    final List<Widget> children;
    if (!w.loaded && w.loading) {
      children = [const LoadingView()];
    } else if (!w.loaded && w.error != null) {
      children = [ErrorView(error: w.error!, onRetry: w.refresh)];
    } else if (w.loaded && !w.activated) {
      children = [_activation(w, online)];
    } else if (w.loaded) {
      final balances = w.balances;
      final sel = balances.isEmpty ? 0 : _selected.clamp(0, balances.length - 1);
      children = [
        if (w.fromCache && w.error != null) const Padding(padding: EdgeInsets.only(bottom: 12), child: CachedDataNotice()),
        if (w.status != 'active')
          const Padding(
            padding: EdgeInsets.only(bottom: 12),
            child: NoticePanel('This wallet requires additional review. Some actions are unavailable.', tone: Tone.peach, icon: Icons.hourglass_top_rounded),
          ),
        _totalCard(w),
        const SizedBox(height: 16),
        if (balances.isNotEmpty)
          PaymentCardStack(
            selected: sel,
            onSelect: (i) => setState(() => _selected = i),
            cards: [
              for (var i = 0; i < balances.length; i++)
                PaymentCard(
                  key: Key('card-${balances[i].s('currency')}'),
                  style: PaymentCardStyle.values[i % 3 == 0 ? 0 : i % 3 == 1 ? 2 : 1],
                  currency: balances[i].s('currency'),
                  available: balances[i].i('available'),
                  maskedDigits: w.maskedDigits,
                  country: Money.countryFor(balances[i].s('currency')),
                ),
            ],
          ),
        if (balances.isNotEmpty) ...[
          const SizedBox(height: 12),
          _selectedDetails(balances[sel]),
        ],
        const SizedBox(height: 18),
        Row(children: [
          Expanded(child: QuickAction(icon: Icons.add_rounded, label: 'Add money', highlight: true, onTap: online ? () => _open(const AddMoneyScreen()) : null)),
          Expanded(child: QuickAction(icon: Icons.north_east_rounded, label: 'Send', onTap: online ? () => widget.onOpenTab(1) : null)),
          Expanded(child: QuickAction(icon: Icons.qr_code_rounded, label: 'Receive', onTap: () => _open(const ReceiveScreen()))),
          if (exchangeOn)
            Expanded(
              child: QuickAction(key: const Key('quick-exchange'), icon: Icons.currency_exchange_rounded, label: 'Exchange', onTap: online ? () => _open(const ExchangeScreen()) : null),
            ),
          Expanded(child: QuickAction(icon: Icons.account_balance_outlined, label: 'Withdraw', onTap: online ? () => _open(const WithdrawScreen()) : null)),
        ]),
        SectionHeader('Recent activity', action: 'See all', onAction: () => widget.onOpenTab(2)),
        _recentCard(),
      ];
    } else {
      children = [const LoadingView()];
    }

    return SecureScreen(
      child: AppPage(
        title: 'Global Wallet',
        subtitle: w.handle.isEmpty ? auth.userName : w.handle,
        onRefresh: _refresh,
        banner: const OfflineBanner(),
        actions: [
          CircleIconButton(
            Icons.notifications_none_rounded,
            key: const Key('notifications-bell'),
            tooltip: 'Notifications',
            badgeCount: unread,
            badgePlus: notifications.unreadMayBeMore,
            onPressed: () => push(context, const NotificationsScreen(businessMode: false)),
          ),
        ],
        children: [
          Wrap(spacing: 8, runSpacing: 8, children: [
            if (auth.canSwitchMode) const ModeChip(),
            const AppChip('Sandbox rails', tone: Tone.peach, icon: Icons.science_outlined, dense: true),
          ]),
          const SizedBox(height: 14),
          ...children,
        ],
      ),
    );
  }

  Widget _totalCard(WalletModel w) {
    return AppCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('Estimated total', style: AppType.label()),
        const SizedBox(height: 6),
        AmountText(w.data!.i('estimated_total_usd'), 'USD', size: AmountSize.hero, key: const Key('wallet-total')),
        const SizedBox(height: 8),
        Row(children: [
          AppChip('${w.balances.length} ${w.balances.length == 1 ? 'currency' : 'currencies'}', dense: true),
          const SizedBox(width: 8),
          Expanded(child: Text(w.data!.s('estimate_note'), style: AppType.caption(), maxLines: 2)),
        ]),
      ]),
    );
  }

  Widget _selectedDetails(Json b) {
    final cur = b.s('currency');
    return InnerPanel(
      color: AppColors.surface,
      child: Row(children: [
        Expanded(child: _mini('Held', b.i('held'), cur)),
        Container(width: 1, height: 34, color: AppColors.line),
        const SizedBox(width: 14),
        Expanded(child: _mini('Incoming', b.i('pending_incoming'), cur)),
      ]),
    );
  }

  Widget _mini(String label, int amount, String cur) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: AppType.label()),
        const SizedBox(height: 4),
        AmountText(amount, cur, size: AmountSize.small),
      ]);

  Widget _recentCard() {
    if (_recent.isEmpty && _recentLoading) return const LoadingView(compact: true);
    if (_recent.isEmpty && _recentError != null) return ErrorView(error: _recentError!, onRetry: _loadRecent);
    if (_recent.isEmpty) {
      return const AppCard(child: EmptyView(title: 'No activity yet', message: 'Add money or ask someone to send you money.', icon: Icons.receipt_long_outlined));
    }
    final shown = _recent.take(5).toList();
    return AppCard(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
      child: Column(children: [
        for (var i = 0; i < shown.length; i++) ...[
          if (i > 0) const Hairline(),
          WalletTxRow(tx: shown[i], history: _recent, onTap: () => push(context, TransferDetailScreen(id: shown[i].s('id'), summary: shown[i]))),
        ],
      ]),
    );
  }

  Widget _activation(WalletModel w, bool online) {
    final verified = w.kycLevel >= 1 && w.kycStatus == 'VERIFIED';
    final review = w.kycStatus == 'REVIEW';
    return Column(children: [
      AppCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          PaymentCard(style: PaymentCardStyle.glass, currency: 'USD', available: 0, maskedDigits: '•••• •••• ••••', caption: 'Global Wallet', country: 'US'),
          const SizedBox(height: 18),
          Text(verified ? 'Activate your wallet' : 'Verify your identity', style: AppType.h2()),
          const SizedBox(height: 6),
          Text(
            review
                ? 'We’re reviewing your details. This usually takes less than a day.'
                : verified
                    ? 'You’re verified. Activate to hold, send and receive money in multiple currencies.'
                    : 'To keep everyone safe we verify every wallet holder. It takes about two minutes.',
            style: AppType.body(AppColors.text2),
          ),
          const SizedBox(height: 10),
          Wrap(spacing: 6, children: [
            AppChip('KYC level ${w.kycLevel}', dense: true, tone: Tone.neutral),
            StatusPill(w.kycStatus),
          ]),
          const SizedBox(height: 18),
          if (verified)
            _ActivateButton(online: online)
          else if (!review)
            PrimaryButton(
              'Start verification',
              key: const Key('start-kyc'),
              icon: Icons.verified_user_outlined,
              onPressed: online ? () => _open(const KycScreen(level: 1, activateAfter: true)) : null,
            ),
        ]),
      ),
    ]);
  }
}

class _ActivateButton extends StatefulWidget {
  const _ActivateButton({required this.online});

  final bool online;

  @override
  State<_ActivateButton> createState() => _ActivateButtonState();
}

class _ActivateButtonState extends State<_ActivateButton> {
  bool _busy = false;
  Object? _error;

  Future<void> _activate() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await context.read<WalletModel>().activate();
      if (mounted) await context.read<AuthController>().reloadWallet();
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(children: [
      PrimaryButton('Activate wallet', key: const Key('activate-wallet'), loading: _busy, onPressed: widget.online ? _activate : null),
      InlineError(_error),
    ]);
  }
}
