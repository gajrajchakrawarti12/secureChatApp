import 'package:chatapp/src/core/navigation/navigation_service.dart';
import 'package:chatapp/src/core/networking/api_service.dart';
import 'package:chatapp/src/core/networking/auth_session.dart';
import 'package:chatapp/src/features/chat/ui/screens/chat_screen.dart';
import 'package:flutter/material.dart';

class PushRouter {
  static Future<void> handleTap(Map<String, dynamic> data) async {
    final senderIdRaw = (data['sender_id'] ?? data['from'] ?? data['senderId'])?.toString();
    final senderId = int.tryParse(senderIdRaw ?? '');
    if (senderId == null) return;
    if (!AuthSession.isLoggedIn.value) return;

    final pubKeyBase64 = await ApiService.getUserPublicKey(senderId.toString());
    if (pubKeyBase64 == null) return;

    await NavigationService.push(
      MaterialPageRoute(
        builder: (_) => ChatScreen(
          receiverId: senderId,
          receiverPublicKeyBase64: pubKeyBase64,
          title: 'Chat',
        ),
      ),
    );
  }
}
