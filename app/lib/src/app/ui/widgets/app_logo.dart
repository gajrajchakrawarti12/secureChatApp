import 'package:flutter/material.dart';

class AppLogo extends StatelessWidget {
  const AppLogo({super.key, this.size = 96});

  final double size;

  @override
  Widget build(BuildContext context) {
    late ThemeData theme = Theme.of(context);
    return Stack(
      alignment: Alignment.center,
      children: [
        Icon(Icons.shield, size: size, color: theme.colorScheme.primary),
        Icon(Icons.chat, size: size / 2, color: theme.colorScheme.surface),
      ],
    );
  }
}