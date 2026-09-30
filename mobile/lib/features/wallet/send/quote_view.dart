import 'package:flutter/material.dart';

import '../../../core/api/api.dart';
import '../../../core/format/dates.dart';
import '../../../theme/kit.dart';

/// A received FX quote plus the local time it arrived. Remaining validity is measured from the
/// server's own created_at → expires_at window, so device clock skew does not matter.
class QuoteState {
  QuoteState(this.quote, {DateTime? receivedAt}) : receivedAt = receivedAt ?? DateTime.now();

  final Json quote;
  final DateTime receivedAt;

  Duration get validity {
    final created = DateTime.tryParse(quote.s('created_at'));
    final expires = DateTime.tryParse(quote.s('expires_at'));
    if (created == null || expires == null) return const Duration(minutes: 5);
    return expires.difference(created);
  }

  Duration remaining([DateTime? now]) {
    final left = validity - (now ?? DateTime.now()).difference(receivedAt);
    return left.isNegative ? Duration.zero : left;
  }

  bool expired([DateTime? now]) => remaining(now) == Duration.zero;

  String get id => quote.s('id');
  String get from => quote.s('from_currency');
  String get to => quote.s('to_currency');
  bool get crossCurrency => from != to;
}

String fmtCountdown(Duration d) => '${d.inMinutes}:${(d.inSeconds % 60).toString().padLeft(2, '0')}';

/// Rate, spread, fee and the exact amount received — shown before the user confirms.
class QuoteView extends StatelessWidget {
  const QuoteView({super.key, required this.state, this.receiverLabel = 'Recipient gets exactly', this.now});

  final QuoteState state;
  final String receiverLabel;
  final DateTime? now;

  @override
  Widget build(BuildContext context) {
    final q = state.quote;
    final from = state.from;
    final to = state.to;
    final rate = q.i('customer_rate_e9') / 1e9;
    final mid = q.i('mid_rate_e9') / 1e9;
    final left = state.remaining(now);
    final expired = left == Duration.zero;
    return AppCard(
      key: const Key('quote-view'),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: Text(receiverLabel, style: AppType.label())),
          AppChip(
            expired ? 'Quote expired' : 'Expires in ${fmtCountdown(left)}',
            key: const Key('quote-countdown'),
            tone: expired ? Tone.rose : Tone.lemon,
            icon: Icons.timer_outlined,
            dense: true,
          ),
        ]),
        const SizedBox(height: 6),
        AmountText(q.i('destination_amount'), to, size: AmountSize.large, key: const Key('quote-received')),
        const SizedBox(height: 14),
        InnerPanel(
          child: Column(children: [
            KeyValueRow('You send', child: AmountText(q.i('source_amount'), from, size: AmountSize.small, key: const Key('quote-send'))),
            KeyValueRow('Fee', child: AmountText(q.i('fee_amount'), from, size: AmountSize.small, key: const Key('quote-fee'))),
            if (state.crossCurrency) ...[
              KeyValueRow('Exchange rate', value: '1 $from = ${formatRate(rate)} $to', key: const Key('quote-rate')),
              KeyValueRow('Mid-market rate', value: '1 $from = ${formatRate(mid)} $to'),
              KeyValueRow(
                'FX spread',
                key: const Key('quote-spread'),
                value: '${formatBps(q.i('spread_bps'))} · ${Money.format(q.i('spread_amount'), to)}',
              ),
            ],
          ]),
        ),
        const SizedBox(height: 10),
        Text(
          state.crossCurrency
              ? 'Fee is charged in $from on top of the amount you send. Rate from ${q.s('rate_source')} as of ${fmtDateTime(q.str('rate_timestamp'))}.'
              : 'Fee is charged in $from on top of the amount you send.',
          style: AppType.caption(),
        ),
      ]),
    );
  }
}
