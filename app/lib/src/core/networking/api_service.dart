import 'dart:convert';
import 'package:chatapp/src/core/errors/exceptions.dart';
import 'package:chatapp/src/core/networking/auth_session.dart';
import 'package:chatapp/src/core/networking/authenticated_http_client.dart';
import 'package:chatapp/src/core/storage/storage_service.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:chatapp/src/core/config/config.dart';
import 'package:chatapp/src/core/networking/websocket_service.dart';

class ApiService {
  static final ValueNotifier<bool> isLoggedIn = AuthSession.isLoggedIn;
  static final WebSocketService _webSocket = WebSocketService();
  static final AuthenticatedHttpClient _authed = AuthenticatedHttpClient();

  static Stream<String> get webSocketMessages => _webSocket.messages;

  static Uri _uri(String path) {
    final base = Config.apiBase;
    if (base.isEmpty) {
      throw StateError('Missing API_BASE. Provide --dart-define=API_BASE=https://<host>/api/v1');
    }
    final normalizedBase = base.endsWith('/') ? base.substring(0, base.length - 1) : base;
    final normalizedPath = path.startsWith('/') ? path : '/$path';
    return Uri.parse('$normalizedBase$normalizedPath');
  }

  static ({bool success, String message, Map<String, dynamic> data}) _decodeEnvelope(http.Response res) {
    final body = res.body;
    if (body.isEmpty) {
      return (success: false, message: 'empty response', data: <String, dynamic>{});
    }
    final decoded = jsonDecode(body);
    if (decoded is! Map) {
      return (success: false, message: 'invalid response', data: <String, dynamic>{});
    }
    final success = decoded['success'] == true;
    final message = decoded['message']?.toString() ?? (success ? 'ok' : 'error');
    final dataRaw = decoded['data'];
    final data = (dataRaw is Map<String, dynamic>) ? dataRaw : <String, dynamic>{};
    return (success: success, message: message, data: data);
  }

  static Future<void> connectWebSocket({void Function(String message)? onMessage}) async {
    await _ensureWebSocketConnection(onMessage: onMessage);
  }

  static void clearWebSocketHandler() {
    _webSocket.updateHandler(null);
  }

  static Future<void> disconnectWebSocket() async {
    await _webSocket.disconnect();
  }


  static Future<void> _ensureWebSocketConnection({void Function(String message)? onMessage}) async {
    if (_webSocket.isConnected) {
      if (onMessage != null) {
        _webSocket.updateHandler(onMessage);
      }
      return;
    }

    final token = AuthSession.accessToken;
    if (token == null || token.isEmpty) {
      throw AuthException('Not authenticated');
    }
    _webSocket.connect(token: token, onMessage: onMessage);
  }

  static Future<void> register(Map<String, dynamic> body) async {
    try {
      final res = await http.post(
        _uri('/auth/register'),
        headers: {"Content-Type": "application/json"},
        body: jsonEncode(body),
      );
      final env = _decodeEnvelope(res);
      if (res.statusCode < 200 || res.statusCode >= 300 || !env.success) {
        throw AuthException(env.message);
      }
    } catch (e) {
      if (e is AuthException) rethrow;
      throw NetworkException(e.toString());
    }
  }

  static Future<Map<String, dynamic>> login({
    required String email,
    required String password,
  }) async {
    try {
      final deviceId = await AuthenticatedHttpClient.getOrCreateDeviceId();
      final res = await http.post(
        _uri('/auth/login'),
        headers: {
          "Content-Type": "application/json",
          if (deviceId != null) 'x-device-id': deviceId,
        },
        body: jsonEncode({"email": email, "password": password}),
      );

      dynamic decoded;
      if (res.body.isNotEmpty) {
        try {
          decoded = jsonDecode(res.body);
        } catch (_) {
          decoded = null;
        }
      }

      if (res.statusCode < 200 || res.statusCode >= 300) {
        final msg = (decoded is Map) ? (decoded['message'] ?? res.statusCode) : res.statusCode;
        throw AuthException('$msg');
      }

      final env = _decodeEnvelope(res);
      if (!env.success) throw AuthException(env.message);

      final token = env.data['token']?.toString();
      final refreshToken = env.data['refreshToken']?.toString();
      if (token == null || token.isEmpty) {
        throw AuthException('Missing access token');
      }
      AuthSession.setAccessToken(token);
      if (refreshToken != null && refreshToken.isNotEmpty) {
        await StorageService.write('refreshToken', refreshToken);
      }
      return env.data;
    } catch (e) {
      if (e is AuthException) rethrow;
      throw NetworkException(e.toString());
    }
  }

