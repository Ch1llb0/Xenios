import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
}

// Signatur für Release-Builds kommt aus Umgebungsvariablen (GitHub-Secrets), nie aus dem Repo.
val keystorePath: String? = System.getenv("XENIOS_KEYSTORE")
val buildNumber = (System.getenv("XENIOS_BUILD_NUMBER") ?: "1").toInt()
// Anzeige-Version wie der Server (server/package.json), dazu die Build-Nummer
val appVersion = (groovy.json.JsonSlurper().parse(rootProject.file("../server/package.json")) as Map<*, *>)["version"]?.toString() ?: "0"

// Web-App (../server/web) in die APK packen: im Direkt-Modus läuft sie ohne Server aus den Assets.
val webAssetsDir = layout.buildDirectory.dir("generated/webassets").get().asFile
val copyWebApp by tasks.registering(Copy::class) {
    from(rootProject.file("../server/web"))
    into(File(webAssetsDir, "web"))
}
tasks.named("preBuild") { dependsOn(copyWebApp) }

android {
    namespace = "app.xeniabridge"
    sourceSets.getByName("main").assets.srcDir(webAssetsDir)
    compileSdk = 36

    defaultConfig {
        applicationId = "app.xeniabridge"
        minSdk = 30
        targetSdk = 36
        versionCode = buildNumber
        versionName = "$appVersion ($buildNumber)"
    }

    signingConfigs {
        if (keystorePath != null) {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = System.getenv("XENIOS_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("XENIOS_KEY_ALIAS")
                keyPassword = System.getenv("XENIOS_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (keystorePath != null) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }

    lint {
        // Bericht ja, aber die APK trotzdem bauen
        abortOnError = false
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}
