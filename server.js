const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

// ลำดับความใหญ่ของไพ่ (CARD_RANKS)
const CARD_RANKS = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, 
    '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14
};

// ดอกไพ่
const SUITS = ['Spades', 'Hearts', 'Diamonds', 'Clubs'];
const VALUES = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];

// จัดเก็บข้อมูลห้องเกมทั้งหมด
const rooms = {};

// ------------------------------------------------------------------
// ฟังก์ชันช่วยเหลือสำหรับสร้างและจัดการสำรับไพ่
// ------------------------------------------------------------------
function createDeck() {
    let deck = [];
    for (let suit of SUITS) {
        for (let value of VALUES) {
            deck.push({ suit, value });
        }
    }
    return deck;
}

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// ------------------------------------------------------------------
// ฟังก์ชัน AI อัจฉริยะ (Smart AI Logic)
// ------------------------------------------------------------------
function getSmartAICardIndex(room, seatIndex) {
    let hand = room.hands[seatIndex];
    let playedCount = room.currentRoundCards.filter(c => c !== null).length;
    let turnOrder = playedCount + 1; // ลำดับการออกไพ่ในรอบนี้ (1, 2, 3, 4)
    
    // ดึงข้อมูลการจับคู่ทีม (ทีม A: 0, 2 | ทีม B: 1, 3)
    let myTeam = (seatIndex === 0 || seatIndex === 2) ? [0, 2] : [1, 3];
    let oppTeam = (seatIndex === 0 || seatIndex === 2) ? [1, 3] : [0, 2];
    let partnerSeat = (seatIndex + 2) % 4;
    let isPartnerDealer = myTeam.includes(room.dealer);
    let isOppDealer = oppTeam.includes(room.dealer);

    // กรองไพ่ตามกฎการบังคับออกตามดอกไพ่คนแรก (Follow Suit)
    let validIndices = [];
    if (playedCount > 0) {
        let leadCard = room.currentRoundCards[room.starterPlayer];
        hand.forEach((c, idx) => {
            if (c.suit === leadCard.suit) validIndices.push(idx);
        });
    }
    // หากไม่มีไพ่ดอกเดียวกับคนแรก สามารถใช้ออกไพ่ใบไหนก็ได้ในมือ
    if (validIndices.length === 0) {
        validIndices = hand.map((_, idx) => idx);
    }

    // ประเมินพลังของไพ่ (บวกคะแนนเพิ่มหากเป็นไพ่ดอกหลัก/Trump)
    const getCardPower = (card) => {
        let baseRank = CARD_RANKS[card.value];
        if (card.suit === room.trumpSuit) {
            return baseRank + 100; // ไพ่ดอกหลักจะชนะไพ่ดอกธรรมดาเสมอ
        }
        return baseRank;
    };

    // เช็กว่าเป็นไพ่ใหญ่ที่สุดในดอกนั้นที่ยังเหลืออยู่หรือไม่ (Card Counting)
    const isHighestRemaining = (card) => {
        let rank = CARD_RANKS[card.value];
        const allRanks = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
        for (let r of allRanks) {
            if (CARD_RANKS[r] > rank) {
                let higherPlayed = room.playedHistory.some(c => c.suit === card.suit && c.value === r);
                if (!higherPlayed) return false; // มีไพ่ที่ใหญ่กว่ายังไม่ออก
            } else {
                break;
            }
        }
        return true;
    };

    let validCards = validIndices.map(idx => ({ card: hand[idx], idx }));

    // ==========================================
    // Turn 1: บอทได้ออกไพ่คนแรก
    // ==========================================
    if (turnOrder === 1) {
        let aceCard = validCards.find(item => item.card.value === 'A');
        
        // 1.1 ถ้าเพื่อนร่วมทีมเป็นเจ้ามือ
        if (isPartnerDealer) {
            if (aceCard) return aceCard.idx;
            
            let opt1 = validCards.filter(item => item.card.suit === room.trumpSuit && !['10', '5'].includes(item.card.value));
            let opt2 = validCards.filter(item => item.card.suit !== room.trumpSuit && !['10', '5'].includes(item.card.value));

            let choice = (Math.random() > 0.5 && opt1.length > 0) ? 1 : 2;
            if (choice === 1 && opt1.length > 0) {
                opt1.sort((a, b) => CARD_RANKS[a.card.value] - CARD_RANKS[b.card.value]);
                return opt1[0].idx; // ทิ้งไพ่เล็กดอกหลัก
            }
            if (opt2.length > 0) {
                opt2.sort((a, b) => CARD_RANKS[b.card.value] - CARD_RANKS[a.card.value]);
                return opt2[0].idx; // ทิ้งไพ่ใหญ่สุดที่ไม่ใช่ดอกหลัก
            }
        }

        // 1.2 ถ้าทีมตรงข้ามเป็นเจ้ามือ
        if (isOppDealer) {
            if (aceCard) return aceCard.idx;
            
            let safeCards = validCards.filter(item => 
                !['10', '5'].includes(item.card.value) && 
                (!room.voidSuits || !room.voidSuits[room.dealer] || !room.voidSuits[room.dealer].includes(item.card.suit))
            );
            
            if (safeCards.length > 0) {
                safeCards.sort((a, b) => getCardPower(b.card) - getCardPower(a.card));
                return safeCards[0].idx;
            }
        }
    }

    // ==========================================
    // Turn 2: บอทได้ออกไพ่คนที่ 2
    // ==========================================
    if (turnOrder === 2) {
        let firstCard = room.currentRoundCards[room.starterPlayer];
        let firstPower = getCardPower(firstCard);

        let biggerCardsNoPoints = validCards.filter(item => 
            getCardPower(item.card) > firstPower && !['10', '5'].includes(item.card.value)
        );
        if (biggerCardsNoPoints.length > 0) {
            biggerCardsNoPoints.sort((a, b) => getCardPower(a.card) - getCardPower(b.card));
            return biggerCardsNoPoints[0].idx;
        }

        let biggerCardsPoints = validCards.filter(item => getCardPower(item.card) > firstPower);
        if (biggerCardsPoints.length > 0) {
            biggerCardsPoints.sort((a, b) => getCardPower(a.card) - getCardPower(b.card));
            return biggerCardsPoints[0].idx;
        }

        let noPointCards = validCards.filter(item => !['10', '5'].includes(item.card.value));
        if (noPointCards.length > 0) {
            noPointCards.sort((a, b) => getCardPower(a.card) - getCardPower(b.card));
            return noPointCards[0].idx;
        }
    }

    // ==========================================
    // Turn 3: บอทได้ออกไพ่คนที่ 3
    // ==========================================
    if (turnOrder === 3) {
        let firstCard = room.currentRoundCards[room.starterPlayer];
        let secondCard = room.currentRoundCards[(room.starterPlayer + 1) % 4];
        let leadSuit = firstCard.suit;

        let firstIsWinner = getCardPower(firstCard) > getCardPower(secondCard);
        let firstIsHighest = isHighestRemaining(firstCard);

        let hasLeadSuit = hand.some(c => c.suit === leadSuit);
        if (!hasLeadSuit) {
            if (secondCard.suit === room.trumpSuit && firstCard.suit !== room.trumpSuit) {
                let trumpBigger = validCards.filter(item => 
                    item.card.suit === room.trumpSuit && getCardPower(item.card) > getCardPower(secondCard)
                );
                if (trumpBigger.length > 0) {
                    trumpBigger.sort((a, b) => getCardPower(a.card) - getCardPower(b.card));
                    return trumpBigger[0].idx;
                } else {
                    let otherMin = validCards.filter(item => item.card.suit !== room.trumpSuit);
                    if (otherMin.length > 0) {
                        otherMin.sort((a, b) => getCardPower(a.card) - getCardPower(b.card));
                        return otherMin[0].idx;
                    }
                }
            }
        }

        if (firstIsWinner && firstIsHighest) {
            let pointCards = validCards.filter(item => ['10', '5'].includes(item.card.value));
            if (pointCards.length > 0) return pointCards[0].idx;
        } else {
            let maxCard = validCards.reduce((prev, curr) => 
                getCardPower(curr.card) > getCardPower(prev.card) ? curr : prev
            );
            if (getCardPower(maxCard.card) > getCardPower(firstCard) && getCardPower(maxCard.card) > getCardPower(secondCard)) {
                return maxCard.idx;
            }
        }

        let smallCards = validCards.filter(item => !['10', '5'].includes(item.card.value));
        if (smallCards.length > 0) {
            smallCards.sort((a, b) => getCardPower(a.card) - getCardPower(b.card));
            return smallCards[0].idx;
        }
    }

    // ==========================================
    // Turn 4: บอทได้ออกไพ่คนที่ 4
    // ==========================================
    if (turnOrder === 4) {
        let seat1 = room.starterPlayer;
        let seat2 = (room.starterPlayer + 1) % 4;
        let seat3 = (room.starterPlayer + 2) % 4;

        let card1 = room.currentRoundCards[seat1];
        let card2 = room.currentRoundCards[seat2];
        let card3 = room.currentRoundCards[seat3];

        let p2Power = getCardPower(card2);
        let p2IsWinner = p2Power > getCardPower(card1) && p2Power > getCardPower(card3);

        if (p2IsWinner || isHighestRemaining(card2)) {
            let pointCards = validCards.filter(item => ['10', '5'].includes(item.card.value));
            if (pointCards.length > 0) return pointCards[0].idx;
        } else {
            let maxCard = validCards.reduce((prev, curr) => 
                getCardPower(curr.card) > getCardPower(prev.card) ? curr : prev
            );
            if (getCardPower(maxCard.card) > getCardPower(card1) && 
                getCardPower(maxCard.card) > getCardPower(card2) && 
                getCardPower(maxCard.card) > getCardPower(card3)) {
                return maxCard.idx;
            }
        }

        let smallCards = validCards.filter(item => !['10', '5'].includes(item.card.value));
        if (smallCards.length > 0) {
            smallCards.sort((a, b) => getCardPower(a.card) - getCardPower(b.card));
            return smallCards[0].idx;
        }
    }

    // Fallback
    let fallbackCards = validCards.filter(item => !['10', '5'].includes(item.card.value));
    return (fallbackCards.length > 0) ? fallbackCards[0].idx : validCards[0].idx;
}

