import 'package:flutter/material.dart';

import '../../../core/api/api.dart';
import '../../../core/format/dates.dart';
import '../../../core/security/secure_screen.dart';
import '../../../shared/loaded_page.dart';
import '../../../theme/kit.dart';
import '../widgets.dart';

/// Transfer detail (`GET /v1/wallet/transfers/{id}`). [summary] is the list row, which carries the
/// counterparty, purpose and note that the detail endpoint does not return.
class TransferDetailScreen extends StatelessWidget {
  const TransferDetailScreen({super.key, required this.id, this.summary});

  final String id;
  final Json? summary;

  @override
  Widget build(BuildContext context) {
    return SecureScreen(
      child: LoadedPage(
        title: 'Transaction',
        subtitle: id,
        bottomInset: 32,
        load: (api) => api.get('/v1/wallet/transfers/$id'),
        builder: (context, data, reload) {
          final t = Json.from(data as Map);
          final s = summary ?? const <String, dynamic>{};
          final out = t.s('direction') == 'out';
          final cross = t.s('source_currency') != t.s('destination_currency');
          final status = t.s('status');
          final shownAmount = out ? t.i('source_amount') : t.i('destination_amount');
          final shownCur = out ? t.s('source_currency') : t.s('destination_currency');
          return [
            AppCard(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Expanded(child: Text(transferTypeLabel({...s, ...t}), style: AppType.label())),
                  StatusPill(status),
                ]),
                const SizedBox(height: 8),
                AmountText(shownAmount, shownCur, size: AmountSize.hero, signed: !out),
                if (s.str('counterparty') != null) ...[
                  const SizedBox(height: 6),
                  Text('${out ? 'To' : 'From'} ${s.s('counterparty')}', style: AppType.body(AppColors.text2)),
                ],
                if (t.str('message') != null) ...[
                  const SizedBox(height: 14),
                  NoticePanel(
                    t.s('message'),
                    tone: status == 'HELD' ? Tone.peach : status == 'COMPLETED' ? Tone.sage : Tone.lemon,
                    icon: status == 'HELD' ? Icons.hourglass_top_rounded : Icons.info_outline_rounded,
                  ),
                ],
              ]),
            ),
            const SectionHeader('Details'),
            AppCard(
              child: Column(children: [
                KeyValueRow('Amount sent', child: AmountText(t.i('source_amount'), t.s('source_currency'), size: AmountSize.small)),
                if (out) KeyValueRow('Fee', child: AmountText(t.i('fee_amount'), t.s('source_currency'), size: AmountSize.small)),
                if (cross) ...[
                  KeyValueRow('Amount received', child: AmountText(t.i('destination_amount'), t.s('destination_currency'), size: AmountSize.small)),
                  if (t.d('fx_rate') != null) KeyValueRow('Exchange rate', value: '1 ${t.s('source_currency')} = ${formatRate(t.d('fx_rate')!)} ${t.s('destination_currency')}'),
                  if (t.str('fx_rate_timestamp') != null) KeyValueRow('Rate as of', value: fmtDateTime(t.str('fx_rate_timestamp'))),
                ],
                if (s.str('purpose') != null) KeyValueRow('Purpose', value: s.str('purpose')),
                if (s.str('note') != null) KeyValueRow('Note', value: s.str('note')),
                KeyValueRow('Created', value: fmtDateTime(t.str('created_at'))),
                if (t.str('completed_at') != null) KeyValueRow('Completed', value: fmtDateTime(t.str('completed_at'))),
                KeyValueRow('Reference', value: t.s('id'), selectable: true),
              ]),
            ),
            const SizedBox(height: 12),
            Row(children: [
              FlagStack([Money.countryFor(t.s('source_currency')), if (cross) Money.countryFor(t.s('destination_currency'))], size: 28),
              const SizedBox(width: 10),
              Expanded(child: Text(cross ? '${t.s('source_currency')} → ${t.s('destination_currency')}' : t.s('source_currency'), style: AppType.label())),
            ]),
          ];
        },
      ),
    );
  }
}
