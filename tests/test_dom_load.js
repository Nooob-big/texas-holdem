/**
 * 验证浏览器环境加载与 DOM 绑定的测试脚本
 */

// 简易模拟 DOM 环境
global.window = {
    addEventListener: () => {}
};
Object.assign(global.window, global);
global.document = {
    getElementById: (id) => ({
        id,
        style: {},
        classList: {
            add: () => {},
            remove: () => {},
            contains: () => false,
            toggle: () => {}
        },
        addEventListener: (event, cb) => {},
        appendChild: () => {},
        setAttribute: () => {},
        innerHTML: '',
        textContent: '',
        disabled: false,
        value: '40',
        min: '20',
        max: '1000',
        dataset: {},
        querySelector: () => null,
        querySelectorAll: () => []
    }),
    createElement: (tag) => ({
        style: {},
        classList: { add: () => {}, remove: () => {} },
        innerHTML: '',
        textContent: ''
    }),
    querySelector: () => null,
    querySelectorAll: () => []
};

// 引入模块
const { Card, Deck, SUIT_NAMES, RANK_STRINGS, SUIT_SYMBOLS } = require('../js/card.js');
global.Card = Card;
global.Deck = Deck;
global.SUIT_NAMES = SUIT_NAMES;
global.RANK_STRINGS = RANK_STRINGS;
global.SUIT_SYMBOLS = SUIT_SYMBOLS;

const { HandEvaluator, HAND_CATEGORIES, CATEGORY_NAMES } = require('../js/evaluator.js');
global.HandEvaluator = HandEvaluator;
global.HAND_CATEGORIES = HAND_CATEGORIES;
global.CATEGORY_NAMES = CATEGORY_NAMES;

const { PotManager } = require('../js/pot.js');
global.PotManager = PotManager;

const { SoundEffects, sounds } = require('../js/audio.js');
global.SoundEffects = SoundEffects;
global.sounds = sounds;

const { AI_PROFILES, AIDecisionEngine } = require('../js/ai.js');
global.AI_PROFILES = AI_PROFILES;
global.AIDecisionEngine = AIDecisionEngine;

const { UIManager } = require('../js/ui.js');
global.UIManager = UIManager;

const { TexasHoldemGame } = require('../js/game.js');

console.log("=== 启动 DOM 与 Game 状态机加载测试 ===");
const testGame = new TexasHoldemGame();
console.log("✅ TexasHoldemGame 实例化成功，玩家数:", testGame.players.length);

testGame.startNewHand();
console.log("✅ 第一局发牌成功，庄家:", testGame.players[testGame.dealerIndex].name);
console.log("  当前阶段:", testGame.currentStreet);
console.log("  玩家0底牌:", testGame.players[0].holeCards.map(c => c.toString()).join(' '));

// 模拟 Hero 弃牌
testGame.handlePlayerAction(testGame.players[0], 'fold');
console.log("✅ Hero 弃牌处理成功，玩家0状态: folded =", testGame.players[0].folded);

console.log("🎉 浏览器逻辑仿真测试完全通过，无任何未捕获错误！");
process.exit(0);
