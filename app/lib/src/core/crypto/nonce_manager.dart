import 'dart:typed_data';

import 'package:chatapp/src/core/storage/storage_service.dart';
import 'package:cryptography/cryptography.dart';

class NonceManager {
  static String _counterKey({required int lowId, required int highId, required String direction}) {
    return 'nonce_ctr_${lowId}_${highId}_$direction';
  }

  static Future<List<int>> nextNonce({
    required int myId,
    required int peerId,
    required SecretKey nonceKey,
  }) async {
    final low = myId < peerId ? myId : peerId;
    final high = myId < peerId ? peerId : myId;
    final direction = myId < peerId ? 'low_to_high' : 'high_to_low';

    final key = _counterKey(lowId: low, highId: high, direction: direction);
    final prevRaw = await StorageService.read(key);
    final prev = int.tryParse(prevRaw ?? '') ?? 0;
    final next = prev + 1;
    await StorageService.write(key, next.toString());

    final counterBytes = ByteData(8)..setUint64(0, next);
    final mac = await Hmac.sha256().calculateMac(counterBytes.buffer.asUint8List(), secretKey: nonceKey);
    // AES-GCM nonce is 12 bytes
    return mac.bytes.sublist(0, 12);
  }
}
