import 'package:flutter/foundation.dart';

class SecureLog {
  static void debug(String message) {
    if (!kDebugMode) return;
    debugPrint(_redact(message));
  }

  static String _redact(String s) {
    // Very small redaction helper: remove obvious bearer tokens.
    return s
        .replaceAll(RegExp(r'Bearer\s+[A-Za-z0-9\-\._~\+\/]+=*'), 'Bearer <redacted>')
        .replaceAll(RegExp(r'rt\.[A-Za-z0-9\-]+\.[A-Za-z0-9_\-]+'), 'rt.<redacted>.<redacted>');
  }
}
