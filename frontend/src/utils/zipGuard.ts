import { Unzip, UnzipInflate } from 'fflate'

const ZIP_MAX_TOTAL_BYTES = 250 * 1024 * 1024
const ZIP_MAX_ENTRIES = 1_000
const ZIP_MAX_RATIO_GENERAL = 25
const ZIP_MAX_RATIO_OFFICE = 100
const ZIP_SMALL_RATIO_BYPASS_BYTES = 10 * 1024 * 1024

/**
 * Streams a `.zip` or OpenXML Office file in chunks using `fflate` and aborts
 * immediately if actual decompressed bytes, entry count, or compression ratio
 * exceed safe thresholds.
 */
export async function inspectZipFile(file: File, isOffice: boolean): Promise<void> {
  const compressedTotal = Math.max(file.size, 1)
  const maxRatio = isOffice ? ZIP_MAX_RATIO_OFFICE : ZIP_MAX_RATIO_GENERAL
  let totalActual = 0
  let entryCount = 0
  let abortedError: Error | null = null

  const unzipper = new Unzip((stream) => {
    if (abortedError) return
    entryCount += 1
    if (entryCount > ZIP_MAX_ENTRIES) {
      abortedError = new Error('Archive contains too many files.')
      return
    }

    const lower = stream.name.toLowerCase()
    if (
      lower.endsWith('.gz') ||
      lower.endsWith('.tar') ||
      lower.endsWith('.7z') ||
      lower.endsWith('.rar')
    ) {
      abortedError = new Error('Nested archives are not allowed.')
      return
    }

    stream.ondata = (err, chunk) => {
      if (abortedError) return
      if (err) {
        abortedError = new Error('Archive appears corrupted.')
        return
      }
      if (chunk) {
        totalActual += chunk.byteLength
        if (totalActual > ZIP_MAX_TOTAL_BYTES) {
          abortedError = new Error('Archive extracted size exceeds 250 MB limit.')
          return
        }
        if (
          totalActual >= ZIP_SMALL_RATIO_BYPASS_BYTES &&
          totalActual / compressedTotal > maxRatio
        ) {
          abortedError = new Error('Archive compression ratio exceeds safe limit.')
        }
      }
    }
    stream.start()
  })

  unzipper.register(UnzipInflate)

  const reader = file.stream().getReader()
  try {
    while (true) {
      if (abortedError) throw abortedError
      const { done, value } = await reader.read()
      if (done) {
        unzipper.push(new Uint8Array(0), true)
        break
      }
      if (value) {
        unzipper.push(value, false)
      }
      if (abortedError) throw abortedError
    }
  } finally {
    reader.releaseLock()
  }

  if (abortedError) throw abortedError
}
