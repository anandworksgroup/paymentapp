import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:share_plus/share_plus.dart';

import '../../../shared/offline.dart';
import '../../../theme/kit.dart';
import '../wallet_model.dart';

/// Receive: the wallet handle as text and QR code, with copy and share.
class ReceiveScreen extends StatelessWidget {
  const ReceiveScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final w = context.watch<WalletModel>();
    final handle = w.handle;
    return AppPage(
      title: 'Receive',
      bottomInset: 24,
      children: [
        if (handle.isEmpty)
          const AppCard(child: EmptyView(title: 'No wallet handle yet', message: 'Activate your wallet to receive money.', icon: Icons.qr_code_rounded))
        else
          AppCard(
            child: Column(children: [
              Text('Your wallet handle', style: AppType.label()),
              const SizedBox(height: 6),
              SelectableText(handle, style: AppType.h1(), key: const Key('receive-handle')),
              const SizedBox(height: 18),
              Container(
                padding: const EdgeInsets.all(18),
                decoration: BoxDecoration(color: AppColors.sage100, borderRadius: BorderRadius.circular(AppRadius.inner)),
                child: QrImageView(
                  data: handle,
                  size: 210,
                  backgroundColor: AppColors.sage100,
                  eyeStyle: const QrEyeStyle(eyeShape: QrEyeShape.circle, color: AppColors.ink),
                  dataModuleStyle: const QrDataModuleStyle(dataModuleShape: QrDataModuleShape.circle, color: AppColors.ink),
                  semanticsLabel: 'QR code for $handle',
                ),
              ),
              const SizedBox(height: 14),
              Text('Anyone with a Global Wallet can send you money using this handle or your email.', style: AppType.small(AppColors.muted), textAlign: TextAlign.center),
              const SizedBox(height: 18),
              Row(children: [
                Expanded(
                  child: SecondaryButton('Copy', icon: Icons.copy_rounded, onPressed: () async {
                    await Clipboard.setData(ClipboardData(text: handle));
                    if (context.mounted) showToast(context, 'Handle copied');
                  }),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: PrimaryButton('Share', icon: Icons.ios_share_rounded, onPressed: () => Share.share('Send me money on Global Wallet: $handle', subject: 'My wallet handle')),
                ),
              ]),
            ]),
          ),
      ],
    );
  }
}
