/** One file inside a skill folder, as the editor needs it. */
export interface SkillFile {
  path: string
  content: string
  mtime: number
  /**
   * Not decodable as text. The renderer offers Finder rather than an editor —
   * a skill folder can hold a script or an image, and opening one in a text
   * editor produces a screen of replacement characters that saves back as a
   * destroyed file.
   */
  binary: boolean
}
