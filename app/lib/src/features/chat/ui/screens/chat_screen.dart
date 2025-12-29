import 'dart:convert';
import 'dart:async';

import 'package:chatapp/src/core/crypto/crypto_helper.dart';
import 'package:chatapp/src/core/crypto/conversation_keys.dart';
import 'package:chatapp/src/core/crypto/nonce_manager.dart';
import 'package:chatapp/src/core/crypto/trust_store.dart';
import 'package:cryptography/cryptography.dart';
import 'package:flutter/material.dart';
import 'package:chatapp/src/core/storage/storage_service.dart';
import 'package:chatapp/src/core/crypto/crypto_service.dart';
import 'package:chatapp/src/core/networking/api_service.dart';

class ChatScreen extends StatefulWidget {
  final int receiverId;
  final String receiverPublicKeyBase64;
  final String title;

  const ChatScreen({
    super.key,
    required this.receiverId,
    required this.receiverPublicKeyBase64,
    this.title = 'Chat',
  });

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class Message {
  final String text;
  final String senderId;
  final DateTime timestamp;

  Message({
    String? id,
    required this.text,
    required this.senderId,
    DateTime? timestamp,
  }) : timestamp = timestamp ?? DateTime.now();

  factory Message.fromJson(Map<String, dynamic> json) {
    return Message(
      text: json['text'] as String,
      senderId: json['senderId'] as String,
      timestamp: DateTime.parse(json['timestamp'] as String),
    );
  }
}

class _ChatScreenState extends State<ChatScreen> {
  final List<Message> _messages = [];
  final TextEditingController _controller = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  bool _isSending = false;
  String? _myId;
  int? _myIdInt;
  ConversationKeys? _keys;
  StreamSubscription<String>? _wsSub;

  @override
  void initState() {
    super.initState();
    _initCryptoAndSocket();
    WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToBottom());
  }

