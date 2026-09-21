/**
 * 德州扑克 UI 渲染与动效交互模块
 * Table Rendering, Card Elements, Animations & Player Controls
 */

const UI_ICONS = {
    chip: `<svg class="chip-svg" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" fill="#f59e0b" stroke="#ffffff" stroke-width="2"/><circle cx="12" cy="12" r="7.5" stroke="#ffffff" stroke-width="1.5" stroke-dasharray="3.5 2.5"/><circle cx="12" cy="12" r="4" fill="#d97706"/></svg>`,
    spade: `<svg class="spade-svg" viewBox="0 0 24 24" fill="#fbbf24" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C9 7 4 9 4 14c0 3.31 2.69 6 6 6 .83 0 1.61-.17 2.34-.47L11 22h2l-1.34-2.47c.73.3 1.51.47 2.34.47 3.31 0 6-2.69 6-6 0-5-5-7-8-12z"/></svg>`,
    raiseArrow: `<svg class="raise-popup-svg" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M4 14h4v7h8v-7h4L12 4 4 14z"/></svg>`,
    allInFlame: `<svg class="raise-popup-svg" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.61 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8z"/></svg>`
};

class UIManager {
    constructor() {
        this.logContainer = document.getElementById('game-log-list');
        this.heroControls = document.getElementById('hero-controls');
        this.potElement = document.getElementById('pot-amount');
        this.sidePotsElement = document.getElementById('side-pots-container');
        this.communityCardsElement = document.getElementById('community-cards');
        this.heroHandStrengthElement = document.getElementById('hero-hand-strength');
        this.winnerBanner = document.getElementById('winner-banner');
        
        // 控制按钮
        this.btnFold = document.getElementById('btn-fold');
        this.btnCheckCall = document.getElementById('btn-check-call');
        this.btnRaise = document.getElementById('btn-raise');
        this.raiseSlider = document.getElementById('raise-slider');
        this.raiseAmountInput = document.getElementById('raise-amount-input');
        
        // 快速加注按钮
        this.btnQuickMin = document.getElementById('quick-min');
        this.btnQuick2_5BB = document.getElementById('quick-2-5bb');
        this.btnQuickHalfPot = document.getElementById('quick-half-pot');
        this.btnQuickPot = document.getElementById('quick-pot');
        this.btnQuickAllIn = document.getElementById('quick-all-in');

        this.initSliderSync();
    }

    initSliderSync() {
        if (!this.raiseSlider || !this.raiseAmountInput) return;

        this.raiseSlider.addEventListener('input', (e) => {
            this.raiseAmountInput.value = e.target.value;
            this.updateRaiseButtonText();
        });

        this.raiseAmountInput.addEventListener('change', (e) => {
            let val = parseInt(e.target.value, 10) || 0;
            val = Math.max(parseInt(this.raiseSlider.min, 10), Math.min(parseInt(this.raiseSlider.max, 10), val));
            this.raiseSlider.value = val;
            this.raiseAmountInput.value = val;
            this.updateRaiseButtonText();
        });
    }

    updateRaiseButtonText() {
        const val = parseInt(this.raiseAmountInput.value, 10) || 0;
        const max = parseInt(this.raiseSlider.max, 10) || 0;
        if (val >= max) {
            this.btnRaise.textContent = `全下 $${val}`;
            this.btnRaise.classList.add('btn-all-in');
        } else {
            this.btnRaise.textContent = `加注至 $${val}`;
            this.btnRaise.classList.remove('btn-all-in');
        }
    }

    /**
     * 生成单张扑克牌 HTML
     * @param {Card} card 卡牌对象
     * @param {boolean} isFaceUp 是否正面朝上
     * @param {boolean} isWinning 是否属于获胜手牌
     */
    renderCard(card, isFaceUp = true, isWinning = false) {
        if (!card || !isFaceUp || card.hidden) {
            return `<div class="poker-card card-back"><div class="card-inner-pattern"></div></div>`;
        }

        const colorClass = card.colorClass;
        const winClass = isWinning ? 'winning-card' : '';
        return `
            <div class="poker-card ${colorClass} ${winClass}" data-rank="${card.rank}" data-suit="${card.suit}">
                <div class="card-corner top-left">
                    <span class="card-rank">${card.rankStr}</span>
                    <span class="card-suit">${card.suitSymbol}</span>
                </div>
                <div class="card-center-suit">${card.suitSymbol}</div>
                <div class="card-corner bottom-right">
                    <span class="card-rank">${card.rankStr}</span>
                    <span class="card-suit">${card.suitSymbol}</span>
                </div>
            </div>
        `;
    }

