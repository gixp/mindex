import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

/**
 * Flat config (required since ESLint v9) — there was never one before this,
 * so `npm run lint` has done nothing but fail since the v9 upgrade. Main and
 * renderer get separate `languageOptions.globals` (Node vs DOM) because they
 * genuinely run in different environments — `tsconfig.node.json` and
 * `tsconfig.web.json` already draw this same line for typecheck, this
 * mirrors it for lint.
 *
 * No type-checked rules (`tseslint.configs.recommendedTypeChecked`) yet:
 * those need `parserOptions.project` wired to both tsconfigs per file and are
 * slow on a codebase this size. `recommended` (syntactic only) already
 * catches the class of bug that motivated this — `react-hooks/rules-of-hooks`
 * and `react-hooks/exhaustive-deps` don't need type info, and would have
 * caught the dead `leftPanelWrapperRef` effect found and removed from
 * `App.tsx` in an earlier pass. Add type-aware rules later as a deliberate
 * second step, not bundled into "turn lint on at all".
 */
// Matches a Tailwind `text-[Npx]` or `rounded(-tl/-tr/-bl/-br/-t/-b/-l/-r)-[Npx]`
// arbitrary value, wherever it appears in a class string — including after a
// variant prefix like `hover:text-[13px]`, since `\b` only requires the
// character before "text-[" to be a non-word character, and `:` qualifies.
// Used by the no-restricted-syntax entries below: every value actually in use
// today has a matching token in tailwind.config.ts's fontSize/borderRadius
// scales (added alongside this rule), so this only ever fires on a genuinely
// new one.
const ARBITRARY_TEXT_OR_RADIUS = String.raw`\btext-\[|\brounded(-[tlbr]{1,2})?-\[`

/**
 * The five design rules below each lock in something that was actually broken
 * and fixed, not something imagined. They share a character: none of them
 * fails loudly. They make the app quietly do the wrong thing — a hover that
 * does not move, a panel a different shade from its neighbour, a shadow on
 * something that is not floating — which no test catches and a person finds a
 * month later.
 */

/**
 * A fill in one of the border colours.
 *
 * `--bd-1` is defined as *equal to* `--bg-2`, and `--bg-2` is what every
 * panel, window and menu is made of. Filling a row with it paints the panel
 * onto itself: twenty hovers across the app did nothing at all, including
 * every button in the header, because of this one mistake. A hover fills a
 * step *above* its surface — `bg-bg-3`.
 *
 * `bg-bd-*` on an `h-px` element is a hairline, not a fill, and is fine; this
 * only catches the state variants, which is where the mistake lives.
 */
const BORDER_COLOUR_AS_FILL = String.raw`\b(hover|focus|active|group-hover):bg-bd-\d`

/**
 * A shadow that is not one of the two named ones.
 *
 * There are exactly two: `shadow-s1` for a knob and `shadow-s2` for anything
 * that floats. A docked panel casts none — it is held by the page's darker
 * ground, and a shadow on it reads as loose. Before this rule there were four
 * different hand-written shadows and five palette ones, because `--sh-1` had
 * no dark value and everything that wanted a shadow invented its own.
 */
const UNNAMED_SHADOW = String.raw`\bshadow-(sm|md|lg|xl|2xl|inner)\b|\bshadow-\[`

/**
 * A colour written as a value rather than named.
 *
 * Every colour in the app is a token. Two places genuinely cannot use a class
 * — a canvas and an SVG stroke — and they read the variable at runtime
 * instead. Everything else that reached for a literal ended up as one of the
 * 66 palette blues, or one of four hand-written surfaces that drifted apart.
 */
const LITERAL_COLOUR_UTILITY = String.raw`\b(bg|text|border|ring|from|to|via|fill|stroke)-\[(#|rgb|hsl)`

/**
 * A shade from the utility palette where the app has its own token.
 *
 * Blue is the accent and has one value; grey is the elevation ladder. The
 * status hues (red, amber, emerald) stay available, because there the colour
 * carries meaning rather than identity.
 */
const PALETTE_SHADE = String.raw`\b(bg|text|border|ring|from|to|via|decoration)-(blue|indigo|sky|slate|gray|zinc|neutral|stone)-\d{2,3}`

// Matches a stacking value written as a number — `z-50` or `z-[999]` — rather
// than as one of the named layers in design-tokens.ts. Tailwind's own numeric
// scale is switched off in the config, so `z-50` no longer resolves to
// anything; this catches it at the point it is written instead of at the point
// someone notices a dialog is behind a panel. Both forms are named because
// `z-[999]` still compiles and would reintroduce exactly the problem the
// ladder removed: a number asserting itself against numbers it cannot see.
const ARBITRARY_LAYER = String.raw`\bz-\[?[0-9]`

