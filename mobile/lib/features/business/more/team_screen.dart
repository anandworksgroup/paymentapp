import 'package:flutter/material.dart';

import '../../../core/api/api.dart';
import '../../../core/format/dates.dart';
import '../../../shared/loaded_page.dart';
import '../../../theme/kit.dart';

/// Read-only team list. Membership changes are made on the web dashboard.
class TeamScreen extends StatelessWidget {
  const TeamScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return LoadedPage(
      title: 'Team',
      subtitle: 'Read-only on mobile',
      bottomInset: 32,
      load: (api) => api.get('/v1/team'),
      isEmpty: (d) => ApiList.from(d).data.isEmpty,
      emptyTitle: 'No team members',
      builder: (context, data, reload) {
        final members = ApiList.from(data).data;
        return [
          AppCard(
            padding: const EdgeInsets.fromLTRB(16, 6, 16, 6),
            child: Column(children: [
              for (var i = 0; i < members.length; i++) ...[
                if (i > 0) const Hairline(indent: 54),
                Builder(builder: (context) {
                  final m = members[i];
                  final u = m.obj('user') ?? {};
                  return Padding(
                    padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 4),
                    child: Row(children: [
                      CircleAvatar(
                        radius: 20,
                        backgroundColor: m.s('role') == 'owner' ? AppColors.lemonSoft : AppColors.sage100,
                        child: Text(u.s('name', '?').isEmpty ? '?' : u.s('name')[0], style: AppType.bodyMedium(AppColors.text2)),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(u.s('name'), style: AppType.bodyMedium()),
                          Text('${u.s('email')} · joined ${fmtDate(m.str('created_at'))}', style: AppType.label(), maxLines: 1, overflow: TextOverflow.ellipsis),
                        ]),
                      ),
                      Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                        AppChip(humanize(m.str('role')), dense: true, tone: m.s('role') == 'owner' ? Tone.lemon : Tone.neutral),
                        if (u.b('mfa_enabled')) ...[const SizedBox(height: 4), Text('2FA on', style: AppType.caption(AppColors.sage700))],
                      ]),
                    ]),
                  );
                }),
              ],
            ]),
          ),
          const SizedBox(height: 12),
          const NoticePanel('Invite members or change roles from the web dashboard.', icon: Icons.info_outline_rounded, tone: Tone.sage),
        ];
      },
    );
  }
}
