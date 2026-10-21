package com.shclock.photos

import android.app.KeyguardManager
import android.content.Context
import java.io.File
import java.io.IOException
import java.io.PrintWriter
import java.io.RandomAccessFile
import org.json.JSONObject

internal object AdbDiagnostics {
    fun dumpLogs(context: Context, writer: PrintWriter) {
        if (!canReadLogs(context, writer)) return
        try {
            val directory = File(context.filesDir, "logs").canonicalFile
            val files = directory.listFiles()
            if (files == null) {
                writer.println("Photos log directory is unavailable.")
                return
            }
            var remaining = 40 * 1024 * 1024
            for (file in
                files
                    .filter {
                        it.isFile &&
                            it.extension == "log" &&
                            it.canonicalFile.parentFile == directory
                    }
                    .sortedByDescending { it.lastModified() }) {
                if (remaining == 0) {
                    writer.println("[Older logs omitted: 40 MiB limit reached]")
                    break
                }
                RandomAccessFile(file, "r").use { input ->
                    val size = input.length()
                    val start = maxOf(0, size - remaining)
                    val bytes = ByteArray((size - start).toInt())
                    input.seek(start)
                    input.readFully(bytes)
                    if (!canReadLogs(context, writer)) return
                    writer.println("=== ${file.name} ===")
                    if (start > 0) writer.println("[First $start bytes omitted]")
                    writer.println(bytes.toString(Charsets.UTF_8))
                    remaining -= bytes.size
                }
            }
            writer.println("=== End of Photos logs ===")
        } catch (error: IOException) {
            writer.println("Could not read Photos logs: ${error.message}")
        }
    }

    private fun canReadLogs(context: Context, writer: PrintWriter): Boolean {
        val prefs =
            context.getSharedPreferences(
                PhotosApplication.FLUTTER_SHARED_PREFERENCES,
                Context.MODE_PRIVATE,
            )
        val internalUser = runCatching {
            !prefs.getBoolean(PhotosApplication.INTERNAL_USER_DISABLED_KEY, false) &&
                JSONObject(prefs.getString(PhotosApplication.REMOTE_FLAGS_KEY, null) ?: "{}")
                    .opt("internalUser") == true
        }
            .getOrDefault(false)
        if (!internalUser) {
            writer.println("Photos logs are only available to internal users.")
            return false
        }
        val keyguard = context.getSystemService(KeyguardManager::class.java)
        if (keyguard == null || keyguard.isDeviceLocked || keyguard.isKeyguardLocked) {
            writer.println("Unlock the device to read Photos logs.")
            return false
        }
        return true
    }
}
