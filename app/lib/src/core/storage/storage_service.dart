import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:chatapp/src/core/errors/exceptions.dart';

class StorageService {
  static final _storage = FlutterSecureStorage();

  static Future<void> write(String k, String v) async {
    try {
      await _storage.write(key: k, value: v);
    } catch (e) {
      throw StorageException('Failed to write key "$k": $e');
    }
  }

  static Future<void> writeAll(Map<String, dynamic> data) async {
    try {
      await _storage.writeAll(data: data);
    } catch (e) {
      throw StorageException('Failed to write multiple keys: $e');
    }
  }

  static Future<String?> read(String k) async {
    try {
      return await _storage.read(key: k);
    } catch (e) {
      throw StorageException('Failed to read key "$k": $e');
    }
  }

  static Future<Map<String, String>> readAll() async {
    try {
      return await _storage.readAll();
    } catch (e) {
      throw StorageException('Failed to read all keys: $e');
    }
  }

  static Future<void> delete(String k) async {
    try {
      await _storage.delete(key: k);
    } catch (e) {
      throw StorageException('Failed to delete key "$k": $e');
    }
  }

  static Future<void> deleteAll() async {
    try {
      await _storage.deleteAll();
    } catch (e) {
      throw StorageException('Failed to delete all keys: $e');
    }
  }
}

extension on FlutterSecureStorage {
  Future<void> writeAll({required Map<String, dynamic> data}) async {
    for (final entry in data.entries) {
      final value = entry.value?.toString();
      await write(key: entry.key, value: value);
    }
  }
}
