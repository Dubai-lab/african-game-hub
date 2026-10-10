# The Android and iPhone apps

The apps are a native shell (Capacitor) around the hub's own site. The shell opens
`https://africangamehub.com/lobby`, so a player in the app and a player in a browser are always
on the same version, and an update to the site reaches the apps without a new release in the
stores. The shell itself carries only the app's icon, its splash screen and the page shown when
there is no connection (`www/offline.html`).

Nothing here is part of the website's download. The site knows it is inside the app by the name
the shell adds to the browser's description (`AfricanGameHubApp/1.0`); the little the site does
differently is in `src/core/lib/nativeApp.ts`.

| | |
| --- | --- |
| App id (both stores) | `com.africangamehub.app` |
| Settings | `capacitor.config.ts` |
| Android project | `android/` |
| iPhone project | `ios/` (Swift packages, no CocoaPods) |
| Icons and splash screens | `npm run icons` (from the hub's mark; see `make-icons.mjs`) |

## Building test apps on Codemagic

`codemagic.yaml` at the top of the repository has two builds, started by hand:

- **Android test app (APK)**: download `AfricanGameHub-test.apk` and open it on an Android phone.
- **iPhone test app (unsigned IPA)**: download `AfricanGameHub-unsigned.ipa` and drop it into
  Sideloadly, which signs it with your Apple ID for seven days.

Neither needs a Google or Apple developer account.

## Building the Android app on a computer

Needs Java 21 and the Android SDK.

```
cd mobile
npm ci
npx cap sync android
cd android
./gradlew assembleDebug        # gradlew.bat on Windows
```

The app is at `android/app/build/outputs/apk/debug/app-debug.apk`. The iPhone app can only be
built on a Mac.

## Testing the shell against another copy of the site

```
AGH_APP_URL=https://some-test-address npx cap sync
```

Never for a release: the stores' builds must open the hub's own address.

## Before the stores

Not done yet, on purpose: they need the developer accounts.

- **Signing.** Android: an upload key and a release build (`bundleRelease`, an `.aab`). iPhone:
  a distribution certificate and profile (Codemagic can manage both).
- **Version numbers.** `versionCode` / `versionName` in `android/app/build.gradle`, and
  `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` in the Xcode project, go up with every release.
- **Links that open the app.** Confirmation and password emails open in the phone's browser
  today. Opening them in the app needs Android App Links and iOS Universal Links (two small
  files served by the site, plus the developer accounts' ids).
- **Store rules.** Apple asks that an app be more than a website in a frame; the listing should
  lead with what the app is for. Both stores have their own rules for real-money play, which
  apply the day deposits are switched on, not before.
