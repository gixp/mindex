// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest'
import { registeredOverlays } from '@/platform/registry/overlays'
import { registerAllOverlays } from './overlays'

/**
 * The order these draw in is what covers what, and it used to be their order
 * in the root's markup — invisible, and changed by anyone who moved a line.
 * Now it is data, and this pins it: a reordering has to be done on purpose and
 * shows up here as a diff rather than as a dialog appearing behind another
 * one.
 *
 * The list below is exactly what the markup did, in the same sequence.
 */

beforeAll(() => {
  registerAllOverlays()
})

const EXPECTED = [
  'palette.command',
  'folderContext.engineStatus',
  'git.sourceControl',
  'vault.clone',
  'engine.log',
  'vault.migration',
  'history.fileHistory',
  'editor.writeConflict',
  'ui.prompt',
  // A confirmation can be raised from inside a prompt's own flow, so it sits
  // just above it.
  'ui.confirm',
  'links.health',
  'feedback.bugReport',
  'platform.errorDialog',
  'ui.toaster',
  'ai.proposalDock',
  // Above the dock because it is a modal and has to cover it; below the gates
  // because a startup or sign-in screen has to cover everything.
  'ai.capture',
  'startup.screen',
  'onboarding.dialog',
  'ui.tableModal',
  'platform.iconPicker',
  'layout.quickAsk',
  // Last, so it covers the corner button it shares a corner with. It is the
  // only one of the two that cannot be reached again by clicking where it was.
  'update.notice'
]

describe('overlays', () => {
  it('draw in the order the root markup used to', () => {
    expect(registeredOverlays().map((o) => o.id)).toEqual(EXPECTED)
  })

  it('are all registered — none lost on the way out of the root', () => {
    expect(registeredOverlays()).toHaveLength(EXPECTED.length)
  })

  it('each bring a component', () => {
    for (const o of registeredOverlays()) {
      expect(typeof o.Component, o.id).toBe('function')
    }
  })
})
