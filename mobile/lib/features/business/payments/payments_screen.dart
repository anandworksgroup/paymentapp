import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../core/api/api.dart';
import '../../../shared/loaded_page.dart';
import '../../../shared/offline.dart';
import '../../../theme/kit.dart';
import '../../common/navigation.dart';
import '../widgets.dart';
import 'payment_detail_screen.dart';

class PaymentsScreen extends StatefulWidget {
  const PaymentsScreen({super.key, this.initialStatus, this.initialReview});

  final String? initialStatus;
  final String? initialReview;

  @override
  State<PaymentsScreen> createState() => _PaymentsScreenState();
}

class _PaymentsScreenState extends State<PaymentsScreen> {
  late final PagedController _c;
  final _search = TextEditingController();
  Timer? _debounce;
  String? _status;

  static const _filters = <String?, String>{
    null: 'All',
    'SUCCEEDED': 'Succeeded',
    'FAILED': 'Failed',
    'PROCESSING': 'Processing',
    'REFUNDED': 'Refunded',
    'PARTIALLY_REFUNDED': 'Partly refunded',
    'DISPUTED': 'Disputed',
  };

  @override
  void initState() {
    super.initState();
    _status = widget.initialStatus;
    _c = PagedController(api: context.read<Api>(), path: '/v1/payments', query: _query());
    _c.refresh();
  }

  Map<String, String?> _query() => {
        'status': _status,
        'review': widget.initialReview,
        'search': _search.text.trim().length > 2 ? _search.text.trim() : null,
      };

  void _apply() {
    _c.query = _query();
    _c.refresh();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AppPage(
      title: widget.initialReview != null ? 'Held for review' : 'Payments',
      subtitle: 'Test mode',
      onRefresh: _c.refresh,
      banner: const OfflineBanner(),
      children: [
        TextField(
          controller: _search,
          decoration: const InputDecoration(
            hintText: 'Search id, email, last 4, order or invoice',
            prefixIcon: Icon(Icons.search_rounded, color: AppColors.muted),
            fillColor: AppColors.surface,
          ),
          onChanged: (_) {
            _debounce?.cancel();
            _debounce = Timer(const Duration(milliseconds: 450), _apply);
          },
        ),
        const SizedBox(height: 12),
        if (widget.initialReview == null)
          FilterChips(
            options: _filters,
            selected: _status,
            onChanged: (v) {
              setState(() => _status = v);
              _apply();
            },
          ),
        const SizedBox(height: 14),
        ListenableBuilder(
          listenable: _c,
          builder: (context, _) => PagedListBody(
            controller: _c,
            emptyTitle: 'No payments found',
            emptyMessage: _status == null ? 'Payments appear here as customers pay.' : 'Nothing with this status.',
            emptyIcon: Icons.receipt_long_outlined,
            itemBuilder: (context, p, i) => PaymentRow(
              payment: p,
              history: _c.items,
              onTap: () => push(context, PaymentDetailScreen(id: p.s('id'))),
            ),
          ),
        ),
      ],
    );
  }
}
