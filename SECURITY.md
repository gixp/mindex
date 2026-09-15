# Security

## Reporting a vulnerability

Please report privately, not in a public issue.

- Preferred: [open a private advisory](https://github.com/gixp/Mindex/security/advisories/new),
  which keeps the report between you and the maintainer until there is a fix.
- Or email **dvolynov@gmail.com** with "Mindex security" in the subject.

Tell me what you found, how to reproduce it, and what an attacker gets. A
proof of concept helps; an exploit against somebody else's machine is not
welcome.

This is a one-person project, so expect a first reply within a few days rather
than within hours. You will be credited in the release that fixes it unless you
would rather not be.

## Supported versions

The latest release only. Fixes go out as a new version rather than as a patch
to an old one.

## What the app does with your data

Worth stating plainly, because it decides what counts as a vulnerability here.

- **Notes never leave your machine** by the app's own doing. They are files in
  a folder you chose.
- **The assistant is a CLI you installed and signed in to yourself.** Mindex
  runs it in your vault. Whatever you send it goes wherever that CLI sends it,
  under your own account — Mindex holds no API key and has no server of its
  own.
- **Crash reports and anonymous usage counts** go to the crash reporter and the
  analytics service named in `.env.example`, and only when those keys were
  compiled in. Note content is never included; the scrubbing that removes
  identifying detail is checked by `node scripts/scrub-check.mjs`.
- **There is no account and no sync.** Nothing to breach on our side, because
  there is no side.

## In scope

Anything that breaks those four sentences. Concretely, and these are the ones
worth looking at:

- A path that writes or reads outside the open vault.
- Note content reaching a crash report, an analytics event, or any log that
  leaves the machine.
- Remote code execution through a crafted note, link, image or vault file.
- An assistant's tools escaping the scope a conversation was given.
- A packaged build shipping a key, a token, or source maps it should not.

## Out of scope

- The assistant CLIs themselves, and what their vendors do with what you send.
  Report those to the vendor.
- Anything requiring an attacker who already has your unlocked machine.
- The unsigned macOS build's Gatekeeper prompt. It is a known consequence of
  shipping without an Apple certificate, and it is stated in the README.
