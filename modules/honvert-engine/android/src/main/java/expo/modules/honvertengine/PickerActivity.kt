package expo.modules.honvertengine

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.view.Gravity
import android.widget.FrameLayout
import android.widget.ProgressBar
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream

/**
 * Opens the system file picker and copies what the user picks into the app cache.
 *
 * It is its own small, see-through activity so the result survives Android killing the app while the picker
 * is open (common on phones with little memory, and when browsing an SD card). After such a restart the
 * system recreates this activity, it receives the picked files, and leaves them in [pendingFile] for the
 * app to pick up when it starts again. Copying runs off the main thread, so a large file on a slow card
 * never freezes the app.
 */
class PickerActivity : Activity() {
  companion object {
    const val EXTRA_TYPES = "types"
    const val EXTRA_MULTIPLE = "multiple"
    const val EXTRA_TAG = "tag"
    private const val REQUEST_PICK = 4101
    private const val STATE_LAUNCHED = "launched"

    // Set while the JS call that opened the picker is still waiting. Null after the process restarted.
    @Volatile
    var listener: ((String) -> Unit)? = null

    fun pendingFile(context: Context) = File(context.filesDir, "pending-pick.json")

    // A name safe to use as a file name: no folders, no control characters, never empty.
    fun safeName(name: String?, index: Int): String {
      val cleaned = (name ?: "").replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), "_").trim().trimStart('.')
      return cleaned.take(120).ifEmpty { "file-${index + 1}" }
    }
  }

  private var launched = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    launched = savedInstanceState?.getBoolean(STATE_LAUNCHED) ?: false
    if (launched) return

    val types = intent.getStringArrayExtra(EXTRA_TYPES)?.takeIf { it.isNotEmpty() } ?: arrayOf("*/*")
    val pick = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      putExtra(Intent.EXTRA_ALLOW_MULTIPLE, intent.getBooleanExtra(EXTRA_MULTIPLE, false))
      if (types.size > 1) {
        type = "*/*"
        putExtra(Intent.EXTRA_MIME_TYPES, types)
      } else {
        type = types[0]
      }
    }
    launched = true
    try {
      startActivityForResult(pick, REQUEST_PICK)
    } catch (error: Exception) {
      deliver(result(canceled = false, files = JSONArray(), error = "no picker"))
    }
  }

  override fun onSaveInstanceState(outState: Bundle) {
    super.onSaveInstanceState(outState)
    outState.putBoolean(STATE_LAUNCHED, launched)
  }

  @Deprecated("Uses the platform activity result API, which works without androidx.")
  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    super.onActivityResult(requestCode, resultCode, data)
    if (requestCode != REQUEST_PICK) return
    val uris = pickedUris(data)
    if (resultCode != RESULT_OK || uris.isEmpty()) {
      deliver(result(canceled = true, files = JSONArray()))
      return
    }

    showProgress()
    val app = applicationContext
    Thread {
      val files = JSONArray()
      var failed = 0
      val folder = File(app.cacheDir, "picked/${System.currentTimeMillis().toString(36)}").apply { mkdirs() }
      uris.forEachIndexed { index, uri ->
        try {
          files.put(copy(app, uri, folder, index))
        } catch (error: Exception) {
          failed++
        }
      }
      val output = result(canceled = false, files = files, error = if (failed > 0) "unreadable" else null)
      runOnUiThread { deliver(output) }
    }.start()
  }

  private fun pickedUris(data: Intent?): List<Uri> {
    val clip = data?.clipData
    if (clip != null) return (0 until clip.itemCount).mapNotNull { clip.getItemAt(it)?.uri }
    return listOfNotNull(data?.data)
  }

  private fun copy(context: Context, uri: Uri, folder: File, index: Int): JSONObject {
    var name: String? = null
    var size = -1L
    context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
      if (cursor.moveToFirst()) {
        val nameColumn = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (nameColumn >= 0 && !cursor.isNull(nameColumn)) name = cursor.getString(nameColumn)
        val sizeColumn = cursor.getColumnIndex(OpenableColumns.SIZE)
        if (sizeColumn >= 0 && !cursor.isNull(sizeColumn)) size = cursor.getLong(sizeColumn)
      }
    }
    // Two picked files can share a name (same name in different folders), so each gets its own folder.
    val target = File(File(folder, index.toString()).apply { mkdirs() }, safeName(name ?: uri.lastPathSegment, index))
    val input = context.contentResolver.openInputStream(uri) ?: throw IllegalStateException("no stream")
    input.use { source -> FileOutputStream(target).use { source.copyTo(it, 1 shl 16) } }
    return JSONObject()
      .put("name", target.name)
      .put("path", target.absolutePath)
      .put("mime", context.contentResolver.getType(uri) ?: "")
      .put("size", if (size >= 0) size else target.length())
  }

  private fun result(canceled: Boolean, files: JSONArray, error: String? = null): String =
    JSONObject()
      .put("canceled", canceled)
      .put("tag", intent.getStringExtra(EXTRA_TAG) ?: "")
      .put("files", files)
      .put("error", error ?: JSONObject.NULL)
      .toString()

  private fun deliver(json: String) {
    val waiting = listener
    listener = null
    if (waiting != null) {
      waiting(json)
    } else if (!JSONObject(json).optBoolean("canceled")) {
      // The app was restarted while the picker was open: leave the files for it to pick up.
      pendingFile(this).writeText(json)
    }
    finish()
    @Suppress("DEPRECATION")
    overridePendingTransition(0, 0)
  }

  private fun showProgress() {
    val frame = FrameLayout(this)
    frame.addView(
      ProgressBar(this),
      FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER),
    )
    setContentView(frame)
  }
}