// ------------------------------------------------------------------
// ฟังก์ชันจัดการตรรกะเกม (Game Engine)
// ------------------------------------------------------------------
function playCard(roomId, seatIndex, cardIndex) {
    let room = rooms[roomId];
    if (!room || room.turn !== seatIndex) return;

    let playedCard = room.hands[seatIndex].splice(cardIndex, 1)[0];
    room.currentRoundCards[seatIndex] = playedCard;
    room.playedHistory.push(playedCard);

    // บันทึกดอกไพ่ที่หมดมือ (Void Suit Track)
    if (room.currentRoundCards.filter(c => c !== null).length > 1) {
        let leadSuit = room.currentRoundCards[room.starterPlayer].suit;
        if (playedCard.suit !== leadSuit) {
            if (!room.voidSuits[seatIndex].includes(leadSuit)) {
                room.voidSuits[seatIndex].push(leadSuit);
            }
        }
    }

    // ตรวจสอบว่าครบรอบ 4 คนหรือยัง
    let playedCount = room.currentRoundCards.filter(c => c !== null).length;
    if (playedCount === 4) {
        // ประมวลผลผู้ชนะในรอบนั้น
        setTimeout(() => resolveRound(roomId), 1500);
    } else {
        // เปลี่ยนตาผู้เล่นถัดไป
        room.turn = (room.turn + 1) % 4;
        io.to(roomId).emit('updateState', getPublicGameState(room));
        checkNextTurn(roomId);
    }
}

