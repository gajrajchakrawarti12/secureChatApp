import 'dart:convert';
import 'dart:io' show Platform;

import 'package:chatapp/src/core/storage/storage_service.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

class PushNotificationService {
  static bool _initialized = false;
  static bool _enabled = true;

  static final FlutterLocalNotificationsPlugin _plugin = FlutterLocalNotificationsPlugin();

  static const AndroidNotificationChannel _channel = AndroidNotificationChannel(
    'messages',
    'Messages',
    description: 'Incoming chat messages',
    importance: Importance.high,
  );

  static Future<void> init() async {
    if (_initialized) return;
    if (kIsWeb) {
      _initialized = true;
      return;
    }

    // This app primarily targets mobile push-style notifications.
    // Desktop support requires extra native setup (and differs per platform),
    // so we no-op on Windows/Linux to avoid runtime crashes.
    if (Platform.isWindows || Platform.isLinux) {
      _initialized = true;
      _enabled = false;
      return;
    }

    try {
      const androidInit = AndroidInitializationSettings('@mipmap/ic_launcher');
      const iosInit = DarwinInitializationSettings(
        requestAlertPermission: false,
        requestBadgePermission: false,
        requestSoundPermission: false,
      );

      await _plugin.initialize(
        const InitializationSettings(android: androidInit, iOS: iosInit),
      );

      final androidImpl = _plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
      await androidImpl?.createNotificationChannel(_channel);

      // Request runtime permissions (Android 13+, iOS).
      await androidImpl?.requestNotificationsPermission();
      final iosImpl = _plugin.resolvePlatformSpecificImplementation<IOSFlutterLocalNotificationsPlugin>();
      await iosImpl?.requestPermissions(alert: true, badge: true, sound: true);
      final macImpl = _plugin.resolvePlatformSpecificImplementation<MacOSFlutterLocalNotificationsPlugin>();
      await macImpl?.requestPermissions(alert: true, badge: true, sound: true);

      _initialized = true;
    } on MissingPluginException {
      // Typically happens right after adding a plugin and doing hot-reload/hot-restart.
      // A full stop + `flutter clean` + reinstall fixes it.
      _initialized = true;
      _enabled = false;
    } on ArgumentError {
      // Platform-specific initialization requirements not met.
      _initialized = true;
      _enabled = false;
    }
  }

  static Future<void> enable() async {
    _enabled = true;
    await init();
  }

  static Future<void> disable() async {
    _enabled = false;
  }

  /// Call this for every incoming WebSocket event.
  /// If it is a chat message addressed to me, show a local notification.
  static Future<void> handleWebSocketEvent(String event) async {
    if (!_enabled) return;
    await init();
    if (kIsWeb) return;
    if (!_enabled) return;

    try {
      final decoded = jsonDecode(event);
      if (decoded is! Map || decoded['type'] != 'message') return;
      final payload = decoded['payload'];
      if (payload is! Map) return;

      final myIdRaw = await StorageService.read('id');
      final myId = int.tryParse(myIdRaw ?? '');
      if (myId == null) return;

      final senderId = int.tryParse(payload['sender_id']?.toString() ?? '');
      final receiverId = int.tryParse(payload['receiver_id']?.toString() ?? '');
      if (senderId == null || receiverId == null) return;
      if (receiverId != myId) return;

      await _show(
        id: senderId,
        title: 'New message',
        body: 'You received a secure message',
      );
    } catch (_) {
      // Ignore malformed events
    }
  }

  static Future<void> _show({required int id, required String title, required String body}) async {
    const androidDetails = AndroidNotificationDetails(
      'messages',
      'Messages',
      channelDescription: 'Incoming chat messages',
      importance: Importance.high,
      priority: Priority.high,
    );
    const iosDetails = DarwinNotificationDetails(
      presentAlert: true,
      presentBadge: true,
      presentSound: true,
    );

    await _plugin.show(
      // Stable-ish integer per sender.
      id.hashCode & 0x7fffffff,
      title,
      body,
      const NotificationDetails(android: androidDetails, iOS: iosDetails),
    );
  }
}

