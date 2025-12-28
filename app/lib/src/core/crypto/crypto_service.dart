import 'dart:convert';
import 'dart:math';
import 'package:chatapp/src/core/storage/storage_service.dart';
import 'package:cryptography/cryptography.dart';

class CryptoService {
  static final _rng = Random.secure();
  static final _aes = AesGcm.with256bits();

  static List<int> randomBytes(int len) =>
      List.generate(len, (_) => _rng.nextInt(256));

  static Future<Map<String, List<int>>> generateKeyPair() async {
    final keyPair = await X25519().newKeyPair();
    final extracted = await keyPair.extract();

    return {
      'privateKey': extracted.bytes,
      'publicKey': extracted.publicKey.bytes,
    };
  }

  static Future<SecretKey> passwordKey(String password, List<int> salt) {
    return Pbkdf2(
      macAlgorithm: Hmac.sha256(),
      iterations: 100000,
      bits: 256,
    ).deriveKey(secretKey: SecretKey(utf8.encode(password)), nonce: salt);
  }

  static Future<SecretBox> encrypt(List<int> data, SecretKey key) async {
    return _aes.encrypt(data, secretKey: key, nonce: randomBytes(12));
  }

  static Future<SecretBox> encryptWithNonce(
    List<int> data,
    SecretKey key,
    List<int> nonce,
  ) async {
    if (nonce.length != 12) {
      throw ArgumentError('AES-GCM nonce must be 12 bytes');
    }
    return _aes.encrypt(data, secretKey: key, nonce: nonce);
  }

  static Future<List<int>> decrypt(SecretBox box, SecretKey key) =>
      _aes.decrypt(box, secretKey: key);

  static Future<SecretKey> deriveSharedSecret({
    required List<int> myPrivateKey,
    required List<int> theirPublicKey,
  }) async {
    final publicKeyBase64 = await StorageService.read("public_key");
    final myPublicKey =  base64Decode(publicKeyBase64 ?? '');
    final myKeyPair = SimpleKeyPairData(
      myPrivateKey,
      publicKey: SimplePublicKey(
        myPublicKey, // ← provide your stored/public bytes here
        type: KeyPairType.x25519,
      ),
      type: KeyPairType.x25519,
    );

    final theirPubKey = SimplePublicKey(
      theirPublicKey,
      type: KeyPairType.x25519,
    );

    final sharedSecret = await X25519().sharedSecretKey(
      keyPair: myKeyPair,
      remotePublicKey: theirPubKey,
    );

    return sharedSecret;
  }
}