function resolveRound(roomId) {
    let room = rooms[roomId];
    if (!room) return;

    let leadSuit = room.currentRoundCards[room.starterPlayer].suit;
    let winningSeat = room.starterPlayer;
    let maxPower = -1;

    for (let i = 0; i < 4; i++) {
        let card = room.currentRoundCards[i];
        let power = CARD_RANKS[card.value];

        if (card.suit === room.trumpSuit) {
            power += 100;
        } else if (card.suit !== leadSuit) {
            power = 0; // ไพ่ผิดดอกที่ไม่ใช่ไพ่หลักจะไม่มีพลัง
        }

        if (power > maxPower) {
            maxPower = power;
            winningSeat = i;
        }
    }

    // คำนวณคะแนนในตานี้ (10 = 10 แต้ม, 5 = 5 แต้ม)
    let roundPoints = 0;
    room.currentRoundCards.forEach(card => {
        if (card.value === '10') roundPoints += 10;
        if (card.value === '5') roundPoints += 5;
    });

    // บวกคะแนนให้ทีมผู้ชนะ (ทีม 0,2 หรือ 1,3)
    let winningTeam = (winningSeat === 0 || winningSeat === 2) ? 'TeamA' : 'TeamB';
    room.scores[winningTeam] += roundPoints;

    // เคลียร์ไพ่ประจำรอบ และส่งสิทธิ์ให้ผู้ชนะได้ออกไพ่ก่อนในรอบถัดไป
    room.currentRoundCards = [null, null, null, null];
    room.starterPlayer = winningSeat;
    room.turn = winningSeat;

    // เช็กว่าหมดมือหรือยัง (จบเกม)
    if (room.hands[0].length === 0) {
        io.to(roomId).emit('gameOver', { scores: room.scores });
    } else {
        io.to(roomId).emit('updateState', getPublicGameState(room));
        checkNextTurn(roomId);
    }
}

