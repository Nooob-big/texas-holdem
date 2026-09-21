const { Card } = require('../js/card.js');
const { HandEvaluator, HAND_CATEGORIES } = require('../js/evaluator.js');
const { PotManager } = require('../js/pot.js');

function assert(condition, message) {
    if (!condition) {
        console.error("❌ FAILED:", message);
        process.exit(1);
    } else {
        console.log("✅ PASSED:", message);
    }
}

console.log("=== 测试 1: 皇家同花顺 vs 同花顺 ===");
const royalFlush = [
    new Card(14, 's'), new Card(13, 's'), new Card(12, 's'), new Card(11, 's'), new Card(10, 's')
];
const straightFlush = [
    new Card(9, 'h'), new Card(8, 'h'), new Card(7, 'h'), new Card(6, 'h'), new Card(5, 'h')
];
const evalRoyal = HandEvaluator.evaluate5(royalFlush);
const evalSF = HandEvaluator.evaluate5(straightFlush);
assert(evalRoyal.category === HAND_CATEGORIES.ROYAL_FLUSH, "Royal flush category");
assert(evalSF.category === HAND_CATEGORIES.STRAIGHT_FLUSH, "Straight flush category");
assert(evalRoyal.score > evalSF.score, "Royal flush beats straight flush");

console.log("\n=== 测试 2: 特殊轮转顺子 (A-2-3-4-5) vs 6高顺子 ===");
const wheelStraight = [
    new Card(14, 's'), new Card(2, 'h'), new Card(3, 'd'), new Card(4, 'c'), new Card(5, 's')
];
const sixHighStraight = [
    new Card(6, 's'), new Card(5, 'h'), new Card(4, 'd'), new Card(3, 'c'), new Card(2, 's')
];
const evalWheel = HandEvaluator.evaluate5(wheelStraight);
const evalSix = HandEvaluator.evaluate5(sixHighStraight);
assert(evalWheel.category === HAND_CATEGORIES.STRAIGHT, "Wheel is straight");
assert(evalSix.category === HAND_CATEGORIES.STRAIGHT, "Six high is straight");
assert(evalSix.score > evalWheel.score, "6-high straight beats 5-high wheel");

console.log("\n=== 测试 3: 两对相同比踢脚 ===");
const twoPairA = [
    new Card(14, 's'), new Card(14, 'h'), new Card(10, 'd'), new Card(10, 'c'), new Card(13, 's') // A A 10 10 K
];
const twoPairB = [
    new Card(14, 'd'), new Card(14, 'c'), new Card(10, 's'), new Card(10, 'h'), new Card(12, 's') // A A 10 10 Q
];
const evalTPA = HandEvaluator.evaluate5(twoPairA);
const evalTPB = HandEvaluator.evaluate5(twoPairB);
assert(evalTPA.score > evalTPB.score, "AA1010K beats AA1010Q");

console.log("\n=== 测试 4: 7选5 最佳手牌选取 ===");
// 7张牌包含 四条A + 顺子，应该选出四条A
const sevenCards = [
    new Card(14, 's'), new Card(14, 'h'), new Card(14, 'd'), new Card(14, 'c'), // 4 A's
    new Card(13, 's'), new Card(12, 'd'), new Card(11, 'c')
];
const bestHand = HandEvaluator.getBestHand(sevenCards);
assert(bestHand.category === HAND_CATEGORIES.FOUR_OF_A_KIND, "Best hand from 7 is four of a kind");
assert(bestHand.comparisonRanks[0] === 14, "Four rank is A");
assert(bestHand.comparisonRanks[1] === 13, "Kicker is K");

console.log("\n=== 测试 5: 主池与边池计算 ===");
const potMgr = new PotManager();
// Player 1: 100 All-in
// Player 2: 300 All-in
// Player 3: 500 Call
// Player 4: 200 Folded
const mockPlayers = [
    { id: 1, totalHandBet: 100, folded: false, chips: 0 },
    { id: 2, totalHandBet: 300, folded: false, chips: 0 },
    { id: 3, totalHandBet: 500, folded: false, chips: 0 },
    { id: 4, totalHandBet: 200, folded: true, chips: 0 }
];
const pots = potMgr.calculatePots(mockPlayers);
console.log("Pots generated:", JSON.stringify(pots, null, 2));
assert(pots.length >= 2, "Has multiple pots");
// Main pot: 100 * 4 = 400 (eligible: 1, 2, 3)
assert(pots[0].amount === 400, "Main pot amount is 400");
assert(pots[0].eligiblePlayerIds.includes(1) && pots[0].eligiblePlayerIds.includes(2) && pots[0].eligiblePlayerIds.includes(3), "Main pot eligibles");
// Side pot 1: 200 from P2 + 200 from P3 + 100 from P4 = 500 (eligible: 2, 3)
assert(pots[1].amount === 500, "Side pot 1 amount is 500");
assert(pots[1].eligiblePlayerIds.includes(2) && pots[1].eligiblePlayerIds.includes(3) && !pots[1].eligiblePlayerIds.includes(1), "Side pot 1 eligibles");

console.log("\n🎉 ALL TESTS PASSED!");
