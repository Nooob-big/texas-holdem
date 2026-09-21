/**
 * 扑克牌与牌堆模块
 * Texas Hold'em Card & Deck Implementation
 */

const SUITS = ['s', 'h', 'd', 'c']; // Spades, Hearts, Diamonds, Clubs
const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]; // 2 to Ace (14)

const SUIT_SYMBOLS = {
    's': '♠',
    'h': '♥',
    'd': '♦',
    'c': '♣'
};

const SUIT_NAMES = {
    's': '黑桃',
    'h': '红桃',
    'd': '方块',
    'c': '草花'
};

const RANK_STRINGS = {
    14: 'A',
    13: 'K',
    12: 'Q',
    11: 'J',
    10: '10',
    9: '9',
    8: '8',
    7: '7',
    6: '6',
    5: '5',
    4: '4',
    3: '3',
    2: '2'
};

class Card {
    constructor(rank, suit) {
        this.rank = rank; // 2 - 14
        this.suit = suit; // 's', 'h', 'd', 'c'
    }

    get rankStr() {
        return RANK_STRINGS[this.rank];
    }

    get suitSymbol() {
        return SUIT_SYMBOLS[this.suit];
    }

    get suitName() {
        return SUIT_NAMES[this.suit];
    }

    get isRed() {
        return this.suit === 'h' || this.suit === 'd';
    }

    // 默认标准花色颜色代码
    get colorClass() {
        switch (this.suit) {
            case 'h': return 'suit-heart';
            case 'd': return 'suit-diamond';
            case 'c': return 'suit-club';
            case 's': return 'suit-spade';
        }
    }

    toString() {
        return `${this.rankStr}${this.suitSymbol}`;
    }

    equals(other) {
        return other && this.rank === other.rank && this.suit === other.suit;
    }
}

class Deck {
    constructor() {
        this.cards = [];
        this.reset();
    }

    reset() {
        this.cards = [];
        for (const suit of SUITS) {
            for (const rank of RANKS) {
                this.cards.push(new Card(rank, suit));
            }
        }
        this.shuffle();
    }

    shuffle() {
        // Fisher-Yates 洗牌算法
        for (let i = this.cards.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
        }
    }

    deal() {
        if (this.cards.length === 0) {
            throw new Error("牌堆已空，无法继续发牌");
        }
        return this.cards.pop();
    }

    get remaining() {
        return this.cards.length;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Card, Deck, SUITS, RANKS, RANK_STRINGS, SUIT_SYMBOLS, SUIT_NAMES };
}
