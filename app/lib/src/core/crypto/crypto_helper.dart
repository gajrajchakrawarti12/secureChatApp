import 'dart:convert';

import 'package:chatapp/src/core/errors/exceptions.dart';
import 'package:chatapp/src/core/crypto/private_key_store.dart';

class CryptoHelper {
  Future<String> decryptPrivateKey() async {
    try {
      final bytes = await PrivateKeyStore.loadPrivateKeyBytes();
      return base64Encode(bytes);
    } catch (e) {
      throw StorageException(e.toString());
    }
  }
}
