package expo.modules.honvertengine

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.annotation.RequiresApi
import java.io.File

/**
 * Copies finished files into the phone's shared storage (Android 10 and newer), one folder per tool:
 * pictures and videos in DCIM/Honvert/<tool> so the gallery shows them, everything else (audio, PDF, ZIP...)
 * in Download/Honvert/<tool>, since Android only allows pictures and videos inside DCIM.
 */
@RequiresApi(Build.VERSION_CODES.Q)
object MediaSaver {
  private const val FOLDER = "Honvert"

  private class Target(val collection: Uri, val root: String)

  // The gallery collection first for pictures and videos, then Downloads, which accepts any file. A collection
  // can refuse a type it does not know (an ICO in Images, for example), so each one is only a first try.
  private fun targets(mimeType: String): List<Target> {
    val downloads = Target(MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), Environment.DIRECTORY_DOWNLOADS)
    val gallery = when {
      mimeType.startsWith("image/") -> Target(MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), Environment.DIRECTORY_DCIM)
      mimeType.startsWith("video/") -> Target(MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), Environment.DIRECTORY_DCIM)
      else -> null
    }
    return listOfNotNull(gallery, downloads)
  }

  // "image", "repair"...: letters, digits and dashes only, so it is always one safe folder name.
  private fun subfolder(tool: String) = tool.lowercase().filter { it.isLetterOrDigit() || it == '-' }.ifEmpty { "files" }

  fun save(context: Context, source: File, fileName: String, mimeType: String, tool: String): String {
    if (!source.exists()) throw IllegalStateException("no file")
    val resolver = context.contentResolver
    var lastError: Exception? = null
    for (target in targets(mimeType)) {
      val folder = "${target.root}/$FOLDER/${subfolder(tool)}"
      val values = ContentValues().apply {
        put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)
        put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
        put(MediaStore.MediaColumns.RELATIVE_PATH, folder)
        put(MediaStore.MediaColumns.IS_PENDING, 1)
      }
      val uri = try {
        resolver.insert(target.collection, values)
      } catch (error: Exception) {
        lastError = error
        null
      } ?: continue
      try {
        val out = resolver.openOutputStream(uri) ?: throw IllegalStateException("could not open the file")
        out.use { stream -> source.inputStream().use { it.copyTo(stream, 1 shl 16) } }
        resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
        return folder
      } catch (error: Exception) {
        // Never leave a half-written file in the user's folders.
        resolver.delete(uri, null, null)
        lastError = error
      }
    }
    throw lastError ?: IllegalStateException("could not save")
  }
}
