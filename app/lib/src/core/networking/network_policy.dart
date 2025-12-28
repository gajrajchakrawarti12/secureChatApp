import 'package:chatapp/src/core/config/config.dart';
import 'package:flutter/foundation.dart';

class NetworkPolicy {
  static void enforceSecureTransport() {
    if (!kReleaseMode) return;

    final api = Uri.parse(Config.apiBase);
    final ws = Uri.parse(Config.wsUrl);

    if (api.scheme != 'https') {
      throw StateError('In release mode, API_BASE must use https');
    }
    if (ws.scheme != 'wss') {
      throw StateError('In release mode, WS_URL must use wss');
    }
  }
}
