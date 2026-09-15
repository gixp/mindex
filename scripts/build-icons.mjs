import sharp from 'sharp'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const here = resolve(new URL('..', import.meta.url).pathname)
const svgPath = resolve(here, 'resources/icon.svg')
const svg = await readFile(svgPath)

const sizes = [1024, 512, 256, 128, 64, 32]

for (const size of sizes) {
  const out = resolve(here, `resources/icon-${size}.png`)
  await sharp(svg).resize(size, size).png().toFile(out)
  console.log(`wrote resources/icon-${size}.png`)
}

// Default icon.png at 512
await writeFile(resolve(here, 'resources/icon.png'), await sharp(svg).resize(512, 512).png().toBuffer())
console.log('wrote resources/icon.png (512×512 alias)')
