#!/bin/sh
# Builds a sideload Slate.apk for testing on your own phone (not for Play; use build-play.sh for that).
# Needs aapt2, apksigner, zipalign, dalvik-exchange and a JDK. The signing key is passed in, never stored here:
#   AJ=/path/to/android.jar KS=/path/to/test-key.jks KS_PASS=... KS_ALIAS=... sh build-local.sh <versionCode>
set -e
AJ=${AJ:-/usr/lib/android-sdk/platforms/android-34/android.jar}   # needs an API 26+ platform jar
B=${B:-/tmp/slate-build}; V=${1:-1}
rm -rf "$B"; mkdir -p "$B/classes" "$B/dex"
javac -source 8 -target 8 -bootclasspath "$AJ" -d "$B/classes" app/src/main/java/com/kaybuilds/slate/*.java
sed "s#<manifest xmlns:android=\"http://schemas.android.com/apk/res/android\">#<manifest xmlns:android=\"http://schemas.android.com/apk/res/android\" package=\"com.kaybuilds.slate\" android:versionCode=\"$V\" android:versionName=\"1.0.$V\"><uses-sdk android:minSdkVersion=\"29\" android:targetSdkVersion=\"36\" />#" app/src/main/AndroidManifest.xml > "$B/AndroidManifest.xml"
${AAPT2:-aapt2} compile --dir app/src/main/res -o "$B/res.zip"
${AAPT2:-aapt2} link -o "$B/unsigned.apk" -I "$AJ" --manifest "$B/AndroidManifest.xml" -A app/src/main/assets --min-sdk-version 29 --target-sdk-version 36 "$B/res.zip"
dalvik-exchange --dex --min-sdk-version=26 --output="$B/dex/classes.dex" "$B/classes"
(cd "$B/dex" && zip -q ../unsigned.apk classes.dex)
zipalign -f -p 4 "$B/unsigned.apk" "$B/aligned.apk"
apksigner sign --ks "${KS:?set KS}" --ks-pass "pass:${KS_PASS:?}" --key-pass "pass:${KS_PASS}" --ks-key-alias "${KS_ALIAS:?}" --min-sdk-version 29 --v2-signing-enabled true --out Slate.apk "$B/aligned.apk"
echo "Built Slate.apk (version $V)"
