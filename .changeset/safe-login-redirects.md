---
"@svelte-atproto/sv": patch
---

Require OAuth 0.4.1, including state-bound return paths, corrected cookie delivery from intercepted hook responses, and Kit 3 compatibility. Both generated login pages now validate return paths with OAuth's `safeReturnTo` instead of an inline copy, rejecting backslash/open-redirect tricks, encoded control characters, and malformed escapes while preserving valid path/query encoding. Publish OAuth 0.4.1 before this addon release.
