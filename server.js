/**
 * 德州扑克局域网联机服务端
 * Texas Hold'em LAN Multiplayer Server
 * - HTTP 静态文件托管
 * - WebSocket 实时房间对战、房间搜索、局域网自发现与一键补齐人机
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer, WebSocket } = require('ws');

// 引入核心游戏算法模块
const { Card, Deck } = require('./js/card.js');
const { HandEvaluator, HAND_CATEGORIES } = require('./js/evaluator.js');
const { PotManager } = require('./js/pot.js');
const { AI_PROFILES, AIDecisionEngine } = require('./js/ai.js');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = __dirname;

// MIME 类型映射
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav'
};

// 1. 创建 HTTP 静态托管服务
const httpServer = http.createServer((req, res) => {
    let reqPath = req.url.split('?')[0];
    if (reqPath === '/' || reqPath === '') {
        reqPath = '/index.html';
    }

    const filePath = path.join(PUBLIC_DIR, reqPath);

    // 路径越界防护
    if (!filePath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('404 Not Found');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(res);
    });
});

// 2. 局域网 IP 获取函数
function getLocalIPAddresses() {
    const interfaces = os.networkInterfaces();
    const ips = [];
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                ips.push(iface.address);
            }
        }
    }
    return ips;
}

// 3. 服务端房间与牌局状态机实现
class ServerRoomGame {
    constructor(room) {
        this.room = room;
        this.deck = new Deck();
        this.potManager = new PotManager();
        this.communityCards = [];
        this.currentStreet = 'WAITING'; // WAITING, PRE_FLOP, FLOP, TURN, RIVER, SHOWDOWN
        this.highestRoundBet = 0;
        this.minRaise = room.bigBlind;
        this.currentTurnIndex = -1;
        this.dealerIndex = -1;
        this.speedDelay = 1200; // AI 决策演示延时
        this.isProcessing = false;
        this.turnTimeout = null;
        this.nextHandTimeout = null;
    }

    get players() {
        return this.room.players;
    }

    /**
     * 开始新一手牌
     */
    startNewHand() {
        if (this.turnTimeout) clearTimeout(this.turnTimeout);
        if (this.nextHandTimeout) clearTimeout(this.nextHandTimeout);
        this.room.status = 'playing';

        // 破产补充筹码
        this.players.forEach(p => {
            if (p.chips <= 0) {
                p.chips = this.room.startingChips;
                this.room.broadcastLog(`【${p.name}】筹码耗尽，已重新补充筹码 $${this.room.startingChips}`, 'system');
            }
        });

        // 轮转庄家位
        if (this.dealerIndex === -1) {
            this.dealerIndex = 0;
        } else {
            this.dealerIndex = (this.dealerIndex + 1) % this.players.length;
        }

        this.deck.reset();
        this.communityCards = [];
        this.highestRoundBet = 0;
        this.minRaise = this.room.bigBlind;

        this.players.forEach(p => {
            p.holeCards = [];
            p.currentRoundBet = 0;
            p.totalHandBet = 0;
            p.folded = false;
            p.allIn = false;
            p.hasActedInRound = false;
            p.lastAction = null;
            p.showCards = false;
        });

        const sbIndex = (this.dealerIndex + 1) % this.players.length;
        const bbIndex = (this.dealerIndex + 2) % this.players.length;

        this.room.broadcastLog(`=== 第 ${this.room.handNumber + 1} 局开始 (庄家: ${this.players[this.dealerIndex].name}) ===`, 'system');
        this.room.handNumber++;

        // 扣除盲注
        this.postBlind(this.players[sbIndex], this.room.smallBlind, '小盲注 (SB)');
        this.postBlind(this.players[bbIndex], this.room.bigBlind, '大盲注 (BB)');
        this.highestRoundBet = this.room.bigBlind;

        // 发底牌 (每人2张)
        for (let i = 0; i < 2; i++) {
            for (const p of this.players) {
                p.holeCards.push(this.deck.deal());
            }
        }
        this.room.broadcastSound('deal');

        this.currentStreet = 'PRE_FLOP';
        this.currentTurnIndex = (bbIndex + 1) % this.players.length;

        this.broadcastGameState();
        this.processCurrentTurn();
    }

    postBlind(player, amount, blindName) {
        const actualAmount = Math.min(player.chips, amount);
        player.chips -= actualAmount;
        player.currentRoundBet += actualAmount;
        player.totalHandBet += actualAmount;
        if (player.chips === 0) player.allIn = true;
        player.lastAction = { type: 'bet', text: `${blindName} $${actualAmount}` };
        this.room.broadcastLog(`${player.name} 下了 ${blindName} $${actualAmount}`);
    }

    processCurrentTurn() {
        this.broadcastGameState();

        // 检查活跃玩家数量
        const activePlayers = this.players.filter(p => !p.folded);
        if (activePlayers.length <= 1) {
            this.handleLoneSurvivor(activePlayers[0]);
            return;
        }

        // 检查本轮下注是否已结束
        if (this.isBettingRoundComplete()) {
            this.advanceToNextStreet();
            return;
        }

        const currentPlayer = this.players[this.currentTurnIndex];

        // 弃牌或全下直接跳到下一位
        if (currentPlayer.folded || currentPlayer.allIn) {
            this.moveToNextPlayer();
            return;
        }

        // 如果是电脑玩家 (AI)
        if (!currentPlayer.isHuman) {
            this.turnTimeout = setTimeout(() => {
                const toCall = this.highestRoundBet - currentPlayer.currentRoundBet;
                const gameState = {
                    pot: this.potManager.getTotalAmount(this.players),
                    toCall: toCall,
                    highestRoundBet: this.highestRoundBet,
                    minRaise: this.minRaise,
                    currentStreet: this.currentStreet,
                    communityCards: this.communityCards,
                    bigBlind: this.room.bigBlind
                };

                const decision = AIDecisionEngine.makeDecision(currentPlayer, gameState);
                if (decision.talk) {
                    this.room.broadcastSpeech(currentPlayer.id, decision.talk);
                }
                this.handlePlayerAction(currentPlayer, decision.action, decision.amount);
            }, this.speedDelay);
        } else {
            // 真人玩家回合：设置超时托管保护 (30秒超时自动过牌/弃牌)
            if (this.turnTimeout) clearTimeout(this.turnTimeout);
            this.turnTimeout = setTimeout(() => {
                const toCall = this.highestRoundBet - currentPlayer.currentRoundBet;
                if (toCall <= 0) {
                    this.handlePlayerAction(currentPlayer, 'check');
                } else {
                    this.handlePlayerAction(currentPlayer, 'fold');
                }
            }, 30000);
        }
    }

    handlePlayerAction(player, actionType, customAmount = 0) {
        if (this.turnTimeout) clearTimeout(this.turnTimeout);
        player.hasActedInRound = true;
        const toCall = this.highestRoundBet - player.currentRoundBet;

        switch (actionType) {
            case 'fold':
                player.folded = true;
                player.lastAction = { type: 'fold', text: '弃牌 (Fold)' };
                this.room.broadcastSound('fold');
                this.room.broadcastLog(`${player.name} 选择了弃牌`, 'fold');
                break;

            case 'check':
                if (toCall > 0) {
                    player.folded = true;
                    player.lastAction = { type: 'fold', text: '弃牌 (Fold)' };
                    this.room.broadcastSound('fold');
                    this.room.broadcastLog(`${player.name} 面对下注无法过牌，自动弃牌`, 'fold');
                    break;
                }
                player.lastAction = { type: 'check', text: '过牌 (Check)' };
                this.room.broadcastSound('check');
                this.room.broadcastLog(`${player.name} 敲桌过牌`, 'check');
                break;

            case 'call':
                const callAmount = Math.min(player.chips, toCall);
                player.chips -= callAmount;
                player.currentRoundBet += callAmount;
                player.totalHandBet += callAmount;
                if (player.chips === 0) {
                    player.allIn = true;
                    player.lastAction = { type: 'allin', text: `全下跟注 $${callAmount}` };
                    this.room.broadcastSound('allin');
                    this.room.broadcastLog(`${player.name} 全下跟注 $${callAmount}!`, 'allin');
                    this.room.broadcastRaisePopup(player.id, `全下 $${player.currentRoundBet}`, true);
                } else {
                    player.lastAction = { type: 'call', text: `跟注 $${callAmount}` };
                    this.room.broadcastSound('chip');
                    this.room.broadcastLog(`${player.name} 跟注 $${callAmount}`, 'call');
                }
                break;

            case 'raise':
            case 'allin':
                const previousHighestBet = this.highestRoundBet;
                let targetBet = customAmount;
                if (actionType === 'allin') {
                    targetBet = player.currentRoundBet + player.chips;
                }

                const neededChips = Math.max(0, targetBet - player.currentRoundBet);
                const actualInvestment = Math.min(player.chips, neededChips);

                player.chips -= actualInvestment;
                player.currentRoundBet += actualInvestment;
                player.totalHandBet += actualInvestment;

                if (player.currentRoundBet > this.highestRoundBet) {
                    const raiseDiff = player.currentRoundBet - this.highestRoundBet;
                    if (raiseDiff >= this.minRaise) {
                        this.minRaise = raiseDiff;
                    }
                    this.highestRoundBet = player.currentRoundBet;

                    // 加注重置其他未 All-in 玩家的本轮行动标记
                    this.players.forEach(p => {
                        if (p.id !== player.id && !p.folded && !p.allIn) {
                            p.hasActedInRound = false;
                        }
                    });
                }

                if (player.chips === 0) {
                    player.allIn = true;
                    player.lastAction = { type: 'allin', text: `全下 $${player.currentRoundBet}` };
                    this.room.broadcastSound('allin');
                    this.room.broadcastLog(`${player.name} 豪掷全下 $${player.currentRoundBet}!`, 'allin');
                    this.room.broadcastRaisePopup(player.id, `全下 $${player.currentRoundBet}`, true);
                } else {
                    const actionWord = (previousHighestBet === 0) ? '下注' : '加注至';
                    player.lastAction = { type: 'raise', text: `${actionWord} $${player.currentRoundBet}` };
                    this.room.broadcastSound('chips');
                    this.room.broadcastLog(`${player.name} ${actionWord} $${player.currentRoundBet}`, 'raise');
                    this.room.broadcastRaisePopup(player.id, `${actionWord} $${player.currentRoundBet}`, false);
                }
                break;
        }

        this.moveToNextPlayer();
    }

    isBettingRoundComplete() {
        const activePlayers = this.players.filter(p => !p.folded);
        if (activePlayers.length <= 1) return true;

        // 除已全下外所有活跃玩家是否均已行动且下注额齐平
        return activePlayers.every(p => {
            if (p.allIn) return true;
            return p.hasActedInRound && p.currentRoundBet === this.highestRoundBet;
        });
    }

    moveToNextPlayer() {
        const activePlayers = this.players.filter(p => !p.folded);
        if (activePlayers.length <= 1) {
            this.handleLoneSurvivor(activePlayers[0]);
            return;
        }

        if (this.isBettingRoundComplete()) {
            this.advanceToNextStreet();
            return;
        }

        this.currentTurnIndex = (this.currentTurnIndex + 1) % this.players.length;
        this.processCurrentTurn();
    }

    advanceToNextStreet() {
        // 重置本轮下注
        this.players.forEach(p => {
            p.currentRoundBet = 0;
            p.hasActedInRound = false;
            p.lastAction = null;
        });
        this.highestRoundBet = 0;
        this.minRaise = this.room.bigBlind;

        // 计算是否有 >= 2 名可行动选手
        const canActPlayers = this.players.filter(p => !p.folded && !p.allIn);
        const shouldFastForward = canActPlayers.length <= 1;

        switch (this.currentStreet) {
            case 'PRE_FLOP':
                this.currentStreet = 'FLOP';
                this.deck.deal(); // 烧牌
                for (let i = 0; i < 3; i++) this.communityCards.push(this.deck.deal());
                this.room.broadcastSound('deal');
                this.room.broadcastLog(`【翻牌圈 FLOP】: ${this.communityCards.map(c => c.toString()).join(' ')}`, 'street');
                break;

            case 'FLOP':
                this.currentStreet = 'TURN';
                this.deck.deal(); // 烧牌
                this.communityCards.push(this.deck.deal());
                this.room.broadcastSound('deal');
                this.room.broadcastLog(`【转牌圈 TURN】: ${this.communityCards.map(c => c.toString()).join(' ')}`, 'street');
                break;

            case 'TURN':
                this.currentStreet = 'RIVER';
                this.deck.deal(); // 烧牌
                this.communityCards.push(this.deck.deal());
                this.room.broadcastSound('deal');
                this.room.broadcastLog(`【河牌圈 RIVER】: ${this.communityCards.map(c => c.toString()).join(' ')}`, 'street');
                break;

            case 'RIVER':
                this.showdown();
                return;
        }

        this.currentTurnIndex = this.dealerIndex;
        do {
            this.currentTurnIndex = (this.currentTurnIndex + 1) % this.players.length;
        } while (this.players[this.currentTurnIndex].folded || this.players[this.currentTurnIndex].allIn);

        this.broadcastGameState();

        if (shouldFastForward) {
            setTimeout(() => this.advanceToNextStreet(), this.speedDelay);
        } else {
            this.processCurrentTurn();
        }
    }

    handleLoneSurvivor(winner) {
        this.currentStreet = 'SHOWDOWN';
        const totalPot = this.potManager.getTotalAmount(this.players);
        winner.chips += totalPot;

        this.room.broadcastLog(`🎉 其他玩家全部弃牌，【${winner.name}】赢得全部底池 $${totalPot}！`, 'win');
        this.room.broadcastSound('win');

        const payouts = [{
            potName: '底池 (Total Pot)',
            amount: totalPot,
            winners: [{ player: { id: winner.id, name: winner.name }, winAmount: totalPot, hand: null }]
        }];

        this.broadcastGameState(true);
        this.room.broadcastShowdown(payouts, 5);

        this.scheduleNextHand(5000);
    }

    showdown() {
        this.currentStreet = 'SHOWDOWN';
        this.room.broadcastLog(`=== 进入摊牌比牌阶段 (SHOWDOWN) ===`, 'system');

        const activePlayers = this.players.filter(p => !p.folded);
        activePlayers.forEach(p => {
            p.showCards = true;
            const full7 = [...this.communityCards, ...p.holeCards];
            p.bestHand = HandEvaluator.evaluate7(full7);
            this.room.broadcastLog(`【${p.name}】亮出手牌: ${p.holeCards.map(c => c.toString()).join(' ')} (${p.bestHand.desc})`);
        });

        // 构造底池并结算
        this.potManager.buildPots(this.players);
        const payouts = this.potManager.distributePots(this.players, this.communityCards);

        payouts.forEach(p => {
            const winNames = p.winners.map(w => `${w.player.name} (+$${w.winAmount})`).join(', ');
            this.room.broadcastLog(`🏆 【${p.potName}】金额 $${p.amount} 归属: ${winNames}`, 'win');
        });
        this.room.broadcastSound('win');

        this.broadcastGameState(true);
        this.room.broadcastShowdown(payouts, 5);

        this.scheduleNextHand(5000);
    }

    scheduleNextHand(delay) {
        if (this.nextHandTimeout) clearTimeout(this.nextHandTimeout);
        this.nextHandTimeout = setTimeout(() => {
            if (this.room.status === 'playing' && this.players.length >= 2) {
                this.startNewHand();
            }
        }, delay);
    }

    /**
     * 广播脱敏游戏状态（反作弊核心）：
     * 只有当前玩家本人能看到自己的两张底牌，其他人只能看到背面占位符；
     * 除非进入 SHOWDOWN 亮牌阶段。
     */
    broadcastGameState(isShowdown = false) {
        const totalPot = this.potManager.getTotalAmount(this.players);
        const sidePots = this.potManager.pots.map(p => ({ name: p.name, amount: p.amount }));

        this.room.clients.forEach((client, playerId) => {
            const sanitizedPlayers = this.players.map(p => {
                const isSelf = p.id === playerId;
                const canSeeCards = isShowdown || isSelf;

                return {
                    id: p.id,
                    name: p.name,
                    avatar: p.avatar,
                    isHuman: p.isHuman,
                    chips: p.chips,
                    currentRoundBet: p.currentRoundBet,
                    totalHandBet: p.totalHandBet,
                    folded: p.folded,
                    allIn: p.allIn,
                    lastAction: p.lastAction,
                    holeCards: canSeeCards ? p.holeCards.map(c => ({ rank: c.rank, suit: c.suit, rankStr: c.rankStr, symbol: c.suitSymbol })) : [{ hidden: true }, { hidden: true }],
                    showCards: p.showCards || isShowdown,
                    bestHand: (isShowdown && p.bestHand) ? { desc: p.bestHand.desc, category: p.bestHand.category } : null
                };
            });

            const payload = {
                type: 'GAME_STATE',
                currentStreet: this.currentStreet,
                communityCards: this.communityCards.map(c => ({ rank: c.rank, suit: c.suit, rankStr: c.rankStr, symbol: c.suitSymbol })),
                totalPot: totalPot,
                sidePots: sidePots,
                highestRoundBet: this.highestRoundBet,
                minRaise: this.minRaise,
                bigBlind: this.room.bigBlind,
                smallBlind: this.room.smallBlind,
                currentTurnPlayerId: this.players[this.currentTurnIndex]?.id ?? -1,
                dealerPlayerId: this.players[this.dealerIndex]?.id ?? -1,
                sbPlayerId: this.players[(this.dealerIndex + 1) % this.players.length]?.id ?? -1,
                bbPlayerId: this.players[(this.dealerIndex + 2) % this.players.length]?.id ?? -1,
                players: sanitizedPlayers
            };

            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(payload));
            }
        });
    }
}

