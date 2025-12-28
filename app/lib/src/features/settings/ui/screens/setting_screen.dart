import 'package:chatapp/src/core/storage/storage_service.dart';
import 'package:chatapp/src/core/networking/api_service.dart';
import 'package:chatapp/src/features/profile/ui/screens/profile_screen.dart';
import 'package:flutter/material.dart';
import 'package:chatapp/src/core/notifications/push_notification_service.dart';
import 'package:chatapp/src/features/auth/ui/screens/welcome_screen.dart';

class SettingScreen extends StatefulWidget {
  const SettingScreen({super.key});

  @override
  State<SettingScreen> createState() => _SettingScreenState();
}

class _SettingScreenState extends State<SettingScreen> {
  bool _push = false;
  bool _email = false;
  String _theme = 'system'; // 'light' | 'dark' | 'system'
  double _fontSize = 14.0;

  @override
  void initState() {
    super.initState();
    _loadPrefs();
  }

  Future<void> _loadPrefs() async {
    final push = await StorageService.read('pushNotifications');
    final email = await StorageService.read('emailAlerts');
    final theme = await StorageService.read('theme');
    final font = await StorageService.read('fontSize');

    setState(() {
      _push = push == 'true';
      _email = email == 'true';
      _theme = theme ?? 'system';
      _fontSize = double.tryParse(font ?? '') ?? 14.0;
    });
  }

  Future<void> _setBool(String key, bool value) async {
    await StorageService.write(key, value ? 'true' : 'false');
  }

  Future<void> _setString(String key, String value) async {
    await StorageService.write(key, value);
  }

  Future<void> _logout() async {
    try {
      // Best-effort unregister of push token.
      await PushNotificationService.disable();
      await ApiService.logout();
      if (!mounted) return;
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => const WelcomeScreen()),
        (_) => false,
      );
    } catch (e) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('Logout failed: $e')));
    }
  }

  void _showFontSizePicker() async {
    final newSize = await showDialog<double?>(
      context: context,
      builder: (ctx) {
        double tmp = _fontSize;
        return AlertDialog(
          title: const Text('Font Size'),
          content: StatefulBuilder(
            builder: (c, setS) {
              return Slider(
                min: 12,
                max: 20,
                divisions: 8,
                label: tmp.toStringAsFixed(0),
                value: tmp,
                onChanged: (v) => setS(() => tmp = v),
              );
            },
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Cancel'),
            ),
            ElevatedButton(
              onPressed: () => Navigator.pop(ctx, tmp),
              child: const Text('OK'),
            ),
          ],
        );
      },
    );

    if (newSize != null) {
      setState(() => _fontSize = newSize);
      await _setString('fontSize', newSize.toString());
    }
  }

  void _selectTheme() async {
    final sel = await showDialog<String?>(
      context: context,
      builder: (ctx) => SimpleDialog(
        title: const Text('Theme'),
        children: [
          ListTile(
            title: const Text('System'),
            trailing: _theme == 'system' ? const Icon(Icons.check) : null,
            onTap: () => Navigator.pop(ctx, 'system'),
          ),
          ListTile(
            title: const Text('Light'),
            trailing: _theme == 'light' ? const Icon(Icons.check) : null,
            onTap: () => Navigator.pop(ctx, 'light'),
          ),
          ListTile(
            title: const Text('Dark'),
            trailing: _theme == 'dark' ? const Icon(Icons.check) : null,
            onTap: () => Navigator.pop(ctx, 'dark'),
          ),
        ],
      ),
    );

    if (sel != null) {
      setState(() => _theme = sel);
      await _setString('theme', sel);
      // Apply theme by updating app-level ThemeMode if available.
      // If the app uses a central notifier, it should observe this storage key.
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        children: [
          _SettingsSection(
            title: 'Account',
            children: [
              ListTile(
                leading: const Icon(Icons.person),
                title: const Text('Profile'),
                trailing: const Icon(Icons.arrow_forward_ios, size: 16),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const ProfileScreen()),
                ),
              ),
              ListTile(
                leading: const Icon(Icons.lock),
                title: const Text('Privacy'),
                trailing: const Icon(Icons.arrow_forward_ios, size: 16),
                onTap: null,
              ),
              ListTile(
                leading: const Icon(Icons.logout),
                title: const Text('Log Out'),
                onTap: _logout,
              ),
            ],
          ),

          _SettingsSection(
            title: 'Notifications',
            children: [
              SwitchListTile(
                secondary: const Icon(Icons.notifications_active),
                title: const Text('Push Notifications'),
                value: _push,
                onChanged: (v) async {
                  setState(() => _push = v);
                  await _setBool('pushNotifications', v);
                  if (v) {
                    await PushNotificationService.enable();
                  } else {
                    await PushNotificationService.disable();
                  }
                },
              ),
              SwitchListTile(
                secondary: const Icon(Icons.email),
                title: const Text('Email Alerts'),
                value: _email,
                onChanged: (v) async {
                  setState(() => _email = v);
                  await _setBool('emailAlerts', v);
                },
              ),
            ],
          ),

          _SettingsSection(
            title: 'Appearance',
            children: [
              ListTile(
                leading: const Icon(Icons.palette),
                title: const Text('Theme'),
                subtitle: Text(_theme.capitalize()),
                trailing: const Icon(Icons.arrow_forward_ios, size: 16),
                onTap: _selectTheme,
              ),
              ListTile(
                leading: const Icon(Icons.text_fields),
                title: const Text('Font Size'),
                subtitle: Text(_fontSize.toStringAsFixed(0)),
                trailing: const Icon(Icons.arrow_forward_ios, size: 16),
                onTap: _showFontSizePicker,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _SettingsSection extends StatelessWidget {
  final String title;
  final List<Widget> children;

  const _SettingsSection({required this.title, required this.children});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          ...children,
        ],
      ),
    );
  }
}

extension StringCasingExtension on String {
  String capitalize() =>
      isEmpty ? this : '${this[0].toUpperCase()}${substring(1)}';
}
