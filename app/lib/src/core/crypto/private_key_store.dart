import 'dart:convert';

import 'package:chatapp/src/core/crypto/crypto_service.dart';
import 'package:chatapp/src/core/errors/exceptions.dart';
import 'package:chatapp/src/core/storage/storage_service.dart';
import 'package:cryptography/cryptography.dart';

class PrivateKeyStore {
  static const _wrapKeyKey = 'local_wrap_key';
  static const _ctKey = 'local_encrypted_private_key';
  static const _nonceKey = 'local_private_key_nonce';
  static const _macKey = 'local_private_key_mac';

  /// Ensures the private key is available for runtime use without persisting
  /// the password-derived key.
  ///
  /// On first login on a device:
  /// - Decrypt server-stored private key blob using PBKDF2(password, salt)
  /// - Re-encrypt it using a random device-local wrap key
  /// - Persist only the wrap key + wrapped private key
  static Future<void> ensureWrappedFromServer({required String password}) async {
    final existing = await StorageService.read(_ctKey);
    final wrapKey = await StorageService.read(_wrapKeyKey);
    if (existing != null && existing.isNotEmpty && wrapKey != null && wrapKey.isNotEmpty) {
      // Also cleanup any legacy persisted derived keys.
      await StorageService.delete('key');
      return;
    }

    final all = await StorageService.readAll();
    final encryptedPrivateKeyB64 = all['encrypted_private_key'] ?? '';
    final nonceB64 = all['nonce'] ?? '';
    final macB64 = all['mac'] ?? '';
    final saltB64 = all['salt'] ?? '';

    if (encryptedPrivateKeyB64.isEmpty || nonceB64.isEmpty || macB64.isEmpty || saltB64.isEmpty) {
      throw StorageException('Missing encrypted private key material');
    }

    final passKey = await CryptoService.passwordKey(password, base64Decode(saltB64));
    final plain = await CryptoService.decrypt(
      SecretBox(
        base64Decode(encryptedPrivateKeyB64),
        nonce: base64Decode(nonceB64),
        mac: Mac(base64Decode(macB64)),
      ),
      passKey,
    );

    final localWrap = CryptoService.randomBytes(32);
    final wrapped = await CryptoService.encrypt(plain, SecretKey(localWrap));

    await StorageService.write(_wrapKeyKey, base64Encode(localWrap));
    await StorageService.write(_ctKey, base64Encode(wrapped.cipherText));
    await StorageService.write(_nonceKey, base64Encode(wrapped.nonce));
    await StorageService.write(_macKey, base64Encode(wrapped.mac.bytes));

    // Never persist password-derived keys.
    await StorageService.delete('key');
  }

  static Future<List<int>> loadPrivateKeyBytes() async {
    final wrapKeyB64 = await StorageService.read(_wrapKeyKey);
    final ctB64 = await StorageService.read(_ctKey);
    final nonceB64 = await StorageService.read(_nonceKey);
    final macB64 = await StorageService.read(_macKey);

    if (wrapKeyB64 == null || ctB64 == null || nonceB64 == null || macB64 == null) {
      throw StorageException('Local private key not available');
    }

    return CryptoService.decrypt(
      SecretBox(
        base64Decode(ctB64),
        nonce: base64Decode(nonceB64),
        mac: Mac(base64Decode(macB64)),
      ),
      SecretKey(base64Decode(wrapKeyB64)),
    );
  }

  static Future<void> clearLocalWrappedKey() async {
    await StorageService.delete(_wrapKeyKey);
    await StorageService.delete(_ctKey);
    await StorageService.delete(_nonceKey);
    await StorageService.delete(_macKey);
  }
}