// 4. 房间管理器
class RoomManager {
    constructor() {
        this.rooms = new Map(); // roomId -> Room
    }

    createRoom(options, hostClient, hostInfo) {
        // 生成 4 位不重复易读房间号 (1000 - 9999)
        let roomId;
        let attempts = 0;
        do {
            roomId = Math.floor(1000 + Math.random() * 9000).toString();
            attempts++;
        } while (this.rooms.has(roomId) && attempts < 100);

        const room = {
            id: roomId,
            name: options.roomName || `${hostInfo.name}的牌桌`,
            smallBlind: parseInt(options.smallBlind, 10) || 10,
            bigBlind: parseInt(options.bigBlind, 10) || 20,
            startingChips: parseInt(options.startingChips, 10) || 1000,
            hostId: 0,
            maxSeats: 6,
            players: [],
            clients: new Map(), // playerId -> ws
            status: 'waiting', // waiting, playing
            handNumber: 0,
            game: null,

            broadcast(data) {
                const msg = JSON.stringify(data);
                this.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(msg);
                    }
                });
            },

            broadcastLog(text, type = 'action') {
                this.broadcast({ type: 'ADD_LOG', text, logType: type });
            },

            broadcastSound(sound) {
                this.broadcast({ type: 'PLAY_SOUND', sound });
            },

            broadcastSpeech(playerId, text) {
                this.broadcast({ type: 'SHOW_SPEECH', playerId, text });
            },

            broadcastRaisePopup(playerId, text, isAllIn) {
                this.broadcast({ type: 'SHOW_RAISE_POPUP', playerId, text, isAllIn });
            },

            broadcastShowdown(payouts, countdown) {
                this.broadcast({ type: 'SHOWDOWN_PAYOUT', payouts, countdown });
            },

            broadcastRoomUpdate() {
                const roomInfo = {
                    id: this.id,
                    name: this.name,
                    hostId: this.hostId,
                    smallBlind: this.smallBlind,
                    bigBlind: this.bigBlind,
                    startingChips: this.startingChips,
                    status: this.status,
                    players: this.players.map(p => ({
                        id: p.id,
                        name: p.name,
                        avatar: p.avatar,
                        chips: p.chips,
                        isHuman: p.isHuman,
                        isHost: p.id === this.hostId
                    }))
                };
                this.broadcast({ type: 'ROOM_UPDATE', room: roomInfo });
            }
        };

        // 房主加入座位 0
        const hostPlayer = {
            id: 0,
            name: hostInfo.name || '房主',
            avatar: hostInfo.avatar || '🤠',
            isHuman: true,
            chips: room.startingChips,
            holeCards: [],
            currentRoundBet: 0,
            totalHandBet: 0,
            folded: false,
            allIn: false,
            hasActedInRound: false,
            lastAction: null,
            showCards: false
        };
        room.players.push(hostPlayer);
        room.clients.set(0, hostClient);
        hostClient.currentRoomId = roomId;
        hostClient.playerId = 0;

        room.game = new ServerRoomGame(room);
        this.rooms.set(roomId, room);

        return room;
    }

    getRoom(roomId) {
        return this.rooms.get(roomId?.toString());
    }

    getPublicRoomList() {
        const list = [];
        this.rooms.forEach(room => {
            const hostPlayer = room.players.find(p => p.id === room.hostId);
            list.push({
                id: room.id,
                name: room.name,
                hostName: hostPlayer ? hostPlayer.name : '未知',
                playerCount: room.players.length,
                maxSeats: room.maxSeats,
                status: room.status,
                smallBlind: room.smallBlind,
                bigBlind: room.bigBlind
            });
        });
        return list;
    }

    joinRoom(roomId, client, playerInfo) {
        const room = this.getRoom(roomId);
        if (!room) {
            return { error: `未找到房间号为 #${roomId} 的房间，请核对后重试！` };
        }
        if (room.status === 'playing') {
            return { error: '该房间正在激战中，请等待下一局或加入其他房间！' };
        }
        if (room.players.length >= room.maxSeats) {
            return { error: '该房间座位已满 (6/6)！' };
        }

        // 分配下一个可用 ID (0-5)
        const occupiedIds = new Set(room.players.map(p => p.id));
        let newId = 0;
        while (occupiedIds.has(newId)) newId++;

        const newPlayer = {
            id: newId,
            name: playerInfo.name || `玩家${newId + 1}`,
            avatar: playerInfo.avatar || '🤠',
            isHuman: true,
            chips: room.startingChips,
            holeCards: [],
            currentRoundBet: 0,
            totalHandBet: 0,
            folded: false,
            allIn: false,
            hasActedInRound: false,
            lastAction: null,
            showCards: false
        };

        room.players.push(newPlayer);
        room.clients.set(newId, client);
        client.currentRoomId = room.id;
        client.playerId = newId;

        return { room, playerId: newId };
    }

    fillBots(room) {
        if (room.status === 'playing') return false;

        const currentCount = room.players.length;
        const emptyCount = room.maxSeats - currentCount;
        if (emptyCount <= 0) return false;

        // 已经使用的 AI 名字
        const usedNames = new Set(room.players.map(p => p.name));
        const availableProfiles = AI_PROFILES.filter(p => !usedNames.has(p.name));

        const occupiedIds = new Set(room.players.map(p => p.id));

        for (let i = 0; i < emptyCount; i++) {
            let nextId = 0;
            while (occupiedIds.has(nextId)) nextId++;
            occupiedIds.add(nextId);

            const profile = availableProfiles[i % availableProfiles.length] || AI_PROFILES[i % AI_PROFILES.length];
            const bot = {
                id: nextId,
                name: profile.name,
                avatar: profile.avatar,
                profile: profile,
                isHuman: false,
                chips: room.startingChips,
                holeCards: [],
                currentRoundBet: 0,
                totalHandBet: 0,
                folded: false,
                allIn: false,
                hasActedInRound: false,
                lastAction: null,
                showCards: false
            };
            room.players.push(bot);
        }

        room.broadcastLog(`🤖 房主已使用【一键补齐】，增加了 ${emptyCount} 位人机玩家！`, 'system');
        room.broadcastRoomUpdate();
        return true;
    }

    clearBots(room) {
        if (room.status === 'playing') return false;

        const initialCount = room.players.length;
        room.players = room.players.filter(p => p.isHuman);
        const removed = initialCount - room.players.length;

        room.broadcastLog(`🧹 房主已清空所有电脑人机座位 (${removed} 位)。`, 'system');
        room.broadcastRoomUpdate();
        return true;
    }

    leaveRoom(client) {
        if (!client.currentRoomId) return;
        const room = this.getRoom(client.currentRoomId);
        if (!room) return;

        const playerId = client.playerId;
        const pIndex = room.players.findIndex(p => p.id === playerId);
        const leavingPlayer = room.players[pIndex];

        if (pIndex !== -1) {
            room.players.splice(pIndex, 1);
            room.clients.delete(playerId);
            room.broadcastLog(`玩家【${leavingPlayer?.name || '某人'}】离开了房间。`, 'system');
        }

        client.currentRoomId = null;
        client.playerId = null;

        // 如果房间内无真人玩家，彻底销毁房间
        const hasHuman = room.players.some(p => p.isHuman);
        if (!hasHuman) {
            if (room.game?.turnTimeout) clearTimeout(room.game.turnTimeout);
            if (room.game?.nextHandTimeout) clearTimeout(room.game.nextHandTimeout);
            this.rooms.delete(room.id);
            return;
        }

        // 如果离开的是房主，移交房主给第一位人类玩家
        if (room.hostId === playerId) {
            const nextHost = room.players.find(p => p.isHuman);
            if (nextHost) {
                room.hostId = nextHost.id;
                room.broadcastLog(`👑 房主已移交给【${nextHost.name}】。`, 'system');
            }
        }

        room.broadcastRoomUpdate();
    }
}

