export type ConfigScope = 'project' | 'global'

export interface SlashCommandEntry {
  name: string
  description: string
  scope: ConfigScope
}
