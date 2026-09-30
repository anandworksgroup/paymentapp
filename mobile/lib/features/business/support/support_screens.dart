import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../core/api/api.dart';
import '../../../core/auth/auth_controller.dart';
import '../../../core/format/dates.dart';
import '../../../shared/loaded_page.dart';
import '../../../shared/offline.dart';
import '../../../theme/kit.dart';
import '../../common/navigation.dart';
import '../widgets.dart';

/// Ticket categories accepted by `POST /v1/support/tickets` (§207).
const ticketCategories = <String, String>{
  'payment_issue': 'Payment issue',
  'checkout_issue': 'Checkout issue',
  'tax_issue': 'Tax issue',
  'account': 'Account',
  'bug': 'Bug',
  'feature_request': 'Feature request',
  'other': 'Other',
};

const _priorities = <String, String>{'normal': 'Normal', 'high': 'High', 'urgent': 'Urgent'};

String ticketStatusLabel(String status) => switch (status) {
      'open' => 'Open',
      'awaiting_merchant' => 'Awaiting your reply',
      'resolved' => 'Resolved',
      'closed' => 'Closed',
      _ => humanize(status),
    };

IconData _categoryIcon(String c) => switch (c) {
      'payment_issue' => Icons.receipt_long_outlined,
      'checkout_issue' => Icons.shopping_cart_checkout_rounded,
      'tax_issue' => Icons.account_balance_outlined,
      'account' => Icons.person_outline_rounded,
      'bug' => Icons.bug_report_outlined,
      'feature_request' => Icons.lightbulb_outline_rounded,
      _ => Icons.help_outline_rounded,
    };

/// Support tickets for the current organization (`GET /v1/support/tickets`).
class SupportTicketsScreen extends StatefulWidget {
  const SupportTicketsScreen({super.key});

  @override
  State<SupportTicketsScreen> createState() => _SupportTicketsScreenState();
}

class _SupportTicketsScreenState extends State<SupportTicketsScreen> {
  final _page = GlobalKey<LoadedPageState>();
  String? _filter;

  Future<void> _create() async {
    final created = await push<Json>(context, const NewTicketScreen());
    if (created == null || !mounted) return;
    await _page.currentState?.reload();
    if (mounted) await push(context, TicketThreadScreen(id: created.s('id'), summary: created));
    await _page.currentState?.reload();
  }

  @override
  Widget build(BuildContext context) {
    List<Json> filtered(dynamic data) {
      final all = ApiList.from(data).data;
      return switch (_filter) {
        'active' => all.where((t) => t.s('status') != 'closed' && t.s('status') != 'resolved').toList(),
        'closed' => all.where((t) => t.s('status') == 'closed' || t.s('status') == 'resolved').toList(),
        _ => all,
      };
    }

    return LoadedPage(
      key: _page,
      title: 'Support',
      subtitle: 'Help & support',
      bottomInset: 24,
      cacheName: 'support.tickets',
      load: (api) => api.get('/v1/support/tickets'),
      footerBuilder: (context, data, reload) =>
          PrimaryButton('New ticket', key: const Key('ticket-new'), icon: Icons.add_rounded, onPressed: canWrite(context) ? _create : null),
      builder: (context, data, reload) {
        final all = ApiList.from(data).data;
        final items = filtered(data);
        final waiting = all.where((t) => t.s('status') == 'awaiting_merchant').length;
        return [
          if (waiting > 0) ...[
            NoticePanel(
              waiting == 1 ? 'Support replied to 1 ticket and is waiting for you.' : 'Support replied to $waiting tickets and is waiting for you.',
              tone: Tone.peach,
              icon: Icons.mark_chat_unread_outlined,
            ),
            const SizedBox(height: 12),
          ],
          FilterChips(
            options: const {null: 'All', 'active': 'Active', 'closed': 'Resolved & closed'},
            selected: _filter,
            onChanged: (v) => setState(() => _filter = v),
          ),
          const SizedBox(height: 12),
          if (items.isEmpty)
            AppCard(
              child: EmptyView(
                title: all.isEmpty ? 'No tickets yet' : 'Nothing in this view',
                message: all.isEmpty ? 'Open a ticket and our team will reply here.' : null,
                icon: Icons.support_agent_rounded,
              ),
            )
          else
            AppCard(
              padding: const EdgeInsets.fromLTRB(16, 6, 16, 6),
              child: Column(children: [
                for (var i = 0; i < items.length; i++) ...[
                  if (i > 0) const Hairline(indent: 54),
                  _TicketRow(
                    ticket: items[i],
                    onTap: () async {
                      await push(context, TicketThreadScreen(id: items[i].s('id'), summary: items[i]));
                      await reload();
                    },
                  ),
                ],
              ]),
            ),
        ];
      },
    );
  }
}

