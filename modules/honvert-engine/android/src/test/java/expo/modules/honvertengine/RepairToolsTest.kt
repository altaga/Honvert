package expo.modules.honvertengine

import java.io.ByteArrayOutputStream
import java.io.File
import java.util.Random
import java.util.zip.CRC32
import java.util.zip.ZipEntry
import java.util.zip.ZipFile
import java.util.zip.ZipOutputStream
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

// Runs without a device: every function under test only reads and writes files.
// Cases per fuzz property come from HONVERT_FUZZ_ITERATIONS (default 3000). See tests/README.md.
class RepairToolsTest {

  @get:Rule
  val folder = TemporaryFolder()

  private val iterations = System.getenv("HONVERT_FUZZ_ITERATIONS")?.toIntOrNull() ?: 3000

  private fun input(name: String, bytes: ByteArray): String = File(folder.root, name).apply { writeBytes(bytes) }.path

  private fun output(name: String): String = File(folder.root, name).path

  // ------------------------------------------------------------------------------ detection

  @Test
  fun sniffRecognizesEachSignatureAtTheStart() {
    // A list, not a map: several containers share a type name ("mp4", "mp3"), and a map would drop repeats.
    val cases = listOf(
      "jpeg" to concat(bytes(0xFF, 0xD8, 0xFF, 0xE0), ByteArray(8)),
      "png" to concat(bytes(0x89), ascii("PNG\r\n\u001a\n"), ByteArray(8)),
      "gif" to concat(ascii("GIF89a"), ByteArray(8)),
      "pdf" to ascii("%PDF-1.7 rest"),
      "zip" to concat(bytes(0x50, 0x4B, 0x03, 0x04), ByteArray(26)),
      "mkv" to concat(bytes(0x1A, 0x45, 0xDF, 0xA3), ascii("matroska")),
      "webm" to concat(bytes(0x1A, 0x45, 0xDF, 0xA3), ascii("webm")),
      "avi" to concat(ascii("RIFF"), u32(0), ascii("AVI ")),
      "wav" to concat(ascii("RIFF"), u32(0), ascii("WAVE")),
      "webp" to concat(ascii("RIFF"), u32(0), ascii("WEBP")),
      "mp4" to concat(u32(24), ascii("ftyp"), ascii("isom")),
      "m4a" to concat(u32(24), ascii("ftyp"), ascii("M4A ")),
      "mov" to concat(u32(24), ascii("ftyp"), ascii("qt  ")),
      "mp4" to concat(u32(8), ascii("moov")),
      "ogg" to ascii("OggS"),
      "flac" to ascii("fLaC"),
      "mp3" to ascii("ID3"),
      "mp3" to bytes(0xFF, 0xFB, 0x90, 0x00),
    )
    for ((type, bytes) in cases) {
      val sniff = RepairTools.sniff(input("case-$type-${bytes.size}.bin", bytes))
      assertEquals("type for $type", type, sniff.type)
      assertEquals("offset for $type", 0, sniff.offset)
    }
  }

  @Test
  fun sniffFindsTheRealStartAfterJunkBytes() {
    val junk = ByteArray(37) { 0x05 }
    val jpeg = concat(bytes(0xFF, 0xD8, 0xFF, 0xE0), ByteArray(8))
    assertEquals(RepairTools.Sniff("jpeg", 37), RepairTools.sniff(input("junk.bin", concat(junk, jpeg))))
  }

  @Test
  fun sniffReportsUnknownForEmptyOrUnrecognizedFiles() {
    assertEquals(RepairTools.Sniff("unknown", -1), RepairTools.sniff(input("empty.bin", ByteArray(0))))
    assertEquals(RepairTools.Sniff("unknown", -1), RepairTools.sniff(input("text.bin", ByteArray(500) { 'x'.code.toByte() })))
  }

  // ------------------------------------------------------------------------------ byte fixes

  @Test
  fun stripPrefixKeepsEverythingFromTheOffset() {
    val bytes = ascii("junkREAL-DATA")
    RepairTools.stripPrefix(input("strip.bin", bytes), output("stripped.bin"), 4)
    assertArrayEquals(ascii("REAL-DATA"), File(output("stripped.bin")).readBytes())
  }

  @Test
  fun appendJpegEoiClosesAJpegThatLacksItsEndMarker() {
    val truncated = concat(bytes(0xFF, 0xD8, 0xFF, 0xE0), ByteArray(12) { 0x11 })
    RepairTools.appendJpegEoi(input("cut.jpg", truncated), output("closed.jpg"))
    assertArrayEquals(concat(truncated, bytes(0xFF, 0xD9)), File(output("closed.jpg")).readBytes())
  }

