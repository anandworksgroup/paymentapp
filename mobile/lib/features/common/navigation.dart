import 'package:flutter/material.dart';

import '../business/customers/customer_detail_screen.dart';
import '../business/more/disputes_screen.dart';
import '../business/more/payouts_screen.dart';
import '../business/payments/payment_detail_screen.dart';
import '../business/subscriptions/subscription_detail_screen.dart';
import '../wallet/activity/transfer_detail_screen.dart';

Future<T?> push<T>(BuildContext context, Widget screen) => Navigator.of(context).push<T>(MaterialPageRoute(builder: (_) => screen));

/// Deep link from a notification (object_type + object_id) to the screen that shows it.
/// Returns false when the object type has no screen in the app.
bool openObject(BuildContext context, String? type, String? id, {required bool businessMode}) {
  if (type == null || id == null || id.isEmpty) return false;
  final Widget? screen = switch (type) {
    'payment' when businessMode => PaymentDetailScreen(id: id),
    'dispute' when businessMode => DisputeDetailScreen(id: id),
    'payout' when businessMode => PayoutDetailScreen(id: id),
    'subscription' when businessMode => SubscriptionDetailScreen(id: id),
    'customer' when businessMode => CustomerDetailScreen(id: id),
    'transfer' => TransferDetailScreen(id: id),
    _ => null,
  };
  if (screen == null) return false;
  push(context, screen);
  return true;
}
