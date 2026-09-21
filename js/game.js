/**
 * 德州扑克核心游戏控制器与状态机
 * Texas Hold'em Game Engine & State Machine
 */

class TexasHoldemGame {
    constructor() {
        this.deck = new Deck();
        this.potManager = new PotManager();
        this.ui = new UIManager();

        // 默认参数
        this.smallBlind = 10;
        this.bigBlind = 20;
        this.startingChips = 1000;
        this.speedDelay = 1300; // 毫秒 (默认慢速)
        this.isPaused = false;

        // 6人桌玩家初始化 (Seat 0 为玩家 Hero，Seat 1-5 为 AI)
        this.players = [];
        this.initPlayers();

        this.dealerIndex = 0;
        this.currentStreet = 'WAITING'; // WAITING, PRE_FLOP, FLOP, TURN, RIVER, SHOWDOWN
        this.communityCards = [];
        this.highestRoundBet = 0;
        this.minRaise = this.bigBlind;
        this.currentTurnIndex = -1;
        this.winningCards = [];

        this.isMultiplayer = false;
        this.myMultiplayerCurrentBet = 0;

        this.bindEvents();
        this.initLobbyEvents();
        this.initNetworkListeners();
    }

    initPlayers() {
        this.players = [
            {
                id: 0,
                name: '你 (Hero)',
                avatar: '🤠',
                isHuman: true,
                chips: this.startingChips,
                holeCards: [],
                currentRoundBet: 0,
                totalHandBet: 0,
                folded: false,
                allIn: false,
                hasActedInRound: false,
                lastAction: null,
                showCards: false
            }
        ];

        // 5 位电脑对手
        for (let i = 0; i < 5; i++) {
            const profile = AI_PROFILES[i];
            this.players.push({
                id: i + 1,
                name: profile.name,
                avatar: profile.avatar,
                profile: profile,
                isHuman: false,
                chips: this.startingChips,
                holeCards: [],
                currentRoundBet: 0,
                totalHandBet: 0,
                folded: false,
                allIn: false,
                hasActedInRound: false,
                lastAction: null,
                showCards: false
            });
        }
    }

    bindEvents() {
        // Hero 按钮交互
        this.ui.btnFold.addEventListener('click', () => {
            sounds.init();
            if (this.isMultiplayer) {
                if (window.network) {
                    window.network.sendAction('fold');
                    this.ui.heroControls.classList.add('controls-disabled');
                    this.ui.btnFold.disabled = true;
                    this.ui.btnCheckCall.disabled = true;
                    this.ui.btnRaise.disabled = true;
                }
                return;
            }
            this.handlePlayerAction(this.players[0], 'fold');
        });

        this.ui.btnCheckCall.addEventListener('click', () => {
            sounds.init();
            if (this.isMultiplayer) {
                const myBet = this.myMultiplayerCurrentBet || 0;
                const toCall = Math.max(0, (this.highestRoundBet || 0) - myBet);
                if (window.network) {
                    window.network.sendAction(toCall <= 0 ? 'check' : 'call');
                    this.ui.heroControls.classList.add('controls-disabled');
                    this.ui.btnFold.disabled = true;
                    this.ui.btnCheckCall.disabled = true;
                    this.ui.btnRaise.disabled = true;
                }
                return;
            }
            const hero = this.players[0];
            const toCall = this.highestRoundBet - hero.currentRoundBet;
            if (toCall <= 0) {
                this.handlePlayerAction(hero, 'check');
            } else {
                this.handlePlayerAction(hero, 'call');
            }
        });

        this.ui.btnRaise.addEventListener('click', () => {
            sounds.init();
            const targetAmount = parseInt(this.ui.raiseAmountInput.value, 10) || 0;
            if (this.isMultiplayer) {
                if (window.network && targetAmount > 0) {
                    window.network.sendAction('raise', targetAmount);
                    this.ui.heroControls.classList.add('controls-disabled');
                    this.ui.btnFold.disabled = true;
                    this.ui.btnCheckCall.disabled = true;
                    this.ui.btnRaise.disabled = true;
                }
                return;
            }
            const hero = this.players[0];
            this.handlePlayerAction(hero, 'raise', targetAmount);
        });

        // 顶部工具栏事件
        const btnMute = document.getElementById('btn-sound-toggle');
        if (btnMute) {
            btnMute.addEventListener('click', () => {
                const enabled = sounds.toggleMute();
                btnMute.textContent = enabled ? '🔊 音效: 开' : '🔇 音效: 关';
            });
        }

        const speedSelect = document.getElementById('speed-select');
        if (speedSelect) {
            const updateSpeed = (val) => {
                if (val === 'fast') this.speedDelay = 350;
                else if (val === 'normal') this.speedDelay = 700;
                else this.speedDelay = 1300;
            };
            if (speedSelect.value) {
                updateSpeed(speedSelect.value);
            }
            speedSelect.addEventListener('change', (e) => {
                updateSpeed(e.target.value);
            });
        }

        const btnReset = document.getElementById('btn-reset-game');
        if (btnReset) {
            btnReset.addEventListener('click', () => {
                if (confirm("确定要重置所有筹码并开始新牌局吗？")) {
                    this.players.forEach(p => p.chips = this.startingChips);
                    this.ui.addLog('系统已重置所有玩家筹码为 $' + this.startingChips, 'system');
                    this.startNewHand();
                }
            });
        }

        const btnRules = document.getElementById('btn-rules');
        const rulesModal = document.getElementById('rules-modal');
        const btnCloseRules = document.getElementById('btn-close-rules');
        if (btnRules && rulesModal && btnCloseRules) {
            btnRules.onclick = () => rulesModal.style.display = 'flex';
            btnCloseRules.onclick = () => rulesModal.style.display = 'none';
        }

        const btnToggleLog = document.getElementById('btn-toggle-log');
        const logPanel = document.getElementById('game-log-panel');
        if (btnToggleLog && logPanel) {
            btnToggleLog.onclick = () => {
                logPanel.classList.toggle('panel-collapsed');
            };
        }
    }

