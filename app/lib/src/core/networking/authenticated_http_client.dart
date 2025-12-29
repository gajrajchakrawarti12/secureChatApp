import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:chatapp/src/core/config/config.dart';
import 'package:chatapp/src/core/errors/exceptions.dart';
import 'package:chatapp/src/core/networking/auth_session.dart';
import 'package:chatapp/src/core/logging/secure_log.dart';
import 'package:chatapp/src/core/storage/storage_service.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

class AuthenticatedHttpClient {
  AuthenticatedHttpClient({http.Client? inner}) : _inner = inner ?? http.Client();

  final http.Client _inner;

  Future<http.Response> get(Uri url, {Map<String, String>? headers}) {
    return _send('GET', url, headers: headers);
  }

  Future<http.Response> post(Uri url, {Map<String, String>? headers, Object? body}) {
    return _send('POST', url, headers: headers, body: body);
  }

  Future<http.Response> _send(
    String method,
    Uri url, {
    Map<String, String>? headers,
    Object? body,
    bool retriedAfterRefresh = false,
  }) async {
    final access = AuthSession.accessToken;

    final merged = <String, String>{
      'Content-Type': 'application/json',
      if (headers != null) ...headers,
      if (access != null) 'Authorization': 'Bearer $access',
    };

    http.Response res;
    try {
      switch (method) {
        case 'GET':
          res = await _inner.get(url, headers: merged);
          break;
        case 'POST':
          res = await _inner.post(url, headers: merged, body: body);
          break;
        default:
          throw StateError('Unsupported method $method');
      }
    } catch (e) {
      throw NetworkException(e.toString());
    }

    if (res.statusCode != 401) return res;
    if (retriedAfterRefresh) return res;

    final refreshed = await _refreshSingleFlight();
    if (!refreshed) return res;

    return _send(method, url, headers: headers, body: body, retriedAfterRefresh: true);
  }

  static Completer<bool>? _refreshInFlight;

  static Future<bool> refreshIfPossible() => _refreshSingleFlight();

  static Future<bool> _refreshSingleFlight() async {
    final existing = _refreshInFlight;
    if (existing != null) return existing.future;

    final c = Completer<bool>();
    _refreshInFlight = c;
    try {
      final ok = await _doRefresh();
      c.complete(ok);
      return ok;
    } catch (e) {
      if (!c.isCompleted) c.complete(false);
      if (kDebugMode) {
        SecureLog.debug('Refresh failed: $e');
      }
      return false;
    } finally {
      _refreshInFlight = null;
    }
  }

  static Future<bool> _doRefresh() async {
    final refresh = await StorageService.read('refreshToken');
    if (refresh == null || refresh.isEmpty) {
      AuthSession.clear();
      return false;
    }

    final deviceId = await getOrCreateDeviceId();

    http.Response res;
    try {
      res = await http.post(
        Uri.parse('${Config.apiBase}/auth/refresh'),
        headers: {
          'Content-Type': 'application/json',
          if (deviceId != null) 'x-device-id': deviceId,
        },
        body: jsonEncode({'refreshToken': refresh}),
      );
    } catch (e) {
      throw NetworkException(e.toString());
    }

    if (res.statusCode < 200 || res.statusCode >= 300) {
      AuthSession.clear();
      await StorageService.delete('refreshToken');
      return false;
    }

    final decoded = jsonDecode(res.body);
    if (decoded is! Map) {
      AuthSession.clear();
      return false;
    }
    
    final success = decoded['success'] == true;
    final data = decoded['data'];
    if (!success || data is! Map) {
      AuthSession.clear();
      await StorageService.delete('refreshToken');
      return false;
    }

    final token = data['token']?.toString();
    final newRefresh = data['refreshToken']?.toString();

    if (token == null || token.isEmpty) {
      AuthSession.clear();
      return false;
    }

    AuthSession.setAccessToken(token);
    if (newRefresh != null && newRefresh.isNotEmpty) {
      await StorageService.write('refreshToken', newRefresh);
    }

    return true;
  }

  static Future<String?> getOrCreateDeviceId() async {
    const key = 'deviceId';
    final existing = await StorageService.read(key);
    if (existing != null && existing.isNotEmpty) return existing;

    final id = _randomId();
    await StorageService.write(key, id);
    return id;
  }

  static String _randomId() {
    final rng = Random.secure();
    final bytes = List<int>.generate(16, (_) => rng.nextInt(256));
    return 'dev_${base64UrlEncode(bytes)}';
  }
}