function checkNextTurn(roomId) {
    let room = rooms[roomId];
    if (!room) return;

    // ถ้าเป็นตาของ AI ให้ AI คำนวณและออกไพ่โดยอัตโนมัติ
    if (room.isAI[room.turn]) {
        setTimeout(() => {
            let cardIndex = getSmartAICardIndex(room, room.turn);
            playCard(roomId, room.turn, cardIndex);
        }, 1000);
    }
}

function getPublicGameState(room) {
    return {
        turn: room.turn,
        starterPlayer: room.starterPlayer,
        currentRoundCards: room.currentRoundCards,
        scores: room.scores,
        trumpSuit: room.trumpSuit,
        dealer: room.dealer
    };
}

// ------------------------------------------------------------------
// Socket.IO Connection Event
// ------------------------------------------------------------------
io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    socket.on('joinRoom', ({ roomId, playerName }) => {
        socket.join(roomId);

        if (!rooms[roomId]) {
            rooms[roomId] = {
                players: [null, null, null, null],
                isAI: [true, true, true, true],
                hands: [[], [], [], []],
                currentRoundCards: [null, null, null, null],
                playedHistory: [],
                voidSuits: [[], [], [], []],
                scores: { TeamA: 0, TeamB: 0 },
                dealer: 0,
                starterPlayer: 1,
                turn: 1,
                trumpSuit: 'Spades'
            };
        }

        let room = rooms[roomId];
        let seatIndex = room.players.findIndex(p => p === null);

        if (seatIndex !== -1) {
            room.players[seatIndex] = { id: socket.id, name: playerName };
            room.isAI[seatIndex] = false;
        }

        // เริ่มเกมอัตโนมัติเมื่อสร้างห้อง
        let deck = shuffle(createDeck());
        for (let i = 0; i < 4; i++) {
            room.hands[i] = deck.splice(0, 13);
        }

        socket.emit('initHand', room.hands[seatIndex]);
        io.to(roomId).emit('updateState', getPublicGameState(room));

        checkNextTurn(roomId);
    });

    socket.on('playCard', ({ roomId, seatIndex, cardIndex }) => {
        playCard(roomId, seatIndex, cardIndex);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