    /**
     * 更新全部公共牌展示 (基于 Slot 槽位缓存更新，彻底杜绝下注时卡牌闪烁)
     */
    renderCommunityCards(cards, winningCards = []) {
        if (!this.communityCardsElement || typeof this.communityCardsElement.querySelectorAll !== 'function') return;

        let slots = this.communityCardsElement.querySelectorAll('.card-slot');
        if (slots.length !== 5) {
            let html = '';
            for (let i = 0; i < 5; i++) {
                let slotName = i < 3 ? '翻牌' : (i === 3 ? '转牌' : '河牌');
                html += `<div class="card-slot empty-slot" id="community-slot-${i}"><span class="slot-placeholder">${slotName}</span></div>`;
            }
            this.communityCardsElement.innerHTML = html;
            slots = this.communityCardsElement.querySelectorAll('.card-slot');
        }

        for (let i = 0; i < 5; i++) {
            const slot = slots[i];
            if (!slot) continue;
            if (!slot.dataset) slot.dataset = {};

            let slotName = i < 3 ? '翻牌' : (i === 3 ? '转牌' : '河牌');

            if (i < cards.length) {
                const card = cards[i];
                const isWinning = winningCards.some(wc => wc.equals(card));
                const cardKey = `${card.rank}${card.suit}_${isWinning ? '1' : '0'}`;

                if (slot.dataset.cardKey !== cardKey) {
                    slot.dataset.cardKey = cardKey;
                    slot.className = 'card-slot active-slot';
                    slot.innerHTML = this.renderCard(card, true, isWinning);
                }
            } else {
                if (slot.dataset.cardKey !== 'empty') {
                    slot.dataset.cardKey = 'empty';
                    slot.className = 'card-slot empty-slot';
                    slot.innerHTML = `<span class="slot-placeholder">${slotName}</span>`;
                }
            }
        }
    }

