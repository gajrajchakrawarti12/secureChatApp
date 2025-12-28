class MessageException implements Exception {
  final String message;

  MessageException([this.message = 'Message error']);

  @override
  String toString() => 'MessageException: $message';
}
