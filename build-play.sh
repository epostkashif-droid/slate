#!/bin/sh
# Builds a signed Android App Bundle (slate-release.aab) for Google Play, without Gradle.
#
# Needs: aapt2, dalvik-exchange (Debian/Ubuntu packages), a JDK, an API 36 android.jar and bundletool.
#   AJ=/path/to/android-36/android.jar BUNDLETOOL=/path/to/bundletool-all.jar \
#   KS=/path/to/upload-key.jks KS_PASS=... KS_ALIAS=upload \
#   sh build-play.sh <versionCode> <versionName>
#
# The upload key is never kept in this repository.
set -e
V=${1:?versionCode}; VN=${2:?versionName}
AJ=${AJ:?set AJ to an API 36 android.jar}; BT=${BUNDLETOOL:?set BUNDLETOOL to bundletool-all.jar}
KS=${KS:?set KS to the upload keystore}; KS_PASS=${KS_PASS:?}; KS_ALIAS=${KS_ALIAS:-upload}
B=${B:-/tmp/slate-play}; OUT=${OUT:-slate-release.aab}
rm -rf "$B"; mkdir -p "$B/classes" "$B/dex" "$B/mod/manifest" "$B/mod/dex"

# 1. code
javac -source 8 -target 8 -bootclasspath "$AJ" -d "$B/classes" app/src/main/java/com/kaybuilds/slate/*.java
dalvik-exchange --dex --min-sdk-version=26 --output="$B/dex/classes.dex" "$B/classes"

# 2. resources and manifest, in the protobuf format bundles use
sed "s#<manifest xmlns:android=\"http://schemas.android.com/apk/res/android\">#<manifest xmlns:android=\"http://schemas.android.com/apk/res/android\" package=\"com.kaybuilds.slate\" android:versionCode=\"$V\" android:versionName=\"$VN\">#" \
  app/src/main/AndroidManifest.xml > "$B/AndroidManifest.xml"
${AAPT2:-aapt2} compile --dir app/src/main/res -o "$B/res.zip"
${AAPT2:-aapt2} link --proto-format -o "$B/linked.zip" -I "$AJ" --manifest "$B/AndroidManifest.xml" \
  --min-sdk-version 29 --target-sdk-version 36 --version-code "$V" --version-name "$VN" "$B/res.zip"

# 3. lay out the base module: manifest/, dex/, res/, assets/, resources.pb
(cd "$B/mod" && unzip -q ../linked.zip && mv AndroidManifest.xml manifest/)
cp "$B/dex/classes.dex" "$B/mod/dex/"
mkdir -p "$B/mod/assets" && cp -r app/src/main/assets/. "$B/mod/assets/"
(cd "$B/mod" && rm -f ../base.zip && zip -qr ../base.zip .)

# 4. bundle and sign
rm -f "$OUT"
java -jar "$BT" build-bundle --modules="$B/base.zip" --output="$OUT"
jarsigner -keystore "$KS" -storepass "$KS_PASS" -sigalg SHA256withRSA -digestalg SHA-256 "$OUT" "$KS_ALIAS" >/dev/null
jarsigner -verify "$OUT" >/dev/null && echo "Built and signed $OUT (versionCode $V, $VN)"
