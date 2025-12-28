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

  static Future<void> connectWebSocket({void Function(String message)? onMessage}) async {
    await _ensureWebSocketConnection(onMessage: onMessage);
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
        Uri.parse("${Config.apiBase}/auth/register"),
        headers: {"Content-Type": "application/json"},
        body: jsonEncode(body),
      );
      final decoded = jsonDecode(res.body);
      if (res.statusCode < 200 || res.statusCode >= 300) {
        final msg = decoded['error'] ?? decoded['message'] ?? res.statusCode;
        throw AuthException('$msg');
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
      final res = await http.post(
        Uri.parse("${Config.apiBase}/auth/login"),
        headers: {"Content-Type": "application/json"},
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
        final msg = (decoded is Map)
            ? (decoded['error'] ?? decoded['message'] ?? res.statusCode)
            : res.statusCode;
        throw AuthException('$msg');
      }

      final map = (decoded is Map<String, dynamic>) ? decoded : <String, dynamic>{};
      final token = map['token']?.toString();
      final refreshToken = map['refreshToken']?.toString();
      if (token == null || token.isEmpty) {
        throw AuthException('Missing access token');
      }
      AuthSession.setAccessToken(token);
      if (refreshToken != null && refreshToken.isNotEmpty) {
        await StorageService.write('refreshToken', refreshToken);
      }
      return map;
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
      Uri.parse("${Config.apiBase}/auth/me"),
    );
    if (res.statusCode >= 200 && res.statusCode < 300) {
      final decoded = jsonDecode(res.body);
      await StorageService.writeAll(decoded['user']);
      AuthSession.setAccessToken(AuthSession.accessToken);
    } else {
      AuthSession.clear();
    }
  }

  static Future<void> logout() async {
    try {
      final res = await _authed.post(
        Uri.parse("${Config.apiBase}/auth/logout"),
        body: jsonEncode({
          "refreshToken": await StorageService.read("refreshToken"),
        }),
      );
      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw ApiException('${res.statusCode}');
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
        Uri.parse("${Config.apiBase}/user/all"),
      );

      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw ApiException('Failed to fetch users: ${res.statusCode}');
      }

      final decoded = jsonDecode(res.body);
      if (decoded is Map && decoded['users'] is List) {
        return List<Map<String, dynamic>>.from(decoded['users']);
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
        Uri.parse("${Config.apiBase}/user/$userId"),
      );

      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw ApiException('Failed to fetch user: ${res.statusCode}');
      }

      final decoded = jsonDecode(res.body);
      if (decoded is Map<String, dynamic>) {
        return decoded;
      } else {
        throw ApiException('Invalid response format');
      }
    } catch (e) {
      if (e is ApiException) rethrow;
      throw NetworkException(e.toString());
    }
  }

  static Future<String?> getUserPublicKey(String userId) async {
    try {
      final res = await _authed.get(
        Uri.parse("${Config.apiBase}/user/$userId/public-key"),
      );

      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw ApiException('Failed to fetch public key: ${res.statusCode}');
      }

      final decoded = jsonDecode(res.body);
      if (decoded is Map && decoded['publicKey'] is String) {
        return decoded['publicKey'] as String;
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
        Uri.parse("${Config.apiBase}/user/contacts"),
      );
      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw ApiException('Failed to fetch contacts: ${res.statusCode}');
      }
      final decoded = jsonDecode(res.body);
      if (decoded is Map && decoded['contacts'] is List) {
        return List<Map<String, dynamic>>.from(decoded['contacts']);
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
        Uri.parse("${Config.apiBase}/messages/$receiverId"),
      );

      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw ApiException('Failed to fetch messages: ${res.statusCode}');
      }

      final decoded = jsonDecode(res.body);
      if (decoded is Map && decoded['messages'] is List) {
        return List<Map<String, dynamic>>.from(decoded['messages']);
      } else {
        throw ApiException('Invalid response format');
      }
    } catch (e) {
      if (e is ApiException) rethrow;
      throw NetworkException(e.toString());
    }
  }
}
