class Config {
  static const String apiBase = String.fromEnvironment(
    'API_BASE',
    defaultValue: '',
  );

  static const String wsUrl = String.fromEnvironment(
    'WS_URL',
    defaultValue: '',
  );
}
