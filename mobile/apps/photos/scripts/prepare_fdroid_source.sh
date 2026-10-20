#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

fail() {
    echo "prepare_fdroid_source: $*" >&2
    exit 1
}

# The standalone offline build no longer ships Firebase, in-app purchases,
# Google services, remote push, or the Play install referrer, so the
# historical pubspec-stripping and fdroid/overlay copy steps are no longer
# needed: the main source tree is fdroid-clean by construction.

remove_playstore_sources() {
    ../../packages/install_source/scripts/prepare_fdroid_source.sh
    sed -i.bak '/com.google.gms.google-services/d' android/app/build.gradle
    rm -f android/app/build.gradle.bak
    rm -f android/app/google-services.json
}

assert_fdroid_source() {
    if rg -n "package:(firebase_core|firebase_messaging|in_app_purchase)" lib pubspec.yaml; then
        fail "restricted package imports or direct dependencies remain"
    fi

    if rg -n "FirebaseMessaging|Firebase\\.initializeApp|RemoteMessage|InAppPurchase|PurchaseStatus" lib; then
        fail "restricted Firebase or in-app purchase references remain"
    fi

    if rg -n "com\\.android\\.installreferrer|InstallReferrer(Client|StateListener)|installreferrer" android/app/build.gradle android/app/src ../../packages/install_source/android; then
        fail "Play install referrer dependency or source remains"
    fi
}

remove_playstore_sources
assert_fdroid_source