class _TicketRow extends StatelessWidget {
  const _TicketRow({required this.ticket, required this.onTap});

  final Json ticket;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final t = ticket;
    final status = t.s('status');
    final priority = t.s('priority', 'normal');
    final tone = status == 'awaiting_merchant' ? Tone.peach : status == 'closed' || status == 'resolved' ? Tone.neutral : Tone.sage;
    return InkWell(
      key: Key('ticket-${t.s('id')}'),
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppRadius.inner),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 4),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(color: tone.background, shape: BoxShape.circle),
            child: Icon(_categoryIcon(t.s('category')), size: 19, color: tone.foreground),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(t.s('subject'), style: AppType.bodyMedium(), maxLines: 2, overflow: TextOverflow.ellipsis),
              const SizedBox(height: 3),
              Text(
                '${ticketCategories[t.s('category')] ?? humanize(t.str('category'))} · updated ${fmtRelative(t.str('updated_at'))}',
                style: AppType.label(),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: 8),
              Wrap(spacing: 6, runSpacing: 6, children: [
                StatusPill(status.toUpperCase(), label: ticketStatusLabel(status)),
                if (priority != 'normal' && _priorities.containsKey(priority)) AppChip('${_priorities[priority]} priority', tone: Tone.peach, dense: true),
              ]),
            ]),
          ),
          const Padding(padding: EdgeInsets.only(top: 8), child: Icon(Icons.chevron_right_rounded, color: AppColors.faint)),
        ]),
      ),
    );
  }
}

/// Opens a ticket (`POST /v1/support/tickets`). Pops with the created ticket.
class NewTicketScreen extends StatefulWidget {
  const NewTicketScreen({super.key, this.relatedObjectId});

  final String? relatedObjectId;

  @override
  State<NewTicketScreen> createState() => _NewTicketScreenState();
}

class _NewTicketScreenState extends State<NewTicketScreen> {
  final _subject = TextEditingController();
  final _body = TextEditingController();
  late final _related = TextEditingController(text: widget.relatedObjectId ?? '');
  String _category = 'payment_issue';
  String _priority = 'normal';
  bool _busy = false;
  Object? _error;
  late final String _idempotencyKey = newUuid();

  @override
  void dispose() {
    _subject.dispose();
    _body.dispose();
    _related.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_subject.text.trim().isEmpty || _body.text.trim().isEmpty) {
      setState(() => _error = 'Add a subject and describe the problem.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final res = await context.read<Api>().post('/v1/support/tickets', idempotencyKey: _idempotencyKey, body: {
        'subject': _subject.text.trim(),
        'category': _category,
        'body': _body.text.trim(),
        'priority': _priority,
        if (_related.text.trim().isNotEmpty) 'related_object_id': _related.text.trim(),
      });
      if (mounted) Navigator.of(context).pop(Json.from(res as Map));
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppPage(
      title: 'New ticket',
      subtitle: 'Support',
      bottomInset: 24,
      banner: const OfflineBanner(),
      footer: PrimaryButton('Send to support', key: const Key('ticket-submit'), icon: Icons.send_rounded, loading: _busy, onPressed: canWrite(context) ? _submit : null),
      children: [
        AppCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('What is it about?', style: AppType.label()),
            const SizedBox(height: 10),
            Wrap(spacing: 6, runSpacing: 6, children: [
              for (final e in ticketCategories.entries)
                AppChip(e.value, key: Key('ticket-category-${e.key}'), tone: Tone.neutral, selected: _category == e.key, dense: true, icon: _categoryIcon(e.key), onTap: () => setState(() => _category = e.key)),
            ]),
            const SizedBox(height: 16),
            TextField(key: const Key('ticket-subject'), controller: _subject, maxLength: 140, decoration: const InputDecoration(labelText: 'Subject', counterText: '')),
            const SizedBox(height: 12),
            TextField(
              key: const Key('ticket-body'),
              controller: _body,
              minLines: 4,
              maxLines: 8,
              maxLength: 5000,
              decoration: const InputDecoration(labelText: 'Describe the problem', alignLabelWithHint: true, counterText: ''),
            ),
          ]),
        ),
        const SizedBox(height: 12),
        AppCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Priority', style: AppType.label()),
            const SizedBox(height: 10),
            Wrap(spacing: 6, children: [
              for (final e in _priorities.entries)
                AppChip(e.value, tone: e.key == 'urgent' ? Tone.peach : Tone.neutral, selected: _priority == e.key, dense: true, onTap: () => setState(() => _priority = e.key)),
            ]),
            const SizedBox(height: 14),
            TextField(
              controller: _related,
              decoration: const InputDecoration(labelText: 'Related payment, payout or dispute ID (optional)', hintText: 'pay_…'),
            ),
          ]),
        ),
        const SizedBox(height: 10),
        Text('Don’t include card numbers, passwords or API keys. Support will never ask for them.', style: AppType.caption()),
        InlineError(_error),
      ],
    );
  }
}

