/**
 * 德州扑克手牌评估器与牌型比对模块
 * Hand Evaluator & 7-Card Combination Best Hand Selector
 */

if (typeof require !== 'undefined') {
    const _card = require('./card.js');
    if (typeof globalThis.SUIT_NAMES === 'undefined') globalThis.SUIT_NAMES = _card.SUIT_NAMES;
    if (typeof globalThis.RANK_STRINGS === 'undefined') globalThis.RANK_STRINGS = _card.RANK_STRINGS;
}

const HAND_CATEGORIES = {
    ROYAL_FLUSH: 9,
    STRAIGHT_FLUSH: 8,
    FOUR_OF_A_KIND: 7,
    FULL_HOUSE: 6,
    FLUSH: 5,
    STRAIGHT: 4,
    THREE_OF_A_KIND: 3,
    TWO_PAIR: 2,
    ONE_PAIR: 1,
    HIGH_CARD: 0
};

const CATEGORY_NAMES = {
    9: '皇家同花顺',
    8: '同花顺',
    7: '四条',
    6: '葫芦',
    5: '同花',
    4: '顺子',
    3: '三条',
    2: '两对',
    1: '一对',
    0: '高牌'
};

class HandEvaluator {
    /**
     * 评估正好 5 张牌的牌型及强度评分
     * @param {Card[]} fiveCards 5张牌
     * @returns {Object} 评估结果对象
     */
    static evaluate5(fiveCards) {
        if (!fiveCards || fiveCards.length !== 5) {
            throw new Error("必须传入正好 5 张牌进行评估");
        }

        // 按点数降序排序
        const sorted = [...fiveCards].sort((a, b) => b.rank - a.rank);

        // 统计花色
        const suitCounts = {};
        for (const card of sorted) {
            suitCounts[card.suit] = (suitCounts[card.suit] || 0) + 1;
        }
        const isFlush = Object.values(suitCounts).some(count => count === 5);
        const flushSuit = isFlush ? Object.keys(suitCounts).find(s => suitCounts[s] === 5) : null;

        // 统计点数频次
        const rankCounts = {};
        for (const card of sorted) {
            rankCounts[card.rank] = (rankCounts[card.rank] || 0) + 1;
        }

        // 检查顺子
        const ranks = sorted.map(c => c.rank);
        let isStraight = false;
        let straightHighRank = 0;
        let straightRanks = [];

        // 普通顺子 (如 10, 9, 8, 7, 6)
        if (
            ranks[0] - ranks[1] === 1 &&
            ranks[1] - ranks[2] === 1 &&
            ranks[2] - ranks[3] === 1 &&
            ranks[3] - ranks[4] === 1
        ) {
            isStraight = true;
            straightHighRank = ranks[0];
            straightRanks = [...ranks];
        }
        // 特殊轮转顺子 A-2-3-4-5 (A 作为 1)
        else if (
            ranks[0] === 14 &&
            ranks[1] === 5 &&
            ranks[2] === 4 &&
            ranks[3] === 3 &&
            ranks[4] === 2
        ) {
            isStraight = true;
            straightHighRank = 5; // 5 为最高
            straightRanks = [5, 4, 3, 2, 1];
        }

        // 1. 同花顺与皇家同花顺
        if (isFlush && isStraight) {
            if (straightHighRank === 14) {
                return this._buildResult(
                    HAND_CATEGORIES.ROYAL_FLUSH,
                    [14, 13, 12, 11, 10],
                    sorted,
                    `皇家同花顺 (${SUIT_NAMES[flushSuit]})`
                );
            } else {
                return this._buildResult(
                    HAND_CATEGORIES.STRAIGHT_FLUSH,
                    straightRanks,
                    sorted,
                    `同花顺 (${RANK_STRINGS[straightHighRank]}高, ${SUIT_NAMES[flushSuit]})`
                );
            }
        }

        // 按频次降序，频次相同时按点数降序分组
        // 比如 [ [rank, count], ... ]
        const groups = Object.entries(rankCounts)
            .map(([r, count]) => ({ rank: parseInt(r, 10), count }))
            .sort((a, b) => b.count - a.count || b.rank - a.rank);

        // 2. 四条 (Four of a Kind)
        if (groups[0].count === 4) {
            const fourRank = groups[0].rank;
            const kicker = groups[1].rank;
            return this._buildResult(
                HAND_CATEGORIES.FOUR_OF_A_KIND,
                [fourRank, kicker, 0, 0, 0],
                sorted,
                `四条 (${RANK_STRINGS[fourRank]}, 踢脚 ${RANK_STRINGS[kicker]})`
            );
        }

        // 3. 葫芦 (Full House)
        if (groups[0].count === 3 && groups[1].count === 2) {
            const threeRank = groups[0].rank;
            const pairRank = groups[1].rank;
            return this._buildResult(
                HAND_CATEGORIES.FULL_HOUSE,
                [threeRank, pairRank, 0, 0, 0],
                sorted,
                `葫芦 (${RANK_STRINGS[threeRank]}满${RANK_STRINGS[pairRank]})`
            );
        }

        // 4. 同花 (Flush)
        if (isFlush) {
            return this._buildResult(
                HAND_CATEGORIES.FLUSH,
                ranks,
                sorted,
                `同花 (${RANK_STRINGS[ranks[0]]}高, ${SUIT_NAMES[flushSuit]})`
            );
        }

        // 5. 顺子 (Straight)
        if (isStraight) {
            return this._buildResult(
                HAND_CATEGORIES.STRAIGHT,
                straightRanks,
                sorted,
                `顺子 (${RANK_STRINGS[straightHighRank]}高)`
            );
        }

        // 6. 三条 (Three of a Kind)
        if (groups[0].count === 3) {
            const threeRank = groups[0].rank;
            const kickers = [groups[1].rank, groups[2].rank].sort((a, b) => b - a);
            return this._buildResult(
                HAND_CATEGORIES.THREE_OF_A_KIND,
                [threeRank, kickers[0], kickers[1], 0, 0],
                sorted,
                `三条 (${RANK_STRINGS[threeRank]}, 踢脚 ${RANK_STRINGS[kickers[0]]})`
            );
        }

        // 7. 两对 (Two Pair)
        if (groups[0].count === 2 && groups[1].count === 2) {
            const highPair = Math.max(groups[0].rank, groups[1].rank);
            const lowPair = Math.min(groups[0].rank, groups[1].rank);
            const kicker = groups[2].rank;
            return this._buildResult(
                HAND_CATEGORIES.TWO_PAIR,
                [highPair, lowPair, kicker, 0, 0],
                sorted,
                `两对 (${RANK_STRINGS[highPair]}和${RANK_STRINGS[lowPair]}, 踢脚 ${RANK_STRINGS[kicker]})`
            );
        }

        // 8. 一对 (One Pair)
        if (groups[0].count === 2) {
            const pairRank = groups[0].rank;
            const kickers = [groups[1].rank, groups[2].rank, groups[3].rank].sort((a, b) => b - a);
            return this._buildResult(
                HAND_CATEGORIES.ONE_PAIR,
                [pairRank, kickers[0], kickers[1], kickers[2], 0],
                sorted,
                `一对 (${RANK_STRINGS[pairRank]}, 踢脚 ${RANK_STRINGS[kickers[0]]})`
            );
        }

        // 9. 高牌 (High Card)
        return this._buildResult(
            HAND_CATEGORIES.HIGH_CARD,
            ranks,
            sorted,
            `高牌 (${RANK_STRINGS[ranks[0]]}高)`
        );
    }

