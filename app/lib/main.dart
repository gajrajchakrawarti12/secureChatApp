import 'package:chatapp/src/core/config/theme_config.dart';
import 'package:chatapp/src/core/networking/network_policy.dart';
import 'package:chatapp/src/features/auth/ui/widgets/auth_gate.dart';
import 'package:flutter/material.dart';
import 'package:chatapp/src/core/navigation/navigation_service.dart';
import 'package:chatapp/src/core/notifications/push_notification_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  NetworkPolicy.enforceSecureTransport();
  await PushNotificationService.init();
  runApp(const MainApp());
}

class MainApp extends StatelessWidget {
  const MainApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Secure Chat App',
      debugShowCheckedModeBanner: false,
      navigatorKey: NavigationService.navigatorKey,

      // Auto switch system light/dark
      theme: ThemeConfig.lightTheme,
      darkTheme: ThemeConfig.darkTheme,
      themeMode: ThemeMode.system,

      home: const AuthGate(),
    );
  }
}
