import 'dart:convert';

import 'package:chatapp/src/core/storage/storage_service.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

class PushNotificationService {
  static bool _initialized = false;
  static bool _enabled = true;

  static final FlutterLocalNotificationsPlugin _plugin =
      FlutterLocalNotificationsPlugin();

  static const AndroidNotificationChannel _channel =
      AndroidNotificationChannel(
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

    try {
      const androidInit =
          AndroidInitializationSettings('@mipmap/ic_launcher');

      const iosInit = DarwinInitializationSettings(
        requestAlertPermission: false,
        requestBadgePermission: false,
        requestSoundPermission: false,
      );

      const windowsInit = WindowsInitializationSettings(
        appName: 'Secure Chat App',
        appUserModelId: 'com.example.chatapp',
        guid: '{D3F4B5E6-7C8D-4A9B-8E0F-123456789ABC}',
      );

      const linuxInit =
          LinuxInitializationSettings(defaultActionName: 'Open');

      await _plugin.initialize(
        const InitializationSettings(
          android: androidInit,
          iOS: iosInit,
          macOS: iosInit,
          windows: windowsInit,
          linux: linuxInit,
        ),
        onDidReceiveNotificationResponse: (response) {
          // Handle notification tap if needed
        },
      );

      final androidImpl = _plugin
          .resolvePlatformSpecificImplementation<
              AndroidFlutterLocalNotificationsPlugin>();

      await androidImpl?.createNotificationChannel(_channel);

      // Android 13+
      await androidImpl?.requestNotificationsPermission();

      final iosImpl = _plugin
          .resolvePlatformSpecificImplementation<
              IOSFlutterLocalNotificationsPlugin>();
      await iosImpl?.requestPermissions(
        alert: true,
        badge: true,
        sound: true,
      );

      final macImpl = _plugin
          .resolvePlatformSpecificImplementation<
              MacOSFlutterLocalNotificationsPlugin>();
      await macImpl?.requestPermissions(
        alert: true,
        badge: true,
        sound: true,
      );

      _initialized = true;
    } on MissingPluginException {
      _initialized = true;
      _enabled = false;
    } on ArgumentError {
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
  static Future<void> handleWebSocketEvent(String event) async {
    if (!_enabled) return;
    await init();
    if (kIsWeb || !_enabled) return;

    try {
      final decoded = jsonDecode(event);
      if (decoded is! Map || decoded['type'] != 'message') return;

      final payload = decoded['payload'];
      if (payload is! Map) return;

      final myIdRaw = await StorageService.read('id');
      final myId = int.tryParse(myIdRaw ?? '');
      if (myId == null) return;

      final senderId =
          int.tryParse(payload['sender_id']?.toString() ?? '1');
      final receiverId =
          int.tryParse(payload['receiver_id']?.toString() ?? '2');

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

  static Future<void> _show({
    required int id,
    required String title,
    required String body,
  }) async {
    const androidDetails = AndroidNotificationDetails(
      'messages',
      'Messages',
      channelDescription: 'Incoming chat messages',
      icon: '@mipmap/ic_launcher',
      importance: Importance.high,
      priority: Priority.high,
      ongoing: true,
      styleInformation: MediaStyleInformation(
        htmlFormatContent: true,
        htmlFormatTitle: true,
      ),
    );

    const iosDetails = DarwinNotificationDetails(
      presentAlert: true,
      presentBadge: true,
      presentSound: true,
    );

    // Windows notification details can be configured here. The `toastXml`
    // parameter is not available in all flutter_local_notifications versions.
    const windowDetails = WindowsNotificationDetails();

    await _plugin.show(
      id.hashCode & 0x7fffffff,
      title,
      body,
      const NotificationDetails(
        android: androidDetails,
        iOS: iosDetails,
        windows: windowDetails,
      ),
    );
  }
}
