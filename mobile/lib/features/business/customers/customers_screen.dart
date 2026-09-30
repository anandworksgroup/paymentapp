import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../core/api/api.dart';
import '../../../core/format/dates.dart';
import '../../../shared/loaded_page.dart';
import '../../../shared/offline.dart';
import '../../../theme/kit.dart';
import '../../common/navigation.dart';
import 'customer_detail_screen.dart';

class CustomersScreen extends StatefulWidget {
  const CustomersScreen({super.key});

  @override
  State<CustomersScreen> createState() => _CustomersScreenState();
}

class _CustomersScreenState extends State<CustomersScreen> {
  late final PagedController _c;
  final _search = TextEditingController();
  Timer? _debounce;

  @override
  void initState() {
    super.initState();
    _c = PagedController(api: context.read<Api>(), path: '/v1/customers')..refresh();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    _c.dispose();
    super.dispose();
  }

  void _apply() {
    final q = _search.text.trim();
    _c.query = {'search': q.length > 1 ? q : null};
    _c.refresh();
  }

  @override
  Widget build(BuildContext context) {
    return AppPage(
      title: 'Customers',
      onRefresh: _c.refresh,
      banner: const OfflineBanner(),
      children: [
        TextField(
          controller: _search,
          decoration: const InputDecoration(
            hintText: 'Search name, email, phone or id',
            prefixIcon: Icon(Icons.search_rounded, color: AppColors.muted),
            fillColor: AppColors.surface,
          ),
          onChanged: (_) {
            _debounce?.cancel();
            _debounce = Timer(const Duration(milliseconds: 400), _apply);
          },
        ),
        const SizedBox(height: 14),
        PagedListBody(
          controller: _c,
          emptyTitle: 'No customers found',
          emptyMessage: 'Customers are created at checkout or through the API.',
          emptyIcon: Icons.people_outline_rounded,
          itemBuilder: (context, c, i) => CustomerRow(customer: c, onTap: () => push(context, CustomerDetailScreen(id: c.s('id')))),
        ),
      ],
    );
  }
}

class CustomerRow extends StatelessWidget {
  const CustomerRow({super.key, required this.customer, this.onTap});

  final Json customer;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final c = customer;
    final name = c.str('name') ?? c.str('email') ?? c.s('id');
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppRadius.inner),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 4),
        child: Row(children: [
          FlagAvatar(c.str('country'), size: 38),
          const SizedBox(width: 14),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(name, style: AppType.bodyMedium(), maxLines: 1, overflow: TextOverflow.ellipsis),
              const SizedBox(height: 2),
              Text(
                [if (c.str('email') != null && c.str('name') != null) c.s('email'), c.s('customer_type').toUpperCase(), 'since ${fmtDate(c.str('created_at'))}'].join(' · '),
                style: AppType.label(),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ]),
          ),
          const Icon(Icons.chevron_right_rounded, color: AppColors.faint),
        ]),
      ),
    );
  }
}
