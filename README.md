# Slate

Know what you spent today, and whether that is up or down. Slate reads the transaction SMS your bank already sends, shows today against yesterday and last week, and keeps everything on the phone.

- **Spent today, vs yesterday and last week**: one number updated after every spend, with ▲/▼ % against yesterday and last week's daily average (also in the spend notification); an optional monthly limit with EMIs and rent set aside first
- **One-tap sorting** of unrecognised spends, straight from the notification
- **Balances** for bank accounts, credit cards and cash, kept current from the moment you enter them
- **Fixed payments** and **lent & borrowed** tracking that carry across months
- **A clean slate every month, nothing lost**: on the 1st the month moves to an in-app **Archive** (wrap, donut, calendar and every spend, read-only, exportable), with an optional spreadsheet copy in Downloads and a shareable month wrap
- **Your own categories**: 19 starters plus any you add, with emoji, colour, an optional monthly cap, reordering and hiding; create one straight from the picker
- **Live visuals**: a liquid "tank" of what is left, pace vs. the month, a donut, "every ₹100", a spending calendar, month-by-month bars, a wallet pocket that spreads out every account and card and a "truly free to use" waterfall
- **Goals & wishlist**: animated jars that fill as you save, coin-drop and milestone confetti at 25/50/75/100%, what it takes per day or month to hit a date, a coffee-skip nudge, an evening offer to stash today's unspent money, and "can I afford it yet?" for wishlist items
- **Remove an account**: "not mine" drops it and ignores its messages (no notifications), or just hide it; either can be brought back
- **Backup and restore**: one file with every month and setting, restorable on a new phone
- **Four looks × eight colours**: Classic, Sway, Paper and Glow; Emerald, Ocean, Grape, Teal, Sunset, Rose, Graphite and an animated Aurora; Auto/Light/Dark; Lively or Calm motion (confetti, ripples, haptics)
- **Private by design**: no account, no cloud, no internet permission

Package `com.kaybuilds.slate` · minimum Android 10 (API 29) · targets Android 16 (API 36).

## Layout

| Path | What it is |
| --- | --- |
| `app/src/main/assets/` | The whole interface (`index.html`, `app.js`, `style.css`) and the SMS parser (`parser.js`) |
| `app/src/main/java/com/kaybuilds/slate/` | Thin native shell: SMS reading, notifications, storage, export, system bars |
| `app/src/main/res/` | Icon, notification icon, theme |
| `tests/` | Parser tests: `node tests/parser.test.js` |
| `docs/privacy.html` | Privacy policy page, ready for GitHub Pages or any web host |
| `build-play.sh` | Builds the signed App Bundle for Google Play |
| `build-local.sh` | Builds a sideload APK for testing on your own phone |

## Building for Google Play

Needs `aapt2` (a 2024 or newer build; older ones cannot read the API 36 platform), `dalvik-exchange`, a JDK, an API 36 `android.jar` and [bundletool](https://github.com/google/bundletool/releases).

```sh
AAPT2=/path/to/aapt2 AJ=/path/to/android-36/android.jar BUNDLETOOL=/path/to/bundletool-all.jar \
KS=/path/to/slate-upload-key.jks KS_PASS='…' KS_ALIAS=upload \
sh build-play.sh 10 1.0.0
```

This writes `slate-release.aab`, signed with the upload key. Raise the version code by one for every upload.

**The upload key and its password are never committed.** Keep them in a password manager. Google Play re-signs the app with its own key (Play App Signing), so a lost upload key can be reset through Play Console support.

## Testing a build on a phone

```sh
java -jar bundletool-all.jar build-apks --bundle=slate-release.aab --output=slate.apks --mode=universal \
  --ks=/path/to/test-key.jks --ks-pass=pass:… --ks-key-alias=…
```

Unzip `slate.apks` and install `universal.apk`. Android blocks SMS access for sideloaded apps until you allow it: App info → ⋮ → Allow restricted settings, then Permissions → SMS → Allow.

## Privacy

Slate has no `INTERNET` permission. All parsing and storage happen in the app's private storage on the device. Published at https://epostkashif-droid.github.io/knockit-legal/slate/privacy.html (source: [`docs/privacy.html`](docs/privacy.html)).
