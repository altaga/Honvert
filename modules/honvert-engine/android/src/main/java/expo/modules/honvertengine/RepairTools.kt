package expo.modules.honvertengine

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.pdmodel.PDDocument
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.OutputStream
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.zip.CRC32
import java.util.zip.DataFormatException
import java.util.zip.Inflater
import kotlin.math.abs

/**
 * Best-effort repair of damaged files, all on the device. Each function reads the damaged input and writes
 * whatever it can still recover. When nothing usable is left it throws IllegalStateException with the reason.
 */
object RepairTools {

  // ------------------------------------------------------------------------------- detection

  data class Sniff(val type: String, val offset: Int)

  private const val SNIFF_WINDOW = 1 shl 20
  private const val WINDOW = 1 shl 20

  // A known signature at offset 0 wins. Otherwise a strong signature a little further in is taken as the
  // real start, because junk bytes were put in front of the file.
  fun sniff(path: String): Sniff {
    val head = readHead(path, SNIFF_WINDOW)
    identify(head, 0)?.let { return Sniff(it, 0) }
    for (offset in 1 until head.size) {
      identify(head, offset)?.let { return Sniff(it, offset) }
    }
    return Sniff("unknown", -1)
  }

  private fun identify(buf: ByteArray, at: Int): String? {
    fun byte(i: Int): Int = if (i < buf.size) buf[i].toInt() and 0xFF else -1
    fun ascii(i: Int, text: String): Boolean =
      i >= 0 && i + text.length <= buf.size && text.indices.all { buf[i + it] == text[it].code.toByte() }

    if (byte(at) == 0xFF && byte(at + 1) == 0xD8 && byte(at + 2) == 0xFF) return "jpeg"
    if (byte(at) == 0x89 && ascii(at + 1, "PNG\r\n\u001a\n")) return "png"
    if (ascii(at, "GIF87a") || ascii(at, "GIF89a")) return "gif"
    if (ascii(at, "%PDF-")) return "pdf"
    if (byte(at) == 0x50 && byte(at + 1) == 0x4B && byte(at + 2) == 0x03 && byte(at + 3) == 0x04) return "zip"
    if (byte(at) == 0x1A && byte(at + 1) == 0x45 && byte(at + 2) == 0xDF && byte(at + 3) == 0xA3) {
      val text = String(buf, at, minOf(64, buf.size - at), Charsets.ISO_8859_1)
      return if (text.contains("webm")) "webm" else "mkv"
    }
    if (ascii(at, "RIFF")) {
      return when {
        ascii(at + 8, "AVI ") -> "avi"
        ascii(at + 8, "WAVE") -> "wav"
        ascii(at + 8, "WEBP") -> "webp"
        else -> null
      }
    }
    if (ascii(at + 4, "ftyp")) {
      return when {
        ascii(at + 8, "M4A ") -> "m4a"
        ascii(at + 8, "qt  ") -> "mov"
        else -> "mp4"
      }
    }
    if (ascii(at + 4, "moov") || ascii(at + 4, "mdat")) return "mp4"
    if (ascii(at, "OggS")) return "ogg"
    if (ascii(at, "fLaC")) return "flac"
    if (ascii(at, "ID3")) return "mp3"
    if (at == 0 && byte(0) == 0xFF && (byte(1) and 0xE0) == 0xE0) return "mp3"
    return null
  }

  private fun readHead(path: String, max: Int): ByteArray =
    RandomAccessFile(path, "r").use { raf ->
      val count = minOf(raf.length(), max.toLong()).toInt()
      ByteArray(count).also { raf.readFully(it) }
    }

  // ------------------------------------------------------------------------------- byte fixes

  // Copies the file starting at `offset`, dropping the junk in front of the real header.
  fun stripPrefix(input: String, output: String, offset: Int) {
    RandomAccessFile(input, "r").use { raf ->
      raf.seek(offset.toLong())
      FileOutputStream(output).use { out -> copyRest(raf, out) }
    }
  }

