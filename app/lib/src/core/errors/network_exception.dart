class NetworkException implements Exception {
  final String message;

  NetworkException([this.message = 'Network error']);

  @override
  String toString() => 'NetworkException: $message';
}
