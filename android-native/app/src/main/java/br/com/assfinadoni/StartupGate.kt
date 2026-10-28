package br.com.assfinadoni

/** A callback from a previous load must never dismiss the current loading/error screen. */
internal class StartupGate {
    enum class Stage { IDLE, LOADING, READY, ERROR }
    var generation: Int = 0
        private set
    var stage: Stage = Stage.IDLE
        private set
    fun begin():Int { generation++;stage=Stage.LOADING;return generation }
    fun ready(token:Int):Boolean {
        if(token!=generation || stage!=Stage.LOADING)return false
        stage=Stage.READY;return true
    }
    fun fail(token:Int):Boolean {
        if(token!=generation || stage==Stage.IDLE || stage==Stage.ERROR)return false
        stage=Stage.ERROR;return true
    }
}
