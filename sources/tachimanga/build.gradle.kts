plugins {
    id("com.android.application") version "8.13.2"
    kotlin("android") version "2.3.10"
}

android {
    namespace = "eu.kanade.tachiyomi.extension.all.archettu"
    compileSdk = 35
    defaultConfig {
        applicationId = "eu.kanade.tachiyomi.extension.all.archettu"
        minSdk = 21
        targetSdk = 35
        versionCode = 1
        versionName = "1.4.1"
    }
    signingConfigs {
        create("repository") {
            val keyPath = System.getenv("TACHIMANGA_KEYSTORE")
            if (!keyPath.isNullOrBlank()) {
                storeFile = file(keyPath)
                storePassword = System.getenv("TACHIMANGA_KEY_PASSWORD")
                keyAlias = "archettu"
                keyPassword = System.getenv("TACHIMANGA_KEY_PASSWORD")
            }
        }
    }
    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("repository").takeIf { !System.getenv("TACHIMANGA_KEYSTORE").isNullOrBlank() }
            isMinifyEnabled = false
        }
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_1_8; targetCompatibility = JavaVersion.VERSION_1_8 }
    testOptions.unitTests.isReturnDefaultValues = true
    sourceSets.getByName("main").java.srcDirs("../../packages/copymanga/native", "../../packages/mangadex/native")
    sourceSets.getByName("main").assets.srcDir("build/generated/assets")
}
kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_1_8) } }

dependencies {
    compileOnly("com.github.keiyoushi:extensions-lib:18a8e26be2") { isTransitive = false }
    compileOnly("com.github.null2264.injekt:injekt-core:4135455a2a")
    compileOnly(kotlin("stdlib"))
    compileOnly("com.squareup.okhttp3:okhttp:4.12.0")
    compileOnly("io.reactivex:rxjava:1.3.8")
    compileOnly("org.jspecify:jspecify:1.0.0")
    implementation("org.jsoup:jsoup:1.18.3")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
    testImplementation(kotlin("stdlib"))
}
