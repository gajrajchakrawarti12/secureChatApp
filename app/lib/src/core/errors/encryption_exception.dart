class EncryptionException implements Exception {
  final String message;

  EncryptionException([this.message = 'Encryption error']);

  @override
  String toString() => 'EncryptionException: $message';
}
