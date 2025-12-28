import 'dart:convert';

import 'package:cryptography/cryptography.dart';

Future<List<int>> hkdfSha256({
  required List<int> ikm,
  required List<int> salt,
  required List<int> info,
  required int length,
}) async {
  if (length <= 0) throw ArgumentError('length must be > 0');

  final hmac = Hmac.sha256();

  // HKDF-Extract
  final prkMac = await hmac.calculateMac(ikm, secretKey: SecretKey(salt));
  final prk = prkMac.bytes;

  // HKDF-Expand
  final out = <int>[];
  var t = <int>[];
  var counter = 1;
  while (out.length < length) {
    final data = <int>[...t, ...info, counter];
    final mac = await hmac.calculateMac(data, secretKey: SecretKey(prk));
    t = mac.bytes;
    out.addAll(t);
    counter += 1;
    if (counter > 255) {
      throw StateError('HKDF counter overflow');
    }
  }
  return out.sublist(0, length);
}

List<int> utf8Bytes(String s) => utf8.encode(s);