const roomManager = new RoomManager();

// 5. 初始化 WebSocket 游戏服务器
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleClientMessage(ws, data);
        } catch (e) {
            console.error('WS 消息解析错误:', e.message);
        }
    });

    ws.on('close', () => {
        roomManager.leaveRoom(ws);
    });
});

function handleClientMessage(ws, data) {
    switch (data.type) {
        case 'GET_ROOMS': {
            ws.send(JSON.stringify({
                type: 'ROOM_LIST',
                rooms: roomManager.getPublicRoomList()
            }));
            break;
        }

        case 'CREATE_ROOM': {
            const room = roomManager.createRoom(data.options || {}, ws, data.player || {});
            ws.send(JSON.stringify({
                type: 'ROOM_JOINED',
                roomId: room.id,
                playerId: ws.playerId,
                isHost: true,
                room: {
                    id: room.id,
                    name: room.name,
                    hostId: room.hostId,
                    smallBlind: room.smallBlind,
                    bigBlind: room.bigBlind,
                    startingChips: room.startingChips,
                    status: room.status,
                    players: room.players.map(p => ({
                        id: p.id,
                        name: p.name,
                        avatar: p.avatar,
                        chips: p.chips,
                        isHuman: p.isHuman,
                        isHost: p.id === room.hostId
                    }))
                }
            }));
            break;
        }

        case 'SEARCH_ROOM': {
            const targetRoom = roomManager.getRoom(data.roomId);
            if (!targetRoom) {
                ws.send(JSON.stringify({
                    type: 'SEARCH_RESULT',
                    found: false,
                    message: `未搜索到房间 #${data.roomId}，请确认房间号或房主是否已创建！`
                }));
            } else {
                ws.send(JSON.stringify({
                    type: 'SEARCH_RESULT',
                    found: true,
                    room: {
                        id: targetRoom.id,
                        name: targetRoom.name,
                        playerCount: targetRoom.players.length,
                        maxSeats: targetRoom.maxSeats,
                        status: targetRoom.status,
                        smallBlind: targetRoom.smallBlind,
                        bigBlind: targetRoom.bigBlind
                    }
                }));
            }
            break;
        }

        case 'JOIN_ROOM': {
            const res = roomManager.joinRoom(data.roomId, ws, data.player || {});
            if (res.error) {
                ws.send(JSON.stringify({ type: 'ERROR', message: res.error }));
                return;
            }

            const room = res.room;
            ws.send(JSON.stringify({
                type: 'ROOM_JOINED',
                roomId: room.id,
                playerId: res.playerId,
                isHost: false,
                room: {
                    id: room.id,
                    name: room.name,
                    hostId: room.hostId,
                    smallBlind: room.smallBlind,
                    bigBlind: room.bigBlind,
                    startingChips: room.startingChips,
                    status: room.status,
                    players: room.players.map(p => ({
                        id: p.id,
                        name: p.name,
                        avatar: p.avatar,
                        chips: p.chips,
                        isHuman: p.isHuman,
                        isHost: p.id === room.hostId
                    }))
                }
            }));

            room.broadcastLog(`欢迎【${data.player?.name || '新玩家'}】加入房间！`, 'system');
            room.broadcastRoomUpdate();
            break;
        }

        case 'FILL_BOTS': {
            const room = roomManager.getRoom(ws.currentRoomId);
            if (room && room.hostId === ws.playerId) {
                roomManager.fillBots(room);
            }
            break;
        }

        case 'CLEAR_BOTS': {
            const room = roomManager.getRoom(ws.currentRoomId);
            if (room && room.hostId === ws.playerId) {
                roomManager.clearBots(room);
            }
            break;
        }

        case 'START_GAME': {
            const room = roomManager.getRoom(ws.currentRoomId);
            if (room && room.hostId === ws.playerId) {
                if (room.players.length < 2) {
                    ws.send(JSON.stringify({ type: 'ERROR', message: '至少需要 2 名玩家（包含人机）才能开始对局！请等待好友或点击【一键补齐】！' }));
                    return;
                }
                room.broadcast({ type: 'GAME_START', roomId: room.id });
                room.game.startNewHand();
            }
            break;
        }

        case 'PLAYER_ACTION': {
            const room = roomManager.getRoom(ws.currentRoomId);
            if (!room || room.status !== 'playing') return;

            const currentPlayer = room.game.players[room.game.currentTurnIndex];
            if (!currentPlayer || currentPlayer.id !== ws.playerId) {
                ws.send(JSON.stringify({ type: 'ERROR', message: '还没轮到您的回合！' }));
                return;
            }

            const amount = parseInt(data.amount, 10) || 0;
            room.game.handlePlayerAction(currentPlayer, data.action, amount);
            break;
        }

        case 'LEAVE_ROOM': {
            roomManager.leaveRoom(ws);
            ws.send(JSON.stringify({ type: 'LEFT_ROOM' }));
            break;
        }
    }
}

