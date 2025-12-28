import 'dart:async';
import 'dart:io';
import 'package:firebase_core/firebase_core.dart';
import 'package:chatapp/firebase_options.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter/material.dart';
import 'package:chatapp/src/core/networking/api_service.dart';
import 'package:chatapp/src/core/storage/storage_service.dart';
import 'package:chatapp/src/core/networking/auth_session.dart';
import 'package:chatapp/src/core/notifications/push_router.dart';
import 'package:chatapp/src/core/logging/secure_log.dart';

// Background message handler must be a top-level function.
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  try {
    await Firebase.initializeApp();
    // Data-only notifications: show a generic local notification.
    final plugin = FlutterLocalNotificationsPlugin();
    const androidInit = AndroidInitializationSettings('@mipmap/ic_launcher');
    const initSettings = InitializationSettings(android: androidInit);
    await plugin.initialize(initSettings);

    const channel = AndroidNotificationChannel(
      'chat_messages',
      'Chat Messages',
      description: 'Notifications for new chat messages',
      importance: Importance.high,
    );

    if (Platform.isAndroid) {
      final androidPlugin = plugin
          .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
      await androidPlugin?.createNotificationChannel(channel);
    }

    final title = message.data['title']?.toString() ?? 'New message';
    final body = message.data['body']?.toString() ?? 'Open the app to view it.';
    await plugin.show(
      message.hashCode,
      title,
      body,
      const NotificationDetails(
        android: AndroidNotificationDetails(
          'chat_messages',
          'Chat Messages',
          channelDescription: 'Notifications for new chat messages',
          icon: '@mipmap/ic_launcher',
          importance: Importance.high,
          priority: Priority.high,
        ),
      ),
    );
  } catch (_) {}
}

class PushNotificationService {
  static final FirebaseMessaging _messaging = FirebaseMessaging.instance;
  static final FlutterLocalNotificationsPlugin _local =
      FlutterLocalNotificationsPlugin();

  static const AndroidNotificationChannel _androidChannel =
      AndroidNotificationChannel(
        'chat_messages',
        'Chat Messages',
        description: 'Notifications for new chat messages',
        importance: Importance.high,
      );

  static bool _initialized = false;
  static final List<StreamSubscription> _subs = [];
  static bool _enabled = false;

  static Future<void> init() async {
    if (_initialized) return;
    WidgetsFlutterBinding.ensureInitialized();
    try {
      // Initialize Firebase with FlutterFire options
      await Firebase.initializeApp(
        options: DefaultFirebaseOptions.currentPlatform,
      );

      // Local notifications init
      const androidInit = AndroidInitializationSettings('@mipmap/ic_launcher');
      const initSettings = InitializationSettings(android: androidInit);
      await _local.initialize(initSettings);

      // Create Android notification channel
      if (Platform.isAndroid) {
        final androidPlugin = _local
            .resolvePlatformSpecificImplementation<
              AndroidFlutterLocalNotificationsPlugin
            >();
        await androidPlugin?.createNotificationChannel(_androidChannel);
      }

      // Background handling
      FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);

      _initialized = true;
    } catch (e) {
      SecureLog.debug('Push init failed: $e');
    }
  }

  static Future<void> enable() async {
    await init();
    _enabled = true;

    // Avoid duplicate listeners.
    for (final s in _subs) {
      await s.cancel();
    }
    _subs.clear();

    // Request permissions (iOS/macOS)
    await _messaging.requestPermission(
      alert: true,
      badge: true,
      sound: true,
      provisional: false,
    );

    await _syncCurrentToken();

    _subs.add(
      FirebaseMessaging.instance.onTokenRefresh.listen((token) async {
        if (!_enabled) return;
        final prev = await StorageService.read('pushToken');
        await StorageService.write('pushToken', token);
        if (!AuthSession.isLoggedIn.value) return;
        try {
          if (prev != null && prev.isNotEmpty && prev != token) {
            await ApiService.unregisterPushToken(prev);
          }
        } catch (_) {}
        try {
          await ApiService.registerPushToken(token);
        } catch (_) {}
      }),
    );

    // Foreground messages
    _subs.add(
      FirebaseMessaging.onMessage.listen((RemoteMessage message) async {
        final title = message.notification?.title ?? 'New message';
        final body = message.notification?.body ?? 'Open the app to view it.';
        await _local.show(
          message.hashCode,
          title,
          body,
          NotificationDetails(
            android: AndroidNotificationDetails(
              _androidChannel.id,
              _androidChannel.name,
              channelDescription: _androidChannel.description,
              icon: '@mipmap/ic_launcher',
              importance: Importance.high,
              priority: Priority.high,
            ),
          ),
        );
      }),
    );

    // When user taps a notification and app opens
    _subs.add(
      FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage message) async {
        await PushRouter.handleTap(message.data);
      }),
    );

    // Terminated -> opened
    final initial = await FirebaseMessaging.instance.getInitialMessage();
    if (initial != null) {
      await PushRouter.handleTap(initial.data);
    }
  }

  static Future<void> _syncCurrentToken() async {
    final token = await _messaging.getToken();
    if (token == null) return;
    await StorageService.write('pushToken', token);
    if (AuthSession.isLoggedIn.value) {
      try {
        await ApiService.registerPushToken(token);
      } catch (e) {
        SecureLog.debug('Register push token failed: $e');
      }
    }
  }

  static Future<void> disable() async {
    _enabled = false;
    for (final s in _subs) {
      await s.cancel();
    }
    _subs.clear();
    try {
      final token = await StorageService.read('pushToken');
      if (token != null) {
        await ApiService.unregisterPushToken(token);
      }
    } catch (_) {}
    await StorageService.delete('pushToken');
    // On Android, you could also unsubscribe from topics here.
  }
}
