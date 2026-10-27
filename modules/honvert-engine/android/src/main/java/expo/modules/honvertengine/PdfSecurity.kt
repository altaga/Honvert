package expo.modules.honvertengine

import android.content.Context
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.encryption.AccessPermission
import com.tom_roush.pdfbox.pdmodel.encryption.InvalidPasswordException
import com.tom_roush.pdfbox.pdmodel.encryption.StandardProtectionPolicy
import java.io.File

/**
 * Adds or removes a PDF password with PDFBox. Everything happens on the device; the password is never stored.
 * A wrong password throws IllegalArgumentException("wrong password") so the app can say so.
 */
object PdfSecurity {

  // AES-256. The same password opens the file and owns its permissions; readers allow printing and copying.
  fun protect(context: Context, input: String, output: String, password: String) {
    require(password.isNotEmpty()) { "empty password" }
    PDFBoxResourceLoader.init(context)
    PDDocument.load(File(input)).use { document ->
      val policy = StandardProtectionPolicy(password, password, AccessPermission())
      policy.encryptionKeyLength = 256
      document.protect(policy)
      document.save(File(output))
    }
  }

  // Opens the file with the password the user knows and saves a copy without any security.
  fun unlock(context: Context, input: String, output: String, password: String) {
    PDFBoxResourceLoader.init(context)
    val document = try {
      PDDocument.load(File(input), password)
    } catch (error: InvalidPasswordException) {
      throw IllegalArgumentException("wrong password")
    }
    document.use {
      it.isAllSecurityToBeRemoved = true
      it.save(File(output))
    }
  }
}
