import { crc32, inflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { zipStream } from './zip'

const streamOf = (...chunks: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
      controller.close()
    }
  })

/** Reads the archive back through its central directory, as an unzip tool does. */
function unzip(zip: Buffer): Record<string, string> {
  const end = zip.length - 22
  expect(zip.readUInt32LE(end)).toBe(0x06054b50)
  const count = zip.readUInt16LE(end + 10)
  let at = zip.readUInt32LE(end + 16)
  const files: Record<string, string> = {}
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(at)).toBe(0x02014b50)
    const crc = zip.readUInt32LE(at + 16)
    const compressed = zip.readUInt32LE(at + 20)
    const size = zip.readUInt32LE(at + 24)
    const nameLength = zip.readUInt16LE(at + 28)
    const offset = zip.readUInt32LE(at + 42)
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8')
    expect(zip.readUInt32LE(offset)).toBe(0x04034b50)
    const dataStart = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28)
    const data = inflateRawSync(zip.subarray(dataStart, dataStart + compressed))
    expect(data.length).toBe(size)
    expect(crc32(data) >>> 0).toBe(crc)
    // The data descriptor repeats crc and sizes.
    const descriptor = dataStart + compressed
    expect(zip.readUInt32LE(descriptor)).toBe(0x08074b50)
    expect(zip.readUInt32LE(descriptor + 4)).toBe(crc)
    files[name] = data.toString('utf8')
    at += 46 + nameLength
  }
  return files
}

describe('zipStream', () => {
  it('writes entries one after another into a valid archive', async () => {
    const big = 'id,code\n' + Array.from({ length: 20_000 }, (_, i) => `r${i},0${i % 10}\n`).join('')
    const opened: string[] = []
    const zip = zipStream([
      { name: 'a.csv', open: async () => (opened.push('a'), streamOf('id,code\n', 'x,007\n')) },
      { name: 'grüße.csv', open: async () => (opened.push('b'), streamOf(big)) },
      { name: 'empty.csv', open: async () => (opened.push('c'), streamOf()) }
    ])
    const files = unzip(Buffer.from(await new Response(zip).arrayBuffer()))
    expect(files).toEqual({ 'a.csv': 'id,code\nx,007\n', 'grüße.csv': big, 'empty.csv': '' })
    expect(opened).toEqual(['a', 'b', 'c'])
  })

  it('fails the archive when an entry fails', async () => {
    const zip = zipStream([
      {
        name: 'broken.csv',
        open: async () =>
          new ReadableStream<Uint8Array>({
            pull(controller) {
              controller.error(new Error('database gone'))
            }
          })
      }
    ])
    await expect(new Response(zip).arrayBuffer()).rejects.toThrow()
  })
})
