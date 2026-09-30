import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../../core/api/api.dart';
import '../../../core/auth/auth_controller.dart';
import '../../../core/cache/cache_store.dart';
import '../../../core/format/dates.dart';
import '../../../shared/offline.dart';
import '../../../theme/kit.dart';
import '../../common/mode_switcher.dart';
import '../../common/navigation.dart';
import '../../common/notifications_screen.dart';
import '../more/disputes_screen.dart';
import '../more/payouts_screen.dart';
import '../payments/payment_detail_screen.dart';
import '../payments/payments_screen.dart';
import '../subscriptions/subscriptions_screen.dart';
import '../widgets.dart';

enum _Period { d7, d14, d30, custom }

/// Business home: balance hero, revenue chart with period chips and day scrubber, MRR and subscribers,
/// attention items and recent payments. Summaries are cached for offline viewing.
class BusinessHomeScreen extends StatefulWidget {
  const BusinessHomeScreen({super.key, required this.onOpenTab});

  final ValueChanged<int> onOpenTab;

  @override
  State<BusinessHomeScreen> createState() => _BusinessHomeScreenState();
}

class _BusinessHomeScreenState extends State<BusinessHomeScreen> {
  _Period _period = _Period.d7;
  DateTimeRange? _custom;
  int? _selectedDay;
  int _currencyIndex = 0;

