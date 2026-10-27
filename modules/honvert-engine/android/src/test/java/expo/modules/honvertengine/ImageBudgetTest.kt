package expo.modules.honvertengine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

// Pure JVM: the budget rule is plain arithmetic, so it runs without a device.
class ImageBudgetTest {

  @Test
  fun imagesWithinTheBudgetKeepTheirSize() {
    assertEquals(1, ImageBudget.sampleSize(4032, 3024)) // 12 MP phone photo
    assertEquals(1, ImageBudget.sampleSize(6000, 4000)) // exactly 24 MP
    assertEquals(1, ImageBudget.sampleSize(1, 100000))
  }

  @Test
  fun biggerImagesAreSampledDownToTheBudget() {
    assertEquals(2, ImageBudget.sampleSize(8064, 6048)) // 48 MP -> 12 MP
    assertEquals(2, ImageBudget.sampleSize(12000, 8000)) // 96 MP -> 24 MP
    assertEquals(4, ImageBudget.sampleSize(20000, 10000)) // 200 MP -> 12.5 MP
    assertEquals(16, ImageBudget.sampleSize(50000, 50000))
  }

  @Test
  fun invalidSizesDoNotReduce() {
    assertEquals(1, ImageBudget.sampleSize(0, 4000))
    assertEquals(1, ImageBudget.sampleSize(-1, -1))
  }

  @Test
  fun theChosenSampleFitsTheBudgetAndTheNextSmallerOneDoesNot() {
    val sizes = listOf(1, 999, 4032, 8064, 12000, 30000, 65535)
    for (width in sizes) {
      for (height in sizes) {
        val sample = ImageBudget.sampleSize(width, height)
        assertTrue("fits at $width x $height", (width / sample).toLong() * (height / sample) <= ImageBudget.MAX_PIXELS)
        if (sample > 1) {
          val half = sample / 2
          assertTrue(
            "half of $sample is too big at $width x $height",
            (width / half).toLong() * (height / half) > ImageBudget.MAX_PIXELS,
          )
        }
      }
    }
  }
}
