/**
 * 德州扑克 AI 决策引擎与不同性格对手模块
 * AI Bot Profiles & Texas Hold'em Decision Logic
 */

const _getEvaluator = () => {
    if (typeof HandEvaluator !== 'undefined' && typeof HAND_CATEGORIES !== 'undefined') {
        return { HandEvaluator, HAND_CATEGORIES };
    }
    if (typeof require !== 'undefined') {
        return require('./evaluator.js');
    }
    return { HandEvaluator: null, HAND_CATEGORIES: {} };
};

// 5位具有鲜明个性的 AI 电脑玩家配置
const AI_PROFILES = [
    {
        name: '老张',
        avatar: '🦈',
        title: '紧凶型鲨鱼',
        style: 'TAG',
        vpip: 0.25, // 仅参与优质手牌
        aggression: 0.75, // 偏好下注加注
        bluffFreq: 0.15,
        chat: {
            raise: ['加注！探探各位的底细。', '这手牌面我占优，继续加！', '想看便宜牌？门都没有！'],
            call: ['跟注，看看下一张。', '赔率合适，跟一个。'],
            check: ['先过牌看看。', '我也过。'],
            fold: ['弃牌保平安，不跟了。', '这牌面太湿了，撤退！', '小牌不贪，弃了。'],
            allIn: ['全下！有胆量的就跟过来！', '梭哈，不给你们翻盘的机会！'],
            win: ['收下底池，多谢各位老板！', '算计之内，兵不血刃。', '牌力与位置的胜利。']
        }
    },
    {
        name: '狂热阿飞',
        avatar: '🔥',
        title: '松凶狂人',
        style: 'LAG',
        vpip: 0.65, // 酷爱入池
        aggression: 0.85, // 极高攻击性
        bluffFreq: 0.40, // 频繁诈唬
        chat: {
            raise: ['加注！牌力不重要，气势最重要！', '看你敢不敢跟！加！', '底池太小没意思，造个大池！'],
            call: ['必须跟！谁怂谁输！', '来看看能发什么神仙牌。'],
            check: ['先让你喘口气，过。'],
            fold: ['切，这次算你狠。', '暂避锋芒，下把干翻你！'],
            allIn: ['梭哈！搏一搏，单车变摩托！', '全下！是男人就跟！'],
            win: ['哈哈哈哈！全归我了！', '这就是勇气带来的回报！', '谁还敢不服？']
        }
    },
    {
        name: '老实陈叔',
        avatar: '🐟',
        title: '快乐跟注站',
        style: 'STATION',
        vpip: 0.70, // 喜欢看热闹
        aggression: 0.15, // 极少主动下注加注
        bluffFreq: 0.05,
        chat: {
            raise: ['哎呀这把牌是真的大！我加注了！', '这好牌可不能藏着了，加注！'],
            call: ['不多不多，跟一个看看嘛。', '底池挺诱人，跟跟看。', '来都来了，看一眼转牌。'],
            check: ['过牌过牌，稳妥第一。', '我也敲桌过。'],
            fold: ['下这么大啊？那我不玩了。', '哎，跟不起了，弃牌。'],
            allIn: ['真有大牌了！全下！'],
            win: ['哎呀，居然赢了，运气不错嘛！', '多谢各位承让承让！']
        }
    },
    {
        name: '铁壁李哥',
        avatar: '🗿',
        title: '冷血石佛',
        style: 'ROCK',
        vpip: 0.12, // 超级严格起手牌
        aggression: 0.50,
        bluffFreq: 0.02, // 几乎从不诈唬
        chat: {
            raise: ['坚果在手，加注。', '不可错失的良机。'],
            call: ['符合概率模型，跟注。'],
            check: ['过牌观察。', '过。'],
            fold: ['牌力不够，坚决弃牌。', '纪律是赢牌的第一法则。', '无益的冒险不参与。'],
            allIn: ['已锁定胜局，全下。'],
            win: ['步步为营，水到渠成。', '纪律战胜冲动。']
        }
    },
    {
        name: '智者艾玛',
        avatar: '🦉',
        title: 'GTO大师',
        style: 'GTO',
        vpip: 0.32,
        aggression: 0.60,
        bluffFreq: 0.20,
        chat: {
            raise: ['下注构建极化范围，加注。', '期望值为正，合理抬高底池。', '位置优势利用，加注。'],
            call: ['底池赔率符合数学期望，跟注。', '赔率合理，Call。'],
            check: ['过牌控池。', 'Check。'],
            fold: ['底池赔率不足以支持抽牌，弃牌。', '期望值为负，止损弃牌。'],
            allIn: ['范围全覆盖，最大化EV全下！'],
            win: ['概率长期终将回归均值。', '数学永远不会说谎。']
        }
    }
];