  Json? _balance;
  Json? _dashboard;
  List<Json> _attention = [];
  List<Json> _recent = [];
  bool _loading = true;
  bool _chartLoading = false;
  bool _fromCache = false;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _loadCached().then((_) => _reload());
  }

  String get _periodKey => _period == _Period.custom && _custom != null
      ? 'custom-${_custom!.start.toIso8601String()}-${_custom!.end.toIso8601String()}'
      : _period.name;

  /// Day buckets are UTC dates, matching the API's `series[].date` grouping.
  DateTimeRange _range() {
    final now = DateTime.now().toUtc();
    final endDay = DateTime.utc(now.year, now.month, now.day);
    switch (_period) {
      case _Period.d7:
        return DateTimeRange(start: endDay.subtract(const Duration(days: 6)), end: endDay);
      case _Period.d14:
        return DateTimeRange(start: endDay.subtract(const Duration(days: 13)), end: endDay);
      case _Period.d30:
        return DateTimeRange(start: endDay.subtract(const Duration(days: 29)), end: endDay);
      case _Period.custom:
        return _custom ?? DateTimeRange(start: endDay.subtract(const Duration(days: 6)), end: endDay);
    }
  }

  Future<void> _loadCached() async {
    final auth = context.read<AuthController>();
    final cache = context.read<CacheStore>();
    final home = await cache.read(auth.cacheKey('home'));
    final dash = await cache.read(auth.cacheKey('dashboard.$_periodKey'));
    if (!mounted) return;
    setState(() {
      if (home is Map) {
        final h = Json.from(home);
        _balance = h.obj('balance');
        _attention = h.list('attention');
        _recent = h.list('recent');
        _fromCache = true;
      }
      if (dash is Map) _dashboard = Json.from(dash);
    });
  }

  Future<Json> _fetchDashboard(Api api) async {
    final r = _range();
    final from = r.start.toIso8601String();
    final to = r.end.add(const Duration(days: 1)).toIso8601String();
    return Json.from(await api.get('/v1/reports/dashboard', query: {'from': from, 'to': to}) as Map);
  }

  Future<void> _reload() async {
    final api = context.read<Api>();
    final auth = context.read<AuthController>();
    final cache = context.read<CacheStore>();
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait([
        api.get('/v1/balance'),
        _fetchDashboard(api),
        api.get('/v1/reports/attention'),
        api.get('/v1/payments', query: {'limit': '20'}),
      ]);
      final balance = Json.from(results[0] as Map);
      final dash = results[1] as Json;
      final attention = Json.from(results[2] as Map).list('items');
      final recent = ApiList.from(results[3]).data;
      await cache.write(auth.cacheKey('home'), {'balance': balance, 'attention': attention, 'recent': recent});
      await cache.write(auth.cacheKey('dashboard.$_periodKey'), dash);
      if (!mounted) return;
      setState(() {
        _balance = balance;
        _dashboard = dash;
        _attention = attention;
        _recent = recent;
        _fromCache = false;
        _loading = false;
        _selectedDay = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e;
        _loading = false;
      });
    }
  }

  Future<void> _changePeriod(_Period p) async {
    if (p == _Period.custom) {
      final now = DateTime.now();
      final picked = await showDateRangePicker(
        context: context,
        firstDate: now.subtract(const Duration(days: 365)),
        lastDate: now,
        initialDateRange: _custom,
        helpText: 'Choose up to 31 days',
      );
      if (picked == null || !mounted) return;
      if (picked.duration.inDays > 30) {
        showToast(context, 'Choose a range of 31 days or fewer.');
        return;
      }
      _custom = DateTimeRange(
        start: DateTime.utc(picked.start.year, picked.start.month, picked.start.day),
        end: DateTime.utc(picked.end.year, picked.end.month, picked.end.day),
      );
    }
    setState(() {
      _period = p;
      _selectedDay = null;
      _chartLoading = true;
    });
    final auth = context.read<AuthController>();
    final cache = context.read<CacheStore>();
    final api = context.read<Api>();
    final cached = await cache.read(auth.cacheKey('dashboard.$_periodKey'));
    if (cached is Map && mounted) setState(() => _dashboard = Json.from(cached));
    try {
      final dash = await _fetchDashboard(api);
      await cache.write(auth.cacheKey('dashboard.$_periodKey'), dash);
      if (mounted) setState(() => _dashboard = dash);
    } catch (e) {
      if (mounted && cached == null) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _chartLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthController>();
    final hasData = _balance != null || _dashboard != null;
    return AppPage(
      title: auth.org?.name ?? 'Business',
      subtitle: 'Good ${_greeting()}, ${auth.userName.split(' ').first}',
      onRefresh: _reload,
      banner: const OfflineBanner(),
      actions: [
        CircleIconButton(
          Icons.notifications_none_rounded,
          tooltip: 'Notifications',
          onPressed: () => push(context, const NotificationsScreen(businessMode: true)),
        ),
      ],
      children: [
        Wrap(spacing: 8, runSpacing: 8, children: [if (auth.canSwitchMode) const ModeChip(), const TestModeChip()]),
        const SizedBox(height: 14),
        if (!hasData && _loading) const LoadingView(),
        if (!hasData && !_loading && _error != null) ErrorView(error: _error!, onRetry: _reload),
        if (hasData) ...[
          if (_fromCache && _error != null) const Padding(padding: EdgeInsets.only(bottom: 12), child: CachedDataNotice()),
          if (!_fromCache && _error != null) Padding(padding: const EdgeInsets.only(bottom: 12), child: ErrorView(error: _error!, onRetry: _reload)),
          _balanceCard(),
          const SizedBox(height: 14),
          _revenueCard(),
          const SizedBox(height: 14),
          _metricsRow(),
          if (_attention.isNotEmpty) ...[
            const SectionHeader('Needs attention'),
            _attentionCard(),
          ],
          SectionHeader('Recent payments', action: 'See all', onAction: () => widget.onOpenTab(1)),
          _recentCard(),
        ],
      ],
    );
  }

  String _greeting() {
    final h = DateTime.now().hour;
    return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
  }

  Widget _balanceCard() {
    final balances = _balance?.list('balances') ?? [];
    if (balances.isEmpty) {
      return AppCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('Your available balance', style: AppType.label()),
          const SizedBox(height: 8),
          AmountText(0, context.watch<AuthController>().org?.currency ?? 'USD', size: AmountSize.hero),
          const SizedBox(height: 8),
          Text('No funds yet. Balances appear after your first successful payment.', style: AppType.small(AppColors.muted)),
        ]),
      );
    }
    final idx = _currencyIndex.clamp(0, balances.length - 1);
    final b = balances[idx];
    final cur = b.s('currency');
    final change = _dashboard?.d('change_pct');
    return AppCard(
      padding: const EdgeInsets.fromLTRB(22, 22, 22, 20),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: Text('Your available balance', style: AppType.label())),
          if (balances.length > 1)
            AppChip(cur, dense: true, dropdown: true, tone: Tone.neutral, onTap: () => setState(() => _currencyIndex = (idx + 1) % balances.length))
          else
            FlagAvatar(Money.countryFor(cur), size: 28),
        ]),
        const SizedBox(height: 8),
        AmountText(b.i('available'), cur, size: AmountSize.hero, key: const Key('balance-available')),
        const SizedBox(height: 14),
        Wrap(spacing: 8, runSpacing: 8, children: [
          if (change != null) AppChip('${change >= 0 ? '+' : ''}${change.toStringAsFixed(1)}% vs prior period', dense: true, icon: change >= 0 ? Icons.trending_up_rounded : Icons.trending_down_rounded),
        ]),
        const SizedBox(height: 14),
        InnerPanel(
          child: Row(children: [
            Expanded(child: _miniAmount('Pending', b.i('pending'), cur)),
            Container(width: 1, height: 34, color: AppColors.line),
            const SizedBox(width: 14),
            Expanded(child: _miniAmount('Reserved', b.i('reserved'), cur)),
          ]),
        ),
        if (b.i('held_for_review') != 0 || b.i('in_transit_to_bank') != 0) ...[
          const SizedBox(height: 10),
          if (b.i('in_transit_to_bank') != 0) KeyValueRow('In transit to bank', value: Money.format(b.i('in_transit_to_bank'), cur)),
          if (b.i('held_for_review') != 0) KeyValueRow('Held for review', value: Money.format(b.i('held_for_review'), cur)),
        ],
      ]),
    );
  }

  Widget _miniAmount(String label, int amount, String cur) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: AppType.label()),
        const SizedBox(height: 4),
        AmountText(amount, cur, size: AmountSize.small),
      ]);

  Widget _revenueCard() {
    final dash = _dashboard;
    final cur = dash?.s('reporting_currency', 'USD') ?? 'USD';
    final range = _range();
    final byDate = {for (final s in dash?.list('series') ?? <Json>[]) s.s('date'): s};
    final days = <DateTime>[];
    for (var d = range.start; !d.isAfter(range.end); d = d.add(const Duration(days: 1))) {
      days.add(d);
    }
    final key = DateFormat('yyyy-MM-dd');
    final data = [
      for (final d in days)
        PillBarDatum(
          label: key.format(d),
          value: (byDate[key.format(d)]?.i('gross') ?? 0).toDouble(),
          line: (byDate[key.format(d)]?.i('count') ?? 0).toDouble(),
          bubble: Money.format(byDate[key.format(d)]?.i('gross') ?? 0, cur),
        ),
    ];
    final sel = (_selectedDay ?? days.length - 1).clamp(0, days.isEmpty ? 0 : days.length - 1);
    final selDay = days.isEmpty ? null : days[sel];
    final selSeries = selDay == null ? null : byDate[key.format(selDay)];
    final short = days.length <= 7;

    return AppCard(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 18),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: Text('Revenue', style: AppType.h3())),
          if (_chartLoading) const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)),
        ]),
        const SizedBox(height: 10),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(children: [
            for (final p in [_Period.d7, _Period.d14, _Period.d30]) ...[
              AppChip(switch (p) { _Period.d7 => '7D', _Period.d14 => '14D', _ => '30D' }, tone: Tone.neutral, selected: _period == p, onTap: () => _changePeriod(p), dense: true),
              const SizedBox(width: 6),
            ],
            AppChip(
              _period == _Period.custom && _custom != null ? '${DateFormat('d MMM').format(_custom!.start)} – ${DateFormat('d MMM').format(_custom!.end)}' : 'Custom',
              tone: Tone.lemon,
              selected: _period == _Period.custom,
              dropdown: true,
              dense: true,
              onTap: () => _changePeriod(_Period.custom),
            ),
          ]),
        ),
        const SizedBox(height: 16),
        if (dash == null)
          const LoadingView(compact: true)
        else ...[
          Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
            Expanded(child: AmountText(dash.i('gross_revenue'), cur, size: AmountSize.large)),
          ]),
          const SizedBox(height: 2),
          Text('Gross revenue excl. tax · ${dash.i('successful_payments')} successful payments', style: AppType.label()),
          const SizedBox(height: 14),
          PillBarChart(
            key: const Key('revenue-chart'),
            data: data,
            selectedIndex: sel,
            onSelect: (i) => setState(() => _selectedDay = i),
            height: 200,
          ),
          const SizedBox(height: 14),
          DayScrubber(
            labels: [for (final d in days) short ? fmtShortDay(d) : DateFormat('d').format(d)],
            selectedIndex: sel,
            onChanged: (i) => setState(() => _selectedDay = i),
          ),
          if (selDay != null) ...[
            const SizedBox(height: 12),
            Text(
              '${DateFormat('EEE d MMM').format(selDay)} · ${selSeries?.i('count') ?? 0} payments · ${Money.format(selSeries?.i('gross') ?? 0, cur)}',
              style: AppType.small(AppColors.muted),
            ),
          ],
        ],
      ]),
    );
  }

  Widget _metricsRow() {
    final dash = _dashboard;
    if (dash == null) return const SizedBox.shrink();
    final cur = dash.s('reporting_currency', 'USD');
    return Row(children: [
      Expanded(
        child: AppCard(
          padding: const EdgeInsets.all(18),
          onTap: () => widget.onOpenTab(3),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('MRR', style: AppType.label()),
            const SizedBox(height: 6),
            AmountText(dash.i('mrr'), cur, size: AmountSize.medium, showCode: false),
            const SizedBox(height: 6),
            Text(cur, style: AppType.caption()),
          ]),
        ),
      ),
      const SizedBox(width: 12),
      Expanded(
        child: AppCard(
          padding: const EdgeInsets.all(18),
          onTap: () => widget.onOpenTab(3),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Subscribers', style: AppType.label()),
            const SizedBox(height: 6),
            Text('${dash.i('active_subscriptions')}', style: AppType.h2().copyWith(fontWeight: FontWeight.w300, fontSize: 24)),
            const SizedBox(height: 6),
            Text('Churn ${dash.d('churn_rate_pct') ?? 0}%', style: AppType.caption()),
          ]),
        ),
      ),
    ]);
  }

  Widget _attentionCard() {
    return AppCard(
      padding: const EdgeInsets.fromLTRB(16, 6, 16, 6),
      child: Column(children: [
        for (var i = 0; i < _attention.length; i++) ...[
          if (i > 0) const Hairline(indent: 54),
          NavRow(
            icon: switch (_attention[i].s('kind')) {
              'failed_payments' => Icons.error_outline_rounded,
              'disputes' => Icons.gavel_rounded,
              'risk_review' => Icons.shield_outlined,
              'at_risk' => Icons.hourglass_bottom_rounded,
              'payouts' => Icons.account_balance_outlined,
              _ => Icons.fact_check_outlined,
            },
            tone: Tone.peach,
            title: _attention[i].s('label'),
            onTap: () => _openAttention(_attention[i]),
          ),
        ],
      ]),
    );
  }

  void _openAttention(Json item) {
    switch (item.s('kind')) {
      case 'failed_payments':
        push(context, const PaymentsScreen(initialStatus: 'FAILED'));
      case 'risk_review':
        push(context, const PaymentsScreen(initialReview: 'pending'));
      case 'disputes':
        push(context, const DisputesScreen());
      case 'at_risk':
        push(context, const SubscriptionsScreen(initialStatus: 'PAST_DUE'));
      case 'payouts':
        push(context, const PayoutsScreen());
      default:
        showDialog<void>(
          context: context,
          builder: (c) => AlertDialog(
            title: const Text('Business verification'),
            content: const Text('Complete business verification from the web dashboard (Settings → Verification).'),
            actions: [TextButton(onPressed: () => Navigator.pop(c), child: const Text('OK'))],
          ),
        );
    }
  }

  Widget _recentCard() {
    if (_recent.isEmpty) {
      return const AppCard(child: EmptyView(title: 'No payments yet', message: 'Payments from checkout, links and invoices appear here.', icon: Icons.receipt_long_outlined));
    }
    final shown = _recent.take(5).toList();
    return AppCard(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
      child: Column(children: [
        for (var i = 0; i < shown.length; i++) ...[
          if (i > 0) const Hairline(),
          PaymentRow(
            payment: shown[i],
            history: _recent,
            onTap: () => push(context, PaymentDetailScreen(id: shown[i].s('id'))),
          ),
        ],
      ]),
    );
  }
}