    /**
     * 开始新一手牌
     */
    startNewHand() {
        this.ui.hideWinnerBanner();
        this.winningCards = [];

        // 检查是否有玩家输光，为破产玩家补充筹码
        this.players.forEach(p => {
            if (p.chips <= 0) {
                p.chips = this.startingChips;
                this.ui.addLog(`${p.name} 筹码耗尽，已重新补充筹码 $${this.startingChips}`, 'system');
            }
        });

        // 轮转庄家位 (Dealer Button)
        this.dealerIndex = (this.dealerIndex + 1) % this.players.length;

        // 初始化牌局状态与重置选手本手数据
        this.deck.reset();
        this.communityCards = [];
        this.highestRoundBet = 0;
        this.minRaise = this.bigBlind;

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

        this.ui.addLog(`=== 新一局开始 (庄家: ${this.players[this.dealerIndex].name}) ===`, 'system');

        // 扣除小盲注与大盲注
        this.postBlind(this.players[sbIndex], this.smallBlind, '小盲注 (SB)');
        this.postBlind(this.players[bbIndex], this.bigBlind, '大盲注 (BB)');

        this.highestRoundBet = this.bigBlind;

        // 发底牌 (每人2张)
        for (let i = 0; i < 2; i++) {
            for (const p of this.players) {
                p.holeCards.push(this.deck.deal());
            }
        }
        sounds.playDeal();

        this.currentStreet = 'PRE_FLOP';
        this.updateAllUI();

        // 翻牌前行动起始位置：大盲左手边 (UTG)
        this.currentTurnIndex = (bbIndex + 1) % this.players.length;

        this.processCurrentTurn();
    }

    postBlind(player, amount, blindName) {
        const actualAmount = Math.min(player.chips, amount);
        player.chips -= actualAmount;
        player.currentRoundBet += actualAmount;
        player.totalHandBet += actualAmount;
        if (player.chips === 0) player.allIn = true;

        player.lastAction = { type: 'bet', text: `${blindName} $${actualAmount}` };
        this.ui.addLog(`${player.name} 下了 ${blindName} $${actualAmount}`);
    }

    /**
     * 执行当前玩家回合
     */
    processCurrentTurn() {
        this.updateAllUI();

        // 检查活跃玩家数量（未弃牌）
        const activePlayers = this.players.filter(p => !p.folded);
        if (activePlayers.length <= 1) {
            // 仅剩最后 1 人，直接获胜
            this.handleLoneSurvivor(activePlayers[0]);
            return;
        }

        // 检查本轮下注是否已全部结束
        if (this.isBettingRoundComplete()) {
            this.advanceToNextStreet();
            return;
        }

        const currentPlayer = this.players[this.currentTurnIndex];

        // 如果该玩家已经弃牌或者已经全下，自动跳到下一位
        if (currentPlayer.folded || currentPlayer.allIn) {
            this.moveToNextPlayer();
            return;
        }

        // 如果是人类玩家 (Hero)
        if (currentPlayer.isHuman) {
            this.ui.updateControls(this.getGameStateForHero(), currentPlayer);
            // 等待玩家点击界面按钮触发 handlePlayerAction
            return;
        }

        // 如果是电脑玩家 (AI)
        this.ui.updateControls(this.getGameStateForHero(), this.players[0]); // 禁用人类按钮
        
        setTimeout(() => {
            const gameState = {
                pot: this.potManager.getTotalAmount(this.players),
                toCall: this.highestRoundBet - currentPlayer.currentRoundBet,
                highestRoundBet: this.highestRoundBet,
                minRaise: this.minRaise,
                currentStreet: this.currentStreet,
                communityCards: this.communityCards,
                bigBlind: this.bigBlind
            };

            const decision = AIDecisionEngine.makeDecision(currentPlayer, gameState);
            if (decision.talk) {
                this.ui.showSpeechBubble(currentPlayer.id, decision.talk);
            }
            this.handlePlayerAction(currentPlayer, decision.action, decision.amount);
        }, this.speedDelay);
    }

