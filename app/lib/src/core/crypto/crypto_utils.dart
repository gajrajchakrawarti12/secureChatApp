import 'package:cryptography/cryptography.dart';
import 'dart:math';

class CryptoUtils {
  static final algorithm = X25519();
  static final aes = AesGcm.with256bits();

  static Future<Map<String, dynamic>> generateKeyPair() async {
    final keyPair = await algorithm.newKeyPair();
    final publicKey = await keyPair.extractPublicKey();
    final privateKey = await keyPair.extractPrivateKeyBytes();
    return {
      'keyPair': keyPair,
      'publicKey': publicKey,
      'privateKey': privateKey
    };
  }

  static List<int> randomBytes(int length) {
    final rand = Random.secure();
    return List<int>.generate(length, (_) => rand.nextInt(256));
  }
}
