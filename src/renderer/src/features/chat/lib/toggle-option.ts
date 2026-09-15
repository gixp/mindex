import type { AcpConfigOption } from '@shared/acp'

/**
 * An assistant setting that is really on or off, however it says so.
 *
 * The protocol has a boolean type, and assistants mostly do not use it: Claude
 * reports its fast mode as an ordinary choice between two values named "on"
 * and "off". Keying off the declared type alone therefore caught nothing, and
 * the setting kept rendering as two rows to choose between — which is how a
 * *choice among values* is offered, and reads as one. You have to find the tick
 * to know which way an on/off currently is.
 *
 * So the shape is recognised as well as the type: exactly two values whose
 * names are a known pair. Anything else stays a list, including a two-value
 * choice that is a genuine either/or rather than a switch.
 */

const PAIRS = [
  ['on', 'off'],
  ['true', 'false'],
  ['enabled', 'disabled'],
  ['yes', 'no']
]

export interface ToggleOption {
  id: string
  label: string
  on: boolean
  /** The value to send to turn it the other way. */
  next: string | boolean
}

export function asToggle(option: AcpConfigOption): ToggleOption | null {
  if (option.type === 'boolean') {
    const on = option.currentValue === true || option.currentValue === 'true'
    return { id: option.id, label: option.label, on, next: !on }
  }

  if (option.values.length !== 2) return null
  const names = option.values.map((v) => String(v.value).toLowerCase())
  const pair = PAIRS.find((p) => names.includes(p[0]!) && names.includes(p[1]!))
  if (!pair) return null

  const onValue = option.values.find((v) => String(v.value).toLowerCase() === pair[0])
  const offValue = option.values.find((v) => String(v.value).toLowerCase() === pair[1])
  if (!onValue || !offValue) return null

  const on = String(option.currentValue).toLowerCase() === pair[0]
  return { id: option.id, label: option.label, on, next: on ? offValue.value : onValue.value }
}