  @Test
  fun appendJpegEoiLeavesAFinishedJpegAlone() {
    val complete = concat(bytes(0xFF, 0xD8), ByteArray(5), bytes(0xFF, 0xD9))
    RepairTools.appendJpegEoi(input("done.jpg", complete), output("same.jpg"))
    assertArrayEquals(complete, File(output("same.jpg")).readBytes())
  }

  @Test
  fun appendGifTrailerAddsTheMissingTrailerOnce() {
    val cut = concat(ascii("GIF89a"), ByteArray(9))
    RepairTools.appendGifTrailer(input("cut.gif", cut), output("closed.gif"))
    assertArrayEquals(concat(cut, bytes(0x3B)), File(output("closed.gif")).readBytes())
    RepairTools.appendGifTrailer(output("closed.gif"), output("twice.gif"))
    assertArrayEquals(File(output("closed.gif")).readBytes(), File(output("twice.gif")).readBytes())
  }

  // ------------------------------------------------------------------------------ ZIP

  @Test
  fun repairZipRebuildsAnIntactArchiveWithDataDescriptors() {
    val entries = listOf("word/document.xml" to letters(3000, 1), "docProps/app.xml" to letters(400, 2))
    val zip = zipOf(entries, deflate = true)
    val count = RepairTools.repairZip(input("intact.docx", zip), output("rebuilt.docx"))
    assertEquals(2, count)
    assertEntries(output("rebuilt.docx"), entries)
  }

  @Test
  fun repairZipKeepsEveryEntryThatIsFullyPresent() {
    val entries = listOf("a.txt" to letters(120, 3), "b.txt" to letters(80, 4), "c.txt" to letters(200, 5))
    val zip = zipOf(entries, deflate = false)
    val starts = localHeaderOffsets(zip)
    // Cut just after the second entry: the third is missing, the first two must come back intact.
    val cut = starts[2]
    val count = RepairTools.repairZip(input("cut.zip", zip.copyOf(cut)), output("kept.zip"))
    assertEquals(2, count)
    assertEntries(output("kept.zip"), entries.take(2))
  }

  @Test
  fun repairZipWithoutAnyEntryFails() {
    try {
      RepairTools.repairZip(input("none.zip", ascii("no zip here")), output("none-out.zip"))
      fail("expected IllegalStateException")
    } catch (error: IllegalStateException) {
      assertTrue(error.message.orEmpty().contains("no ZIP entries"))
    }
  }

  // ------------------------------------------------------------------------------ H.264 from MP4

  @Test
  fun parameterSetsComeOutOfTheAvcCRecordAsAnnexB() {
    val reference = input("reference.mp4", mp4(withIndex = true, media = null))
    assertArrayEquals(annexB(SPS, PPS), RepairTools.parameterSetsFrom(reference))
  }

  @Test
  fun parameterSetsAreNullWithoutAnAvcCBox() {
    assertNull(RepairTools.parameterSetsFrom(input("no-avcc.mp4", mp4(withIndex = false, media = null))))
  }

  @Test
  fun parameterSetsAreNullForATruncatedRecord() {
    val short = concat(
      box("ftyp", ascii("isom")),
      box("moov", box("trak", box("mdia", box("minf", box("stbl",
        box("stsd", ByteArray(4), u32(1), box("avc1", ByteArray(78), box("avcC", bytes(1, 0x64, 0, 0x1F, 0xFF)))))))))
    )
    assertNull(RepairTools.parameterSetsFrom(input("short-avcc.mp4", short)))
  }

  @Test
  fun extractH264RecoversEveryReadableUnitWhenTheIndexIsGone() {
    val media = lengthPrefixed(SPS, PPS, SEI, IDR, P_SLICE)
    val count = RepairTools.extractH264(input("no-index.mp4", mp4(withIndex = false, media = media)), output("raw.h264"), null)
    assertEquals(5, count)
    assertArrayEquals(annexB(SPS, PPS, SEI, IDR, P_SLICE), File(output("raw.h264")).readBytes())
  }

  @Test
  fun extractH264PutsTheReferenceParameterSetsFirst() {
    val media = lengthPrefixed(SPS, PPS, SEI, IDR, P_SLICE)
    val reference = input("reference.mp4", mp4(withIndex = true, media = null))
    val count = RepairTools.extractH264(input("no-index.mp4", mp4(withIndex = false, media = media)), output("with-ref.h264"), reference)
    assertEquals(5, count)
    assertArrayEquals(concat(annexB(SPS, PPS), annexB(SPS, PPS, SEI, IDR, P_SLICE)), File(output("with-ref.h264")).readBytes())
  }

  @Test
  fun extractH264FailsWhenThereIsNoMediaData() {
    try {
      RepairTools.extractH264(input("index-only.mp4", mp4(withIndex = true, media = null)), output("empty.h264"), null)
      fail("expected IllegalStateException")
    } catch (error: IllegalStateException) {
      assertTrue(error.message.orEmpty().contains("no H.264"))
    }
  }

