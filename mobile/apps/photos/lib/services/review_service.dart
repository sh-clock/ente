import 'package:url_launcher/url_launcher_string.dart';

abstract final class ReviewService {
  // Fork: the standalone build is not published to the app stores, so
  // "rate us" routes to the fork's repository instead of ente's store
  // listings.
  static String get url {
    return 'https://github.com/sh-clock/ente';
  }

  static Future<void> launch() {
    return launchUrlString(url, mode: LaunchMode.externalApplication);
  }
}
