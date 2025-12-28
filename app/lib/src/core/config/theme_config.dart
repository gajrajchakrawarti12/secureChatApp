import 'package:flutter/material.dart';

class ThemeConfig {
  // 🔐 Seed Colors (Security-focused)
  static const Color lightSeed = Color(0xFF2563EB); // Trust Blue
  static const Color darkSeed = Color(0xFF3B82F6); // Encrypted Blue

  // 🌤 Light Theme
  static final ThemeData lightTheme = ThemeData(
    useMaterial3: true,
    brightness: Brightness.light,

    colorScheme:
        ColorScheme.fromSeed(
          seedColor: lightSeed,
          brightness: Brightness.light,
        ).copyWith(
          // 60%
          surface: const Color(0xFFF8FAFC),
          surfaceContainerLowest: const Color(0xFFF8FAFC),

          // 30%
          surfaceContainer: const Color(0xFFE2E8F0),

          // 10%
          primary: lightSeed,

          onPrimary: Colors.white,
          onSurface: const Color(0xFF0F172A),
        ),

    scaffoldBackgroundColor: const Color(0xFFF8FAFC),

    appBarTheme: const AppBarTheme(
      elevation: 0,
      backgroundColor: Color(0xFFF8FAFC),
      foregroundColor: Color(0xFF0F172A),
    ),

    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: const Color(0xFFE2E8F0),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide.none,
      ),
    ),

    floatingActionButtonTheme: const FloatingActionButtonThemeData(
      backgroundColor: lightSeed,
      foregroundColor: Colors.white,
    ),
  );

  // 🌙 Dark Theme
  static final ThemeData darkTheme = ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,

    colorScheme:
        ColorScheme.fromSeed(
          seedColor: darkSeed,
          brightness: Brightness.dark,
        ).copyWith(
          // 60%
          surface: const Color(0xFF0F172A),
          surfaceContainerLowest: const Color(0xFF0F172A),

          // 30%
          surfaceContainer: const Color(0xFF1E293B),

          // 10%
          primary: darkSeed,

          onPrimary: Colors.white,
          onSurface: const Color(0xFFF8FAFC),
        ),

    scaffoldBackgroundColor: const Color(0xFF0F172A),

    appBarTheme: const AppBarTheme(
      elevation: 0,
      backgroundColor: Color(0xFF0F172A),
      foregroundColor: Colors.white,
    ),

    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: const Color(0xFF1E293B),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide.none,
      ),
    ),

    floatingActionButtonTheme: const FloatingActionButtonThemeData(
      backgroundColor: darkSeed,
      foregroundColor: Colors.white,
    ),
  );

  // getters (static to allow class-level access)
  static ThemeData get light => lightTheme;
  static ThemeData get dark => darkTheme;
}