class AIDecisionEngine {
    /**
     * 评估手牌在翻牌前的强度分值 (0 到 100)
     */
    static evaluatePreflopStrength(holeCards) {
        if (!holeCards || holeCards.length < 2) return 0;
        const [c1, c2] = [...holeCards].sort((a, b) => b.rank - a.rank);
        const r1 = c1.rank;
        const r2 = c2.rank;
        const isPair = r1 === r2;
        const isSuited = c1.suit === c2.suit;
        const gap = r1 - r2;

        let score = 0;
        if (isPair) {
            // 对子得分
            score = 50 + r1 * 3.5; // 22: 57, AA: 99
        } else {
            // 高牌与组合
            score = (r1 * 3.2) + (r2 * 2.0);
            if (isSuited) score += 6; // 同花加分
            if (gap === 1) score += 5; // 连张加分
            else if (gap === 2) score += 3; // 隔一张连张
            else if (gap >= 4) score -= 4; // 悬殊散牌扣分
        }

        return Math.min(100, Math.max(0, score));
    }

    /**
     * 估算公共牌阶段的胜率或牌力成色 (0.0 到 1.0)
     */
    static estimatePostflopStrength(holeCards, communityCards) {
        const allCards = [...holeCards, ...communityCards];
        const { HandEvaluator: evaluator, HAND_CATEGORIES: categories } = _getEvaluator();
        const best = evaluator.getBestHand(allCards);

        // 基础牌型价值映射
        const catBaseValues = {
            [categories.ROYAL_FLUSH]: 1.0,
            [categories.STRAIGHT_FLUSH]: 0.98,
            [categories.FOUR_OF_A_KIND]: 0.95,
            [categories.FULL_HOUSE]: 0.88,
            [categories.FLUSH]: 0.78,
            [categories.STRAIGHT]: 0.70,
            [categories.THREE_OF_A_KIND]: 0.60,
            [categories.TWO_PAIR]: 0.48,
            [categories.ONE_PAIR]: 0.32,
            [categories.HIGH_CARD]: 0.12
        };

        let strength = catBaseValues[best.category] || 0.1;

        // 根据点数微调
        if (best.comparisonRanks && best.comparisonRanks[0]) {
            strength += (best.comparisonRanks[0] / 14) * 0.08;
        }

        // 如果在翻牌圈或转牌圈，考虑抽顺/抽花的潜力 (Outs)
        if (communityCards.length < 5) {
            const suitCounts = {};
            for (const c of allCards) {
                suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1;
            }
            // 4张同花 (4-flush draw)
            if (Object.values(suitCounts).some(cnt => cnt === 4)) {
                strength += 0.15; // 抽花有巨大潜力
            }

            // 顺子听牌
            const uniqueRanks = Array.from(new Set(allCards.map(c => c.rank))).sort((a, b) => a - b);
            let consecutive = 1;
            let maxConsecutive = 1;
            for (let i = 1; i < uniqueRanks.length; i++) {
                if (uniqueRanks[i] - uniqueRanks[i - 1] === 1) {
                    consecutive++;
                    if (consecutive > maxConsecutive) maxConsecutive = consecutive;
                } else {
                    consecutive = 1;
                }
            }
            if (maxConsecutive === 4) {
                strength += 0.12; // 两头顺或卡顺听牌
            }
        }

        return Math.min(1.0, strength);
    }

