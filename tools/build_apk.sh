#!/bin/bash
# Builds dist/Brads_Underover.apk (package com.bradz.underover) from dist/Brads_Underover.html without Android Studio.
# Needs: Java 17+, Node/npm (to fetch the toolchain), Python 3, zip.
# Signing: set KEYSTORE, KS_PASS and KS_ALIAS to use your own key. Without them a new key
# is made in keys/ (git-ignored). Updates only install over a build signed with the same key.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
TC=.toolchain; B=build
VC=${VC:-4}; VN=${VN:-1.1.2}; NAME=Brads_Underover; MANIFEST=android/AndroidManifest.xml
TARGET=${TARGET:-36}
if [ ! -d $TC/minapk ]; then
  mkdir -p $TC && (cd $TC && npm pack @drxiaozhi/minapk@0.5.1 aaptjs3@2.0.2 >/dev/null)
  mkdir -p $TC/minapk $TC/aapt && tar xzf $TC/drxiaozhi-minapk-*.tgz -C $TC/minapk && tar xzf $TC/aaptjs3-*.tgz -C $TC/aapt
fi
T=$TC/minapk/package/tools; AJ=$T/android.jar
case "$(uname -s)" in Darwin) AAPT2=$TC/aapt/package/bin/x64/darwin/aapt2;; *) AAPT2=$TC/aapt/package/bin/x64/linux/aapt2;; esac
chmod +x "$AAPT2"
VN=$VN python3 tools/bundle.py
rm -rf $B; mkdir -p $B/assets $B/classes $B/dex
cp dist/$NAME.html $B/assets/index.html
mkdir -p $B/res && cp -r android/res/. $B/res/
"$AAPT2" compile --dir $B/res -o $B/res.zip
"$AAPT2" link -I $AJ --manifest $MANIFEST -o $B/base.apk -A $B/assets \
  --min-sdk-version 24 --target-sdk-version $TARGET --version-code $VC --version-name $VN --java $B/gen $B/res.zip
# ecj, because d8 8.2 rejects the MethodParameters attribute newer javac versions emit
java -jar $T/ecj-3.45.0.jar -8 -nowarn -cp $AJ -d $B/classes $(find android/src $B/gen -name '*.java')
java -cp $T/d8.jar com.android.tools.r8.D8 --release --min-api 24 --lib $AJ --output $B/dex $(find $B/classes -name '*.class')
cp $B/base.apk $B/unaligned.apk && (cd $B/dex && zip -q -X ../unaligned.apk classes.dex)
python3 -m pip show repro-apk >/dev/null 2>&1 || python3 -m pip install -q repro-apk
# alignment padding as a proper ZIP extra field (0xD935, what the Android Gradle plugin writes),
# not loose zero bytes, so strict ZIP parsers on newer phones accept every entry
python3 -m repro_apk.zipalign --pad-like-apksigner --replace 4 $B/unaligned.apk $B/aligned.apk
if [ -z "${KEYSTORE:-}" ]; then
  KEYSTORE=keys/underover.jks; KS_PASS=${KS_PASS:-changeit}; KS_ALIAS=${KS_ALIAS:-underover}
  [ -f $KEYSTORE ] || { mkdir -p keys; keytool -genkeypair -keystore $KEYSTORE -storepass $KS_PASS -keypass $KS_PASS -alias $KS_ALIAS -keyalg RSA -keysize 4096 -validity 36500 -dname "CN=Bradley Williams, O=Brad's Underover, C=JM"; }
fi
# v1 (JAR) signing on top of v2/v3: Android 7+ only needs v2, but some file managers and OEM installers still read the v1 files
java -jar $T/apksigner.jar sign --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true --ks "$KEYSTORE" --ks-pass pass:$KS_PASS --ks-key-alias $KS_ALIAS --key-pass pass:$KS_PASS --min-sdk-version 24 --out dist/$NAME.apk $B/aligned.apk
java -jar $T/apksigner.jar verify dist/$NAME.apk && echo "dist/$NAME.apk is signed and ready"
