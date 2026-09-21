/**
 * 完整模拟多局德州扑克流程的自动化脚本
 */
const { Card, Deck } = require('../js/card.js');
const { HandEvaluator, HAND_CATEGORIES } = require('../js/evaluator.js');
const { PotManager } = require('../js/pot.js');
const { AI_PROFILES, AIDecisionEngine } = require('../js/ai.js');

console.log("=== 启动德州扑克多轮模拟对局 ===");

const potManager = new PotManager();
let totalHandsSimulated = 50;
let successCount = 0;

for (let h = 1; h <= totalHandsSimulated; h++) {
    const deck = new Deck();
    const players = [
        { id: 0, name: 'Hero', isHuman: true, chips: 1000, holeCards: [], currentRoundBet: 0, totalHandBet: 0, folded: false, allIn: false },
        ...AI_PROFILES.map((p, idx) => ({
            id: idx + 1,
            name: p.name,
            profile: p,
            isHuman: false,
            chips: 1000,
            holeCards: [],
            currentRoundBet: 0,
            totalHandBet: 0,
            folded: false,
            allIn: false
        }))
    ];

    // 发底牌
    for (let i = 0; i < 2; i++) {
        for (const p of players) {
            p.holeCards.push(deck.deal());
        }
    }

    // 盲注
    players[1].chips -= 10;
    players[1].totalHandBet = 10;
    players[2].chips -= 20;
    players[2].totalHandBet = 20;

    // 模拟大家行动投入
    for (const p of players) {
        if (p.id !== 1 && p.id !== 2) {
            const bet = Math.floor(Math.random() * 8) * 20;
            if (bet === 0) {
                p.folded = true;
            } else {
                p.chips -= bet;
                p.totalHandBet = bet;
            }
        }
    }

    // 发5张公共牌
    const community = [deck.deal(), deck.deal(), deck.deal(), deck.deal(), deck.deal()];

    // 评估手牌
    const hands = {};
    for (const p of players) {
        if (!p.folded) {
            hands[p.id] = HandEvaluator.getBestHand([...p.holeCards, ...community]);
            if (!hands[p.id] || typeof hands[p.id].score !== 'number') {
                throw new Error(`手牌评估失败: Player ${p.name}`);
            }
        }
    }

    // 计算底池与派彩
    const pots = potManager.calculatePots(players);
    const payouts = potManager.distributePots(pots, hands, players);

    // 验证派彩总金额等于总投入
    const totalInvested = players.reduce((s, p) => s + p.totalHandBet, 0);
    const totalWon = payouts.reduce((s, pot) => s + pot.winners.reduce((ws, w) => ws + w.winAmount, 0), 0);

    if (totalInvested !== totalWon) {
        throw new Error(`筹码不守恒! 投入: ${totalInvested}, 派发: ${totalWon}`);
    }

    successCount++;
}

console.log(`✅ 成功通过 ${successCount}/${totalHandsSimulated} 手完整扑克对局模拟！筹码守恒率 100%！`);
