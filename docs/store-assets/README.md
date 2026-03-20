# Store assets and metadata checklist

Use this checklist when preparing DriftGuide for App Store and Google Play. Store listings are configured in App Store Connect and Play Console; you can keep local copies of copy and screenshots here.

## Before you ship

1. **Replace placeholder URLs in app config**  
   In [app.json](../../app.json), set `expo.extra.privacyPolicyUrl` and `expo.extra.supportUrl` to your real URLs (replace `https://yoursite.com/...`). Use the same URLs in the store consoles.

2. **Sign in with Apple (iOS)**  
   If you add any third-party sign-in later, Apple requires Sign in with Apple. The app already has the plugin and `usesAppleSignIn: true`. In [Apple Developer](https://developer.apple.com): open your App ID for DriftGuide and enable the **Sign in with Apple** capability.

---

## iOS (App Store Connect)

| Item | Notes |
|------|--------|
| **Screenshots** | 6.5" (e.g. iPhone 14 Pro Max) required; 5.5" optional. iPad if supporting tablet. Use Simulator or device. |
| **App description** | Short + full description. |
| **Keywords** | 100 characters, comma-separated, no spaces after commas. |
| **Support URL** | Required. Same as `expo.extra.supportUrl`. |
| **Privacy policy URL** | Required. Same as `expo.extra.privacyPolicyUrl`. |
| **Category** | e.g. Sports or Navigation. |
| **Age rating** | Complete the questionnaire. |
| **Contact email** | For review and support. |
| **Icon** | 1024×1024; export from `assets/images/icon.png` or design source. |

---

## Android (Play Console)

| Item | Notes |
|------|--------|
| **Screenshots** | Phone required; 7" tablet if supporting tablet. Check Play Console for current dimensions. |
| **Short description** | Max 80 characters. |
| **Full description** | Max 4000 characters. Use keywords here (Play has no separate keyword field). |
| **Privacy policy URL** | Required. Same as `expo.extra.privacyPolicyUrl`. |
| **Support / contact** | Recommended. Same as `expo.extra.supportUrl`. |
| **Category** | e.g. Sports or Maps & Navigation. |
| **Content rating** | Complete the questionnaire. |
| **High-res icon** | Export from same source as iOS. |

---

## Suggested screenshot flows

- Sign-in / sign-up screen
- Home (main experience)
- Guide tab
- Journal tab

Capture at required resolutions; add device frames if desired (e.g. design tools or `fastlane frameit`).

---

## Build and submit

- **Build**: `eas build --platform ios --profile production` and `eas build --platform android --profile production`
- **Submit**: `eas submit` or upload the built artifact in the store consoles.
- **iOS**: Complete the listing in App Store Connect, then submit for review.
- **Android**: Upload AAB to Play Console; use an internal testing track first, then promote to production.