  Future<void> _initCryptoAndSocket() async {
    try {
      // Cache my id for comparison and UI alignment
      _myId = await StorageService.read("id");
      _myIdInt = int.tryParse(_myId ?? '');
      if (_myIdInt == null) {
        throw Exception('Missing local user id');
      }

      final theirPublic = base64Decode(widget.receiverPublicKeyBase64);
      final trust = await TrustStore.checkAndPin(
        userId: widget.receiverId,
        publicKeyBytes: theirPublic,
      );
      if (trust.status == 'changed') {
        if (!mounted) return;
        final proceed = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('Security warning'),
            content: Text(
              'The contact\'s public key has changed.\n\n'
              'Pinned: ${trust.pinned}\n'
              'Current: ${trust.current}\n\n'
              'Only continue if you confirmed this change out-of-band.',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('Cancel'),
              ),
              ElevatedButton(
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('Trust new key'),
              ),
            ],
          ),
        );
        if (proceed != true) {
          if (mounted) Navigator.of(context).pop();
          return;
        }
        await TrustStore.updatePinned(userId: widget.receiverId, fingerprintBase64: trust.current);
      }

      // Derive shared secret once, then HKDF-expand directional keys.
      final myPrivateBase64 = await CryptoHelper().decryptPrivateKey();
      final myPrivate = base64Decode(myPrivateBase64);

      final shared = await CryptoService.deriveSharedSecret(
        myPrivateKey: myPrivate,
        theirPublicKey: theirPublic,
      );

      final myPublicB64 = await StorageService.read('public_key');
      if (myPublicB64 == null || myPublicB64.isEmpty) {
        throw Exception('Missing local public key');
      }
      final myPublic = base64Decode(myPublicB64);
      final sharedBytes = await shared.extractBytes();
      _keys = await deriveConversationKeys(
        sharedSecret: sharedBytes,
        myPublicKey: myPublic,
        peerPublicKey: theirPublic,
        myId: _myIdInt!,
        peerId: widget.receiverId,
      );

      // Load existing messages after we have crypto ready
      await _loadMessages();

      // Connect WebSocket and listen for new messages
      await ApiService.connectWebSocket();
      _wsSub?.cancel();
      _wsSub = ApiService.webSocketMessages.listen(_onWsMessage);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('Realtime setup failed: $e')));
    }
  }

  Future<void> _loadMessages() async {
    try {
      final messages = await ApiService.fetchMessagesForReceiver(
        widget.receiverId,
      );
      final keys = _keys;
      final myId = _myIdInt;
      if (keys == null || myId == null) return;

      final decrypted = await Future.wait(
        messages.map((m) async {
          final encrypted = jsonDecode(m['encrypted_message']);
          final senderId = int.tryParse((m['senderId'] ?? m['sender_id']).toString());
          final key = (senderId != null && senderId == myId) ? keys.sendKey : keys.recvKey;
          final box = SecretBox(
            base64Decode(encrypted['cipherText']),
            nonce: base64Decode(encrypted['nonce']),
            mac: Mac(base64Decode(encrypted['mac'])),
          );
          final plaintextBytes = await CryptoService.decrypt(box, key);
          final text = utf8.decode(plaintextBytes);
          return Message(
            text: text,
            senderId: (m['senderId'] ?? m['sender_id']).toString(),
            timestamp: DateTime.parse(m['timestamp'] as String),
          );
        }),
      );

      if (!mounted) return;
      setState(() {
        _messages.addAll(decrypted);
      });
      WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToBottom());
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('Failed to load messages: $e')));
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    _scrollController.dispose();
    _wsSub?.cancel();
    super.dispose();
  }

  void _scrollToBottom() {
    if (!_scrollController.hasClients) return;
    _scrollController.animateTo(
      _scrollController.position.maxScrollExtent,
      duration: const Duration(milliseconds: 200),
      curve: Curves.easeOut,
    );
  }

  Future<void> _sendMessage() async {
    final text = _controller.text.trim();
    if (text.isEmpty) return;
    setState(() => _isSending = true);

    try {
      final keys = _keys;
      final myId = _myIdInt;
      if (keys == null || myId == null) {
        throw Exception('Crypto not initialized');
      }

      final nonce = await NonceManager.nextNonce(
        myId: myId,
        peerId: widget.receiverId,
        nonceKey: keys.sendNonceKey,
      );
      final box = await CryptoService.encryptWithNonce(
        utf8.encode(text),
        keys.sendKey,
        nonce,
      );

      final payload = jsonEncode({
        'cipherText': base64Encode(box.cipherText),
        'nonce': base64Encode(box.nonce),
        'mac': base64Encode(box.mac.bytes),
      });

      // Send to backend. Server should authenticate sender by token.
      await ApiService.sendMessage(
        receiverId: widget.receiverId,
        encryptedMessage: payload,
      );
      final message = Message(text: text, senderId: (_myId ?? ''));

      setState(() {
        _messages.add(message);
        _controller.clear();
        _isSending = false;
      });

      WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToBottom());
    } catch (e) {
      setState(() => _isSending = false);
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Send failed: $e')));
      }
    }
  }

  void _onWsMessage(String event) async {
    try {
      final decoded = jsonDecode(event);
      if (decoded is! Map || decoded['type'] != 'message') return;
      final payload = decoded['payload'];
      if (payload is! Map) return;

      final senderId = payload['sender_id'];
      final receiverId = payload['receiver_id'];
      final enc = payload['encrypted_message'];

      // Only handle messages coming from this chat partner to me
      final myIdInt = int.tryParse(
        (_myId ?? await StorageService.read('id')) ?? '',
      );
      if (senderId != widget.receiverId ||
          myIdInt == null ||
          receiverId != myIdInt) {
        return;
      }

      final keys = _keys;
      if (keys == null) return;

      final encJson = (enc is String) ? jsonDecode(enc) : enc;
      final box = SecretBox(
        base64Decode(encJson['cipherText'] as String),
        nonce: base64Decode(encJson['nonce'] as String),
        mac: Mac(base64Decode(encJson['mac'] as String)),
      );
      final plainBytes = await CryptoService.decrypt(box, keys.recvKey);
      final text = utf8.decode(plainBytes);

      if (!mounted) return;
      setState(() {
        _messages.add(
          Message(
            text: text,
            senderId: senderId.toString(),
            timestamp: DateTime.now(),
          ),
        );
      });
      WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToBottom());
    } catch (_) {
      // Ignore malformed events
    }
  }

  Widget _buildMessageBubble(Message m) {
    final bool isMe = (_myId != null && m.senderId == _myId);
    final alignment = isMe ? CrossAxisAlignment.end : CrossAxisAlignment.start;
    final bg = isMe ? Colors.blueAccent : Colors.grey.shade200;
    final textColor = isMe ? Colors.white : Colors.black87;

    return Column(
      crossAxisAlignment: alignment,
      children: [
        Container(
          margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          constraints: const BoxConstraints(maxWidth: 560),
          decoration: BoxDecoration(
            color: bg,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Text(m.text, style: TextStyle(color: textColor)),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12.0),
          child: Text(
            _formatTimestamp(m.timestamp),
            style: const TextStyle(fontSize: 10, color: Colors.grey),
          ),
        ),
      ],
    );
  }

  String _formatTimestamp(DateTime t) {
    final time = TimeOfDay.fromDateTime(t);
    final hour = time.hourOfPeriod == 0 ? 12 : time.hourOfPeriod;
    final period = time.period == DayPeriod.am ? 'AM' : 'PM';
    return '$hour:${time.minute.toString().padLeft(2, '0')} $period';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: ListView.builder(
                controller: _scrollController,
                padding: const EdgeInsets.only(top: 12, bottom: 12),
                itemCount: _messages.length,
                itemBuilder: (context, index) {
                  final msg = _messages[index];
                  return Align(
                    alignment: (_myId != null && msg.senderId == _myId)
                        ? Alignment.centerRight
                        : Alignment.centerLeft,
                    child: _buildMessageBubble(msg),
                  );
                },
              ),
            ),
            const Divider(height: 1),
            Container(
              color: Theme.of(context).scaffoldBackgroundColor,
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _controller,
                      textInputAction: TextInputAction.send,
                      onSubmitted: (_) => _sendMessage(),
                      decoration: const InputDecoration(
                        hintText: 'Type a message',
                        border: OutlineInputBorder(borderSide: BorderSide.none),
                        isDense: true,
                      ),
                    ),
                  ),
                  IconButton(
                    icon: _isSending
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.send),
                    onPressed: _isSending ? null : _sendMessage,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
