import { ZipFile } from 'yazl'
import { createWriteStream } from 'fs'

export function makeTestZip(zipPath: string, files: Record<string, Buffer>): Promise<void> {
  return new Promise((resolve, reject) => {
    const zip = new ZipFile()
    for (const [name, content] of Object.entries(files)) {
      zip.addBuffer(content, name)
    }
    zip.outputStream.pipe(createWriteStream(zipPath)).on('close', () => resolve()).on('error', reject)
    zip.end()
  })
}
