/// Money display helpers. Amounts arrive as integer minor units plus an ISO currency code; the client
/// only formats them and never recomputes money (no floating point on any money path).
class CurrencyInfo {
  const CurrencyInfo(this.code, this.exponent, this.symbol);
  final String code;
  final int exponent;
  final String symbol;
}

class MoneyParts {
  const MoneyParts({required this.negative, required this.symbol, required this.whole, required this.fraction, required this.code});
  final bool negative;
  final String symbol;

  /// Grouped whole units, e.g. "8,499".
  final String whole;

  /// Fraction digits without the separator, e.g. "05"; empty for zero-exponent currencies.
  final String fraction;
  final String code;
}

abstract final class Money {
  /// Mirrors the backend currency table (Common/Money.cs).
  static const Map<String, CurrencyInfo> currencies = {
    'USD': CurrencyInfo('USD', 2, r'$'),
    'EUR': CurrencyInfo('EUR', 2, '€'),
    'GBP': CurrencyInfo('GBP', 2, '£'),
    'INR': CurrencyInfo('INR', 2, '₹'),
    'AUD': CurrencyInfo('AUD', 2, r'A$'),
    'CAD': CurrencyInfo('CAD', 2, r'C$'),
    'SGD': CurrencyInfo('SGD', 2, r'S$'),
    'AED': CurrencyInfo('AED', 2, 'AED '),
    'BRL': CurrencyInfo('BRL', 2, r'R$'),
    'JPY': CurrencyInfo('JPY', 0, '¥'),
    'BHD': CurrencyInfo('BHD', 3, 'BD '),
  };

  static CurrencyInfo info(String code) => currencies[code.toUpperCase()] ?? CurrencyInfo(code.toUpperCase(), 2, '');

  static int exponent(String code) => info(code).exponent;

  static String _group(String digits) {
    final b = StringBuffer();
    for (var i = 0; i < digits.length; i++) {
      if (i > 0 && (digits.length - i) % 3 == 0) b.write(',');
      b.write(digits[i]);
    }
    return b.toString();
  }

  static MoneyParts parts(int minor, String currency) {
    final ci = info(currency);
    final negative = minor < 0;
    final digits = minor.abs().toString().padLeft(ci.exponent + 1, '0');
    final split = digits.length - ci.exponent;
    final whole = digits.substring(0, split);
    final fraction = ci.exponent == 0 ? '' : digits.substring(split);
    return MoneyParts(negative: negative, symbol: ci.symbol, whole: _group(whole), fraction: fraction, code: ci.code);
  }

  /// "€8,499.00", or "€8,499.00 EUR" with [withCode]. [signed] prefixes "+" for positive values.
  static String format(int minor, String currency, {bool withCode = false, bool signed = false}) {
    final p = parts(minor, currency);
    final sign = p.negative ? '−' : (signed && minor > 0 ? '+' : '');
    final frac = p.fraction.isEmpty ? '' : '.${p.fraction}';
    return '$sign${p.symbol}${p.whole}$frac${withCode ? ' ${p.code}' : ''}';
  }

  /// Parses user input ("1,234.5") into minor units without floating point. Returns null when invalid.
  static int? parseInput(String input, String currency) {
    final exp = exponent(currency);
    final s = input.replaceAll(',', '').replaceAll(' ', '').trim();
    if (s.isEmpty) return null;
    final m = RegExp(r'^(\d{0,15})(?:\.(\d*))?$').firstMatch(s);
    if (m == null) return null;
    final whole = m.group(1) ?? '';
    var frac = m.group(2) ?? '';
    if (whole.isEmpty && frac.isEmpty) return null;
    if (frac.length > exp) return null;
    frac = frac.padRight(exp, '0');
    return int.parse('${whole.isEmpty ? '0' : whole}$frac');
  }

  /// Renders a minor-unit value back into an editable string ("1234.50").
  static String toInput(int minor, String currency) {
    final p = parts(minor, currency);
    return '${p.negative ? '-' : ''}${p.whole.replaceAll(',', '')}${p.fraction.isEmpty ? '' : '.${p.fraction}'}';
  }

  /// Maps a currency to a representative country for flag avatars.
  static String countryFor(String currency) => switch (currency.toUpperCase()) {
        'USD' => 'US',
        'EUR' => 'EU',
        'GBP' => 'GB',
        'INR' => 'IN',
        'AUD' => 'AU',
        'CAD' => 'CA',
        'SGD' => 'SG',
        'AED' => 'AE',
        'BRL' => 'BR',
        'JPY' => 'JP',
        'BHD' => 'BH',
        _ => currency.length >= 2 ? currency.substring(0, 2) : currency,
      };
}

/// Exchange rates are display-only ratios (never used to compute money on the client).
String formatRate(num rate) {
  if (rate == 0) return '0';
  final abs = rate.abs();
  final digits = abs >= 100 ? 2 : abs >= 1 ? 4 : 6;
  return rate.toStringAsFixed(digits);
}

/// Basis points as a percentage string: 50 → "0.50%".
String formatBps(int bps) {
  final whole = bps ~/ 100;
  final frac = (bps % 100).toString().padLeft(2, '0');
  return '$whole.$frac%';
}
