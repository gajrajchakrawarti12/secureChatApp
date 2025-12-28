import 'package:chatapp/src/core/networking/api_service.dart';
import 'package:chatapp/src/features/chat/ui/screens/chat_screen.dart';
import 'package:chatapp/src/app/ui/widgets/app_logo.dart';
import 'package:flutter/material.dart';

class ContactsScreen extends StatefulWidget {
  const ContactsScreen({super.key});

  @override
  State<ContactsScreen> createState() => _ContactsScreenState();
}

class _ContactsScreenState extends State<ContactsScreen> {
  late Future<List<Map<String, dynamic>>> _usersFuture;

  @override
  void initState() {
    super.initState();
    _usersFuture = ApiService.getAllContacts();
  }

  void _refresh() {
    setState(() {
      _usersFuture = ApiService.getAllContacts();
    });
  }

  final TextEditingController _searchController = TextEditingController();
  String _query = '';

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return FutureBuilder<List<Map<String, dynamic>>>(
      future: _usersFuture,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Scaffold(
            body: Center(child: CircularProgressIndicator()),
          );
        }
        if (snapshot.hasError) {
          return Scaffold(
            body: Center(child: Text('Error: ${snapshot.error}')),
          );
        }
        final users = snapshot.data ?? [];

        return Scaffold(
          appBar: AppBar(
            title: const Text('Secure Chat'),
            actions: [
              IconButton(icon: const Icon(Icons.refresh), onPressed: _refresh),
            ],
            leading: AppLogo(size: 40),
          ),
          body: SafeArea(
            child: Column(
              children: [
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: TextField(
                    controller: _searchController,
                    onChanged: (value) => setState(() => _query = value),
                    decoration: InputDecoration(
                      hintText: 'Search contacts',
                      prefixIcon: const Icon(Icons.search),
                      suffixIcon: _query.isEmpty
                          ? null
                          : IconButton(
                              icon: const Icon(Icons.clear),
                              onPressed: () {
                                _searchController.clear();
                                setState(() => _query = '');
                              },
                            ),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                  ),
                ),
                Expanded(
                  child: users.isEmpty
                      ? Center(
                          child: Text(
                            'No contacts found.',
                            style: theme.textTheme.bodyMedium,
                          ),
                        )
                      : ListView.separated(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 16,
                            vertical: 8,
                          ),

                          itemCount: users.length,
                          separatorBuilder: (context, index) =>
                              const SizedBox(height: 12),
                          itemBuilder: (context, index) {
                            final user = users[index];
                            return Card(
                              elevation: 1,
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(16),
                              ),
                              child: ListTile(
                                leading: CircleAvatar(
                                  backgroundColor: theme.colorScheme.primary
                                      .withValues(alpha: 0.1),
                                  child: Icon(
                                    user['public_key'].isNotEmpty
                                        ? Icons.person
                                        : Icons.person_off,
                                    color: theme.colorScheme.primary,
                                  ),
                                ),
                                onTap: () {
                                  final key = (user['public_key'] ?? '')
                                      .toString();
                                  final rid = (user['id'] is int)
                                      ? user['id'] as int
                                      : int.tryParse('${user['id']}');
                                  if (key.isEmpty || rid == null) {
                                    ScaffoldMessenger.of(context).showSnackBar(
                                      const SnackBar(
                                        content: Text('User has no public key'),
                                      ),
                                    );
                                    return;
                                  }
                                  Navigator.of(context).push(
                                    MaterialPageRoute(
                                      builder: (_) => ChatScreen(
                                        receiverId: rid,
                                        receiverPublicKeyBase64: key,
                                        title: user['name'] ?? key,
                                      ),
                                    ),
                                  );
                                },
                                title: Text(
                                  user['public_key'],
                                  style: theme.textTheme.titleMedium,
                                ),
                                subtitle: Text(
                                  user['public_key'].isNotEmpty
                                      ? 'Member'
                                      : 'No Public Key',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            );
                          },
                        ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}