    /**
     * 处理玩家做出的具体行动
     */
    handlePlayerAction(player, actionType, customAmount = 0) {
        player.hasActedInRound = true;
        const toCall = this.highestRoundBet - player.currentRoundBet;

        switch (actionType) {
            case 'fold':
                player.folded = true;
                player.lastAction = { type: 'fold', text: '弃牌 (Fold)' };
                sounds.playFold();
                this.ui.addLog(`${player.name} 选择了弃牌`, 'fold');
                break;

            case 'check':
                player.lastAction = { type: 'check', text: '过牌 (Check)' };
                sounds.playCheck();
                this.ui.addLog(`${player.name} 敲桌过牌`, 'check');
                break;

            case 'call':
                const callAmount = Math.min(player.chips, toCall);
                player.chips -= callAmount;
                player.currentRoundBet += callAmount;
                player.totalHandBet += callAmount;
                if (player.chips === 0) {
                    player.allIn = true;
                    player.lastAction = { type: 'allin', text: `全下跟注 $${callAmount}` };
                    sounds.playAllIn();
                    this.ui.addLog(`${player.name} 全下跟注 $${callAmount}!`, 'allin');
                } else {
                    player.lastAction = { type: 'call', text: `跟注 $${callAmount}` };
                    sounds.playChip();
                    this.ui.addLog(`${player.name} 跟注 $${callAmount}`, 'call');
                }
                break;

            case 'raise':
            case 'allin':
                const previousHighestBet = this.highestRoundBet;

                // 加注到的目标金额 (Target total bet for the round)
                let targetBet = customAmount;
                if (actionType === 'allin') {
                    targetBet = player.currentRoundBet + player.chips;
                }

                // 计算玩家实际需要补投的筹码
                const neededChips = Math.max(0, targetBet - player.currentRoundBet);
                const actualInvestment = Math.min(player.chips, neededChips);

                player.chips -= actualInvestment;
                player.currentRoundBet += actualInvestment;
                player.totalHandBet += actualInvestment;

                // 判断是否提高了最高下注额 (Raise)
                if (player.currentRoundBet > this.highestRoundBet) {
                    const raiseDiff = player.currentRoundBet - this.highestRoundBet;
                    if (raiseDiff >= this.minRaise) {
                        this.minRaise = raiseDiff;
                    }
                    this.highestRoundBet = player.currentRoundBet;

                    // 有人加注，重置其他未 All-in 玩家的本轮行动标记
                    this.players.forEach(p => {
                        if (p.id !== player.id && !p.folded && !p.allIn) {
                            p.hasActedInRound = false;
                        }
                    });
                }

                if (player.chips === 0) {
                    player.allIn = true;
                    player.lastAction = { type: 'allin', text: `全下 $${player.currentRoundBet}` };
                    sounds.playAllIn();
                    this.ui.addLog(`${player.name} 豪掷全下 $${player.currentRoundBet}!`, 'allin');
                    this.ui.showRaisePopup(player.id, `全下 $${player.currentRoundBet}`, true);
                } else {
                    const actionWord = (previousHighestBet === 0) ? '下注' : '加注至';
                    player.lastAction = { type: 'raise', text: `${actionWord} $${player.currentRoundBet}` };
                    sounds.playChips();
                    this.ui.addLog(`${player.name} ${actionWord} $${player.currentRoundBet}`, 'raise');
                    this.ui.showRaisePopup(player.id, `${actionWord} $${player.currentRoundBet}`, false);
                }
                break;
        }

        this.updateAllUI();

        // 检查活跃玩家是否仅剩一人
        const remaining = this.players.filter(p => !p.folded);
        if (remaining.length <= 1) {
            setTimeout(() => this.handleLoneSurvivor(remaining[0]), 600);
            return;
        }

        // 推进到下一位或下一个阶段
        this.moveToNextPlayer();
    }

    moveToNextPlayer() {
        this.currentTurnIndex = (this.currentTurnIndex + 1) % this.players.length;
        this.processCurrentTurn();
    }

    /**
     * 判断当前街 (Street) 下注轮是否结束
     */
    isBettingRoundComplete() {
        const eligiblePlayers = this.players.filter(p => !p.folded && !p.allIn);

        // 如果只剩 0 或 1 名未全下的玩家，且该玩家已经平注或过牌
        if (eligiblePlayers.length === 0) return true;
        if (eligiblePlayers.length === 1 && eligiblePlayers[0].hasActedInRound && eligiblePlayers[0].currentRoundBet === this.highestRoundBet) {
            return true;
        }

        // 所有未弃牌、未全下的玩家都必须：1. 已经行动过 2. 下注额持平最高下注额
        return eligiblePlayers.every(p => p.hasActedInRound && p.currentRoundBet === this.highestRoundBet);
    }

