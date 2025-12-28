import 'package:flutter/material.dart';

class NavigationService {
  static final GlobalKey<NavigatorState> navigatorKey = GlobalKey<NavigatorState>();

  static NavigatorState? get _nav => navigatorKey.currentState;

  static Future<T?> push<T>(Route<T> route) {
    final nav = _nav;
    if (nav == null) return Future.value(null);
    return nav.push(route);
  }
}
