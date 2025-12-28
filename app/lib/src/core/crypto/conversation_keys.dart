import 'dart:convert';

import 'package:chatapp/src/core/crypto/hkdf_sha256.dart';
import 'package:cryptography/cryptography.dart';

class ConversationKeys {
  final SecretKey sendKey;
  final SecretKey recvKey;
  final SecretKey sendNonceKey;

  ConversationKeys({required this.sendKey, required this.recvKey, required this.sendNonceKey});
}

Future<ConversationKeys> deriveConversationKeys({
  required List<int> sharedSecret,
  required List<int> myPublicKey,
  required List<int> peerPublicKey,
  required int myId,
  required int peerId,
}) async {
  // Salt binds keys to the pinned public keys to prevent silent key substitution.
  final saltDigest = await Sha256().hash(_sortedConcat(myPublicKey, peerPublicKey));
  final salt = saltDigest.bytes;

  final low = myId < peerId ? myId : peerId;
  final high = myId < peerId ? peerId : myId;

  final aToBInfo = utf8.encode('chatapp/e2ee/v1:$low->$high');
  final bToAInfo = utf8.encode('chatapp/e2ee/v1:$high->$low');

  final keyLowToHigh = await hkdfSha256(ikm: sharedSecret, salt: salt, info: aToBInfo, length: 32);
  final keyHighToLow = await hkdfSha256(ikm: sharedSecret, salt: salt, info: bToAInfo, length: 32);

  final nonceLowToHigh = await hkdfSha256(ikm: sharedSecret, salt: salt, info: utf8.encode('chatapp/nonce/v1:$low->$high'), length: 32);
  final nonceHighToLow = await hkdfSha256(ikm: sharedSecret, salt: salt, info: utf8.encode('chatapp/nonce/v1:$high->$low'), length: 32);

  final isLow = myId == low;
  return ConversationKeys(
    sendKey: SecretKey(isLow ? keyLowToHigh : keyHighToLow),
    recvKey: SecretKey(isLow ? keyHighToLow : keyLowToHigh),
    sendNonceKey: SecretKey(isLow ? nonceLowToHigh : nonceHighToLow),
  );
}

List<int> _sortedConcat(List<int> a, List<int> b) {
  // Deterministic ordering.
  if (_lexCompare(a, b) <= 0) return <int>[...a, ...b];
  return <int>[...b, ...a];
}

int _lexCompare(List<int> a, List<int> b) {
  final n = a.length < b.length ? a.length : b.length;
  for (var i = 0; i < n; i++) {
    final d = a[i] - b[i];
    if (d != 0) return d;
  }
  return a.length - b.length;
}