    /**
     * 更新玩家座位 UI (增量精准更新，不销毁 DOM 节点，杜绝频闪)
     */
    renderPlayerSeat(player, isActive, dealerId, sbId, bbId, winningCards = [], visualSeatId = player.id) {
        const seatEl = document.getElementById(`seat-${visualSeatId}`);
        if (!seatEl || typeof seatEl.querySelector !== 'function') return;

        // 状态样式更新
        seatEl.classList.toggle('seat-active', !!isActive);
        seatEl.classList.toggle('seat-folded', !!player.folded);
        seatEl.classList.toggle('seat-allin', !!player.allIn);
        seatEl.classList.toggle('seat-busted', player.chips === 0 && !player.allIn);

        // 如果座位 DOM 骨架尚未建立，进行一次性骨架初始化
        let infoEl = seatEl.querySelector('.seat-info');
        if (!infoEl) {
            seatEl.innerHTML = `
                <div class="speech-bubble" id="speech-bubble-${visualSeatId}"></div>
                <div class="seat-badges"></div>
                <div class="seat-avatar-wrap">
                    <div class="seat-avatar">${player.avatar || '👤'}</div>
                </div>
                <div class="seat-info">
                    <div class="seat-name-row">
                        <span class="seat-name" title="${player.name}">${player.name}</span>
                        <span class="seat-action-slot"></span>
                    </div>
                    <div class="seat-chips">$${player.chips}</div>
                </div>
                <div class="seat-cards"></div>
                <div class="seat-bet-chip" style="display: none;">
                    <span class="chip-icon">${UI_ICONS.chip}</span>
                    <span class="chip-val">$0</span>
                </div>
            `;
        }

        // 头像与名称动态同步 (多人联机或换座时更新)
        const nameEl = seatEl.querySelector('.seat-name');
        if (nameEl && nameEl.textContent !== player.name) {
            nameEl.textContent = player.name;
            nameEl.title = player.name;
        }
        const avatarEl = seatEl.querySelector('.seat-avatar');
        if (avatarEl && avatarEl.textContent !== (player.avatar || '👤')) {
            avatarEl.textContent = player.avatar || '👤';
        }

        // 1. 位置徽章更新 (仅当发生变化时更新)
        const badgesEl = seatEl.querySelector('.seat-badges');
        let badgeHtml = '';
        if (player.id === dealerId) badgeHtml += '<span class="badge badge-dealer" title="庄家位">D</span>';
        if (player.id === sbId) badgeHtml += '<span class="badge badge-blind" title="小盲">SB</span>';
        if (player.id === bbId) badgeHtml += '<span class="badge badge-blind" title="大盲">BB</span>';
        if (badgesEl && badgesEl.innerHTML !== badgeHtml) {
            badgesEl.innerHTML = badgeHtml;
        }

        // 2. 行动标签更新
        const actionSlot = seatEl.querySelector('.seat-action-slot');
        const lastActionTag = player.lastAction ? `<span class="action-tag tag-${player.lastAction.type}">${player.lastAction.text}</span>` : '';
        if (actionSlot && actionSlot.innerHTML !== lastActionTag) {
            actionSlot.innerHTML = lastActionTag;
        }

        // 3. 筹码数额更新
        const chipsEl = seatEl.querySelector('.seat-chips');
        const chipStr = `$${player.chips}`;
        if (chipsEl && chipsEl.textContent !== chipStr) {
            chipsEl.textContent = chipStr;
        }

        // 4. 手牌渲染 (使用 key 缓存对比，手牌没变绝不触碰 DOM，彻底消除卡牌反复眨眼重绘)
        const cardsEl = seatEl.querySelector('.seat-cards');
        if (cardsEl) {
            if (!cardsEl.dataset) cardsEl.dataset = {};
            const holeCards = player.holeCards || [];
            const hasHiddenCard = holeCards.some(c => c && c.hidden);
            const isHuman = player.isHuman;
            const reveal = (player.showCards || isHuman) && !hasHiddenCard;
            const winCardKeys = (winningCards || []).map(wc => `${wc.rank}${wc.suit}`).join(',');
            const cardsKey = `${holeCards.map(c => c.hidden ? 'H' : `${c.rank}${c.suit}`).join(',')}_${reveal}_${winCardKeys}`;

            if (cardsEl.dataset.cardsKey !== cardsKey) {
                cardsEl.dataset.cardsKey = cardsKey;
                if (holeCards.length === 0) {
                    cardsEl.innerHTML = '';
                } else {
                    cardsEl.innerHTML = holeCards.map(c => {
                        const isWinning = (winningCards && !c.hidden) ? winningCards.some(wc => wc.equals && wc.equals(c)) : false;
                        return this.renderCard(c, reveal, isWinning);
                    }).join('');
                }
            }
        }

        // 5. 本轮下注筹码徽标更新 (平滑显示，不销毁重建)
        const betChipEl = seatEl.querySelector('.seat-bet-chip');
        if (betChipEl) {
            if (player.currentRoundBet > 0) {
                betChipEl.style.display = 'flex';
                const chipValEl = betChipEl.querySelector('.chip-val');
                if (chipValEl) chipValEl.textContent = `$${player.currentRoundBet}`;
            } else {
                betChipEl.style.display = 'none';
            }
        }

        // 6. 思考对话气泡状态保持
        const speechBubble = seatEl.querySelector('.speech-bubble');
        if (speechBubble && player.speechText) {
            speechBubble.textContent = player.speechText;
            speechBubble.classList.add('show-bubble');
        }
    }

    /**
     * 弹出加注/全下金额动态提示徽章 (头像旁浮动小动画)
     * @param {number} playerId 玩家ID
     * @param {string} text 提示文本，如 "加注至 $60" 或 "全下 $500"
     * @param {boolean} isAllIn 是否全下
     */
    showRaisePopup(playerId, text, isAllIn = false) {
        const seatEl = document.getElementById(`seat-${playerId}`);
        if (!seatEl || typeof seatEl.querySelector !== 'function') return;

        const avatarWrap = seatEl.querySelector('.seat-avatar-wrap');
        if (!avatarWrap || typeof avatarWrap.querySelectorAll !== 'function') return;

        // 移除该座位已有的旧动画弹窗，避免重叠
        const oldPopups = avatarWrap.querySelectorAll('.raise-popup');
        oldPopups.forEach(p => p.remove());

        const popup = document.createElement('div');
        popup.className = `raise-popup ${isAllIn ? 'popup-allin' : ''}`;
        const iconSvg = isAllIn ? UI_ICONS.allInFlame : UI_ICONS.raiseArrow;
        popup.innerHTML = `
            <span class="raise-popup-icon">${iconSvg}</span>
            <span class="raise-popup-text">${text}</span>
        `;

        avatarWrap.appendChild(popup);

        // 动效结束后自动从 DOM 移除
        setTimeout(() => {
            if (popup.parentNode) {
                popup.remove();
            }
        }, 1800);
    }

