package expo.modules.honvertengine

// Largest image the app keeps in memory as a bitmap: 24 megapixels, about 96 MB as ARGB_8888.
// A 48 MP photo decoded at full size needs about twice that, which low-memory phones cannot spare.
// Bigger images are sampled down before they are decoded, and the result tells the user.
object ImageBudget {
  const val MAX_PIXELS = 24_000_000L

  // The smallest power-of-two sample size that keeps width * height within maxPixels. 1 means no reduction.
  fun sampleSize(width: Int, height: Int, maxPixels: Long = MAX_PIXELS): Int {
    if (width <= 0 || height <= 0) return 1
    var sample = 1
    while ((width / sample).toLong() * (height / sample) > maxPixels) sample *= 2
    return sample
  }
}
