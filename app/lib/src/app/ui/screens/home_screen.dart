import 'package:chatapp/src/features/contacts/ui/screens/contacts_screen.dart';
import 'package:chatapp/src/features/public/ui/screens/public_screen.dart';
import 'package:chatapp/src/features/settings/ui/screens/setting_screen.dart';
import 'package:curved_navigation_bar/curved_navigation_bar.dart';
import 'package:flutter/material.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _selectedIndex = 0;
  // compute theme inside build() so it updates when Theme changes

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      //body
      body: IndexedStack(
        index: _selectedIndex,
        children: const [ContactsScreen(), PublicScreen(), SettingScreen()],
      ),
      //bottom navigation bar
      bottomNavigationBar: CurvedNavigationBar(
        index: _selectedIndex,
        items: <Widget>[
          Icon(Icons.contacts, color: theme.colorScheme.onPrimary),
          Icon(Icons.public, color: theme.colorScheme.onPrimary),
          Icon(Icons.settings, color: theme.colorScheme.onPrimary),
        ],
        color: theme.colorScheme.primary,
        buttonBackgroundColor: theme.colorScheme.primary,
        backgroundColor: theme.scaffoldBackgroundColor,
        animationCurve: Curves.easeInOut,
        animationDuration: Duration(milliseconds: 600),
        onTap: (index) {
          setState(() {
            _selectedIndex = index;
          });
        },
        letIndexChange: (index) => true,
      ),
    );
  }
}