    /**
     * 弹出玩家思考/发言气泡
     */
    showSpeechBubble(playerOrId, text) {
        const player = typeof playerOrId === 'object' ? playerOrId : (window.game ? window.game.players.find(p => p.id === playerOrId) : null);
        if (player) {
            player.speechText = text;
            if (player.speechTimeout) clearTimeout(player.speechTimeout);
            player.speechTimeout = setTimeout(() => {
                player.speechText = '';
                const b = document.getElementById(`speech-bubble-${player.id}`);
                if (b) b.classList.remove('show-bubble');
            }, 3200);
        }

        const bubbleId = player ? player.id : playerOrId;
        const bubble = document.getElementById(`speech-bubble-${bubbleId}`);
        if (!bubble || !text) return;

        bubble.textContent = text;
        bubble.classList.add('show-bubble');
    }

    /**
     * 更新底池数额与边池列表
     */
    renderPots(pots, totalAmount) {
        if (this.potElement) {
            this.potElement.textContent = `$${totalAmount}`;
        }

        if (this.sidePotsElement) {
            if (pots && pots.length > 1) {
                this.sidePotsElement.innerHTML = pots.map(p => 
                    `<span class="side-pot-pill">${p.name}: $${p.amount}</span>`
                ).join('');
                this.sidePotsElement.style.display = 'flex';
            } else {
                this.sidePotsElement.innerHTML = '';
                this.sidePotsElement.style.display = 'none';
            }
        }
    }

    /**
     * 更新玩家实时手牌成色描述
     */
    renderHeroHandStrength(handDesc) {
        if (!this.heroHandStrengthElement) return;
        if (handDesc) {
            this.heroHandStrengthElement.innerHTML = `<span class="badge-icon">${UI_ICONS.spade}</span> <span class="badge-text">${handDesc}</span>`;
            this.heroHandStrengthElement.style.display = 'inline-flex';
        } else {
            this.heroHandStrengthElement.style.display = 'none';
        }
    }

    /**
     * 更新下方操作按钮可用性与数值
     */
    updateControls(gameState, hero) {
        if (!this.heroControls) return;

        const isHeroTurn = gameState.currentTurnPlayerId === hero.id && !hero.folded && !hero.allIn;

        if (!isHeroTurn) {
            this.heroControls.classList.add('controls-disabled');
            this.btnFold.disabled = true;
            this.btnCheckCall.disabled = true;
            this.btnRaise.disabled = true;
            this.raiseSlider.disabled = true;
            this.raiseAmountInput.disabled = true;
            [this.btnQuickMin, this.btnQuick2_5BB, this.btnQuickHalfPot, this.btnQuickPot, this.btnQuickAllIn].forEach(b => b.disabled = true);
            return;
        }

        this.heroControls.classList.remove('controls-disabled');
        this.btnFold.disabled = false;
        this.btnCheckCall.disabled = false;

        const toCall = gameState.toCall;
        if (toCall === 0) {
            this.btnCheckCall.textContent = '过牌 (Check)';
            this.btnCheckCall.className = 'btn-action btn-check';
        } else {
            const callAmount = Math.min(toCall, hero.chips);
            this.btnCheckCall.textContent = callAmount >= hero.chips ? `全下跟注 ($${callAmount})` : `跟注 $${callAmount} (Call)`;
            this.btnCheckCall.className = 'btn-action btn-call';
        }

        // 加注范围计算
        const currentHeroBet = hero.currentRoundBet || 0;
        const targetCallBet = gameState.highestRoundBet || 0;
        const minRaiseDelta = gameState.minRaise;
        const minRaiseTarget = targetCallBet + minRaiseDelta;
        const maxRaiseTarget = currentHeroBet + hero.chips; // 全下额度

        if (maxRaiseTarget > targetCallBet && hero.chips > toCall) {
            this.btnRaise.disabled = false;
            this.raiseSlider.disabled = false;
            this.raiseAmountInput.disabled = false;

            const effectiveMin = Math.min(minRaiseTarget, maxRaiseTarget);
            this.raiseSlider.min = effectiveMin;
            this.raiseSlider.max = maxRaiseTarget;
            this.raiseSlider.step = gameState.bigBlind;

            // 默认设置为有效加注额或上一次合法值
            let currentVal = parseInt(this.raiseAmountInput.value, 10);
            if (isNaN(currentVal) || currentVal < effectiveMin || currentVal > maxRaiseTarget) {
                currentVal = effectiveMin;
            }
            this.raiseSlider.value = currentVal;
            this.raiseAmountInput.value = currentVal;
            this.updateRaiseButtonText();

            // 启用快捷加注按钮
            [this.btnQuickMin, this.btnQuick2_5BB, this.btnQuickHalfPot, this.btnQuickPot, this.btnQuickAllIn].forEach(b => b.disabled = false);

            // 快捷加注计算事件
            this.setupQuickButtons(gameState, hero, effectiveMin, maxRaiseTarget);
        } else {
            // 筹码不足以再加注 (只能跟注或全下跟注)
            this.btnRaise.disabled = true;
            this.raiseSlider.disabled = true;
            this.raiseAmountInput.disabled = true;
            [this.btnQuickMin, this.btnQuick2_5BB, this.btnQuickHalfPot, this.btnQuickPot, this.btnQuickAllIn].forEach(b => b.disabled = true);
        }
    }