    /**
     * AI 执行行动决策
     * @param {Object} player 当前 AI 玩家
     * @param {Object} gameState 游戏当前状态 (pot, toCall, minRaise, currentStreet, communityCards, bigBlind)
     * @returns {Object} { action: 'fold'|'check'|'call'|'raise'|'allin', amount: number, talk: string }
     */
    static makeDecision(player, gameState) {
        const {
            pot,
            toCall,
            highestRoundBet = 0,
            minRaise,
            currentStreet,
            communityCards,
            bigBlind
        } = gameState;

        const profile = player.profile || AI_PROFILES[0];
        const canCheck = toCall === 0;
        const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;
        const isPreflop = currentStreet === 'PRE_FLOP' || communityCards.length === 0;

        let strength = 0;
        if (isPreflop) {
            const rawScore = this.evaluatePreflopStrength(player.holeCards); // 0 - 100
            strength = rawScore / 100;
        } else {
            strength = this.estimatePostflopStrength(player.holeCards, communityCards); // 0.0 - 1.0
        }

        // 随机因子与性格倾向修正
        const luckFactor = (Math.random() - 0.5) * 0.1;
        const adjustedStrength = Math.max(0, Math.min(1, strength + luckFactor));
        const isBluffing = Math.random() < profile.bluffFreq;

        const pickTalk = (category) => {
            const list = profile.chat[category] || [];
            if (list.length === 0) return '';
            return list[Math.floor(Math.random() * list.length)];
        };

        // 1. 如果可以免费过牌 (Check)
        if (canCheck) {
            // 极强牌或松凶倾向下注
            const betThreshold = profile.style === 'LAG' ? 0.50 : (profile.style === 'TAG' ? 0.65 : 0.80);
            if ((adjustedStrength > betThreshold || isBluffing) && player.chips >= bigBlind) {
                // 主动下注或加注 (如大盲位 Option)
                const currentBet = player.currentRoundBet || 0;
                const minBetTarget = (highestRoundBet > 0) ? (highestRoundBet + minRaise) : bigBlind;
                const maxBetTarget = currentBet + player.chips;

                if (maxBetTarget >= minBetTarget) {
                    const desiredBet = Math.round(pot * (0.5 + Math.random() * 0.5));
                    const betSize = Math.max(minBetTarget, Math.min(maxBetTarget, desiredBet));

                    if (betSize >= maxBetTarget) {
                        return {
                            action: 'allin',
                            amount: maxBetTarget,
                            talk: pickTalk('allIn')
                        };
                    }
                    return {
                        action: 'raise',
                        amount: betSize,
                        talk: pickTalk('raise')
                    };
                }
            }
            return {
                action: 'check',
                amount: 0,
                talk: pickTalk('check')
            };
        }

        // 2. 需要跟注 (Facing a Bet / Raise)
        // 阈值基于性格调整
        let requiredStrength = potOdds * 1.1; // 基础底池赔率门槛

        if (profile.style === 'STATION') {
            requiredStrength *= 0.6; // 跟注站大幅降低门槛
        } else if (profile.style === 'ROCK') {
            requiredStrength *= 1.4; // 石佛极度严格
        } else if (profile.style === 'LAG') {
            requiredStrength *= 0.85;
        }

        // 如果手牌特别强 (> 0.82) 或者松凶选手有诈唬意图，考虑加注
        const wantsToRaise = (adjustedStrength > 0.82 && Math.random() < profile.aggression) ||
            (isBluffing && profile.style === 'LAG' && Math.random() < 0.35);

        if (wantsToRaise && player.chips > toCall) {
            // 加注目标总下注额 (Target total round bet)
            const currentBet = player.currentRoundBet || 0;
            const minRaiseTarget = highestRoundBet + minRaise;
            const maxRaiseTarget = currentBet + player.chips;

            if (maxRaiseTarget >= minRaiseTarget) {
                const desiredRaise = Math.round(highestRoundBet * 2 + pot * 0.4);
                const raiseTarget = Math.max(minRaiseTarget, Math.min(maxRaiseTarget, desiredRaise));

                if (raiseTarget >= maxRaiseTarget) {
                    return {
                        action: 'allin',
                        amount: maxRaiseTarget,
                        talk: pickTalk('allIn')
                    };
                }

                return {
                    action: 'raise',
                    amount: raiseTarget,
                    talk: pickTalk('raise')
                };
            }
        }

        // 满足胜率条件跟注
        if (adjustedStrength >= requiredStrength || (toCall <= bigBlind && profile.style !== 'ROCK')) {
            if (toCall >= player.chips) {
                return {
                    action: 'allin',
                    amount: player.chips,
                    talk: pickTalk('allIn')
                };
            }
            return {
                action: 'call',
                amount: toCall,
                talk: pickTalk('call')
            };
        }

        // 不满足跟注条件，弃牌
        return {
            action: 'fold',
            amount: 0,
            talk: pickTalk('fold')
        };
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AI_PROFILES, AIDecisionEngine };
}
