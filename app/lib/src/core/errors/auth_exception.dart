class AuthException implements Exception {
  final String message;

  AuthException([this.message = 'Authentication error']);
  
  @override
  String toString() => message;
}