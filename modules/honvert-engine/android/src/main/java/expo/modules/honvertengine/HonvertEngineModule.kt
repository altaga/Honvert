package expo.modules.honvertengine

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.ImageDecoder
import android.graphics.pdf.PdfRenderer
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.os.Build
import android.os.ParcelFileDescriptor
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
      val bitmap = BitmapFactory.decodeFile(inPath)
        ?: throw IllegalStateException("No se pudo leer la imagen intermedia.")
      val format = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        Bitmap.CompressFormat.WEBP_LOSSY
      } else {
        Bitmap.CompressFormat.WEBP
      }
      FileOutputStream(outPath).use { out -> bitmap.compress(format, quality, out) }
      bitmap.recycle()
      outPath
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
    AsyncFunction("decodeImage") { inPath: String, outPath: String ->
      val bitmap = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        val source = ImageDecoder.createSource(File(inPath))
        ImageDecoder.decodeBitmap(source) { decoder, _, _ ->
          decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        }
      } else {
        BitmapFactory.decodeFile(inPath) ?: throw IllegalStateException("decode failed")
      }
      FileOutputStream(outPath).use { out -> bitmap.compress(Bitmap.CompressFormat.PNG, 100, out) }
      bitmap.recycle()
      outPath
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
}