    /**
     * 进入下一个下注阶段 (Flop -> Turn -> River -> Showdown)
     */
    advanceToNextStreet() {
        // 重置本轮下注额与标记
        this.players.forEach(p => {
            p.currentRoundBet = 0;
            p.hasActedInRound = false;
            p.lastAction = null;
        });
        this.highestRoundBet = 0;
        this.minRaise = this.bigBlind;

        // 计算当前底池
        this.potManager.calculatePots(this.players);

        // 检查是否所有还在牌局中的玩家都已 All-in（无需后续下注，直接连发公共牌摊牌）
        const canStillBet = this.players.filter(p => !p.folded && !p.allIn).length > 1;

        if (this.currentStreet === 'PRE_FLOP') {
            this.currentStreet = 'FLOP';
            // 发翻牌 3 张
            this.communityCards.push(this.deck.deal(), this.deck.deal(), this.deck.deal());
            sounds.playDeal();
            this.ui.addLog(`--- 翻牌圈 (Flop): ${this.communityCards.map(c => c.toString()).join(' ')} ---`, 'stage');
        } else if (this.currentStreet === 'FLOP') {
            this.currentStreet = 'TURN';
            // 发转牌 1 张
            this.communityCards.push(this.deck.deal());
            sounds.playDeal();
            this.ui.addLog(`--- 转牌圈 (Turn): ${this.communityCards[3].toString()} ---`, 'stage');
        } else if (this.currentStreet === 'TURN') {
            this.currentStreet = 'RIVER';
            // 发河牌 1 张
            this.communityCards.push(this.deck.deal());
            sounds.playDeal();
            this.ui.addLog(`--- 河牌圈 (River): ${this.communityCards[4].toString()} ---`, 'stage');
        } else if (this.currentStreet === 'RIVER') {
            this.currentStreet = 'SHOWDOWN';
            this.handleShowdown();
            return;
        }

        this.updateAllUI();

        if (!canStillBet) {
            // 如果大家已 All-in，稍作延迟后自动连发
            setTimeout(() => this.advanceToNextStreet(), this.speedDelay * 1.2);
            return;
        }

        // 翻牌后由庄家左手侧第一位未弃牌玩家先行动
        this.currentTurnIndex = this.findNextActiveIndex(this.dealerIndex);
        this.processCurrentTurn();
    }

    findNextActiveIndex(startIndex) {
        for (let i = 1; i <= this.players.length; i++) {
            const idx = (startIndex + i) % this.players.length;
            const p = this.players[idx];
            if (!p.folded && !p.allIn) {
                return idx;
            }
        }
        return (startIndex + 1) % this.players.length;
    }

    /**
     * 其他人全部弃牌，单人直接独赢底池
     */
    handleLoneSurvivor(winner) {
        this.currentStreet = 'SHOWDOWN';
        const totalPot = this.potManager.getTotalAmount(this.players);
        winner.chips += totalPot;

        sounds.playWin();
        this.ui.addLog(`🎉 其他玩家全部弃牌，【${winner.name}】赢得全部底池 $${totalPot}！`, 'win');

        this.updateAllUI();

        this.ui.showWinnerBanner([{
            potName: '底池 (Uncontested Pot)',
            amount: totalPot,
            winners: [{ player: winner, winAmount: totalPot, hand: null }]
        }], () => this.startNewHand());
    }

    /**
     * 摊牌决胜 (Showdown)
     */
    handleShowdown() {
        this.currentStreet = 'SHOWDOWN';
        const activePlayers = this.players.filter(p => !p.folded);

        // 亮牌
        activePlayers.forEach(p => p.showCards = true);

        // 评估每位活跃玩家的最终最强手牌
        const playerHands = {};
        activePlayers.forEach(p => {
            const allCards = [...p.holeCards, ...this.communityCards];
            playerHands[p.id] = HandEvaluator.getBestHand(allCards);
            this.ui.addLog(`${p.name} 亮牌: ${p.holeCards.map(c=>c.toString()).join(' ')} -> 【${playerHands[p.id].desc}】`);
        });

        // 重新核算主池与边池并派彩
        const pots = this.potManager.calculatePots(this.players);
        const payouts = this.potManager.distributePots(pots, playerHands, this.players);

        // 提取所有赢家手牌中构成的 5 张胜利牌，用于在桌上突出高亮显示
        const winningCardSet = [];
        payouts.forEach(p => {
            p.winners.forEach(w => {
                if (w.hand && w.hand.cards) {
                    w.hand.cards.forEach(c => {
                        if (!winningCardSet.some(wc => wc.equals(c))) {
                            winningCardSet.push(c);
                        }
                    });
                }
            });
        });
        this.winningCards = winningCardSet;

        sounds.playWin();

        // 播报赢家对话
        payouts.forEach(p => {
            p.winners.forEach(w => {
                if (!w.player.isHuman && w.player.profile) {
                    const winQuotes = w.player.profile.chat.win || [];
                    if (winQuotes.length > 0) {
                        const quote = winQuotes[Math.floor(Math.random() * winQuotes.length)];
                        setTimeout(() => this.ui.showSpeechBubble(w.player.id, quote), 400);
                    }
                }
            });
        });

        this.updateAllUI();

        // 弹出获胜结算横幅
        this.ui.showWinnerBanner(payouts, () => this.startNewHand());
    }

    getGameStateForHero() {
        const hero = this.players[0];
        const toCall = Math.max(0, this.highestRoundBet - hero.currentRoundBet);
        return {
            currentTurnPlayerId: this.players[this.currentTurnIndex] ? this.players[this.currentTurnIndex].id : -1,
            toCall: toCall,
            highestRoundBet: this.highestRoundBet,
            minRaise: this.minRaise,
            bigBlind: this.bigBlind,
            totalPot: this.potManager.getTotalAmount(this.players)
        };
    }