  static Future<void> checkLogin() async {
    // If we don't have an access token yet, try refreshing using refresh token.
    if (AuthSession.accessToken == null) {
      // This will set access token if refresh succeeds.
      await AuthenticatedHttpClient.refreshIfPossible();
    }

    final res = await _authed.get(
      _uri('/auth/me'),
    );
    if (res.statusCode >= 200 && res.statusCode < 300) {
      final env = _decodeEnvelope(res);
      final user = env.data['user'];
      if (env.success && user is Map) {
        await StorageService.writeAll(Map<String, dynamic>.from(user));
      } else {
        AuthSession.clear();
        return;
      }
      AuthSession.setAccessToken(AuthSession.accessToken);
    } else {
      AuthSession.clear();
    }
  }

  static Future<void> logout() async {
    try {
      final deviceId = await AuthenticatedHttpClient.getOrCreateDeviceId();
      final res = await _authed.post(
        _uri('/auth/logout'),
        headers: {
          if (deviceId != null) 'x-device-id': deviceId,
        },
        body: jsonEncode({
          "refreshToken": await StorageService.read("refreshToken"),
        }),
      );
      final env = _decodeEnvelope(res);
      if (res.statusCode < 200 || res.statusCode >= 300 || !env.success) {
        throw ApiException(env.message);
      }
      await _webSocket.disconnect();
      await StorageService.deleteAll();
      AuthSession.clear();
    } catch (e) {
      if (e is ApiException) rethrow;
      throw NetworkException(e.toString());
    }
  }

  static Future<List<Map<String, dynamic>>> getAllUsers() async {
    try {
      final res = await _authed.get(
        _uri('/user/all'),
      );

      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw ApiException('Failed to fetch users: ${res.statusCode}');
      }

      final env = _decodeEnvelope(res);
      final users = env.data['users'];
      if (env.success && users is List) {
        return List<Map<String, dynamic>>.from(users);
      } else {
        throw ApiException('Invalid response format');
      }
    } catch (e) {
      if (e is ApiException) rethrow;
      throw NetworkException(e.toString());
    }
  }

  static Future<Map<String, dynamic>> getUserById(String userId) async {
    try {
      final res = await _authed.get(
        _uri('/user/$userId'),
      );

      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw ApiException('Failed to fetch user: ${res.statusCode}');
      }

      final env = _decodeEnvelope(res);
      return env.data;
    } catch (e) {
      if (e is ApiException) rethrow;
      throw NetworkException(e.toString());
    }
  }

  static Future<String?> getUserPublicKey(String userId) async {
    try {
      final res = await _authed.get(
        _uri('/user/$userId/public-key'),
      );

      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw ApiException('Failed to fetch public key: ${res.statusCode}');
      }

      final env = _decodeEnvelope(res);
      final pk = env.data['publicKey'];
      if (env.success && pk is String) {
        return pk;
      }
      return null;
    } catch (e) {
      if (e is ApiException) rethrow;
      throw NetworkException(e.toString());
    }
  }

  static Future<List<Map<String, dynamic>>> getAllContacts() async {
    try {
      final res = await _authed.get(
        _uri('/user/contacts'),
      );
      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw ApiException('Failed to fetch contacts: ${res.statusCode}');
      }
      final env = _decodeEnvelope(res);
      final contacts = env.data['contacts'];
      if (env.success && contacts is List) {
        return List<Map<String, dynamic>>.from(contacts);
      } else {
        throw ApiException('Invalid response format');
      }
    } catch (e) {
      if (e is ApiException) rethrow;
      throw NetworkException(e.toString());
    }
  }

  /// Send an encrypted message to a receiver. The server should use the
  /// authenticated user from the token as the sender.
  static Future<void> sendMessage({
    required int receiverId,
    required String encryptedMessage,
  }) async {
    try {
      await _ensureWebSocketConnection();
      final senderIdRaw = await StorageService.read("id");
      final senderId = int.tryParse(senderIdRaw ?? '');
      if (senderId == null) {
        throw AuthException('Missing local user id');
      }
      _webSocket.send({
        'type': 'message',
        'payload': {
          'sender_id': senderId,
          'receiver_id': receiverId,
          'encrypted_message': encryptedMessage,
        },
      });
    } on AuthException {
      rethrow;
    } catch (e) {
      throw NetworkException(e.toString());
    }
  }

  static Future<List<Map<String, dynamic>>> fetchMessagesForReceiver(int receiverId) async {
    try {
      final res = await _authed.get(
        _uri('/messages/$receiverId'),
      );

      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw ApiException('Failed to fetch messages: ${res.statusCode}');
      }

      final env = _decodeEnvelope(res);
      final messages = env.data['messages'];
      if (env.success && messages is List) {
        return List<Map<String, dynamic>>.from(messages);
      } else {
        throw ApiException('Invalid response format');
      }
    } catch (e) {
      if (e is ApiException) rethrow;
      throw NetworkException(e.toString());
    }
  }
}