// 6. 启动服务器并友好输出局域网地址 (支持端口被占用时自动切换备用端口)
function startServer(port = PORT) {
    return new Promise((resolve, reject) => {
        const onError = (err) => {
            if (err.code === 'EADDRINUSE') {
                console.warn(`\n[提示] 默认端口 ${port} 已被占用（可能是上一次游戏未完全退出或有其他程序占用）。`);
                console.log(`正在自动尝试备用端口 ${port + 1}...`);
                httpServer.removeListener('error', onError);
                resolve(startServer(port + 1));
            } else {
                reject(err);
            }
        };

        httpServer.once('error', onError);

        httpServer.listen(port, () => {
            httpServer.removeListener('error', onError);
            const localIPs = getLocalIPAddresses();
            console.log('\n' + '='.repeat(64));
            console.log('  ♠ 德州扑克局域网对战联机服务器已启动 ♠');
            console.log('='.repeat(64));
            console.log(`- 本机访问地址:    http://localhost:${port}`);
            localIPs.forEach(ip => {
                console.log(`- 局域网好友访问:  http://${ip}:${port}`);
            });
            console.log('='.repeat(64));
            console.log('提示: 同一个 Wi-Fi 或局域网下的好友在浏览器输入上述地址即可加入对局！\n');
            resolve(httpServer);
        });
    });
}

if (require.main === module) {
    startServer();
}

module.exports = { httpServer, wss, roomManager, startServer };
