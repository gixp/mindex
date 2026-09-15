// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@/test/setup'
import { installApiStub } from '@/test/apiStub'
import { SettingsDialog } from './SettingsDialog'

beforeEach(() => {
  installApiStub()
})

describe('SettingsDialog', () => {
  it('renders nothing when closed', () => {
    // StandardDialog wraps a Radix Dialog.Portal, so its content (when open)
    // lands in document.body, not in render()'s own container — `screen`
    // queries the whole document and is what actually proves "closed" means
    // "not there", not just "not in this particular div".
    render(<SettingsDialog open={false} onOpenChange={vi.fn()} />)
    expect(screen.queryAllByText('Vaults')).toHaveLength(0)
  })

  it('shows the settings UI when open', () => {
    render(<SettingsDialog open onOpenChange={vi.fn()} />)
    // Vaults is the landing section now — it was Profile until the
    // account went away — so its name appears both in the nav and as the
    // section's own heading.
    expect(screen.getAllByText('Vaults').length).toBeGreaterThan(0)
  })
})
