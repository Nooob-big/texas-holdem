/**
 * 底池与多级边池管理模块
 * Texas Hold'em Main & Side Pot Manager
 */

class PotManager {
    constructor() {
        this.reset();
    }

    reset() {
        this.pots = []; // [ { amount, eligiblePlayerIds: [] } ]
    }

    /**
     * 根据所有玩家在整手牌中投入的总筹码 (totalHandBet) 计算主池与各个边池
     * @param {Array} players 所有参与玩家对象列表
     * @returns {Array} 计算出的所有有效底池 [{ amount, eligiblePlayerIds, name }]
     */
    calculatePots(players) {
        // 筛选出投入了筹码的玩家
        const investors = players.filter(p => (p.totalHandBet || 0) > 0);
        if (investors.length === 0) {
            return [];
        }

        // 收集所有 All-in 玩家的投资额，以及其他活跃玩家的投资额，去重排序
        const investmentLevels = Array.from(
            new Set(investors.map(p => p.totalHandBet))
        ).sort((a, b) => a - b);

        const calculatedPots = [];
        let prevLevel = 0;

        for (let i = 0; i < investmentLevels.length; i++) {
            const currentLevel = investmentLevels[i];
            const levelDifference = currentLevel - prevLevel;
            if (levelDifference <= 0) continue;

            let potAmount = 0;
            const eligiblePlayers = [];

            for (const p of investors) {
                if (p.totalHandBet > prevLevel) {
                    const contribution = Math.min(p.totalHandBet - prevLevel, levelDifference);
                    potAmount += contribution;

                    // 只有未弃牌的玩家才有资格赢得底池
                    if (!p.folded && p.totalHandBet >= currentLevel) {
                        eligiblePlayers.push(p.id);
                    }
                }
            }

            if (potAmount > 0) {
                // 如果该池只有 1 个符合资格的人，且其他人都已上限（无法争夺），这部分属于未被跟注的筹码或多余注额
                calculatedPots.push({
                    amount: potAmount,
                    eligiblePlayerIds: eligiblePlayers,
                    name: calculatedPots.length === 0 ? '主池 (Main Pot)' : `边池 ${calculatedPots.length} (Side Pot)`
                });
            }

            prevLevel = currentLevel;
        }

        // 合并连续具有完全相同符合资格名单的边池（简化展示）
        const mergedPots = [];
        for (const pot of calculatedPots) {
            if (pot.eligiblePlayerIds.length === 0) {
                // 如果没有合规赢家（例如全弃牌异常情况），筹码归入上一个有效底池
                if (mergedPots.length > 0) {
                    mergedPots[mergedPots.length - 1].amount += pot.amount;
                }
                continue;
            }

            if (mergedPots.length > 0) {
                const prev = mergedPots[mergedPots.length - 1];
                const sameEligible = prev.eligiblePlayerIds.length === pot.eligiblePlayerIds.length &&
                    prev.eligiblePlayerIds.every(id => pot.eligiblePlayerIds.includes(id));
                
                if (sameEligible) {
                    prev.amount += pot.amount;
                    continue;
                }
            }

            mergedPots.push(pot);
        }

        // 重新规范底池名称
        mergedPots.forEach((p, idx) => {
            p.name = idx === 0 ? '主池 (Main Pot)' : `边池 ${idx} (Side Pot ${idx})`;
        });

        this.pots = mergedPots;
        return this.pots;
    }

    /**
     * 获取当前所有底池总金额
     */
    getTotalAmount(players) {
        if (!players) return 0;
        return players.reduce((sum, p) => sum + (p.totalHandBet || 0), 0);
    }

    /**
     * 结算所有底池并分发给赢家
     * @param {Array} pots calculatePots 返回的底池数组
     * @param {Map|Object} playerHands 包含各玩家最好手牌评估结果的映射 { playerId: evaluatedHand }
     * @param {Array} activePlayers 当前仍未弃牌的玩家
     * @returns {Array} 派彩明细列表 [ { potIndex, amount, winners: [ { player, winAmount, hand } ] } ]
     */
    distributePots(pots, playerHands, players) {
        const payouts = [];

        for (let i = 0; i < pots.length; i++) {
            const pot = pots[i];
            // 从符合资格的玩家中筛选出赢家
            const eligiblePlayers = players.filter(p => pot.eligiblePlayerIds.includes(p.id) && !p.folded);

            if (eligiblePlayers.length === 0) {
                // 极端情况：无未弃牌人（理论上不会发生，最后一人在未摊牌前就收池）
                continue;
            }

            if (eligiblePlayers.length === 1) {
                // 仅一人有资格（例如退还未跟注或独赢）
                const winner = eligiblePlayers[0];
                winner.chips += pot.amount;
                payouts.push({
                    potName: pot.name,
                    amount: pot.amount,
                    winners: [{
                        player: winner,
                        winAmount: pot.amount,
                        hand: playerHands[winner.id] || null
                    }]
                });
                continue;
            }

            // 比较牌力，找出最高得分
            let bestScore = -1;
            for (const p of eligiblePlayers) {
                const hand = playerHands[p.id];
                if (hand && hand.score > bestScore) {
                    bestScore = hand.score;
                }
            }

            const potWinners = eligiblePlayers.filter(p => {
                const hand = playerHands[p.id];
                return hand && hand.score === bestScore;
            });

            // 平分底池筹码
            const share = Math.floor(pot.amount / potWinners.length);
            let remainder = pot.amount % potWinners.length;

            const winnerDetails = [];
            for (const winner of potWinners) {
                let winAmt = share;
                if (remainder > 0) {
                    winAmt += 1; // 零头筹码分给顺位靠前的玩家
                    remainder--;
                }
                winner.chips += winAmt;
                winnerDetails.push({
                    player: winner,
                    winAmount: winAmt,
                    hand: playerHands[winner.id]
                });
            }

            payouts.push({
                potName: pot.name,
                amount: pot.amount,
                winners: winnerDetails
            });
        }

        return payouts;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PotManager };
}
