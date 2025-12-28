import 'package:chatapp/src/core/networking/api_service.dart';
import 'package:chatapp/src/app/ui/screens/home_screen.dart';
import 'package:chatapp/src/features/auth/ui/screens/welcome_screen.dart';
import 'package:flutter/material.dart';

/// AuthGate shows a splash while checking auth state, then listens to
/// `AuthService.instance.isLoggedIn` and displays `HomeScreen` when
/// authenticated or `WelcomeScreen` when not.
class AuthGate extends StatefulWidget {
  const AuthGate({super.key});

  @override
  State<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<AuthGate> {
  bool _checking = true;

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    await ApiService.checkLogin();
    if (!mounted) return;
    setState(() => _checking = false);
  }

  @override
  Widget build(BuildContext context) {
    if (_checking) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    return ValueListenableBuilder<bool>(
      valueListenable: ApiService.isLoggedIn,
      builder: (context, loggedIn, _) {
        return loggedIn ? const HomeScreen() : const WelcomeScreen();
      },
    );
  }
}
