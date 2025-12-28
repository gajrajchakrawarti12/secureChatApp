// ignore_for_file: use_build_context_synchronously

import 'package:chatapp/src/core/networking/api_service.dart';
import 'package:chatapp/src/features/auth/ui/screens/login_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:chatapp/src/core/storage/storage_service.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  String? _email;
  Map<String, String> _crypto = {};
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    final email = await StorageService.read('email');
    final all = await StorageService.readAll();

    setState(() {
      _email = email;
      _crypto = Map.fromEntries(
        all.entries.where(
          (e) =>
              e.key.startsWith('crypto') ||
              e.key == 'crypto' ||
              e.key == 'publicKey',
        ),
      );
      _loading = false;
    });
  }

  Widget _row(String label, String? value, {bool masked = false}) {
    return ListTile(
      title: Text(label),
      subtitle: Text(
        value == null || value.isEmpty
            ? 'Not set'
            : (masked ? '••••••••' : value),
      ),
      trailing: value == null || value.isEmpty
          ? null
          : IconButton(
              icon: const Icon(Icons.copy),
              onPressed: () async {
                final messenger = ScaffoldMessenger.of(context);
                await Clipboard.setData(ClipboardData(text: value));
                if (!mounted) return;
                messenger.showSnackBar(
                  const SnackBar(content: Text('Copied to clipboard')),
                );
              },
            ),
    );
  }

  Future<List<dynamic>> _fetchItems() async {
    // Simulate a delay
    await Future.delayed(const Duration(seconds: 2));
    // Fetch items from storage or any other source
    final items = await StorageService.readAll();
    // Convert to a list of dynamic items (modify as per your data structure)
    return items.entries
        .map((e) => {'title': e.key, 'subtitle': e.value})
        .toList();
  }

  Widget buildItemList() => FutureBuilder<List<dynamic>>(
    future: _fetchItems(),
    builder: (context, snapshot) {
      if (snapshot.connectionState == ConnectionState.waiting) {
        return const Center(child: CircularProgressIndicator());
      } else if (snapshot.hasError) {
        return Center(child: Text('Error: ${snapshot.error}'));
      } else if (!snapshot.hasData || snapshot.data!.isEmpty) {
        return const Center(child: Text('No items found.'));
      } else {
        final items = snapshot.data!;
        return ListView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: items.length,
          itemBuilder: (context, index) {
            final item = items[index];
            return ListTile(
              title: Text(item['title'].toString()),
              subtitle: Text(item['subtitle'] ?? ''),
            );
          },
        );
      }
    },
  );

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              children: [
                const SizedBox(height: 12),
                ListTile(
                  leading: CircleAvatar(
                    backgroundColor: theme.colorScheme.primary,
                    child: Text((_email ?? 'U').substring(0, 1).toUpperCase()),
                  ),
                  title: Text(
                    _email ?? 'Unknown',
                    style: theme.textTheme.titleLarge,
                  ),
                  subtitle: Text('Account'),
                ),
                const Divider(),
                Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16.0,
                    vertical: 8.0,
                  ),
                  child: Text(
                    'Authentication',
                    style: theme.textTheme.titleMedium,
                  ),
                ),
                buildItemList(),
                const Divider(),
                Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16.0,
                    vertical: 8.0,
                  ),
                  child: Text('Crypto', style: theme.textTheme.titleMedium),
                ),
                ..._crypto.entries.map(
                  (e) => _row(e.key, e.value, masked: false),
                ),
                const SizedBox(height: 24),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16.0),
                  child: ElevatedButton.icon(
                    icon: const Icon(Icons.logout),
                    label: const Text('Log Out'),
                    onPressed: () async {
                      try {
                        await ApiService.logout();
                        if (!mounted) return;
                        Navigator.of(context).push(
                          MaterialPageRoute(
                            builder: (_) => const LoginScreen(),
                          ),
                        );
                      } catch (e) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(content: Text('Logout failed: $e')),
                        );
                        return;
                      }
                    },
                  ),
                ),
                const SizedBox(height: 24),
              ],
            ),
    );
  }
}