export default tseslint.config(
  {
    ignores: ['out/**', 'dist/**', 'build/**', 'resources/**', '**/*.d.ts']
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // A `try { cleanup() } catch {}` around a best-effort teardown (remove
      // a listener, kill an already-exited process) is a deliberate,
      // widely-used idiom in this codebase — the failure genuinely doesn't
      // matter. `no-empty`'s default still catches an accidentally-empty
      // `if`/`for`/etc body, which is a different, real mistake.
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  },
  {
    // Standalone Node scripts (icon generation, release helpers) — not part
    // of the main/preload/renderer split above, so they get plain Node
    // globals rather than falling through with none at all.
    files: ['scripts/**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: { ...globals.node }
    }
  },
  {
    // Everything the main process answers goes through one door.
    //
    // `ipc/handle.ts` exists so that registering an operation and declaring it
    // cannot drift apart: it takes a channel from the shared list, and a test
    // asserts every declared operation has a handler. A call to `ipcMain`
    // anywhere else is a handler outside that accounting — it works, and the
    // completeness check silently stops meaning anything.
    //
    // Zero violations when this was turned on. That is the point of turning it
    // on now: the cheapest moment to lock a decision is while nothing breaks
    // it, and the alternative is remembering for a year.
    files: ['src/main/**/*.{ts,tsx}', 'src/preload/**/*.{ts,tsx}'],
    ignores: ['src/main/ipc/handle.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'ipcMain',
          property: 'handle',
          message:
            'Register through handle() in main/ipc/handle.ts — the completeness test only sees handlers that went through it'
        },
        {
          object: 'ipcMain',
          property: 'on',
          message:
            'Register through handle() in main/ipc/handle.ts — the completeness test only sees handlers that went through it'
        }
      ],
      // Same reason as the renderer's: reaching up out of a folder is what
      // makes moving one expensive, and these folders are about to be
      // regrouped. `@main/…` resolves from the process root, so a file moves
      // without any of its imports changing. Siblings stay relative — a
      // folder takes them along.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../*'],
              message:
                "Import from '@main/…' instead of climbing out with '../'. Same-folder './…' imports are fine."
            }
          ]
        }
      ]
    },
    languageOptions: {
      globals: { ...globals.node }
    }
  },
  {
    // Everything the window asks of the main process goes through one door.
    //
    // `platform/api.ts` is that door: it reads the bridge once and throws a
    // sentence if preload did not run, instead of every call site getting
    // `undefined is not a function` from somewhere unrelated. Reaching the
    // bridge directly also skips the typed contract, which is the thing that
    // makes an operation and its declaration impossible to drift apart.
    //
    // Zero violations when this was turned on — like the handler rule beside
    // it. The test stub is exempt because assigning the bridge is exactly its
    // job.
    files: ['src/renderer/**/*.{ts,tsx}'],
    ignores: ['src/renderer/src/platform/api.ts', 'src/renderer/src/test/**'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'window',
          property: 'mindex',
          message:
            'Call api() from platform/api.ts — it checks the bridge is there and carries the typed contract'
        }
      ]
    }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser }
    },
    plugins: {
      react,
      'react-hooks': reactHooks
    },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules,
      // Not `reactHooks.configs.recommended` — as of v7 that preset is the
      // full React Compiler rule set (`set-state-in-effect`, `purity`,
      // `immutability`, `gating`, ...), meant for a codebase opting into the
      // compiler. Applied here it flagged ~15 ordinary, working
      // "reset/sync state on id change" effects — an established, deliberate
      // pattern in this app (see the existing
      // `// eslint-disable-next-line react-hooks/exhaustive-deps` in
      // `TypeEditorView.tsx`) — as errors. Only the two rules that catch a
      // real hook-usage mistake regardless of compiler adoption:
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // `prop-types` validates plain-JS PropTypes declarations — every prop
      // here is already typed, so the rule can only ever be a false
      // positive on a TS codebase. `eslint-plugin-react`'s `recommended`
      // (spread above) turns it on by default; this is the standard
      // TS-project override for it.
      'react/prop-types': 'off',
      // Several components deliberately use `dangerouslySetInnerHTML` and
      // already carry a scoped `eslint-disable-next-line react/no-danger`
      // acknowledging it — the rule needs to actually be on for those
      // comments to mean anything, rather than reporting as dead directives.
      'react/no-danger': 'warn',
      // Blocks new `text-[Npx]`/`rounded-[Npx]` arbitrary values — reach for
      // a fontSize/borderRadius token in tailwind.config.ts instead, adding
      // one there first if the size you need genuinely isn't covered yet.
      // The 450+ pre-existing occurrences are exempted via
      // eslint-suppressions.json (ESLint's baseline mechanism, `npx eslint
      // --suppress-all` after a real audit), not by this rule going easy on
      // them — migrate one on next touch and rerun `--prune-suppressions` to
      // keep that file honest as the backlog shrinks. `error`, not `warn`:
      // unlike `--suppress-all`, plain `warn` would just add ~450 lines of
      // noise burying the real signal in the 11 exhaustive-deps warnings.
      //
      // Only catches TS/TSX class strings — a handful of `@apply text-[Npx]`
      // sites in globals.css are outside what ESLint parses; no stylelint in
      // this repo yet to cover those.
      // Reaching up out of your own folder is what makes moving a file
      // expensive: every `../../..` inside it has to be rewritten, and every
      // one that pointed *at* it too. The `@/` alias (already wired for the
      // build, typecheck and tests) resolves from the renderer root, so a
      // file can move without any of its imports changing.
      //
      // Siblings stay relative on purpose — `./thing` says "next to me", and
      // a folder that moves takes its siblings along, so those never break.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../*'],
              message:
                "Import from '@/…' instead of climbing out with '../'. Same-folder './…' imports are fine."
            },
            {
              // How a file or folder looks is one answer, and it is the
              // facade's. The low-level resolver takes an override key that
              // is the absolute path for a note and the relative one for a
              // folder — get it the wrong way round and the lookup silently
              // misses, which looks exactly like nobody ever chose an icon.
              // Two call sites had already rebuilt that by hand.
              group: ['@/platform/presentation/tree-icon'],
              message:
                "Ask '@/platform/presentation' instead — noteLook / folderLook, or the *From forms when resolving rows in a loop."
            }
          ]
        }
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: `Literal[value=/${ARBITRARY_TEXT_OR_RADIUS}/]`,
          message:
            'Use a fontSize/borderRadius token from tailwind.config.ts instead of an arbitrary text-[…]/rounded-[…] value.'
        },
        {
          selector: `TemplateElement[value.raw=/${ARBITRARY_TEXT_OR_RADIUS}/]`,
          message:
            'Use a fontSize/borderRadius token from tailwind.config.ts instead of an arbitrary text-[…]/rounded-[…] value.'
        },
        {
          selector: `Literal[value=/${BORDER_COLOUR_AS_FILL}/]`,
          message:
            'A border colour as a hover fill is invisible: --bd-1 equals --bg-2, which panels are made of. Fill a step above the surface — hover:bg-bg-3.'
        },
        {
          selector: `TemplateElement[value.raw=/${BORDER_COLOUR_AS_FILL}/]`,
          message:
            'A border colour as a hover fill is invisible: --bd-1 equals --bg-2, which panels are made of. Fill a step above the surface — hover:bg-bg-3.'
        },
        {
          selector: `Literal[value=/${UNNAMED_SHADOW}/]`,
          message:
            'Use shadow-s1 or shadow-s2. A docked panel casts no shadow at all; only floating things do.'
        },
        {
          selector: `TemplateElement[value.raw=/${UNNAMED_SHADOW}/]`,
          message:
            'Use shadow-s1 or shadow-s2. A docked panel casts no shadow at all; only floating things do.'
        },
        {
          selector: `Literal[value=/${LITERAL_COLOUR_UTILITY}/]`,
          message:
            'Name the colour in globals.css and use the token. A literal cannot follow the theme.'
        },
        {
          selector: `TemplateElement[value.raw=/${LITERAL_COLOUR_UTILITY}/]`,
          message:
            'Name the colour in globals.css and use the token. A literal cannot follow the theme.'
        },
        {
          selector: `Literal[value=/${PALETTE_SHADE}/]`,
          message:
            'Use accent-1 for blue and the bg-/bd-/c- ladders for grey. The status hues (red, amber, emerald) are still fine.'
        },
        {
          selector: `TemplateElement[value.raw=/${PALETTE_SHADE}/]`,
          message:
            'Use accent-1 for blue and the bg-/bd-/c- ladders for grey. The status hues (red, amber, emerald) are still fine.'
        }
      ]
    },
    settings: {
      react: { version: 'detect' }
    }
  },
  {
    // The facade is the one thing allowed to reach the resolver it wraps —
    // it is what everyone else is being pointed at. Its own test too.
    files: ['src/renderer/src/platform/presentation/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../*'],
              message:
                "Import from '@/…' instead of climbing out with '../'. Same-folder './…' imports are fine."
            }
          ]
        }
      ]
    }
  },
  {
    files: ['src/shared/**/*.{ts,tsx}'],
    languageOptions: {
      // Shared code runs in both main (Node) and renderer (browser) — no
      // globals assumed either way; anything it needs it imports explicitly.
      globals: {}
    }
  },
  {
    // Test files run under Vitest/jsdom; its globals (`describe`, `it`,
    // `expect`, ...) aren't auto-injected by `eslint-plugin-react`/tseslint.
    files: ['**/*.test.ts', '**/*.test.tsx'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser }
    }
  },
  {
    rules: {
      // A parameter or destructured field kept only for documentation/shape
      // (e.g. an unused `_e` in a callback signature) is a deliberate,
      // common pattern in this codebase — flag only bindings that give no
      // such signal.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],
      // The whole app is TypeScript; `any` shows up deliberately at IPC/JSON
      // boundaries. Warn, don't block — tightening this is a separate,
      // opt-in pass, not something a first-ever lint run should force.
      '@typescript-eslint/no-explicit-any': 'warn'
    }
  }
)
