import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:web_socket_channel/io.dart';
import 'package:chatapp/src/core/config/config.dart';

class WebSocketService {
  WebSocketChannel? _channel;
  StreamSubscription? _subscription;
  void Function(String message)? _handler;
  final StreamController<String> _messagesController = StreamController<String>.broadcast();

  Stream<String> get messages => _messagesController.stream;

  bool get isConnected => _channel != null;

  void connect({required String token, void Function(String message)? onMessage}) {
    if (_channel != null) {
      if (onMessage != null) {
        _handler = onMessage;
      }
      return;
    }

    _handler = onMessage;
    final uri = Uri.parse(Config.wsUrl);

    // Prefer subprotocol auth so it works on web too.
    // Backend accepts: Sec-WebSocket-Protocol: bearer,<token>
    final protocols = <String>['bearer', token];

    final WebSocketChannel channel;
    if (kIsWeb) {
      channel = WebSocketChannel.connect(uri, protocols: protocols);
    } else {
      channel = IOWebSocketChannel.connect(
        uri,
        headers: {'Authorization': 'Bearer $token'},
        protocols: protocols,
      );
    }
    _channel = channel;
    _subscription = channel.stream.listen(
      _onData,
      onDone: _handleClose,
      onError: (_) => _handleClose(),
    );
  }

  void updateHandler(void Function(String message)? onMessage) {
    _handler = onMessage;
  }

  void send(Map<String, dynamic> data) {
    final channel = _channel;
    if (channel == null) {
      throw StateError('WebSocket not connected');
    }
    channel.sink.add(jsonEncode(data));
  }

  Future<void> disconnect() async {
    await _subscription?.cancel();
    _subscription = null;
    final channel = _channel;
    _channel = null;
    await channel?.sink.close();
  }

  void _onData(dynamic event) {
    if (event is! String) return;

    _messagesController.add(event);

    final handler = _handler;
    if (handler != null) {
      handler(event);
    }
  }

  void _handleClose() {
    _subscription?.cancel();
    _subscription = null;
    _channel = null;
  }
}