  // ------------------------------------------------------------------------------ fuzz

  @Test
  fun fuzzSniffFindsTheStartBehindAnyJunkAndNeverThrows() {
    val random = Random(20261027)
    val signatures = listOf(
      bytes(0xFF, 0xD8, 0xFF, 0xE0),
      ascii("GIF89a"),
      ascii("%PDF-"),
      bytes(0x50, 0x4B, 0x03, 0x04),
      ascii("OggS"),
    )
    for (i in 0 until iterations) {
      // Junk made only of bytes 0x00 to 0x08 can never start a signature, so the expected offset is exact.
      val junk = ByteArray(random.nextInt(64)) { random.nextInt(9).toByte() }
      val signature = signatures[random.nextInt(signatures.size)]
      val sniff = RepairTools.sniff(input("fuzz-sniff.bin", concat(junk, signature, ByteArray(16))))
      assertEquals("junk ${junk.size} before ${signature.size} bytes", junk.size, sniff.offset)
    }
    for (i in 0 until iterations / 10) {
      val noise = ByteArray(random.nextInt(4096)).also { random.nextBytes(it) }
      val sniff = RepairTools.sniff(input("fuzz-noise.bin", noise))
      assertTrue("offset out of range: ${sniff.offset}", sniff.offset >= -1 && sniff.offset < noise.size)
    }
  }

  @Test
  fun fuzzEndMarkerHelpersAreIdempotent() {
    val random = Random(20261028)
    for (i in 0 until iterations) {
      val body = ByteArray(random.nextInt(300)).also { random.nextBytes(it) }
      RepairTools.appendJpegEoi(input("fuzz.jpg", body), output("fuzz-eoi.jpg"))
      val once = File(output("fuzz-eoi.jpg")).readBytes()
      assertTrue("JPEG must end with EOI", once.size >= 2 && once[once.size - 2] == 0xFF.toByte() && once[once.size - 1] == 0xD9.toByte())
      RepairTools.appendJpegEoi(output("fuzz-eoi.jpg"), output("fuzz-eoi2.jpg"))
      assertArrayEquals(once, File(output("fuzz-eoi2.jpg")).readBytes())

      RepairTools.appendGifTrailer(input("fuzz.gif", body), output("fuzz-gif.gif"))
      val gif = File(output("fuzz-gif.gif")).readBytes()
      assertEquals(0x3B.toByte(), gif.last())
      RepairTools.appendGifTrailer(output("fuzz-gif.gif"), output("fuzz-gif2.gif"))
      assertArrayEquals(gif, File(output("fuzz-gif2.gif")).readBytes())
    }
  }

  @Test
  fun fuzzZipTruncationRecoversExactlyTheEntriesThatArePresent() {
    val random = Random(20261029)
    for (i in 0 until iterations / 4) {
      val count = 1 + random.nextInt(4)
      val entries = (0 until count).map { "f$it.txt" to letters(random.nextInt(300), random.nextLong()) }
      val zip = zipOf(entries, deflate = false)
      val cut = random.nextInt(zip.size + 1)
      // An entry counts as present once its header, name and all of its data fit before the cut.
      val present = entries.indices.count { index ->
        val starts = localHeaderOffsets(zip)
        val (name, data) = entries[index]
        starts[index] + 30 + name.length + data.size <= cut
      }
      val truncated = input("fuzz-cut.zip", zip.copyOf(cut))
      try {
        val recovered = RepairTools.repairZip(truncated, output("fuzz-cut-out.zip"))
        assertEquals("entries present at cut $cut", present, recovered)
        assertEntries(output("fuzz-cut-out.zip"), entries.take(present))
      } catch (error: IllegalStateException) {
        assertEquals("nothing to recover at cut $cut", 0, present)
      }
    }
  }

  @Test
  fun fuzzExtractH264SurvivesRandomDamageWithoutCrashing() {
    val random = Random(20261030)
    val intact = mp4(withIndex = false, media = lengthPrefixed(SPS, PPS, SEI, IDR, P_SLICE))
    for (i in 0 until iterations / 4) {
      val damaged = intact.copyOf()
      repeat(1 + random.nextInt(6)) { damaged[random.nextInt(damaged.size)] = random.nextInt(256).toByte() }
      val reference = if (random.nextBoolean()) input("ref-fuzz.mp4", mp4(withIndex = true, media = null)) else null
      try {
        val count = RepairTools.extractH264(input("fuzz-damaged.mp4", damaged), output("fuzz-raw.h264"), reference)
        val raw = File(output("fuzz-raw.h264")).readBytes()
        assertEquals("one start code per unit", count, countStartCodes(raw) - (if (reference != null) 2 else 0))
      } catch (error: IllegalStateException) {
        // Allowed: nothing readable was left. Any other exception is a crash and fails the test.
      }
    }
  }

