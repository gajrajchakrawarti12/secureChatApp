class Config {
  static const String apiBase = String.fromEnvironment(
    'API_BASE',
    defaultValue: 'http://10.33.234.2:3000/api',
  );

  static const String wsUrl = String.fromEnvironment(
    'WS_URL',
    defaultValue: 'ws://10.33.234.2:3000/ws',
  );
}