    updateAllUI() {
        const sbIndex = (this.dealerIndex + 1) % this.players.length;
        const bbIndex = (this.dealerIndex + 2) % this.players.length;
        const dealerId = this.players[this.dealerIndex].id;
        const sbId = this.players[sbIndex].id;
        const bbId = this.players[bbIndex].id;
        const currentTurnId = this.players[this.currentTurnIndex] ? this.players[this.currentTurnIndex].id : -1;

        // 渲染座位
        this.players.forEach(p => {
            this.ui.renderPlayerSeat(
                p,
                p.id === currentTurnId && this.currentStreet !== 'SHOWDOWN',
                dealerId,
                sbId,
                bbId,
                this.winningCards
            );
        });

        // 渲染公共牌
        this.ui.renderCommunityCards(this.communityCards, this.winningCards);

        // 渲染底池与边池
        const pots = this.potManager.calculatePots(this.players);
        const totalPot = this.potManager.getTotalAmount(this.players);
        this.ui.renderPots(pots, totalPot);

        // 实时手牌牌力分析 (给玩家 Hero 实时辅助参考)
        const hero = this.players[0];
        if (hero.holeCards && hero.holeCards.length === 2 && !hero.folded) {
            const allAvailable = [...hero.holeCards, ...this.communityCards];
            const currentEval = HandEvaluator.getBestHand(allAvailable);
            this.ui.renderHeroHandStrength(currentEval ? currentEval.desc : null);
        } else {
            this.ui.renderHeroHandStrength(null);
        }

        // 更新控制台
        this.ui.updateControls(this.getGameStateForHero(), hero);
    }

