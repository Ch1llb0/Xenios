package app.xeniabridge

// Erzeugt (widgets_gen) – gleiche Zeilen/Spalten wie die Klickflächen in den Widget-Layouts
object WidgetSpecs {
    const val PAD = 12f
    class Row(val name: String?, val weight: Float, val cols: List<Pair<String?, Float>>?, val gap: Float)
    val ROWS: Map<String, List<Row>> = mapOf(
        "power" to listOf(Row("body", 1f, null, 0f)),
        "switch" to listOf(Row("head", 18f, null, 0f), Row(null, 6f, null, 0f), Row("seg", 36f, listOf("btn_on" to 1f, "btn_eco" to 1f, "btn_off" to 1f), 6f), Row(null, 8f, null, 0f), Row("tg_steam", 26f, null, 0f), Row("tg_nosteam", 26f, null, 0f)),
        "large" to listOf(Row("head", 18f, null, 0f), Row(null, 4f, null, 0f), Row("status", 46f, null, 0f), Row(null, 4f, null, 0f), Row("badges", 18f, null, 0f), Row(null, 8f, null, 0f), Row("seg", 36f, listOf("btn_on" to 1f, "btn_eco" to 1f, "btn_off" to 1f), 6f), Row(null, 8f, null, 0f), Row("tg_steam", 26f, null, 0f), Row("tg_nosteam", 26f, null, 0f)),
        "large_live" to listOf(Row("head", 18f, null, 0f), Row(null, 4f, null, 0f), Row("info", 60f, null, 0f), Row(null, 6f, null, 0f), Row("chart", 60f, null, 0f), Row(null, 8f, null, 0f), Row("stop", 36f, null, 0f)),
        "gauges" to listOf(Row("head", 18f, null, 0f), Row(null, 4f, null, 0f), Row("body", 100f, null, 0f)),
        "targets" to listOf(Row("head", 18f, null, 0f), Row(null, 6f, null, 0f), Row("t1", 30f, listOf(null to 40f, "t1_minus" to 22f, null to 34f, "t1_plus" to 22f), 0f), Row("t2", 30f, listOf(null to 40f, "t2_minus" to 22f, null to 34f, "t2_plus" to 22f), 0f), Row("t3", 30f, listOf(null to 40f, "t3_minus" to 22f, null to 34f, "t3_plus" to 22f), 0f)),
        "care" to listOf(Row("body", 1f, null, 0f)),
        "history" to listOf(Row("head", 18f, null, 0f), Row(null, 4f, null, 0f), Row("body", 100f, null, 0f)),
        "lastshot" to listOf(Row("head", 18f, null, 0f), Row(null, 2f, null, 0f), Row("kpi", 34f, null, 0f), Row(null, 4f, null, 0f), Row("body", 80f, null, 0f)),
        "shots" to listOf(Row("head", 18f, null, 0f), Row(null, 4f, null, 0f), Row("body", 100f, null, 0f)),
        "shotslarge" to listOf(Row("head", 18f, null, 0f), Row(null, 4f, null, 0f), Row("top", 90f, null, 0f), Row(null, 8f, null, 0f), Row("bottom", 90f, null, 0f)),
    )
}