  // JPEG without its end marker (FF D9): close it so decoders keep the rows they already have.
  fun appendJpegEoi(input: String, output: String) =
    copyEnsuringEnd(input, output, byteArrayOf(0xFF.toByte(), 0xD9.toByte()))

  // GIF without its trailer (3B): add it so frame readers stop cleanly at the cut.
  fun appendGifTrailer(input: String, output: String) = copyEnsuringEnd(input, output, byteArrayOf(0x3B))

  private fun copyEnsuringEnd(input: String, output: String, marker: ByteArray) {
    val tail = lastBytes(input, marker.size)
    val complete = tail.size == marker.size && tail.contentEquals(marker)
    RandomAccessFile(input, "r").use { raf ->
      FileOutputStream(output).use { out ->
        copyRest(raf, out)
        if (!complete) out.write(marker)
      }
    }
  }

  private fun lastBytes(path: String, count: Int): ByteArray =
    RandomAccessFile(path, "r").use { raf ->
      val n = minOf(raf.length(), count.toLong()).toInt()
      raf.seek(raf.length() - n)
      ByteArray(n).also { raf.readFully(it) }
    }

  // ------------------------------------------------------------------------------- PNG

  data class PngResult(val width: Int, val height: Int, val rows: Int)

  private val PNG_SIGNATURE = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)

  // Rebuilds a PNG from the image data that is still readable. CRCs are not checked, because a chunk with a
  // bad CRC often still holds usable pixels. Rows that cannot be inflated stay transparent.
  fun repairPng(input: String, output: String): PngResult {
    val bytes = File(input).readBytes()
    if (bytes.size < 33 || !(0 until 8).all { bytes[it] == PNG_SIGNATURE[it] }) throw IllegalStateException("not a PNG")

    var width = 0
    var height = 0
    var depth = 0
    var colorType = -1
    var interlaced = false
    var palette: ByteArray? = null
    var transparency: ByteArray? = null
    val compressed = ByteArrayOutputStream()

    var pos = 8
    while (pos + 8 <= bytes.size) {
      val length = be32(bytes, pos).toLong() and 0xFFFFFFFFL
      val type = String(bytes, pos + 4, 4, Charsets.ISO_8859_1)
      val dataStart = pos + 8
      val available = (bytes.size - dataStart).toLong()
      if (length > available) {
        // Truncated chunk: keep the image data that is there, then stop.
        if (type == "IDAT") compressed.write(bytes, dataStart, available.toInt())
        break
      }
      val len = length.toInt()
      when (type) {
        "IHDR" -> if (len >= 13) {
          width = be32(bytes, dataStart)
          height = be32(bytes, dataStart + 4)
          depth = bytes[dataStart + 8].toInt() and 0xFF
          colorType = bytes[dataStart + 9].toInt() and 0xFF
          interlaced = bytes[dataStart + 12].toInt() != 0
        }
        "PLTE" -> palette = bytes.copyOfRange(dataStart, dataStart + len)
        "tRNS" -> transparency = bytes.copyOfRange(dataStart, dataStart + len)
        "IDAT" -> compressed.write(bytes, dataStart, len)
      }
      pos = dataStart + len + 4
      if (type == "IEND") break
    }

    if (width <= 0 || height <= 0) throw IllegalStateException("PNG header missing")
    if (depth != 8) throw IllegalStateException("PNG bit depth $depth is not supported")
    if (interlaced) throw IllegalStateException("interlaced PNG is not supported")
    val channels = when (colorType) {
      0 -> 1
      2 -> 3
      3 -> 1
      4 -> 2
      6 -> 4
      else -> throw IllegalStateException("PNG color type $colorType is not supported")
    }
    if (colorType == 3 && palette == null) throw IllegalStateException("PNG palette missing")
    if (width.toLong() * height > 40_000_000L) throw IllegalStateException("image too large to rebuild")

    val stride = width * channels
    val rowBytes = stride + 1
    val raw = inflatePartial(compressed.toByteArray(), rowBytes * height)
    val rows = raw.size / rowBytes
    if (rows == 0) throw IllegalStateException("no image rows could be recovered")

    val pixels = IntArray(width * height)
    var previous = ByteArray(stride)
    var current = ByteArray(stride)
    for (row in 0 until rows) {
      val filter = raw[row * rowBytes].toInt() and 0xFF
      val base = row * rowBytes + 1
      for (x in 0 until stride) {
        val value = raw[base + x].toInt() and 0xFF
        val left = if (x >= channels) current[x - channels].toInt() and 0xFF else 0
        val up = previous[x].toInt() and 0xFF
        val upLeft = if (x >= channels) previous[x - channels].toInt() and 0xFF else 0
        val predictor = when (filter) {
          1 -> left
          2 -> up
          3 -> (left + up) / 2
          4 -> paeth(left, up, upLeft)
          else -> 0
        }
        current[x] = ((value + predictor) and 0xFF).toByte()
      }
      for (x in 0 until width) pixels[row * width + x] = pixelAt(current, x, colorType, palette, transparency)
      val swap = previous
      previous = current
      current = swap
    }

    val bitmap = Bitmap.createBitmap(pixels, width, height, Bitmap.Config.ARGB_8888)
    try {
      FileOutputStream(output).use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
    } finally {
      bitmap.recycle()
    }
    return PngResult(width, height, rows)
  }

  private fun inflatePartial(input: ByteArray, expected: Int): ByteArray {
    val out = ByteArray(expected)
    var produced = 0
    val inflater = Inflater()
    try {
      inflater.setInput(input)
      while (produced < expected && !inflater.finished()) {
        val n = inflater.inflate(out, produced, expected - produced)
        if (n == 0 && (inflater.needsInput() || inflater.needsDictionary())) break
        produced += n
      }
    } catch (error: DataFormatException) {
      // Keep the bytes inflated before the damage.
    } finally {
      inflater.end()
    }
    return out.copyOf(produced)
  }

  private fun pixelAt(row: ByteArray, x: Int, colorType: Int, palette: ByteArray?, trns: ByteArray?): Int {
    fun u(i: Int): Int = row[i].toInt() and 0xFF
    return when (colorType) {
      0 -> u(x).let { Color.argb(255, it, it, it) }
      2 -> Color.argb(255, u(x * 3), u(x * 3 + 1), u(x * 3 + 2))
      3 -> {
        val index = u(x)
        val p = palette ?: return 0
        val known = index * 3 + 2 < p.size
        val r = if (known) p[index * 3].toInt() and 0xFF else 0
        val g = if (known) p[index * 3 + 1].toInt() and 0xFF else 0
        val b = if (known) p[index * 3 + 2].toInt() and 0xFF else 0
        val a = if (trns != null && index < trns.size) trns[index].toInt() and 0xFF else 255
        Color.argb(a, r, g, b)
      }
      4 -> u(x * 2).let { Color.argb(u(x * 2 + 1), it, it, it) }
      else -> Color.argb(u(x * 4 + 3), u(x * 4), u(x * 4 + 1), u(x * 4 + 2))
    }
  }

  private fun paeth(a: Int, b: Int, c: Int): Int {
    val p = a + b - c
    val pa = abs(p - a)
    val pb = abs(p - b)
    val pc = abs(p - c)
    return if (pa <= pb && pa <= pc) a else if (pb <= pc) b else c
  }

  // ------------------------------------------------------------------------------- ZIP

  private const val ZIP_LOCAL = 0x04034b50L
  private const val ZIP_CENTRAL = 0x02014b50L
  private const val ZIP_END = 0x06054b50L
  private const val ZIP_DESCRIPTOR = 0x08074b50L

  private class ZipItem(
    val name: ByteArray,
    val flags: Int,
    val method: Int,
    val time: Int,
    val date: Int,
    val crc: Long,
    val compressed: Long,
    val uncompressed: Long,
    val dataStart: Long,
  )

  private class Measured(val compressed: Long, val uncompressed: Long, val crc: Long, val descriptorBytes: Int)

  // Rebuilds the central directory from the local headers, so a ZIP (DOCX, XLSX, ...) whose index is missing
  // or cut off can be opened again. Entries that are cut short are dropped.
  fun repairZip(input: String, output: String): Int {
    val items = mutableListOf<ZipItem>()
    RandomAccessFile(input, "r").use { raf ->
      val size = raf.length()
      var pos = findSignature(raf, 0L, ZIP_LOCAL) ?: throw IllegalStateException("no ZIP entries found")
      while (pos + 30 <= size) {
        val header = readAt(raf, pos, 30)
        if ((le32(header, 0).toLong() and 0xFFFFFFFFL) != ZIP_LOCAL) {
          pos = findSignature(raf, pos + 1, ZIP_LOCAL) ?: break
          continue
        }
        val flags = le16(header, 6)
        val method = le16(header, 8)
        val time = le16(header, 10)
        val date = le16(header, 12)
        val nameLength = le16(header, 26)
        val extraLength = le16(header, 28)
        val dataStart = pos + 30 + nameLength + extraLength
        if (dataStart > size) break
        val name = readAt(raf, pos + 30, nameLength)
        val item: ZipItem
        val next: Long
        if ((flags and 0x08) == 0) {
          val compressed = le32(header, 18).toLong() and 0xFFFFFFFFL
          if (compressed == 0xFFFFFFFFL || dataStart + compressed > size) break
          val crc = le32(header, 14).toLong() and 0xFFFFFFFFL
          val uncompressed = le32(header, 22).toLong() and 0xFFFFFFFFL
          item = ZipItem(name, flags, method, time, date, crc, compressed, uncompressed, dataStart)
          next = dataStart + compressed
        } else {
          val m = measureDescribed(raf, method, dataStart) ?: break
          item = ZipItem(name, flags, method, time, date, m.crc, m.compressed, m.uncompressed, dataStart)
          next = dataStart + m.compressed + m.descriptorBytes
        }
        items += item
        pos = next
      }
    }
    if (items.isEmpty()) throw IllegalStateException("no readable ZIP entries")
    writeZip(input, output, items)
    return items.size
  }

  // Sizes and CRC of an entry whose local header defers them to a data descriptor. Only deflate can be measured
  // this way: the stream end tells where the data stops.
  private fun measureDescribed(raf: RandomAccessFile, method: Int, dataStart: Long): Measured? {
    if (method != 8) return null
    val inflater = Inflater(true)
    val crc = CRC32()
    var uncompressed = 0L
    val chunk = ByteArray(1 shl 16)
    val out = ByteArray(1 shl 16)
    try {
      raf.seek(dataStart)
      while (!inflater.finished()) {
        if (inflater.needsInput()) {
          val n = raf.read(chunk)
          if (n <= 0) return null
          inflater.setInput(chunk, 0, n)
        }
        val produced = inflater.inflate(out)
        if (produced > 0) {
          crc.update(out, 0, produced)
          uncompressed += produced
        } else if (inflater.needsDictionary()) {
          return null
        }
      }
      val compressed = inflater.bytesRead
      raf.seek(dataStart + compressed)
      var descriptorBytes = 12
      if (raf.length() - raf.filePointer >= 4) {
        val sig = ByteArray(4)
        raf.readFully(sig)
        if ((le32(sig, 0).toLong() and 0xFFFFFFFFL) == ZIP_DESCRIPTOR) descriptorBytes = 16
      }
      return Measured(compressed, uncompressed, crc.value, descriptorBytes)
    } catch (error: DataFormatException) {
      return null
    } finally {
      inflater.end()
    }
  }

  private fun writeZip(input: String, output: String, items: List<ZipItem>) {
    RandomAccessFile(input, "r").use { raf ->
      FileOutputStream(output).use { out ->
        val offsets = LongArray(items.size)
        var written = 0L
        items.forEachIndexed { index, item ->
          offsets[index] = written
          val local = ByteBuffer.allocate(30).order(ByteOrder.LITTLE_ENDIAN)
            .putInt(ZIP_LOCAL.toInt()).putShort(20).putShort((item.flags and 0x08.inv()).toShort())
            .putShort(item.method.toShort()).putShort(item.time.toShort()).putShort(item.date.toShort())
            .putInt(item.crc.toInt()).putInt(item.compressed.toInt()).putInt(item.uncompressed.toInt())
            .putShort(item.name.size.toShort()).putShort(0)
          out.write(local.array())
          out.write(item.name)
          copyRange(raf, item.dataStart, item.compressed, out)
          written += 30 + item.name.size + item.compressed
        }
        val directoryStart = written
        var directorySize = 0L
        items.forEachIndexed { index, item ->
          val central = ByteBuffer.allocate(46).order(ByteOrder.LITTLE_ENDIAN)
            .putInt(ZIP_CENTRAL.toInt()).putShort(20).putShort(20).putShort((item.flags and 0x08.inv()).toShort())
            .putShort(item.method.toShort()).putShort(item.time.toShort()).putShort(item.date.toShort())
            .putInt(item.crc.toInt()).putInt(item.compressed.toInt()).putInt(item.uncompressed.toInt())
            .putShort(item.name.size.toShort()).putShort(0).putShort(0).putShort(0).putShort(0)
            .putInt(0).putInt(offsets[index].toInt())
          out.write(central.array())
          out.write(item.name)
          directorySize += 46 + item.name.size
        }
        val end = ByteBuffer.allocate(22).order(ByteOrder.LITTLE_ENDIAN)
          .putInt(ZIP_END.toInt()).putShort(0).putShort(0)
          .putShort(items.size.toShort()).putShort(items.size.toShort())
          .putInt(directorySize.toInt()).putInt(directoryStart.toInt()).putShort(0)
        out.write(end.array())
      }
    }
  }

  // ------------------------------------------------------------------------------- PDF

  // PDFBox reads damaged files leniently: it rebuilds a missing or broken cross-reference table and skips
  // unreadable objects. Saving writes a new, consistent file. Returns the number of pages recovered.
  fun repairPdf(context: Context, input: String, output: String): Int {
    PDFBoxResourceLoader.init(context)
    PDDocument.load(File(input)).use { document ->
      val pages = document.numberOfPages
      if (pages <= 0) throw IllegalStateException("no pages could be recovered")
      FileOutputStream(output).use { document.save(it) }
      return pages
    }
  }

  // ------------------------------------------------------------------------------- H.264 without an index

  private val ACCEPTED_NAL = setOf(1, 5, 6, 7, 8, 9)

  // Writes the H.264 NAL units found in the MP4 media data as an Annex B stream. The index (moov) is gone in
  // this case, so units are found through their length prefixes and checked against the next one. Video only.
  fun extractH264(input: String, output: String, referencePath: String?): Int {
    var nals = 0
    val parameterSets = referencePath?.let { parameterSetsFrom(it) }
    RandomAccessFile(input, "r").use { raf ->
      val size = raf.length()
      FileOutputStream(output).use { out ->
        // The index (moov) normally carries the SPS and PPS, which the stream does not repeat. A healthy
        // reference video from the same camera supplies them, so the decoder knows the picture size and profile.
        if (parameterSets != null) out.write(parameterSets)
        for ((start, end) in mediaDataRanges(raf, size)) {
          nals += writeAvcNals(raf, start, end, out)
        }
      }
    }
    if (nals == 0) throw IllegalStateException("no H.264 data found")
    return nals
  }

  // SPS and PPS from the avcC box of a healthy MP4 or MOV, as Annex B NAL units. Null when there is none.
  fun parameterSetsFrom(referencePath: String): ByteArray? {
    return try {
      RandomAccessFile(referencePath, "r").use { raf ->
        val (start, end) = findAvcC(raf, 0L, raf.length(), 0) ?: return null
        val record = ByteArray((end - start).toInt())
        raf.seek(start)
        raf.readFully(record)
        val out = ByteArrayOutputStream()
        val startCode = byteArrayOf(0, 0, 0, 1)
        var p = 5
        val spsCount = record[p++].toInt() and 0x1F
        for (i in 0 until spsCount) {
          val len = ((record[p].toInt() and 0xFF) shl 8) or (record[p + 1].toInt() and 0xFF)
          p += 2
          out.write(startCode)
          out.write(record, p, len)
          p += len
        }
        val ppsCount = record[p++].toInt() and 0xFF
        for (i in 0 until ppsCount) {
          val len = ((record[p].toInt() and 0xFF) shl 8) or (record[p + 1].toInt() and 0xFF)
          p += 2
          out.write(startCode)
          out.write(record, p, len)
          p += len
        }
        out.toByteArray()
      }
    } catch (error: IndexOutOfBoundsException) {
      null
    }
  }

  private val AVC_CONTAINERS = setOf("moov", "trak", "mdia", "minf", "stbl", "stsd", "avc1", "avc3")

  // Depth-first search for the avcC box. Only the container boxes on the way to a video sample entry are
  // entered. Returns the payload as [start, end).
  private fun findAvcC(raf: RandomAccessFile, start: Long, end: Long, depth: Int): Pair<Long, Long>? {
    if (depth > 8) return null
    var pos = start
    while (pos + 8 <= end) {
      raf.seek(pos)
      val head = ByteArray(16)
      raf.read(head)
      var size = be32(head, 0).toLong() and 0xFFFFFFFFL
      val type = String(head, 4, 4, Charsets.ISO_8859_1)
      var header = 8L
      if (size == 1L) {
        size = (be32(head, 8).toLong() shl 32) or (be32(head, 12).toLong() and 0xFFFFFFFFL)
        header = 16L
      } else if (size == 0L) {
        size = end - pos
      }
      if (size < header || pos + size > end) break
      val payload = pos + header
      if (type == "avcC") return Pair(payload, pos + size)
      if (type in AVC_CONTAINERS) {
        // stsd is a full box (version, flags and entry count come first). avc1 and avc3 start with 78 bytes of fields.
        val childStart = when (type) {
          "stsd" -> payload + 8
          "avc1", "avc3" -> payload + 78
          else -> payload
        }
        findAvcC(raf, childStart, pos + size, depth + 1)?.let { return it }
      }
      pos += size
    }
    return null
  }

  // Top-level 'mdat' payloads as [start, end) offsets.
  private fun mediaDataRanges(raf: RandomAccessFile, size: Long): List<Pair<Long, Long>> {
    val ranges = mutableListOf<Pair<Long, Long>>()
    var pos = 0L
    while (pos + 8 <= size) {
      raf.seek(pos)
      val head = ByteArray(16)
      raf.read(head)
      var box = be32(head, 0).toLong() and 0xFFFFFFFFL
      val type = String(head, 4, 4, Charsets.ISO_8859_1)
      var header = 8L
      if (box == 1L) {
        box = (be32(head, 8).toLong() shl 32) or (be32(head, 12).toLong() and 0xFFFFFFFFL)
        header = 16L
      } else if (box == 0L) {
        box = size - pos
      }
      if (box < header) break
      if (type == "mdat") ranges += Pair(pos + header, minOf(pos + box, size))
      pos += box
    }
    return ranges
  }

  private fun writeAvcNals(raf: RandomAccessFile, start: Long, end: Long, out: OutputStream): Int {
    val window = ByteWindow(raf, end)
    val startCode = byteArrayOf(0, 0, 0, 1)
    var count = 0
    var pos = start
    while (pos + 5 <= end) {
      val length = window.u32(pos)
      val nalStart = pos + 4
      val header = window.byteAt(nalStart)
      val plausible = length >= 2 && length <= end - nalStart && header >= 0 &&
        (header and 0x80) == 0 && (header and 0x1F) in ACCEPTED_NAL
      // Slices are long and rarely mistaken for other data, so they are taken without the look-ahead. Short
      // units (SEI, parameter sets) must be followed by another plausible unit. The last slice of each sample
      // is followed by audio, which is why a look-ahead on slices drops most of the picture.
      val slice = header >= 0 && ((header and 0x1F) == 1 || (header and 0x1F) == 5)
      if (plausible && (slice || nextLooksValid(window, nalStart + length, end))) {
        out.write(startCode)
        copyRange(raf, nalStart, length, out)
        count++
        pos = nalStart + length
      } else {
        pos++
      }
    }
    return count
  }

  private fun nextLooksValid(window: ByteWindow, at: Long, end: Long): Boolean {
    if (at + 5 > end) return true
    val length = window.u32(at)
    val header = window.byteAt(at + 4)
    return length >= 1 && length <= end - at - 4 && header >= 0 && (header and 0x80) == 0
  }

  // Reads through a 1 MB window, so scanning the media data does not seek for every byte.
  private class ByteWindow(private val raf: RandomAccessFile, private val limit: Long) {
    private var base = -1L
    private var data = ByteArray(0)

    fun byteAt(pos: Long): Int {
      if (pos < base || pos >= base + data.size) load(pos)
      val offset = pos - base
      return if (offset >= 0 && offset < data.size) data[offset.toInt()].toInt() and 0xFF else -1
    }

    fun u32(pos: Long): Long {
      val b0 = byteAt(pos)
      val b1 = byteAt(pos + 1)
      val b2 = byteAt(pos + 2)
      val b3 = byteAt(pos + 3)
      if (b0 < 0 || b1 < 0 || b2 < 0 || b3 < 0) return -1L
      return (b0.toLong() shl 24) or (b1.toLong() shl 16) or (b2.toLong() shl 8) or b3.toLong()
    }

    private fun load(pos: Long) {
      base = pos
      val count = minOf(WINDOW.toLong(), limit - pos).coerceAtLeast(0L).toInt()
      raf.seek(pos)
      val buffer = ByteArray(count)
      val read = if (count > 0) raf.read(buffer) else 0
      data = if (read > 0) buffer.copyOf(read) else ByteArray(0)
    }
  }

  // ------------------------------------------------------------------------------- shared helpers

  private fun be32(b: ByteArray, i: Int): Int =
    ((b[i].toInt() and 0xFF) shl 24) or ((b[i + 1].toInt() and 0xFF) shl 16) or
      ((b[i + 2].toInt() and 0xFF) shl 8) or (b[i + 3].toInt() and 0xFF)

  private fun le16(b: ByteArray, i: Int): Int = (b[i].toInt() and 0xFF) or ((b[i + 1].toInt() and 0xFF) shl 8)

  private fun le32(b: ByteArray, i: Int): Int = le16(b, i) or (le16(b, i + 2) shl 16)

  private fun readAt(raf: RandomAccessFile, pos: Long, length: Int): ByteArray {
    raf.seek(pos)
    return ByteArray(length).also { raf.readFully(it) }
  }

  private fun copyRange(raf: RandomAccessFile, start: Long, length: Long, out: OutputStream) {
    raf.seek(start)
    val buffer = ByteArray(1 shl 16)
    var left = length
    while (left > 0) {
      val n = raf.read(buffer, 0, minOf(buffer.size.toLong(), left).toInt())
      if (n <= 0) break
      out.write(buffer, 0, n)
      left -= n
    }
  }

  private fun copyRest(raf: RandomAccessFile, out: OutputStream) {
    val buffer = ByteArray(1 shl 16)
    while (true) {
      val n = raf.read(buffer)
      if (n <= 0) break
      out.write(buffer, 0, n)
    }
  }

  private fun findSignature(raf: RandomAccessFile, from: Long, signature: Long): Long? {
    val pattern = ByteArray(4) { ((signature shr (8 * it)) and 0xFFL).toByte() }
    val size = raf.length()
    val buffer = ByteArray(1 shl 16)
    var start = from
    while (start + 4 <= size) {
      raf.seek(start)
      val n = raf.read(buffer)
      if (n < 4) return null
      for (i in 0..n - 4) {
        if (buffer[i] == pattern[0] && buffer[i + 1] == pattern[1] &&
          buffer[i + 2] == pattern[2] && buffer[i + 3] == pattern[3]
        ) {
          return start + i
        }
      }
      start += n - 3
    }
    return null
  }
}