/// One ticket with its message thread (`GET /v1/support/tickets/{id}`), reply and close.
class TicketThreadScreen extends StatefulWidget {
  const TicketThreadScreen({super.key, required this.id, this.summary});

  final String id;
  final Json? summary;

  @override
  State<TicketThreadScreen> createState() => _TicketThreadScreenState();
}

class _TicketThreadScreenState extends State<TicketThreadScreen> {
  final _reply = TextEditingController();
  final _scroll = ScrollController();
  Json? _ticket;
  List<Json> _messages = [];
  bool _loading = true;
  Object? _loadError;
  bool _sending = false;
  bool _closing = false;
  Object? _error;
  String _replyKey = newUuid();

  @override
  void initState() {
    super.initState();
    _ticket = widget.summary;
    _load();
  }

  @override
  void dispose() {
    _reply.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _loadError = null;
    });
    try {
      final res = Json.from(await context.read<Api>().get('/v1/support/tickets/${widget.id}') as Map);
      if (!mounted) return;
      setState(() {
        _ticket = res.obj('ticket') ?? _ticket;
        _messages = res.list('messages');
        _loading = false;
      });
      _scrollToEnd();
    } catch (e) {
      if (mounted) {
        setState(() {
          _loadError = e;
          _loading = false;
        });
      }
    }
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) _scroll.animateTo(_scroll.position.maxScrollExtent, duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
    });
  }

  Future<void> _send() async {
    final body = _reply.text.trim();
    if (body.isEmpty || _sending) return;
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      final m = await context.read<Api>().post('/v1/support/tickets/${widget.id}/messages', idempotencyKey: _replyKey, body: {'body': body});
      if (!mounted) return;
      _reply.clear();
      _replyKey = newUuid();
      setState(() {
        _messages = [..._messages, Json.from(m as Map)];
        _ticket = {...?_ticket, 'status': 'open'};
        _sending = false;
      });
      _scrollToEnd();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e;
        _sending = false;
      });
      if (e is ApiException && e.code == 'ticket_closed') await _load();
    }
  }

  Future<void> _close() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Close this ticket?'),
        content: const Text('You won’t be able to reply to it. Open a new ticket if you need more help.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Keep open')),
          TextButton(key: const Key('ticket-close-confirm'), onPressed: () => Navigator.pop(c, true), child: const Text('Close ticket')),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    setState(() {
      _closing = true;
      _error = null;
    });
    try {
      final t = await context.read<Api>().post('/v1/support/tickets/${widget.id}/close');
      if (!mounted) return;
      setState(() {
        _ticket = Json.from(t as Map);
        _closing = false;
      });
      showToast(context, 'Ticket closed');
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e;
          _closing = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = _ticket;
    final status = t?.s('status') ?? 'open';
    final closed = status == 'closed';
    final online = canWrite(context);
    final List<Widget> children;
    if (t == null && _loading) {
      children = [const LoadingView()];
    } else if (t == null && _loadError != null) {
      children = [ErrorView(error: _loadError!, onRetry: _load)];
    } else if (t == null) {
      children = [const AppCard(child: EmptyView(title: 'Ticket not found', icon: Icons.support_agent_rounded))];
    } else {
      children = [
        AppCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(child: Text(ticketCategories[t.s('category')] ?? humanize(t.str('category')), style: AppType.label())),
              StatusPill(status.toUpperCase(), label: ticketStatusLabel(status), key: const Key('ticket-status')),
            ]),
            const SizedBox(height: 6),
            Text(t.s('subject'), style: AppType.h2()),
            const SizedBox(height: 10),
            Wrap(spacing: 6, runSpacing: 6, children: [
              AppChip('Opened ${fmtDate(t.str('created_at'))}', tone: Tone.neutral, dense: true),
              if (t.s('priority', 'normal') != 'normal' && _priorities.containsKey(t.s('priority')))
                AppChip('${_priorities[t.s('priority')]} priority', tone: Tone.peach, dense: true),
              if (t.str('related_object_id') != null) AppChip(t.s('related_object_id'), tone: Tone.lemon, dense: true, icon: Icons.link_rounded),
            ]),
          ]),
        ),
        if (_loadError != null) Padding(padding: const EdgeInsets.only(top: 12), child: ErrorView(error: _loadError!, onRetry: _load)),
        const SectionHeader('Conversation'),
        if (_loading && _messages.isEmpty) const LoadingView(compact: true),
        for (final m in _messages) _MessageBubble(message: m, meId: context.watch<AuthController>().user?.str('id')),
        if (status == 'awaiting_merchant')
          const Padding(
            padding: EdgeInsets.only(top: 4),
            child: NoticePanel('Support is waiting for your reply.', tone: Tone.peach, icon: Icons.mark_chat_unread_outlined),
          ),
        if (closed)
          const Padding(
            padding: EdgeInsets.only(top: 4),
            child: NoticePanel('This ticket is closed. Open a new ticket if you need more help.', tone: Tone.neutral, icon: Icons.lock_outline_rounded),
          ),
        InlineError(_error),
      ];
    }
    return AppPage(
      title: 'Ticket',
      subtitle: widget.id,
      bottomInset: 24,
      controller: _scroll,
      onRefresh: _load,
      banner: const OfflineBanner(),
      actions: [
        if (t != null && !closed)
          _closing
              ? const SizedBox(width: 44, height: 44, child: Padding(padding: EdgeInsets.all(12), child: CircularProgressIndicator(strokeWidth: 2)))
              : CircleIconButton(Icons.task_alt_rounded, key: const Key('ticket-close'), tooltip: 'Close ticket', onPressed: online ? _close : null),
      ],
      footer: t == null || closed
          ? null
          : Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
              Expanded(
                child: TextField(
                  key: const Key('ticket-reply'),
                  controller: _reply,
                  minLines: 1,
                  maxLines: 4,
                  enabled: online && !_sending,
                  textInputAction: TextInputAction.newline,
                  decoration: const InputDecoration(hintText: 'Write a reply…'),
                ),
              ),
              const SizedBox(width: 8),
              _sending
                  ? const SizedBox(width: 44, height: 44, child: Padding(padding: EdgeInsets.all(12), child: CircularProgressIndicator(strokeWidth: 2)))
                  : CircleIconButton(Icons.send_rounded, key: const Key('ticket-send'), tooltip: 'Send reply', dark: true, onPressed: online ? _send : null),
            ]),
      children: children,
    );
  }
}

