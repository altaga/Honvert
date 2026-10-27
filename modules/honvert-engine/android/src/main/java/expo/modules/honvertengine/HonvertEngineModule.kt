package expo.modules.honvertengine

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.ImageDecoder
import android.graphics.pdf.PdfRenderer
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.os.Build
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.DocumentsContract
import com.arthenica.ffmpegkit.FFmpegKit
import com.arthenica.ffmpegkit.FFprobeKit
import com.arthenica.ffmpegkit.ReturnCode
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.CountDownLatch

/**
 * Local-only media engine: FFmpeg (LGPL build), Android PdfRenderer and hardware codec discovery.
 * Nothing in here touches the network.
 */
class HonvertEngineModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HonvertEngine")

    Events("onStart", "onProgress")

    // Runs an FFmpeg command. Resolves when the process finishes or is cancelled.
    // durationMs is the expected output length, used for the notification percentage.
    // While it runs, a foreground service keeps the app alive in the background.
    AsyncFunction("execute") { id: String, args: List<String>, durationMs: Double, labels: Map<String, String> ->
      val context = appContext.reactContext ?: throw IllegalStateException("React context unavailable")
      val latch = CountDownLatch(1)
      var result: Map<String, Any?> = mapOf("success" to false, "cancelled" to false, "output" to "")

      ConversionService.begin(
        context,
        ConversionLabels(
          title = labels["title"] ?: "Honvert",
          processing = labels["processing"] ?: "Processing",
          cancel = labels["cancel"] ?: "Cancel",
          done = labels["done"] ?: "Done",
        ),
      )

      try {
        val session = FFmpegKit.executeWithArgumentsAsync(
          args.toTypedArray(),
          { finished ->
            val code = finished.returnCode
            val success = ReturnCode.isSuccess(code)
            result = mapOf(
              "success" to success,
              "cancelled" to ReturnCode.isCancel(code),
              "output" to (finished.output ?: "").takeLast(4000),
            )
            ConversionService.end(context, success)
            latch.countDown()
          },
          null,
          { stats ->
            if (durationMs > 0) ConversionService.progress(context, stats.time / durationMs)
            sendEvent(
              "onProgress",
              mapOf("id" to id, "sessionId" to stats.sessionId, "timeMs" to stats.time, "size" to stats.size),
            )
          },
        )

        sendEvent("onStart", mapOf("id" to id, "sessionId" to session.sessionId))
        latch.await()
      } catch (error: Exception) {
        if (latch.count > 0) ConversionService.end(context, false)
        throw error
      }
      result
    }

    // Synchronous on purpose: cancelling must not wait behind a running conversion in the async queue.
    Function("cancel") { sessionId: Long ->
      FFmpegKit.cancel(sessionId)
      true
    }

    // Returns ffprobe JSON (streams and format) for a local file path.
    AsyncFunction("probe") { path: String ->
      val session = FFprobeKit.executeWithArguments(
        arrayOf("-v", "error", "-print_format", "json", "-show_format", "-show_streams", path),
      )
      if (ReturnCode.isSuccess(session.returnCode)) session.output ?: "{}" else "{}"
    }

    // Encodes a PNG to WebP with Android's built-in encoder (the FFmpeg build has no libwebp).
    AsyncFunction("encodeWebp") { inPath: String, outPath: String, quality: Int ->
      val (bitmap, reduced) = decodeBounded(inPath)
      val format = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        Bitmap.CompressFormat.WEBP_LOSSY
      } else {
        Bitmap.CompressFormat.WEBP
      }
      FileOutputStream(outPath).use { out -> bitmap.compress(format, quality, out) }
      bitmap.recycle()
      mapOf("path" to outPath, "downscaled" to reduced)
    }

    // EXIF orientation (1 = normal). FFmpeg on some builds ignores it, so the app checks it here.
    Function("exifOrientation") { path: String ->
      try {
        android.media.ExifInterface(path).getAttributeInt(
          android.media.ExifInterface.TAG_ORIENTATION,
          android.media.ExifInterface.ORIENTATION_NORMAL,
        )
      } catch (error: Exception) {
        1
      }
    }

    // Decodes any image Android understands (WEBP, HEIF/HEIC, ...) into a PNG that FFmpeg can read.
    // Android 9+ uses ImageDecoder (applies EXIF orientation); older versions fall back to BitmapFactory.
    // Images bigger than ImageBudget are sampled down, and the result says so.
    AsyncFunction("decodeImage") { inPath: String, outPath: String ->
      var reduced = false
      val bitmap = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        val source = ImageDecoder.createSource(File(inPath))
        ImageDecoder.decodeBitmap(source) { decoder, info, _ ->
          decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
          val sample = ImageBudget.sampleSize(info.size.width, info.size.height)
          if (sample > 1) {
            decoder.setTargetSampleSize(sample)
            reduced = true
          }
        }
      } else {
        val (decoded, wasReduced) = decodeBounded(inPath)
        reduced = wasReduced
        decoded
      }
      FileOutputStream(outPath).use { out -> bitmap.compress(Bitmap.CompressFormat.PNG, 100, out) }
      bitmap.recycle()
      mapOf("path" to outPath, "downscaled" to reduced)
    }

    // Number of pages in a PDF.
    AsyncFunction("pdfPageCount") { pdfPath: String ->
      ParcelFileDescriptor.open(File(pdfPath), ParcelFileDescriptor.MODE_READ_ONLY).use { fd ->
        PdfRenderer(fd).use { renderer -> renderer.pageCount }
      }
    }

    // Renders one PDF page to an image file. format: "jpg" or "png".
    AsyncFunction("renderPdfPage") { pdfPath: String, pageIndex: Int, dpi: Int, format: String, quality: Int, outPath: String ->
      ParcelFileDescriptor.open(File(pdfPath), ParcelFileDescriptor.MODE_READ_ONLY).use { fd ->
        PdfRenderer(fd).use { renderer ->
          renderer.openPage(pageIndex).use { page ->
            val scale = dpi / 72f
            val width = (page.width * scale).toInt().coerceAtLeast(1)
            val height = (page.height * scale).toInt().coerceAtLeast(1)
            val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
            bitmap.eraseColor(Color.WHITE)
            page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_PRINT)
            FileOutputStream(outPath).use { out ->
              if (format == "png") {
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
              } else {
                bitmap.compress(Bitmap.CompressFormat.JPEG, quality, out)
              }
            }
            bitmap.recycle()
          }
        }
      }
      outPath
    }

    // Saves a finished file into a folder the user picked with the system folder picker (SAF). The bytes are
    // streamed, so large videos never sit in memory. Returns the URI of the new document.
    AsyncFunction("saveToFolder") { inPath: String, treeUri: String, fileName: String, mimeType: String ->
      val context = appContext.reactContext ?: throw IllegalStateException("app context not ready")
      val resolver = context.contentResolver
      val tree = Uri.parse(treeUri)
      val parent = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
      val created = DocumentsContract.createDocument(resolver, parent, mimeType, fileName)
        ?: throw IllegalStateException("could not create the file")
      try {
        val out = resolver.openOutputStream(created) ?: throw IllegalStateException("could not open the file")
        out.use { stream -> File(inPath).inputStream().use { input -> input.copyTo(stream, 1 shl 16) } }
      } catch (error: Exception) {
        // Do not leave a half-written file in the user's folder.
        DocumentsContract.deleteDocument(resolver, created)
        throw error
      }
      created.toString()
    }

    // Repair: each function writes whatever it can still recover from a damaged file. See RepairTools.
    AsyncFunction("repairSniff") { path: String ->
      val found = RepairTools.sniff(path)
      mapOf("type" to found.type, "offset" to found.offset)
    }
    AsyncFunction("repairStrip") { input: String, output: String, offset: Int ->
      RepairTools.stripPrefix(input, output, offset)
      output
    }
    AsyncFunction("repairJpegEoi") { input: String, output: String ->
      RepairTools.appendJpegEoi(input, output)
      output
    }
    AsyncFunction("repairGifTrailer") { input: String, output: String ->
      RepairTools.appendGifTrailer(input, output)
      output
    }
    AsyncFunction("repairPng") { input: String, output: String ->
      val result = RepairTools.repairPng(input, output)
      mapOf("width" to result.width, "height" to result.height, "rows" to result.rows)
    }
    AsyncFunction("repairZip") { input: String, output: String ->
      RepairTools.repairZip(input, output)
    }
    AsyncFunction("repairPdf") { input: String, output: String ->
      val context = appContext.reactContext ?: throw IllegalStateException("app context not ready")
      RepairTools.repairPdf(context, input, output)
    }
    AsyncFunction("extractH264") { input: String, output: String, reference: String? ->
      RepairTools.extractH264(input, output, reference)
    }

    // First frame of a video as a small JPEG, upright, for the crop box preview. Some Android versions return
    // the frame unrotated, so it is turned here when its size still matches the stored (unrotated) size.
    AsyncFunction("videoFrame") { inPath: String, outPath: String, maxSide: Int ->
      val retriever = android.media.MediaMetadataRetriever()
      try {
        retriever.setDataSource(inPath)
        val frame = retriever.getFrameAtTime(0, android.media.MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
          ?: throw IllegalStateException("no frame")
        val rotation = retriever.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
        val storedWidth = retriever.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: frame.width
        val upright = if (rotation % 360 != 0 && frame.width == storedWidth) {
          val matrix = android.graphics.Matrix().apply { postRotate(rotation.toFloat()) }
          Bitmap.createBitmap(frame, 0, 0, frame.width, frame.height, matrix, true)
        } else {
          frame
        }
        val scale = minOf(1f, maxSide.toFloat() / maxOf(upright.width, upright.height))
        val small = if (scale < 1f) {
          Bitmap.createScaledBitmap(
            upright,
            (upright.width * scale).toInt().coerceAtLeast(1),
            (upright.height * scale).toInt().coerceAtLeast(1),
            true,
          )
        } else {
          upright
        }
        FileOutputStream(outPath).use { out -> small.compress(Bitmap.CompressFormat.JPEG, 85, out) }
        outPath
      } finally {
        retriever.release()
      }
    }

    // PDF passwords (PdfSecurity.kt).
    AsyncFunction("pdfProtect") { input: String, output: String, password: String ->
      val context = appContext.reactContext ?: throw IllegalStateException("app context not ready")
      PdfSecurity.protect(context, input, output, password)
      output
    }
    AsyncFunction("pdfUnlock") { input: String, output: String, password: String ->
      val context = appContext.reactContext ?: throw IllegalStateException("app context not ready")
      PdfSecurity.unlock(context, input, output, password)
      output
    }

    // Lists encoders for a MIME type, marking which ones are hardware accelerated.
    Function("getEncoders") { mime: String ->
      MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos
        .filter { it.isEncoder && it.supportedTypes.any { type -> type.equals(mime, ignoreCase = true) } }
        .map { info -> mapOf("name" to info.name, "hardware" to isHardware(info)) }
    }
  }

  private fun isHardware(info: MediaCodecInfo): Boolean {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) return info.isHardwareAccelerated
    return !info.name.startsWith("OMX.google.") && !info.name.startsWith("c2.android.")
  }

  // Decodes an image with BitmapFactory, sampled down when it is bigger than the budget. Returns the bitmap and
  // whether it was reduced, so the result can say so.
  private fun decodeBounded(path: String): Pair<Bitmap, Boolean> {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(path, bounds)
    val sample = ImageBudget.sampleSize(bounds.outWidth, bounds.outHeight)
    val bitmap = BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sample })
      ?: throw IllegalStateException("decode failed")
    return Pair(bitmap, sample > 1)
  }
}
