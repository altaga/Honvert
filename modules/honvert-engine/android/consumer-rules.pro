# Fresco looks ExifInterface up by name to read the orientation of HEIC and AVIF pictures. R8 cannot see that
# use, so without this rule it removes the class and showing such a picture crashes the app.
-keep class androidx.exifinterface.media.ExifInterface { *; }
