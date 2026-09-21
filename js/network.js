/**
 * 德州扑克局域网联机客户端通信模块
 * WebSocket Network Client for LAN Multiplayer
 */

class NetworkClient {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this.currentRoom = null;
        this.myPlayerId = null;
        this.isHost = false;

        // 回调钩子
        this.onRoomList = null;
        this.onRoomJoined = null;
        this.onRoomUpdate = null;
        this.onSearchResult = null;
        this.onGameStart = null;
        this.onGameState = null;
        this.onShowdown = null;
        this.onRaisePopup = null;
        this.onSpeech = null;
        this.onSound = null;
        this.onLog = null;
        this.onError = null;
        this.onConnectionChange = null;
    }

    connect() {
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            return;
        }

        let wsUrl;
        if (window.location.protocol === 'file:') {
            wsUrl = 'ws://localhost:3000';
        } else {
            const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            wsUrl = `${proto}//${window.location.host}`;
        }

        try {
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                this.isConnected = true;
                if (this.onConnectionChange) this.onConnectionChange(true);
                this.getRooms();
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleMessage(data);
                } catch (e) {
                    console.error('WS 消息解析错误:', e);
                }
            };

            this.ws.onclose = () => {
                this.isConnected = false;
                this.currentRoom = null;
                if (this.onConnectionChange) this.onConnectionChange(false);
            };

            this.ws.onerror = (err) => {
                console.warn('WS 连接异常:', err);
                if (this.onError) this.onError('无法连接到联机对战服务器，请确认 server.js 已在运行！');
            };
        } catch (e) {
            console.error('WS 初始化失败:', e);
            if (this.onError) this.onError('WebSocket 初始化失败');
        }
    }

    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        } else {
            console.warn('WebSocket 未处于连接状态，无法发送指令');
        }
    }

    handleMessage(data) {
        switch (data.type) {
            case 'ROOM_LIST':
                if (this.onRoomList) this.onRoomList(data.rooms);
                break;

            case 'SEARCH_RESULT':
                if (this.onSearchResult) this.onSearchResult(data);
                break;

            case 'ROOM_JOINED':
                this.currentRoom = data.room;
                this.myPlayerId = data.playerId;
                this.isHost = data.isHost;
                if (this.onRoomJoined) this.onRoomJoined(data);
                break;

            case 'ROOM_UPDATE':
                this.currentRoom = data.room;
                this.isHost = data.room.hostId === this.myPlayerId;
                if (this.onRoomUpdate) this.onRoomUpdate(data.room);
                break;

            case 'GAME_START':
                if (this.onGameStart) this.onGameStart(data);
                break;

            case 'GAME_STATE':
                if (this.onGameState) this.onGameState(data);
                break;

            case 'SHOW_RAISE_POPUP':
                if (this.onRaisePopup) this.onRaisePopup(data.playerId, data.text, data.isAllIn);
                break;

            case 'SHOW_SPEECH':
                if (this.onSpeech) this.onSpeech(data.playerId, data.text);
                break;

            case 'PLAY_SOUND':
                if (this.onSound) this.onSound(data.sound);
                break;

            case 'ADD_LOG':
                if (this.onLog) this.onLog(data.text, data.logType);
                break;

            case 'SHOWDOWN_PAYOUT':
                if (this.onShowdown) this.onShowdown(data.payouts, data.countdown);
                break;

            case 'LEFT_ROOM':
                this.currentRoom = null;
                this.myPlayerId = null;
                this.isHost = false;
                break;

            case 'ERROR':
                if (this.onError) this.onError(data.message);
                break;
        }
    }

    getRooms() {
        this.send({ type: 'GET_ROOMS' });
    }

    createRoom(options, player) {
        this.send({
            type: 'CREATE_ROOM',
            options,
            player
        });
    }

    searchRoom(roomId) {
        this.send({
            type: 'SEARCH_ROOM',
            roomId
        });
    }

    joinRoom(roomId, player) {
        this.send({
            type: 'JOIN_ROOM',
            roomId,
            player
        });
    }

    fillBots() {
        this.send({ type: 'FILL_BOTS' });
    }

    clearBots() {
        this.send({ type: 'CLEAR_BOTS' });
    }

    startGame() {
        this.send({ type: 'START_GAME' });
    }

    sendAction(action, amount = 0) {
        this.send({
            type: 'PLAYER_ACTION',
            action,
            amount
        });
    }

    leaveRoom() {
        this.send({ type: 'LEAVE_ROOM' });
        this.currentRoom = null;
        this.myPlayerId = null;
        this.isHost = false;
    }
}

// 挂载全局网络实例
window.network = new NetworkClient();