  // ------------------------------------------------------------------------------ builders

  private fun assertEntries(path: String, expected: List<Pair<String, ByteArray>>) {
    ZipFile(path).use { zip ->
      assertEquals(expected.map { it.first }, zip.entries().toList().map { it.name })
      for ((name, data) in expected) {
        assertArrayEquals(name, data, zip.getInputStream(zip.getEntry(name)).readBytes())
      }
    }
  }

  private fun zipOf(entries: List<Pair<String, ByteArray>>, deflate: Boolean): ByteArray {
    val bytes = ByteArrayOutputStream()
    ZipOutputStream(bytes).use { zip ->
      for ((name, data) in entries) {
        val entry = ZipEntry(name)
        if (deflate) {
          entry.method = ZipEntry.DEFLATED
        } else {
          entry.method = ZipEntry.STORED
          entry.size = data.size.toLong()
          entry.compressedSize = data.size.toLong()
          entry.crc = CRC32().apply { update(data) }.value
        }
        zip.putNextEntry(entry)
        zip.write(data)
        zip.closeEntry()
      }
    }
    return bytes.toByteArray()
  }

  private fun localHeaderOffsets(zip: ByteArray): List<Int> {
    val signature = bytes(0x50, 0x4B, 0x03, 0x04)
    return (0..zip.size - 4).filter { position -> (0 until 4).all { zip[position + it] == signature[it] } }
  }

  // Letters only: the content can never contain a ZIP signature by accident.
  private fun letters(length: Int, seed: Long): ByteArray {
    val random = Random(seed)
    return ByteArray(length) { ('a'.code + random.nextInt(26)).toByte() }
  }

  private fun countStartCodes(bytes: ByteArray): Int {
    var count = 0
    for (position in 0..bytes.size - 4) {
      if (bytes[position] == 0.toByte() && bytes[position + 1] == 0.toByte() &&
        bytes[position + 2] == 0.toByte() && bytes[position + 3] == 1.toByte()
      ) count++
    }
    return count
  }

  private fun mp4(withIndex: Boolean, media: ByteArray?): ByteArray {
    val ftyp = box("ftyp", ascii("isom"), u32(512), ascii("isomavc1"))
    val index = if (withIndex) {
      box(
        "moov",
        box(
          "trak",
          box(
            "mdia",
            box("minf", box("stbl", box("stsd", ByteArray(4), u32(1), box("avc1", ByteArray(78), box("avcC", avcC(SPS, PPS)))))),
          ),
        ),
      )
    } else {
      ByteArray(0)
    }
    val data = media?.let { box("mdat", it) } ?: ByteArray(0)
    return concat(ftyp, index, data)
  }

  private fun avcC(sps: ByteArray, pps: ByteArray): ByteArray =
    concat(bytes(1, 0x64, 0, 0x1F, 0xFF, 0xE1), u16(sps.size), sps, bytes(1), u16(pps.size), pps)

  private fun box(type: String, vararg parts: ByteArray): ByteArray {
    val payload = concat(*parts)
    return concat(u32(8 + payload.size), ascii(type), payload)
  }

  private fun annexB(vararg units: ByteArray): ByteArray = concat(*units.map { concat(START_CODE, it) }.toTypedArray())

  private fun lengthPrefixed(vararg units: ByteArray): ByteArray = concat(*units.map { concat(u32(it.size), it) }.toTypedArray())

  private fun concat(vararg parts: ByteArray): ByteArray {
    val out = ByteArrayOutputStream()
    for (part in parts) out.write(part)
    return out.toByteArray()
  }

  private fun ascii(text: String): ByteArray = text.toByteArray(Charsets.ISO_8859_1)

  private fun bytes(vararg values: Int): ByteArray = ByteArray(values.size) { values[it].toByte() }

  private fun u16(value: Int): ByteArray = bytes(value ushr 8, value)

  private fun u32(value: Int): ByteArray = bytes(value ushr 24, value ushr 16, value ushr 8, value)

  companion object {
    private val START_CODE = bytes(0, 0, 0, 1)
    private val SPS = bytes(0x67, 0x64, 0x00, 0x1F, 0xAC)
    private val PPS = bytes(0x68, 0xEE, 0x3C, 0x80)
    private val SEI = bytes(0x06, 0x05, 0x01, 0x02)
    private val IDR = bytes(0x65, 0x88, 0x84, 0x21, 0xA0, 0x01)
    private val P_SLICE = bytes(0x41, 0x9A, 0x22, 0x33)

    private fun bytes(vararg values: Int): ByteArray = ByteArray(values.size) { values[it].toByte() }

    private fun ascii(text: String): ByteArray = text.toByteArray(Charsets.ISO_8859_1)
  }
}
