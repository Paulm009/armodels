import { cpSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const output = new URL('../client/dist/image-targets/', import.meta.url)
mkdirSync(output, { recursive: true })
cpSync(fileURLToPath(new URL('../image-targets/', import.meta.url)), fileURLToPath(output), { recursive: true })
console.log('Image targets copiados al build de Cloudflare.')
