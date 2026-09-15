# Release notes

One file per released version, named for it exactly as `package.json` does —
`1.0.0.md`, `1.1.0-beta.1.md`. The release workflow reads the file matching
the version it is building and writes it into the manifest that both the
download page and the app's own update card display.

The format is two parts:

```
One sentence, shown as the summary under the version.

- What changed, one line each.
- Written for someone who uses Mindex, not for someone who works on it.
```

The first line is the summary. Everything after it is read as bullets, with
any leading `-` or `*` stripped, so plain lines work too.

**Why files rather than a form.** These used to be typed into the release form
at the moment of pressing the button — written from memory, by whoever
happened to be releasing, about work that might be weeks old, and kept
nowhere afterwards. A file is written while the change is fresh, is reviewed
alongside it, and is still here a year later. If a version has no file the
workflow falls back to the form's inputs, so nothing breaks; it just goes back
to being typed from memory.

A version with nothing worth saying can have a file with one line. An empty
release note is a decision; a missing one is an accident.
