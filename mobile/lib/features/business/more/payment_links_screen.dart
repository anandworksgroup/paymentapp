import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:share_plus/share_plus.dart';

import '../../../core/api/api.dart';
import '../../../core/config.dart';
import '../../../core/format/dates.dart';
import '../../../shared/loaded_page.dart';
import '../../../shared/offline.dart';
import '../../../shared/step_up.dart';
import '../../../theme/kit.dart';

/// Full hosted-checkout URL for a link. The API returns a relative `url` ("/pay/{id}").
String paymentLinkUrl(Json link) {
  final rel = link.str('url') ?? '/pay/${link.s('id')}';
  return '${AppConfig.checkoutUrl}$rel';
}

class PaymentLinksScreen extends StatefulWidget {
  const PaymentLinksScreen({super.key});

  @override
  State<PaymentLinksScreen> createState() => _PaymentLinksScreenState();
}

class _PaymentLinksScreenState extends State<PaymentLinksScreen> {
  late final PagedController _c;

  @override
  void initState() {
    super.initState();
    _c = PagedController(api: context.read<Api>(), path: '/v1/payment_links')..refresh();
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  Future<void> _create() async {
    final link = await showModalBottomSheet<Json>(context: context, isScrollControlled: true, builder: (_) => const CreatePaymentLinkSheet());
    if (link == null || !mounted) return;
    await _c.refresh();
    if (mounted) await showLinkShareSheet(context, link);
  }

  @override
  Widget build(BuildContext context) {
    return AppPage(
      title: 'Payment links',
      bottomInset: 24,
      onRefresh: _c.refresh,
      banner: const OfflineBanner(),
      footer: PrimaryButton('Create payment link', key: const Key('create-link'), icon: Icons.add_link_rounded, onPressed: canWrite(context) ? _create : null),
      children: [
        PagedListBody(
          controller: _c,
          emptyTitle: 'No payment links',
          emptyMessage: 'Create a link from any active price and share it anywhere.',
          emptyIcon: Icons.link_rounded,
          itemBuilder: (context, l, i) => NavRow(
            icon: Icons.link_rounded,
            tone: l.s('status') == 'active' ? Tone.lemon : Tone.neutral,
            title: l.s('id'),
            subtitle: '${l.i('visits')} visits · ${l.i('completions')} paid · ${fmtDate(l.str('created_at'))}',
            trailing: StatusPill(l.str('status')),
            onTap: () => showLinkShareSheet(context, l),
          ),
        ),
      ],
    );
  }
}

class CreatePaymentLinkSheet extends StatefulWidget {
  const CreatePaymentLinkSheet({super.key});

  @override
  State<CreatePaymentLinkSheet> createState() => _CreatePaymentLinkSheetState();
}

class _CreatePaymentLinkSheetState extends State<CreatePaymentLinkSheet> {
  List<Json>? _prices;
  Map<String, String> _productNames = {};
  String? _priceId;
  int _quantity = 1;
  bool _allowCoupons = true;
  bool _busy = false;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final api = context.read<Api>();
    try {
      final r = await Future.wait([
        api.get('/v1/prices', query: {'active': 'true', 'limit': '100'}),
        api.get('/v1/products', query: {'status': 'active', 'limit': '100'}),
      ]);
      final prices = ApiList.from(r[0]).data;
      final names = {for (final p in ApiList.from(r[1]).data) p.s('id'): p.s('name')};
      if (!mounted) return;
      setState(() {
        _prices = prices.where((p) => names.containsKey(p.s('product_id'))).toList();
        _productNames = names;
        _priceId = _prices!.isEmpty ? null : _prices!.first.s('id');
      });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  String _priceLabel(Json p) {
    final name = _productNames[p.s('product_id')] ?? p.s('product_id');
    final amount = Money.format(p.i('unit_amount'), p.s('currency', 'USD'));
    final interval = p.str('interval') == null ? '' : ' / ${p.s('interval')}';
    return '$name · $amount$interval${p.str('nickname') != null ? ' (${p.s('nickname')})' : ''}';
  }

  Future<void> _submit() async {
    if (_priceId == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    final api = context.read<Api>();
    try {
      final res = await withStepUp(context, (key) => api.post('/v1/payment_links',
          idempotencyKey: key, body: {'price_id': _priceId, 'quantity': _quantity, 'allow_coupons': _allowCoupons}));
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
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('New payment link', style: AppType.h2()),
        const SizedBox(height: 14),
        if (_prices == null && _error == null) const LoadingView(compact: true, label: 'Loading prices…'),
        if (_prices != null && _prices!.isEmpty) const EmptyView(title: 'No active prices', message: 'Create a product and price on the web dashboard first.', icon: Icons.sell_outlined),
        if (_prices != null && _prices!.isNotEmpty) ...[
          DropdownButtonFormField<String>(
            value: _priceId,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Price'),
            items: [for (final p in _prices!) DropdownMenuItem(value: p.s('id'), child: Text(_priceLabel(p), overflow: TextOverflow.ellipsis))],
            onChanged: (v) => setState(() => _priceId = v),
          ),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(child: Text('Quantity', style: AppType.body(AppColors.text2))),
            CircleIconButton(Icons.remove_rounded, size: 36, onPressed: _quantity > 1 ? () => setState(() => _quantity--) : null),
            SizedBox(width: 40, child: Text('$_quantity', textAlign: TextAlign.center, style: AppType.h3())),
            CircleIconButton(Icons.add_rounded, size: 36, onPressed: _quantity < 99 ? () => setState(() => _quantity++) : null),
          ]),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            value: _allowCoupons,
            onChanged: (v) => setState(() => _allowCoupons = v),
            title: Text('Allow coupon codes', style: AppType.body()),
          ),
        ],
        InlineError(_error),
        const SizedBox(height: 14),
        PrimaryButton('Create link', loading: _busy, onPressed: _priceId != null && canWrite(context) ? _submit : null),
      ]),
    );
  }
}

Future<void> showLinkShareSheet(BuildContext context, Json link) {
  final url = paymentLinkUrl(link);
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (sheet) => Padding(
      padding: const EdgeInsets.fromLTRB(22, 0, 22, 22),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Text('Share payment link', style: AppType.h2()),
        const SizedBox(height: 16),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(color: AppColors.surface2, borderRadius: BorderRadius.circular(AppRadius.inner)),
          child: QrImageView(
            data: url,
            size: 200,
            backgroundColor: AppColors.surface2,
            eyeStyle: const QrEyeStyle(eyeShape: QrEyeShape.circle, color: AppColors.ink),
            dataModuleStyle: const QrDataModuleStyle(dataModuleShape: QrDataModuleShape.circle, color: AppColors.ink),
            semanticsLabel: 'QR code for $url',
          ),
        ),
        const SizedBox(height: 14),
        SelectableText(url, style: AppType.small(), textAlign: TextAlign.center),
        const SizedBox(height: 4),
        Text('Opens hosted checkout (test mode).', style: AppType.caption()),
        const SizedBox(height: 16),
        Row(children: [
          Expanded(
            child: SecondaryButton('Copy', icon: Icons.copy_rounded, onPressed: () async {
              await Clipboard.setData(ClipboardData(text: url));
              if (sheet.mounted) showToast(sheet, 'Link copied');
            }),
          ),
          const SizedBox(width: 10),
          Expanded(child: PrimaryButton('Share', icon: Icons.ios_share_rounded, onPressed: () => Share.share(url, subject: 'Payment link'))),
        ]),
      ]),
    ),
  );
}
