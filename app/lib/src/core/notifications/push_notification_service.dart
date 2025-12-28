class PushNotificationService {
  static bool _initialized = false;

  static Future<void> init() async {
    if (_initialized) return;
    _initialized = true;
  }

  static Future<void> enable() async {
    await init();
  }

  static Future<void> disable() async {
    // No-op: push notifications are disabled.
  }
}

