import 'package:flutter/foundation.dart';

/// In-memory auth state.
///
/// - Access token is kept only in memory.
/// - Refresh token remains in secure storage (see [StorageService] usage in ApiService).
class AuthSession {
  static final ValueNotifier<bool> isLoggedIn = ValueNotifier<bool>(false);

  static String? _accessToken;

  static String? get accessToken => _accessToken;

  static void setAccessToken(String? token) {
    _accessToken = (token == null || token.isEmpty) ? null : token;
    isLoggedIn.value = _accessToken != null;
  }

  static void clear() {
    _accessToken = null;
    isLoggedIn.value = false;
  }
}