    /**
     * 生成 32 位唯一可比整数评分
     */
    static _buildResult(category, comparisonRanks, cards, desc) {
        // 保证 comparisonRanks 有 5 个元素
        const r = [...comparisonRanks];
        while (r.length < 5) r.push(0);

        // score = (category << 20) | (r0 << 16) | (r1 << 12) | (r2 << 8) | (r3 << 4) | r4
        const score = (category << 20) | (r[0] << 16) | (r[1] << 12) | (r[2] << 8) | (r[3] << 4) | r[4];

        return {
            category,
            categoryName: CATEGORY_NAMES[category],
            comparisonRanks: r,
            score,
            cards,
            desc
        };
    }

    /**
     * 7选5评估最佳手牌
     * @param {Card[]} cards 5-7 张牌 (通常为2张手牌 + 3~5张公共牌)
     */
    static getBestHand(cards) {
        if (!cards || cards.length < 5) {
            // 如果不足5张牌（如翻牌前仅手牌），提供基础起手牌简述
            return this.describeIncompleteHand(cards);
        }

        if (cards.length === 5) {
            return this.evaluate5(cards);
        }

        // 获取所有 5 张牌的组合 (6选5为6种，7选5为21种)
        const combinations = this.getCombinations(cards, 5);
        let bestHand = null;

        for (const combo of combinations) {
            const evaluated = this.evaluate5(combo);
            if (!bestHand || evaluated.score > bestHand.score) {
                bestHand = evaluated;
            }
        }

        return bestHand;
    }

    /**
     * 辅助函数：求数组的 k 组合
     */
    static getCombinations(array, k) {
        const result = [];
        function helper(start, combo) {
            if (combo.length === k) {
                result.push([...combo]);
                return;
            }
            for (let i = start; i < array.length; i++) {
                combo.push(array[i]);
                helper(i + 1, combo);
                combo.pop();
            }
        }
        helper(0, []);
        return result;
    }

    /**
     * 描述不足 5 张时的手牌状态（如翻牌前两张底牌）
     */
    static describeIncompleteHand(cards) {
        if (!cards || cards.length === 0) return { desc: '无牌', category: -1 };
        if (cards.length === 1) return { desc: `${cards[0].rankStr}高牌`, category: 0 };
        if (cards.length === 2) {
            const [c1, c2] = [...cards].sort((a, b) => b.rank - a.rank);
            if (c1.rank === c2.rank) {
                return {
                    desc: `口袋对 ${c1.rankStr}`,
                    category: HAND_CATEGORIES.ONE_PAIR,
                    score: (1 << 20) | (c1.rank << 16) | (c2.rank << 12)
                };
            }
            const isSuited = c1.suit === c2.suit;
            const diff = Math.abs(c1.rank - c2.rank);
            const suitedStr = isSuited ? '同花' : '不同花';
            let connStr = '';
            if (diff === 1) connStr = '连张';
            else if (diff === 2) connStr = '跳连';
            
            return {
                desc: `${c1.rankStr}${c2.rankStr} ${suitedStr}${connStr ? ' ' + connStr : ''}`,
                category: HAND_CATEGORIES.HIGH_CARD,
                score: (0 << 20) | (c1.rank << 16) | (c2.rank << 12)
            };
        }
        return { desc: '多张手牌', category: 0 };
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { HandEvaluator, HAND_CATEGORIES, CATEGORY_NAMES };
}
