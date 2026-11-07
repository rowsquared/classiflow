import 'server-only'
import { Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { crc32, createDeflateRaw } from 'node:zlib'

/**
 * A ZIP archive written as a stream: each entry is opened only when the
 * previous one is finished, deflated as it arrives and never held in memory
 * as a whole. Sizes and checksums follow each entry in a data descriptor
 * (general purpose flag bit 3), so nothing has to be known in advance.
 * No ZIP64: an archive over 4 GiB fails instead of writing a broken file.
 */
export type ZipEntry = { name: string; open: () => Promise<ReadableStream<Uint8Array>> }

const LIMIT = 0xffffffff
const FLAGS = 0x0008 | 0x0800 // data descriptor, UTF-8 names
const DEFLATE = 8

function dosTime(date: Date): { time: number; date: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  }
}

async function* archive(entries: ZipEntry[], now: Date): AsyncGenerator<Buffer> {
  const stamp = dosTime(now)
  const central: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(FLAGS, 6)
    local.writeUInt16LE(DEFLATE, 8)
    local.writeUInt16LE(stamp.time, 10)
    local.writeUInt16LE(stamp.date, 12)
    // crc and sizes (14..25) are zero: they follow in the data descriptor
    local.writeUInt16LE(name.length, 26)
    yield Buffer.concat([local, name])

    let crc = 0
    let size = 0
    let compressed = 0
    // The DOM and Node typings of the same web stream differ.
    const source = Readable.fromWeb((await entry.open()) as NodeReadableStream<Uint8Array>)
    const deflate = createDeflateRaw()
    source.on('error', error => deflate.destroy(error))
    source.on('data', (chunk: Buffer) => {
      crc = crc32(chunk, crc)
      size += chunk.length
    })
    source.pipe(deflate)
    for await (const out of deflate as AsyncIterable<Buffer>) {
      compressed += out.length
      yield out
    }
    if (size > LIMIT || compressed > LIMIT) throw new Error('The archive is too large')

    const descriptor = Buffer.alloc(16)
    descriptor.writeUInt32LE(0x08074b50, 0)
    descriptor.writeUInt32LE(crc >>> 0, 4)
    descriptor.writeUInt32LE(compressed, 8)
    descriptor.writeUInt32LE(size, 12)
    yield descriptor

    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50, 0)
    header.writeUInt16LE(20, 4) // version made by
    header.writeUInt16LE(20, 6) // version needed
    header.writeUInt16LE(FLAGS, 8)
    header.writeUInt16LE(DEFLATE, 10)
    header.writeUInt16LE(stamp.time, 12)
    header.writeUInt16LE(stamp.date, 14)
    header.writeUInt32LE(crc >>> 0, 16)
    header.writeUInt32LE(compressed, 20)
    header.writeUInt32LE(size, 24)
    header.writeUInt16LE(name.length, 28)
    header.writeUInt32LE(offset, 42)
    central.push(header, name)

    offset += local.length + name.length + compressed + descriptor.length
    if (offset > LIMIT) throw new Error('The archive is too large')
  }

  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  yield Buffer.concat([directory, end])
}

/** The entries as one streamed ZIP file. */
export function zipStream(entries: ZipEntry[], now = new Date()): ReadableStream<Uint8Array> {
  return Readable.toWeb(Readable.from(archive(entries, now))) as ReadableStream<Uint8Array>
}
