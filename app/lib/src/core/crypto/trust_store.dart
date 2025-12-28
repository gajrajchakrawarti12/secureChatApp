import 'dart:convert';

import 'package:chatapp/src/core/storage/storage_service.dart';
import 'package:cryptography/cryptography.dart';

class TrustStore {
  static String _keyForUser(int userId) => 'trusted_pubkey_fpr_$userId';

  static Future<String> fingerprintBase64(List<int> publicKeyBytes) async {
    final digest = await Sha256().hash(publicKeyBytes);
    return base64Encode(digest.bytes);
  }

  /// Trust-On-First-Use:
  /// - If no fingerprint exists, pin current one.
  /// - If it exists and differs, report the mismatch.
  static Future<TrustResult> checkAndPin({
    required int userId,
    required List<int> publicKeyBytes,
  }) async {
    final current = await fingerprintBase64(publicKeyBytes);
    final key = _keyForUser(userId);
    final pinned = await StorageService.read(key);

    if (pinned == null || pinned.isEmpty) {
      await StorageService.write(key, current);
      return TrustResult.pinned(current);
    }

    if (pinned == current) {
      return TrustResult.trusted(current);
    }

    return TrustResult.changed(pinned: pinned, current: current);
  }

  static Future<void> updatePinned({required int userId, required String fingerprintBase64}) {
    return StorageService.write(_keyForUser(userId), fingerprintBase64);
  }
}

class TrustResult {
  final String status; // pinned | trusted | changed
  final String current;
  final String? pinned;

  TrustResult._(this.status, this.current, this.pinned);

  factory TrustResult.pinned(String current) => TrustResult._('pinned', current, null);
  factory TrustResult.trusted(String current) => TrustResult._('trusted', current, null);
  factory TrustResult.changed({required String pinned, required String current}) => TrustResult._('changed', current, pinned);
}
