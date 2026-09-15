const HALLUCINATION_PATTERNS: RegExp[] = [
  /^продолжение следует[\s.…!?]*$/,
  /^спасибо за просмотр[\s.…!?]*$/,
  /^спасибо за внимание[\s.…!?]*$/,
  /^подписывайтесь[\s\S]{0,40}$/,
  /^до новых встреч[\s.…!?]*$/,
  /^всем пока[\s.…!?]*$/,
  /^да[\s.…!?]*$/,
  /^ага[\s.…!?]*$/,
  /^угу[\s.…!?]*$/,
  /^ну[\s.…!?]*$/,

  /^thank you[\s.…!?]*$/,
  /^thanks[\s.…!?]*$/,
  /^thanks? for watching[\s.…!?]*$/,
  /^thanks for listening[\s.…!?]*$/,
  /^please subscribe[\s\S]{0,40}$/,
  /^subscribe[\s\S]{0,40}$/,
  /^bye[\s.…!?]*$/,
  /^okay[\s.…!?]*$/,

  /^ご視聴ありがとうございました[\s.…!?]*$/, // Japanese: thanks for watching
  /^ご清聴ありがとうございました[\s.…!?]*$/,
  /^e aí[\s.…!?]*$/, // Portuguese: hey
  /^obrigado[\s.…!?]*$/, // Portuguese: thank you
  /^merci[\s.…!?]*$/, // French
  /^danke[\s.…!?]*$/, // German
  /^gracias[\s.…!?]*$/, // Spanish
  /^grazie[\s.…!?]*$/, // Italian

  /^[\s.…!?]+$/
]

export function isHallucinatedSegment(text: string): boolean {
  const t = text.trim().toLowerCase()
  if (t.length === 0) return true
  for (const re of HALLUCINATION_PATTERNS) {
    if (re.test(t)) return true
  }
  return false
}