    setupQuickButtons(gameState, hero, minRaise, maxRaise) {
        const currentHeroBet = hero.currentRoundBet || 0;
        const pot = gameState.totalPot || 0;
        const bb = gameState.bigBlind;
        const toCall = gameState.toCall || 0;
        const highestBet = gameState.highestRoundBet || 0;

        const setVal = (val) => {
            const clamped = Math.max(minRaise, Math.min(maxRaise, Math.round(val)));
            this.raiseSlider.value = clamped;
            this.raiseAmountInput.value = clamped;
            this.updateRaiseButtonText();
        };

        // 最小合法加注
        this.btnQuickMin.onclick = () => setVal(minRaise);

        // 2.5BB
        this.btnQuick2_5BB.onclick = () => {
            const baseBet = highestBet > bb ? highestBet : bb;
            setVal(baseBet * 2.5);
        };

        // 1/2 底池加注 (标准德州扑克底池计算：如有需要跟注的差额，计入平注后的底池)
        this.btnQuickHalfPot.onclick = () => {
            if (toCall <= 0) {
                setVal(Math.round(pot * 0.5));
            } else {
                setVal(highestBet + Math.round((pot + toCall) * 0.5));
            }
        };

        // 满池加注 (Pot)
        this.btnQuickPot.onclick = () => {
            if (toCall <= 0) {
                setVal(pot);
            } else {
                setVal(highestBet + (pot + toCall));
            }
        };

        // 全下 (All-in)
        this.btnQuickAllIn.onclick = () => setVal(maxRaise);
    }

    /**
     * 记录历史动态日志
     */
    addLog(message, type = 'info') {
        if (!this.logContainer) return;
        const item = document.createElement('div');
        item.className = `log-item log-${type}`;

        const now = new Date();
        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

        item.innerHTML = `<span class="log-time">[${timeStr}]</span> ${message}`;
        this.logContainer.appendChild(item);
        this.logContainer.scrollTop = this.logContainer.scrollHeight;
    }

    /**
     * 展示胜者结算弹窗与横幅
     */
    showWinnerBanner(payouts, onNextHand) {
        if (!this.winnerBanner) return;

        let bannerContent = '';
        payouts.forEach(p => {
            const winNames = p.winners.map(w => `<strong class="winner-name">${w.player.name}</strong> (+$${w.winAmount})`).join(', ');
            const handDesc = p.winners[0].hand ? `<div class="winner-hand-desc">🏆 ${p.winners[0].hand.desc}</div>` : '';
            bannerContent += `
                <div class="winner-pot-item">
                    <div class="winner-pot-header">${p.potName}: ${winNames}</div>
                    ${handDesc}
                </div>
            `;
        });

        this.winnerBanner.innerHTML = `
            <div class="banner-content animate-slide-down">
                <div class="trophy-icon">🎉</div>
                <div class="banner-details">${bannerContent}</div>
                <button id="btn-next-hand-banner" class="btn-next-hand">下一局 (Next Hand) <span id="next-countdown">(5)</span></button>
            </div>
        `;
        this.winnerBanner.style.display = 'flex';

        let countdown = 5;
        const countdownEl = document.getElementById('next-countdown');
        const interval = setInterval(() => {
            countdown--;
            if (countdownEl) countdownEl.textContent = `(${countdown})`;
            if (countdown <= 0) {
                clearInterval(interval);
                this.hideWinnerBanner();
                if (onNextHand) onNextHand();
            }
        }, 1000);

        const btnNext = document.getElementById('btn-next-hand-banner');
        if (btnNext) {
            btnNext.onclick = () => {
                clearInterval(interval);
                this.hideWinnerBanner();
                if (onNextHand) onNextHand();
            };
        }
    }

    hideWinnerBanner() {
        if (this.winnerBanner) {
            this.winnerBanner.style.display = 'none';
            this.winnerBanner.innerHTML = '';
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { UIManager };
}
