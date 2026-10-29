package expo.modules.honvertengine

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.arthenica.ffmpegkit.FFmpegKit

// Strings shown in the notification. The app sets them in the current language before each conversion.
data class ConversionLabels(
  val title: String,
  val processing: String,
  val cancel: String,
  val done: String,
)

/**
 * Keeps the app process in the foreground while a conversion runs, so Android does not suspend or
 * kill it when the user leaves the app. The notification shows progress and a Cancel action.
 * The FFmpeg work itself stays in HonvertEngineModule; this service only protects the process.
 */
class ConversionService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_CANCEL) {
      FFmpegKit.cancel()
      return START_NOT_STICKY
    }

    ensureChannel(this)
    val current = labels ?: ConversionLabels("Honvert", "", "", "")
    ServiceCompat.startForeground(
      this,
      NOTIFICATION_ID,
      buildProgress(this, current, percent),
      ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
    )
    // A fast conversion can end before Android gets here. The service could not be stopped then (Android
    // crashes the app when a service started this way is stopped before startForeground), so stop it now.
    if (!markForeground()) stopSelf()
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    clearForeground()
    super.onDestroy()
  }

  // Android 15+ limits dataSync foreground services to 6 hours per 24-hour window and calls this
  // method when the limit is reached. If the service is still running a few seconds later, the
  // system crashes the app, so stop the conversion and the service right away.
  override fun onTimeout(startId: Int, fgsType: Int) {
    FFmpegKit.cancel()
    stopSelf(startId)
  }

  companion object {
    const val ACTION_CANCEL = "expo.modules.honvertengine.action.CANCEL"
    private const val CHANNEL_ID = "honvert_conversions"
    private const val NOTIFICATION_ID = 4242
    private const val DONE_NOTIFICATION_ID = 4243
    private const val MIN_UPDATE_INTERVAL_MS = 500L

    private var active = 0
    // True once the service has called startForeground. Only then may it be stopped from outside.
    private var foreground = false
    private var labels: ConversionLabels? = null
    private var percent = 0
    private var lastUpdate = 0L

    // Called when a conversion starts. The first one starts the foreground service.
    @Synchronized
    fun begin(context: Context, next: ConversionLabels) {
      active += 1
      labels = next
      percent = 0
      lastUpdate = 0L
      if (active == 1) {
        ContextCompat.startForegroundService(context, Intent(context, ConversionService::class.java))
      }
    }

    // fraction is 0.0 to 1.0. Updates are throttled so the notification does not flicker.
    @Synchronized
    fun progress(context: Context, fraction: Double) {
      val now = System.currentTimeMillis()
      val next = (fraction * 100).toInt().coerceIn(0, 99)
      if (next == percent || now - lastUpdate < MIN_UPDATE_INTERVAL_MS) return
      percent = next
      lastUpdate = now
      val current = labels ?: return
      NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, buildProgress(context, current, next))
    }

    // Called when a conversion ends. The last one stops the service.
    @Synchronized
    fun end(context: Context, success: Boolean) {
      active = (active - 1).coerceAtLeast(0)
      if (active > 0) return

      val current = labels
      if (success && current != null) {
        ensureChannel(context)
        NotificationManagerCompat.from(context).notify(DONE_NOTIFICATION_ID, buildDone(context, current))
      }
      // Before startForeground ran, stopping would crash the app; the service stops itself once it starts.
      if (foreground) context.stopService(Intent(context, ConversionService::class.java))
    }

    // Records that the service is in the foreground. Returns false when every conversion already ended.
    @Synchronized
    private fun markForeground(): Boolean {
      foreground = active > 0
      return foreground
    }

    @Synchronized
    private fun clearForeground() {
      foreground = false
    }

    private fun ensureChannel(context: Context) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
      val manager = context.getSystemService(NotificationManager::class.java) ?: return
      if (manager.getNotificationChannel(CHANNEL_ID) != null) return
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "Honvert", NotificationManager.IMPORTANCE_LOW),
      )
    }

    private fun buildProgress(context: Context, labels: ConversionLabels, percent: Int): Notification {
      val cancelIntent = PendingIntent.getService(
        context,
        0,
        Intent(context, ConversionService::class.java).setAction(ACTION_CANCEL),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
      return NotificationCompat.Builder(context, CHANNEL_ID)
        .setSmallIcon(R.drawable.ic_notification)
        .setContentTitle(labels.title)
        .setContentText("${labels.processing} · $percent%")
        .setProgress(100, percent, false)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setCategory(NotificationCompat.CATEGORY_PROGRESS)
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .addAction(0, labels.cancel, cancelIntent)
        .build()
    }

    private fun buildDone(context: Context, labels: ConversionLabels): Notification =
      NotificationCompat.Builder(context, CHANNEL_ID)
        .setSmallIcon(R.drawable.ic_notification)
        .setContentTitle(labels.title)
        .setContentText(labels.done)
        .setAutoCancel(true)
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .build()
  }
}
