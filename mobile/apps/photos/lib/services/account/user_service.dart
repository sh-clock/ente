import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:logging/logging.dart';
import 'package:photos/core/configuration.dart';
import 'package:photos/core/event_bus.dart';
import 'package:photos/events/signed_in_event.dart';
import 'package:photos/events/user_details_changed_event.dart';
import 'package:photos/events/user_logged_out_event.dart';
import 'package:photos/models/user_details.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Offline standalone app: the ente account stack (SRP login, OTP, 2FA,
/// passkeys, sessions, family portal, account deletion) has been removed.
/// Only the shell needed by the lock screen, the settings drawer and the
/// cached user details remains.
class UserService {
  static const keyUserDetails = "user_details";

  final _logger = Logger((UserService).toString());
  final _config = Configuration.instance;
  late SharedPreferences _preferences;
  StreamSubscription<UserLoggedOutEvent>? _loggedOutEventSubscription;
  StreamSubscription<SignedInEvent>? _signedInEventSubscription;

  final ValueNotifier<String?> emailValueNotifier = ValueNotifier<String?>(null);

  UserService._privateConstructor();

  static final UserService instance = UserService._privateConstructor();

  Future<void> init() async {
    emailValueNotifier.value = Configuration.instance.getEmail();
    if (_loggedOutEventSubscription != null) {
      await _loggedOutEventSubscription!.cancel();
    }
    _loggedOutEventSubscription = Bus.instance.on<UserLoggedOutEvent>().listen((
      _,
    ) {
      emailValueNotifier.value = null;
    });
    if (_signedInEventSubscription != null) {
      await _signedInEventSubscription!.cancel();
    }
    _signedInEventSubscription = Bus.instance.on<SignedInEvent>().listen((_) {
      emailValueNotifier.value = Configuration.instance.getEmail();
    });
    _preferences = await SharedPreferences.getInstance();
  }

  UserDetails? getCachedUserDetails() {
    if (_preferences.containsKey(keyUserDetails)) {
      try {
        return UserDetails.fromJson(_preferences.getString(keyUserDetails)!);
      } catch (e) {
        _logger.warning("Failed to parse cached user details", e);
      }
    }
    return null;
  }

  /// Offline app: user details can no longer be fetched from a server, so
  /// this only serves the locally cached value (if any).
  Future<UserDetails?> getUserDetailsV2({
    bool memoryCount = true,
    bool shouldCache = true,
  }) async {
    return getCachedUserDetails();
  }

  Future<void> setEmail(String email) async {
    await _config.setEmail(email);
    emailValueNotifier.value = email;
    Bus.instance.fire(UserDetailsChangedEvent());
  }

  /// Local logout: clear all local state and restart the app flow at the
  /// root route. There is no server session to terminate.
  Future<void> logout(BuildContext context) async {
    try {
      await Configuration.instance.logout();
    } catch (e, s) {
      _logger.severe("Failed to clear local state during logout", e, s);
    }
    if (context.mounted) {
      Navigator.of(context).popUntil((route) => route.isFirst);
    }
    if (kDebugMode) {
      _logger.info("Local logout complete");
    }
  }
}