    /**
     * 初始化大厅与房间等待区事件交互
     */
    initLobbyEvents() {
        if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return;

        const lobbyModal = document.getElementById('lobby-modal');
        const btnOpenLobby = document.getElementById('btn-open-lobby');
        const btnCloseLobby = document.getElementById('btn-close-lobby');

        if (btnOpenLobby && lobbyModal) {
            btnOpenLobby.addEventListener('click', () => {
                lobbyModal.style.display = 'flex';
                if (window.network) {
                    window.network.connect();
                    window.network.getRooms();
                }
            });
        }

        if (btnCloseLobby && lobbyModal) {
            btnCloseLobby.addEventListener('click', () => {
                lobbyModal.style.display = 'none';
            });
        }

        // 头像选择
        const avatarOpts = document.querySelectorAll('.avatar-opt');
        avatarOpts.forEach(opt => {
            opt.addEventListener('click', () => {
                avatarOpts.forEach(o => o.classList.remove('selected'));
                opt.classList.add('selected');
            });
        });

        // 选项卡切换
        const tabBtnCreate = document.getElementById('tab-btn-create');
        const tabBtnJoin = document.getElementById('tab-btn-join');
        const paneCreate = document.getElementById('tab-pane-create');
        const paneJoin = document.getElementById('tab-pane-join');

        if (tabBtnCreate && tabBtnJoin && paneCreate && paneJoin) {
            tabBtnCreate.addEventListener('click', () => {
                tabBtnCreate.classList.add('active');
                tabBtnJoin.classList.remove('active');
                paneCreate.classList.add('active');
                paneJoin.classList.remove('active');
            });

            tabBtnJoin.addEventListener('click', () => {
                tabBtnJoin.classList.add('active');
                tabBtnCreate.classList.remove('active');
                paneJoin.classList.add('active');
                paneCreate.classList.remove('active');
                if (window.network) window.network.getRooms();
            });
        }

        // 创建房间提交
        const btnSubmitCreate = document.getElementById('btn-submit-create-room');
        if (btnSubmitCreate) {
            btnSubmitCreate.addEventListener('click', () => {
                const roomName = document.getElementById('input-room-name')?.value.trim() || '老友德州俱乐部';
                const blindsVal = (document.getElementById('select-room-blinds')?.value || '10/20').split('/');
                const sb = parseInt(blindsVal[0], 10) || 10;
                const bb = parseInt(blindsVal[1], 10) || 20;
                const chips = parseInt(document.getElementById('select-starting-chips')?.value, 10) || 1000;

                const nickname = document.getElementById('player-nickname-input')?.value.trim() || '牛仔大叔';
                const selectedAvatar = document.querySelector('.avatar-opt.selected')?.dataset.avatar || '🤠';

                if (window.network) {
                    window.network.connect();
                    window.network.createRoom(
                        { roomName, smallBlind: sb, bigBlind: bb, startingChips: chips },
                        { name: nickname, avatar: selectedAvatar }
                    );
                }
            });
        }

        // 搜索房间号
        const btnSearchRoom = document.getElementById('btn-search-room');
        const inputSearchRoomId = document.getElementById('input-search-room-id');
        if (btnSearchRoom && inputSearchRoomId) {
            const doSearch = () => {
                const roomId = inputSearchRoomId.value.trim();
                if (!roomId) {
                    alert('请输入4位房间号！');
                    return;
                }
                if (window.network) {
                    window.network.connect();
                    window.network.searchRoom(roomId);
                }
            };
            btnSearchRoom.addEventListener('click', doSearch);
            inputSearchRoomId.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') doSearch();
            });
        }

        // 刷新活跃房间
        const btnRefreshRooms = document.getElementById('btn-refresh-rooms');
        if (btnRefreshRooms) {
            btnRefreshRooms.addEventListener('click', () => {
                if (window.network) {
                    window.network.connect();
                    window.network.getRooms();
                }
            });
        }

        // 一键补齐人机
        const btnFillBots = document.getElementById('btn-fill-bots');
        if (btnFillBots) {
            btnFillBots.addEventListener('click', () => {
                if (window.network) window.network.fillBots();
            });
        }

        // 清空人机
        const btnClearBots = document.getElementById('btn-clear-bots');
        if (btnClearBots) {
            btnClearBots.addEventListener('click', () => {
                if (window.network) window.network.clearBots();
            });
        }

        // 房主开始对局
        const btnStartMulti = document.getElementById('btn-start-multiplayer-game');
        if (btnStartMulti) {
            btnStartMulti.addEventListener('click', () => {
                if (window.network) window.network.startGame();
            });
        }

        // 离开房间
        const btnLeaveRoom = document.getElementById('btn-leave-room');
        if (btnLeaveRoom) {
            btnLeaveRoom.addEventListener('click', () => {
                if (window.network) window.network.leaveRoom();
                const viewMain = document.getElementById('lobby-view-main');
                const viewWaiting = document.getElementById('lobby-view-waiting');
                if (viewMain && viewWaiting) {
                    viewMain.style.display = 'block';
                    viewWaiting.style.display = 'none';
                }
                const badge = document.getElementById('mode-badge');
                if (badge) {
                    badge.className = 'mode-badge mode-solo';
                    badge.textContent = '单人练习';
                }
                const headerPill = document.getElementById('room-header-pill');
                if (headerPill) headerPill.style.display = 'none';
                this.isMultiplayer = false;

                // 恢复显示所有 6 个本地单人座位
                for (let s = 0; s < 6; s++) {
                    const el = document.getElementById(`seat-${s}`);
                    if (el) el.style.display = 'flex';
                }
                this.updateAllUI();
            });
        }

        // 复制房间号按钮
        const bindCopy = (btnId, getId) => {
            const btn = document.getElementById(btnId);
            if (btn) {
                btn.addEventListener('click', () => {
                    const text = document.getElementById(getId)?.textContent.trim();
                    if (text && text !== '----') {
                        if (navigator.clipboard && navigator.clipboard.writeText) {
                            navigator.clipboard.writeText(text).then(() => {
                                const original = btn.textContent;
                                btn.textContent = '✅ 已复制!';
                                setTimeout(() => { btn.textContent = original; }, 1800);
                            }).catch(() => {
                                prompt('请手动复制房间号:', text);
                            });
                        } else {
                            prompt('请手动复制房间号:', text);
                        }
                    }
                });
            }
        };
        bindCopy('btn-copy-room-id', 'room-header-id');
        bindCopy('btn-waiting-copy', 'waiting-room-id');
    }

    /**
     * 绑定联机网络回调
     */
    initNetworkListeners() {
        if (typeof window === 'undefined' || !window.network) return;
        const net = window.network;

        net.onRoomList = (rooms) => {
            const container = document.getElementById('room-list-container');
            if (!container) return;
            if (!rooms || rooms.length === 0) {
                container.innerHTML = '<div class="room-empty-tip">局域网暂无活跃房间，点击“创建新房间”成为房主吧！</div>';
                return;
            }

            container.innerHTML = rooms.map(r => `
                <div class="room-card" data-room-id="${r.id}">
                    <div class="room-card-head">
                        <span class="room-card-id">#${r.id}</span>
                        <span class="room-card-status ${r.status === 'playing' ? 'status-playing' : 'status-waiting'}">
                            ${r.status === 'playing' ? '激战中' : '等待中'}
                        </span>
                    </div>
                    <div class="room-card-name" title="${r.name}">${r.name}</div>
                    <div class="room-card-meta">
                        <span>房主: ${r.hostName}</span>
                        <span>人数: ${r.playerCount}/${r.maxSeats}</span>
                    </div>
                </div>
            `).join('');

            container.querySelectorAll('.room-card').forEach(card => {
                card.addEventListener('click', () => {
                    const roomId = card.dataset.roomId;
                    const nickname = document.getElementById('player-nickname-input')?.value.trim() || '牛仔大叔';
                    const avatar = document.querySelector('.avatar-opt.selected')?.dataset.avatar || '🤠';
                    net.joinRoom(roomId, { name: nickname, avatar });
                });
            });
        };

        net.onSearchResult = (result) => {
            const area = document.getElementById('search-result-area');
            if (!area) return;
            area.style.display = 'flex';
            if (!result.found) {
                area.innerHTML = `
                    <div class="search-res-info">
                        <span class="search-res-title" style="color: #f87171;">未找到房间</span>
                        <span class="search-res-meta">${result.message}</span>
                    </div>
                `;
            } else {
                const r = result.room;
                area.innerHTML = `
                    <div class="search-res-info">
                        <span class="search-res-title">#${r.id} - ${r.name}</span>
                        <span class="search-res-meta">盲注: $${r.smallBlind}/$${r.bigBlind} | 座位: ${r.playerCount}/${r.maxSeats} (${r.status === 'playing' ? '激战中' : '等待中'})</span>
                    </div>
                    <button class="btn-join-room-act" id="btn-join-search-res" ${r.status === 'playing' ? 'disabled' : ''}>立即加入</button>
                `;
                document.getElementById('btn-join-search-res')?.addEventListener('click', () => {
                    const nickname = document.getElementById('player-nickname-input')?.value.trim() || '牛仔大叔';
                    const avatar = document.querySelector('.avatar-opt.selected')?.dataset.avatar || '🤠';
                    net.joinRoom(r.id, { name: nickname, avatar });
                });
            }
        };

        net.onRoomJoined = (data) => {
            this.renderWaitingRoom(data.room);
            const viewMain = document.getElementById('lobby-view-main');
            const viewWaiting = document.getElementById('lobby-view-waiting');
            if (viewMain && viewWaiting) {
                viewMain.style.display = 'none';
                viewWaiting.style.display = 'block';
            }
        };

        net.onRoomUpdate = (room) => {
            this.renderWaitingRoom(room);
        };

        net.onGameStart = (data) => {
            this.isMultiplayer = true;
            const lobbyModal = document.getElementById('lobby-modal');
            if (lobbyModal) lobbyModal.style.display = 'none';

            const badge = document.getElementById('mode-badge');
            if (badge) {
                badge.className = 'mode-badge mode-multi';
                badge.textContent = '🟢 局域网联机';
            }

            const headerPill = document.getElementById('room-header-pill');
            const headerRoomId = document.getElementById('room-header-id');
            if (headerPill && headerRoomId) {
                headerRoomId.textContent = data.roomId;
                headerPill.style.display = 'flex';
            }

            this.ui.addLog(`=== 局域网联机对局已启动 (房间 #${data.roomId}) ===`, 'system');
        };

        net.onGameState = (state) => {
            this.renderMultiplayerState(state);
        };

        net.onShowdown = (payouts, countdown) => {
            this.ui.showWinnerBanner(payouts, () => {});
        };

        net.onRaisePopup = (playerId, text, isAllIn) => {
            const visualId = (playerId - (net.myPlayerId ?? 0) + 6) % 6;
            this.ui.showRaisePopup(visualId, text, isAllIn);
        };

        net.onSpeech = (playerId, text) => {
            const visualId = (playerId - (net.myPlayerId ?? 0) + 6) % 6;
            this.ui.showSpeechBubble(visualId, text);
        };

        net.onSound = (sound) => {
            if (sound === 'deal') sounds.playDeal();
            else if (sound === 'chip') sounds.playChip();
            else if (sound === 'chips') sounds.playChips();
            else if (sound === 'check') sounds.playCheck();
            else if (sound === 'fold') sounds.playFold();
            else if (sound === 'allin') sounds.playAllIn();
            else if (sound === 'win') sounds.playWin();
        };

        net.onLog = (text, type) => {
            this.ui.addLog(text, type);
        };

        net.onError = (message) => {
            alert(message);
        };
    }

    /**
     * 渲染房间等待区
     */
    renderWaitingRoom(room) {
        if (!room) return;
        const net = window.network;
        const waitingId = document.getElementById('waiting-room-id');
        const waitingName = document.getElementById('waiting-room-name');
        const waitingBlinds = document.getElementById('waiting-blinds');
        const waitingChips = document.getElementById('waiting-chips');
        const waitingCount = document.getElementById('waiting-player-count');
        const btnFillBots = document.getElementById('btn-fill-bots');
        const btnClearBots = document.getElementById('btn-clear-bots');
        const btnStart = document.getElementById('btn-start-multiplayer-game');
        const statusMsg = document.getElementById('waiting-status-msg');

        if (waitingId) waitingId.textContent = room.id;
        if (waitingName) waitingName.textContent = room.name;
        if (waitingBlinds) waitingBlinds.textContent = `盲注: $${room.smallBlind} / $${room.bigBlind}`;
        if (waitingChips) waitingChips.textContent = `筹码: $${room.startingChips}`;
        if (waitingCount) waitingCount.textContent = `座位: ${room.players.length} / 6`;

        const isHost = net && net.isHost;
        if (btnFillBots) btnFillBots.style.display = isHost ? 'inline-flex' : 'none';
        if (btnClearBots) btnClearBots.style.display = isHost ? 'inline-flex' : 'none';
        if (btnStart) {
            btnStart.style.display = isHost ? 'inline-flex' : 'none';
            btnStart.disabled = room.players.length < 2;
        }

        if (statusMsg) {
            if (isHost) {
                statusMsg.textContent = room.players.length < 2
                    ? '至少需要 2 名玩家才可开局。点击【一键补齐人机】可快速填满空余座位！'
                    : '人数已满足，点击【开始游戏】立即发牌！亦可继续补齐或等待好友加入。';
            } else {
                statusMsg.textContent = '已就绪，等待房主开始对局...';
            }
        }

        // 渲染 6 个座位卡片
        const container = document.getElementById('waiting-seats-container');
        if (!container) return;

        let seatsHtml = '';
        for (let i = 0; i < 6; i++) {
            const p = room.players[i];
            if (p) {
                const isMe = net && p.id === net.myPlayerId;
                let roleClass = 'role-player';
                let roleText = '👤 玩家';
                if (p.isHost) {
                    roleClass = 'role-host';
                    roleText = '👑 房主';
                } else if (!p.isHuman) {
                    roleClass = 'role-bot';
                    roleText = '🤖 电脑人机';
                }

                seatsHtml += `
                    <div class="waiting-seat-card ${isMe ? 'is-me' : ''}">
                        <div class="seat-card-avatar">${p.avatar || '🤠'}</div>
                        <div class="seat-card-name">${p.name}${isMe ? ' (你)' : ''}</div>
                        <div class="seat-card-chips">$${p.chips}</div>
                        <span class="seat-card-role ${roleClass}">${roleText}</span>
                    </div>
                `;
            } else {
                seatsHtml += `
                    <div class="waiting-seat-card is-empty">
                        <div class="seat-card-avatar" style="opacity: 0.4;">🪑</div>
                        <div class="seat-card-name" style="color: #64748b;">空座位 ${i + 1}</div>
                        <span class="seat-card-role role-empty">等待加入...</span>
                    </div>
                `;
            }
        }
        container.innerHTML = seatsHtml;
    }

    /**
     * 渲染联机对战实时牌局状态
     */
    renderMultiplayerState(state) {
        const net = window.network;
        const myId = (net && net.myPlayerId !== null) ? net.myPlayerId : 0;

        // 1. 公共牌
        this.communityCards = (state.communityCards || []).map(c => new Card(c.rank, c.suit));
        this.ui.renderCommunityCards(this.communityCards);

        // 2. 底池与边池
        this.ui.renderPots(state.sidePots || [], state.totalPot || 0);

        // 3. 游戏核心状态
        this.highestRoundBet = state.highestRoundBet || 0;
        this.minRaise = state.minRaise || 20;
        this.currentStreet = state.currentStreet;

        // 4. 座位渲染 (以本人为中心，本人始终位于桌底 Seat 0)
        let myPlayer = null;
        const dealerVisualId = (state.dealerPlayerId !== -1) ? (state.dealerPlayerId - myId + 6) % 6 : -1;
        const sbVisualId = (state.sbPlayerId !== -1) ? (state.sbPlayerId - myId + 6) % 6 : -1;
        const bbVisualId = (state.bbPlayerId !== -1) ? (state.bbPlayerId - myId + 6) % 6 : -1;

        state.players.forEach(p => {
            if (p.id === myId) myPlayer = p;
            const visualSeatId = (p.id - myId + 6) % 6;
            const holeCards = (p.holeCards || []).map(c => c.hidden ? { hidden: true } : new Card(c.rank, c.suit));
            const isActive = state.currentTurnPlayerId === p.id;

            this.ui.renderPlayerSeat(
                {
                    ...p,
                    holeCards: holeCards
                },
                isActive,
                dealerVisualId,
                sbVisualId,
                bbVisualId,
                [],
                visualSeatId
            );

            const seatEl = document.getElementById(`seat-${visualSeatId}`);
            if (seatEl) seatEl.style.display = 'flex';
        });

        // 隐藏未占用的座位
        const occupiedVisualSeats = new Set(state.players.map(p => (p.id - myId + 6) % 6));
        for (let s = 0; s < 6; s++) {
            if (!occupiedVisualSeats.has(s)) {
                const emptySeatEl = document.getElementById(`seat-${s}`);
                if (emptySeatEl) emptySeatEl.style.display = 'none';
            }
        }

        // 5. Hero 手牌成色计算与下注数据同步
        if (myPlayer) {
            this.myMultiplayerCurrentBet = myPlayer.currentRoundBet || 0;
            if (myPlayer.holeCards && myPlayer.holeCards.length === 2 && !myPlayer.holeCards.some(c => c.hidden)) {
                const myCards = myPlayer.holeCards.map(c => new Card(c.rank, c.suit));
                const allAvailable = [...myCards, ...this.communityCards];
                const evalResult = HandEvaluator.getBestHand(allAvailable);
                this.ui.renderHeroHandStrength(evalResult ? evalResult.desc : null);
            } else {
                this.ui.renderHeroHandStrength(null);
            }
        } else {
            this.ui.renderHeroHandStrength(null);
        }

        // 6. 轮到自己行动时启用控制栏，否则置灰禁用
        const isMyTurn = state.currentTurnPlayerId === myId && myPlayer && !myPlayer.folded && !myPlayer.allIn;
        if (isMyTurn) {
            const toCall = Math.max(0, this.highestRoundBet - (myPlayer.currentRoundBet || 0));
            const gameStateMock = {
                currentTurnPlayerId: myId,
                highestRoundBet: this.highestRoundBet,
                minRaise: this.minRaise,
                pot: state.totalPot || 0,
                totalPot: state.totalPot || 0,
                toCall: toCall,
                bigBlind: state.bigBlind || this.bigBlind || this.minRaise || 20
            };
            this.ui.updateControls(gameStateMock, {
                ...myPlayer,
                id: myId,
                isHuman: true
            });
            this.ui.heroControls.classList.remove('controls-disabled');
        } else {
            this.ui.heroControls.classList.add('controls-disabled');
            this.ui.btnFold.disabled = true;
            this.ui.btnCheckCall.disabled = true;
            this.ui.btnRaise.disabled = true;
            this.ui.raiseSlider.disabled = true;
            this.ui.raiseAmountInput.disabled = true;
            [this.ui.btnQuickMin, this.ui.btnQuick2_5BB, this.ui.btnQuickHalfPot, this.ui.btnQuickPot, this.ui.btnQuickAllIn].forEach(b => {
                if (b) b.disabled = true;
            });
        }
    }
}

// 页面加载完成后启动
if (typeof window !== 'undefined') {
    const initGame = () => {
        if (!window.game) {
            window.game = new TexasHoldemGame();
            window.game.startNewHand();
        }
    };

    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', initGame);
    } else {
        initGame();
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TexasHoldemGame };
}