class _MessageBubble extends StatelessWidget {
  const _MessageBubble({required this.message, this.meId});

  final Json message;
  final String? meId;

  @override
  Widget build(BuildContext context) {
    final mine = message.s('author_type') != 'staff';
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        mainAxisAlignment: mine ? MainAxisAlignment.end : MainAxisAlignment.start,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          if (!mine) ...[
            const CircleAvatar(radius: 14, backgroundColor: AppColors.lemonSoft, child: Icon(Icons.support_agent_rounded, size: 16, color: AppColors.lemonInk)),
            const SizedBox(width: 8),
          ],
          Flexible(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 320),
              child: Container(
                padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
                decoration: BoxDecoration(
                  color: mine ? AppColors.sage100 : AppColors.surface,
                  boxShadow: mine ? null : AppShadows.card,
                  borderRadius: BorderRadius.only(
                    topLeft: const Radius.circular(AppRadius.inner),
                    topRight: const Radius.circular(AppRadius.inner),
                    bottomLeft: Radius.circular(mine ? AppRadius.inner : 6),
                    bottomRight: Radius.circular(mine ? 6 : AppRadius.inner),
                  ),
                ),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(!mine ? 'Support' : message.str('author_id') == meId ? 'You' : 'Your team', style: AppType.caption(mine ? AppColors.sage700 : AppColors.lemonInk)),
                  const SizedBox(height: 3),
                  SelectableText(message.s('body'), style: AppType.body()),
                  const SizedBox(height: 4),
                  Text(fmtDateTime(message.str('created_at')), style: AppType.caption(AppColors.faint)),
                ]),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
