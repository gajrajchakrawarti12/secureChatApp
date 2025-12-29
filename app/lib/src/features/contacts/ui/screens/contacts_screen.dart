import 'package:chatapp/src/core/networking/api_service.dart';
import 'package:chatapp/src/features/chat/ui/screens/chat_screen.dart';
import 'package:chatapp/src/app/ui/widgets/app_logo.dart';
import 'package:chatapp/src/core/storage/storage_service.dart';
import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';

class ContactsScreen extends StatefulWidget {
  const ContactsScreen({super.key});

  @override
  State<ContactsScreen> createState() => _ContactsScreenState();
}

class _ContactsScreenState extends State<ContactsScreen> {
  late Future<List<Map<String, dynamic>>> _usersFuture;
  StreamSubscription<String>? _wsSub;
  int? _myIdInt;
  final Map<int, int> _unreadBySenderId = <int, int>{};

  @override
  void initState() {
    super.initState();
    _usersFuture = ApiService.getAllContacts();
    _initRealtime();
  }

  Future<void> _initRealtime() async {
    try {
      // HomeScreen usually owns the socket lifetime, but calling connect here is safe (no-op if already connected).
      await ApiService.connectWebSocket();
      final myIdRaw = await StorageService.read('id');
      _myIdInt = int.tryParse(myIdRaw ?? '');
      _wsSub?.cancel();
      _wsSub = ApiService.webSocketMessages.listen(_onWsMessage);
    } catch (_) {
      // Keep Contacts usable even if realtime is unavailable.
    }
  }

  void _onWsMessage(String event) {
    try {
      final decoded = jsonDecode(event);
      if (decoded is! Map || decoded['type'] != 'message') return;
      final payload = decoded['payload'];
      if (payload is! Map) return;

      final myId = _myIdInt;
      if (myId == null) return;

      final senderId = int.tryParse(payload['sender_id']?.toString() ?? '');
      final receiverId = int.tryParse(payload['receiver_id']?.toString() ?? '');
      if (senderId == null || receiverId == null) return;
      if (receiverId != myId) return;

      if (!mounted) return;
      setState(() {
        _unreadBySenderId[senderId] = (_unreadBySenderId[senderId] ?? 0) + 1;
      });
    } catch (_) {
      // Ignore malformed events
    }
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
    _wsSub?.cancel();
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
                            final rid = (user['id'] is int)
                                ? user['id'] as int
                                : int.tryParse('${user['id']}');
                            final unread = (rid == null) ? 0 : (_unreadBySenderId[rid] ?? 0);
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
                                  if (key.isEmpty || rid == null) {
                                    ScaffoldMessenger.of(context).showSnackBar(
                                      const SnackBar(
                                        content: Text('User has no public key'),
                                      ),
                                    );
                                    return;
                                  }

                                  if (unread > 0) {
                                    setState(() {
                                      _unreadBySenderId.remove(rid);
                                    });
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
                                  unread > 0
                                      ? (unread == 1 ? 'New message' : 'New messages ($unread)')
                                      : (user['public_key'].isNotEmpty
                                          ? 'Member'
                                          : 'No Public Key'),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                                trailing: unread > 0
                                    ? Container(
                                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                                        decoration: BoxDecoration(
                                          color: theme.colorScheme.primary,
                                          borderRadius: BorderRadius.circular(999),
                                        ),
                                        child: Text(
                                          unread.toString(),
                                          style: theme.textTheme.labelSmall?.copyWith(
                                            color: theme.colorScheme.onPrimary,
                                          ),
                                        ),
                                      )
                                    : null,
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
