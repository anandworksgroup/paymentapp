import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../../core/api/api.dart';
import '../../../core/auth/auth_controller.dart';
import '../../../core/security/secure_screen.dart';
import '../../../shared/offline.dart';
import '../../../theme/kit.dart';
import '../wallet_model.dart';

/// Identity verification (`POST /v1/me/kyc`), then wallet activation (`POST /v1/wallet/activate`).
class KycScreen extends StatefulWidget {
  const KycScreen({super.key, this.level = 1, this.activateAfter = false});

  final int level;
  final bool activateAfter;

  @override
  State<KycScreen> createState() => _KycScreenState();
}

class _KycScreenState extends State<KycScreen> {
  final _name = TextEditingController();
  final _address = TextEditingController();
  DateTime? _dob;
  String? _country;
  String _doc = 'passport';
  List<Json> _countries = [];
  bool _busy = false;
  Object? _error;
  Json? _result;

  @override
  void initState() {
    super.initState();
    final auth = context.read<AuthController>();
    _name.text = auth.userName;
    _address.text = auth.user?.str('address') ?? '';
    _country = auth.user?.str('country');
    final dob = auth.user?.str('date_of_birth');
    if (dob != null) _dob = DateTime.tryParse(dob);
    _loadCountries();
  }

  Future<void> _loadCountries() async {
    try {
      final meta = Json.from(await context.read<Api>().get('/v1/meta') as Map);
      if (mounted) setState(() => _countries = meta.list('countries').where((c) => c.b('wallet_enabled')).toList());
    } catch (_) {}
  }

  @override
  void dispose() {
    _name.dispose();
    _address.dispose();
    super.dispose();
  }

  Future<void> _pickDob() async {
    final now = DateTime.now();
    final d = await showDatePicker(
      context: context,
      initialDate: _dob ?? DateTime(now.year - 30, 1, 1),
      firstDate: DateTime(1900),
      lastDate: now,
      helpText: 'Date of birth',
    );
    if (d != null) setState(() => _dob = d);
  }

  Future<void> _submit() async {
    if (_name.text.trim().isEmpty || _dob == null || _country == null || _address.text.trim().isEmpty) {
      setState(() => _error = 'Complete every field.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final api = context.read<Api>();
    try {
      final res = Json.from(await api.post('/v1/me/kyc', body: {
        'full_name': _name.text.trim(),
        'date_of_birth': DateFormat('yyyy-MM-dd').format(_dob!),
        'country': _country,
        'address': _address.text.trim(),
        'document_type': _doc,
        'level': widget.level,
      }) as Map);
      if (res.s('status') == 'VERIFIED' && widget.activateAfter && mounted) {
        await context.read<WalletModel>().activate();
      }
      if (mounted) await context.read<AuthController>().reloadWallet();
      if (mounted) {
        setState(() {
          _result = res;
          _busy = false;
        });
      }
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
    final online = canWrite(context);
    if (_result != null) return _resultPage();
    return SecureScreen(
      child: AppPage(
        title: widget.level > 1 ? 'Raise your limits' : 'Verify identity',
        subtitle: 'Level ${widget.level} verification',
        bottomInset: 24,
        banner: const OfflineBanner(),
        footer: PrimaryButton('Submit for verification', key: const Key('kyc-submit'), loading: _busy, onPressed: online ? _submit : null),
        children: [
          const NoticePanel('Sandbox KYC provider: no documents are uploaded. Your details are screened and checked instantly.', icon: Icons.science_outlined),
          const SizedBox(height: 14),
          AppCard(
            child: Column(children: [
              TextField(controller: _name, decoration: const InputDecoration(labelText: 'Full legal name'), textCapitalization: TextCapitalization.words),
              const SizedBox(height: 12),
              InkWell(
                onTap: _pickDob,
                borderRadius: BorderRadius.circular(AppRadius.field),
                child: InputDecorator(
                  decoration: const InputDecoration(labelText: 'Date of birth', suffixIcon: Icon(Icons.calendar_today_rounded, size: 18)),
                  child: Text(_dob == null ? 'Select' : DateFormat('d MMMM yyyy').format(_dob!), style: AppType.body(_dob == null ? AppColors.faint : AppColors.text)),
                ),
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                value: _countries.any((c) => c.s('country') == _country) ? _country : null,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Country of residence'),
                items: [
                  for (final c in _countries)
                    DropdownMenuItem(value: c.s('country'), child: Row(children: [FlagAvatar(c.s('country'), size: 22), const SizedBox(width: 10), Text(c.s('name'))])),
                ],
                onChanged: (v) => setState(() => _country = v),
              ),
              const SizedBox(height: 12),
              TextField(controller: _address, decoration: const InputDecoration(labelText: 'Residential address'), minLines: 1, maxLines: 3),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                value: _doc,
                decoration: const InputDecoration(labelText: 'Identity document'),
                items: const [
                  DropdownMenuItem(value: 'passport', child: Text('Passport')),
                  DropdownMenuItem(value: 'national_id', child: Text('National ID card')),
                  DropdownMenuItem(value: 'driving_licence', child: Text('Driving licence')),
                ],
                onChanged: (v) => setState(() => _doc = v ?? _doc),
              ),
            ]),
          ),
          InlineError(_error),
        ],
      ),
    );
  }

  Widget _resultPage() {
    final r = _result!;
    final status = r.s('status');
    final ok = status == 'VERIFIED';
    final tone = ok ? Tone.sage : status == 'REVIEW' ? Tone.peach : Tone.rose;
    return AppPage(
      title: 'Verification',
      bottomInset: 24,
      footer: PrimaryButton('Done', onPressed: () => Navigator.of(context).pop(true)),
      children: [
        AppCard(
          child: Column(children: [
            Container(
              width: 64,
              height: 64,
              decoration: BoxDecoration(color: tone.background, shape: BoxShape.circle),
              child: Icon(ok ? Icons.verified_rounded : Icons.hourglass_top_rounded, color: tone.foreground, size: 30),
            ),
            const SizedBox(height: 14),
            Text(ok ? 'You’re verified' : status == 'REVIEW' ? 'Under review' : 'We couldn’t verify you', style: AppType.h2()),
            const SizedBox(height: 6),
            Text(
              r.str('message') ??
                  (ok
                      ? (widget.activateAfter ? 'Your wallet is active.' : 'Your limits have been updated.')
                      : 'Please check your details and try again, or contact support.'),
              style: AppType.body(AppColors.text2),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 12),
            AppChip('KYC level ${r.i('kyc_level')}', tone: Tone.neutral, dense: true),
          ]),
        ),
      ],
    );
  }
}
