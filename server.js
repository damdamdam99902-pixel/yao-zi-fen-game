const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

const rooms = {};

// ลำดับไพ่เรียงจากต่ำไปสูง (2 เล็กสุด -> A ใหญ่สุด)
const CARD_RANKS = {
    '2': 1, '3': 2, '4': 3, '5': 4, '6': 5, '7': 6, '8': 7,
    '9': 8, '10': 9, 'J': 10, 'Q': 11, 'K': 12, 'A': 13
};

// ลำดับดอกไพ่: ♠ โพดำ -> ♥️ โพแดง -> ♣ ดอกจิก -> ♦️ ข้าวหลามตัด
const SUIT_RANKS = {
    '♠': 1,
    '♥️': 2,
    '♣': 3,
    '♦️': 4
};

function createDeck() {
    const suits = ['♠', '♥️', '♣', '♦️'];
    const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    let deck = [];
    for (let s of suits) {
        for (let v of values) {
            deck.push({ suit: s, value: v });
        }
    }
    return deck.sort(() => Math.random() - 0.5);
}

// คำนวณแต้มเฉพาะไพ่ 5, 10, A
function calculateCardScore(card) {
    if (card.value === '5') return 5;
    if (card.value === '10' || card.value === 'A') return 10;
    return 0;
}

// เรียงไพ่ตามดอก (♠ > ♥️ > ♣ > ♦️) แล้วตามด้วยแต้มใหญ่ไปเล็ก
function sortCards(a, b) {
    if (SUIT_RANKS[a.suit] !== SUIT_RANKS[b.suit]) {
        return SUIT_RANKS[a.suit] - SUIT_RANKS[b.suit];
    }
    return CARD_RANKS[b.value] - CARD_RANKS[a.value];
}

function createRoomObject(roomId) {
    return {
        id: roomId,
        seats: [null, null, null, null],
        gameState: 'LOBBY',
        deck: [],
        hands: {},
        kitty: [],
        dealer: -1,
        bidTurn: -1,
        highestBid: 60,
        highestBidder: -1,
        consecutivePasses: 0,
        trumpSuit: null,
        teamAScore: 0,
        teamBScore: 0,
        teamACapturedCards: [],
        teamBCapturedCards: [],
        starterPlayer: -1,
        currentRoundCards: [null, null, null, null],
        roundCount: 0,
        playedHistory: [] // บันทึกประวัติไพ่ที่ออกไปแล้วในแต่ละรอบ[span_0](start_span)[span_0](end_span)[span_1](start_span)[span_1](end_span)
    };
}

io.on('connection', (socket) => {
    
    socket.on('createRoom', (playerName) => {
        const roomId = Math.floor(1000 + Math.random() * 9000).toString();
        rooms[roomId] = createRoomObject(roomId);
        rooms[roomId].seats[0] = { id: socket.id, name: playerName, isAI: false, seat: 0 };
        socket.join(roomId);
        socket.emit('roomCreated', { roomId, seat: 0 });
        io.to(roomId).emit('updateRoom', rooms[roomId]);
    });

    socket.on('createSinglePlayer', (playerName) => {
        const roomId = Math.floor(1000 + Math.random() * 9000).toString();
        const room = createRoomObject(roomId);
        room.seats[0] = { id: socket.id, name: playerName, isAI: false, seat: 0 };
        for (let i = 1; i <= 3; i++) {
            room.seats[i] = { id: `bot-${i}`, name: `บอท AI ${i}`, isAI: true, seat: i };
        }
        rooms[roomId] = room;
        socket.join(roomId);
        socket.emit('roomCreated', { roomId, seat: 0 });
        io.to(roomId).emit('updateRoom', room);
    });

    socket.on('joinRoom', ({ roomId, playerName }) => {
        const room = rooms[roomId];
        if (!room) return socket.emit('errorMessage', 'ไม่พบห้องนี้');
        
        let emptySeat = room.seats.findIndex(s => s === null);
        if (emptySeat === -1) return socket.emit('errorMessage', 'ห้องเต็มแล้ว');

        room.seats[emptySeat] = { id: socket.id, name: playerName, isAI: false, seat: emptySeat };
        socket.join(roomId);
        socket.emit('joinedSuccess', { roomId, seat: emptySeat });
        io.to(roomId).emit('updateRoom', room);
    });

    socket.on('changeSeat', ({ roomId, targetSeat }) => {
        const room = rooms[roomId];
        if (!room || room.gameState !== 'LOBBY') return;
        
        let currentSeat = room.seats.findIndex(s => s && s.id === socket.id);
        if (currentSeat !== -1 && room.seats[targetSeat] === null) {
            room.seats[targetSeat] = room.seats[currentSeat];
            room.seats[targetSeat].seat = targetSeat;
            room.seats[currentSeat] = null;
            io.to(roomId).emit('updateRoom', room);
        }
    });

    socket.on('fillAI', ({ roomId }) => {
        const room = rooms[roomId];
        if (!room || room.gameState !== 'LOBBY') return;
        for (let i = 0; i < 4; i++) {
            if (room.seats[i] === null) {
                room.seats[i] = { id: `bot-${i}`, name: `บอท AI ${i}`, isAI: true, seat: i };
            }
        }
        io.to(roomId).emit('updateRoom', room);
    });

    socket.on('startGameReq', ({ roomId }) => {
        const room = rooms[roomId];
        if (!room) return;
        if (room.seats.some(s => s === null)) return socket.emit('errorMessage', 'ที่นั่งยังไม่ครบ 4 คน');

        startNewGame(room);
    });

    socket.on('submitBid', ({ roomId, bidValue, isPass }) => {
        const room = rooms[roomId];
        if (!room || room.gameState !== 'BIDDING') return;

        if (isPass) {
            room.consecutivePasses++;
        } else {
            if (bidValue > room.highestBid) {
                room.highestBid = bidValue;
                room.highestBidder = room.bidTurn;
                room.consecutivePasses = 0;
            }
        }

        if (room.consecutivePasses >= 3 && room.highestBidder !== -1) {
            room.dealer = room.highestBidder;
            room.gameState = 'SELECT_TRUMP';
            io.to(roomId).emit('updateGameState', room);
            checkAITurn(room);
            return;
        }

        room.bidTurn = (room.bidTurn + 1) % 4;
        io.to(roomId).emit('updateGameState', room);
        checkAITurn(room);
    });

    socket.on('selectTrump', ({ roomId, suit }) => {
        const room = rooms[roomId];
        if (!room || room.gameState !== 'SELECT_TRUMP') return;
        
        room.trumpSuit = suit;
        
        // แจกไพ่กองกลาง 4 ใบเข้ามือผู้ชนะประมูลหลังเลือกดอกหลัก
        room.hands[room.dealer].push(...room.kitty);
        room.hands[room.dealer].sort(sortCards);
        room.kitty = [];

        const dealerSocket = io.sockets.sockets.get(room.seats[room.dealer].id);
        if (dealerSocket) dealerSocket.emit('yourHand', room.hands[room.dealer]);

        room.gameState = 'KITTY_DISCARD';
        io.to(roomId).emit('updateGameState', room);
        checkAITurn(room);
    });

    socket.on('confirmDiscard', ({ roomId, discardIndexes }) => {
        const room = rooms[roomId];
        if (!room || room.gameState !== 'KITTY_DISCARD') return;

        let dealerHand = room.hands[room.dealer];
        discardIndexes.sort((a, b) => b - a);
        discardIndexes.forEach(idx => {
            room.kitty.push(dealerHand.splice(idx, 1)[0]);
        });

        dealerHand.sort(sortCards);

        const dealerSocket = io.sockets.sockets.get(room.seats[room.dealer].id);
        if (dealerSocket) dealerSocket.emit('yourHand', dealerHand);

        room.gameState = 'PLAYING';
        room.starterPlayer = room.dealer;
        io.to(roomId).emit('updateGameState', room);
        checkAITurn(room);
    });

    socket.on('playCard', ({ roomId, cardIndex }) => {
        const room = rooms[roomId];
        if (!room || room.gameState !== 'PLAYING') return;

        let currentTurn = getCurrentTurn(room);
        let playerSocket = room.seats[currentTurn];

        if (playerSocket.id !== socket.id) return;

        executePlayCard(room, currentTurn, cardIndex);
    });

    socket.on('restartGameReq', ({ roomId }) => {
        const room = rooms[roomId];
        if (!room) return;
        startNewGame(room);
    });
});

function startNewGame(room) {
    room.gameState = 'BIDDING';
    room.deck = createDeck();
    room.highestBid = 60;
    room.highestBidder = -1;
    room.consecutivePasses = 0;
    room.trumpSuit = null;
    room.teamAScore = 0;
    room.teamBScore = 0;
    room.teamACapturedCards = [];
    room.teamBCapturedCards = [];
    room.roundCount = 0;
    room.currentRoundCards = [null, null, null, null];
    room.playedHistory = []; // รีเซ็ตประวัติไพ่เมื่อเริ่มเกมใหม่[span_2](start_span)[span_2](end_span)

    for (let i = 0; i < 4; i++) {
        room.hands[i] = room.deck.splice(0, 12).sort(sortCards);
    }
    room.kitty = room.deck.splice(0, 4);

    room.bidTurn = Math.floor(Math.random() * 4);

    for (let i = 0; i < 4; i++) {
        const player = room.seats[i];
        if (player && !player.isAI) {
            io.to(player.id).emit('yourHand', room.hands[i]);
        }
    }

    io.to(room.id).emit('updateGameState', room);
    checkAITurn(room);
}

function getCurrentTurn(room) {
    let playedCount = room.currentRoundCards.filter(c => c !== null).length;
    return (room.starterPlayer + playedCount) % 4;
}

function executePlayCard(room, seatIndex, cardIndex) {
    let hand = room.hands[seatIndex];
    let card = hand[cardIndex];

    let playedCount = room.currentRoundCards.filter(c => c !== null).length;
    if (playedCount > 0) {
        let leadCard = room.currentRoundCards[room.starterPlayer];
        let hasLeadSuit = hand.some(c => c.suit === leadCard.suit);
        if (hasLeadSuit && card.suit !== leadCard.suit) {
            return;
        }
    }

    hand.splice(cardIndex, 1);
    room.currentRoundCards[seatIndex] = card;

    const player = room.seats[seatIndex];
    if (player && !player.isAI) {
        io.to(player.id).emit('yourHand', hand);
    }

    if (room.currentRoundCards.filter(c => c !== null).length === 4) {
        io.to(room.id).emit('updateGameState', room);
        setTimeout(() => resolveRound(room), 1500);
    } else {
        io.to(room.id).emit('updateGameState', room);
        checkAITurn(room);
    }
}

function resolveRound(room) {
    let leadCard = room.currentRoundCards[room.starterPlayer];
    let winningSeat = room.starterPlayer;
    let winningCard = leadCard;

    // บันทึกไพ่ทั้ง 4 ใบของรอบนี้เข้าประวัติ[span_3](start_span)[span_3](end_span)[span_4](start_span)[span_4](end_span)
    room.currentRoundCards.forEach(c => {
        if (c) room.playedHistory.push(c);
    });

    for (let i = 0; i < 4; i++) {
        if (i === room.starterPlayer) continue;
        let card = room.currentRoundCards[i];

        if (card.suit === winningCard.suit) {
            if (CARD_RANKS[card.value] > CARD_RANKS[winningCard.value]) {
                winningCard = card;
                winningSeat = i;
            }
        } else if (card.suit === room.trumpSuit && winningCard.suit !== room.trumpSuit) {
            winningCard = card;
            winningSeat = i;
        }
    }

    let roundPoints = 0;
    let pointCardsInRound = [];

    room.currentRoundCards.forEach(c => {
        let pts = calculateCardScore(c);
        roundPoints += pts;
        if (pts > 0) pointCardsInRound.push(c);
    });

    if (winningSeat === 0 || winningSeat === 2) {
        room.teamAScore += roundPoints;
        room.teamACapturedCards.push(...pointCardsInRound);
    } else {
        room.teamBScore += roundPoints;
        room.teamBCapturedCards.push(...pointCardsInRound);
    }

    room.starterPlayer = winningSeat;
    room.currentRoundCards = [null, null, null, null];
    room.roundCount++;

    if (room.roundCount >= 12) {
        let kittyPoints = 0;
        let kittyPointCards = [];
        room.kitty.forEach(c => {
            let pts = calculateCardScore(c);
            kittyPoints += pts * 2;
            if (pts > 0) kittyPointCards.push(c);
        });

        if (winningSeat === 0 || winningSeat === 2) {
            room.teamAScore += kittyPoints;
            room.teamACapturedCards.push(...kittyPointCards);
        } else {
            room.teamBScore += kittyPoints;
            room.teamBCapturedCards.push(...kittyPointCards);
        }

        room.gameState = 'END';
    }

    io.to(room.id).emit('updateGameState', room);
    checkAITurn(room);
}

// ==========================================
// ฟังก์ชันคำนวณการเลือกไพ่ของ AI ตามกติกา[span_5](start_span)[span_5](end_span)
// ==========================================
function getSmartAICardIndex(room, seatIndex) {
    let hand = room.hands[seatIndex];
    let playedCards = room.currentRoundCards;
    let starter = room.starterPlayer;
    
    let playedCount = playedCards.filter(c => c !== null).length;
    let leadCard = playedCount > 0 ? playedCards[starter] : null;

    // เลือกเฉพาะไพ่ที่ออกได้ถูกต้องตามกฎ[span_6](start_span)[span_6](end_span)
    let validCards = [];
    if (leadCard) {
        validCards = hand.map((card, idx) => ({ card, idx })).filter(item => item.card.suit === leadCard.suit);
    }
    if (validCards.length === 0) {
        validCards = hand.map((card, idx) => ({ card, idx }));
    }

    // ฟังก์ชันกรองระหว่างไพ่ธรรมดากับไพ่แต้ม (10, 5)[span_7](start_span)[span_7](end_span)
    const filterPointCards = (list, keepPoints) => {
        let filtered = list.filter(item => ['5', '10'].includes(item.card.value) === keepPoints);
        return filtered.length > 0 ? filtered : list; // หากไม่มีไพ่ธรรมดา จำเป็นต้องยอมใช้ไพ่แต้ม[span_8](start_span)[span_8](end_span)
    };

    // ฟังก์ชันเปรียบเทียบว่าไพ่ A ใหญ่กว่าไพ่ B หรือไม่[span_9](start_span)[span_9](end_span)
    const isCardBigger = (cardA, cardB) => {
        if (!cardB) return true;
        if (cardA.suit === cardB.suit) {
            return CARD_RANKS[cardA.value] > CARD_RANKS[cardB.value];
        }
        if (cardA.suit === room.trumpSuit && cardB.suit !== room.trumpSuit) {
            return true;
        }
        return false;
    };

    // -------------------------------------------------------------
    // คนที่ 1: ออกใหญ่สุด ยกเว้น 10 หรือ 5 (ถ้าไม่มีตัวอื่นค่อยออก 10 หรือ 5)[span_10](start_span)[span_10](end_span)
    // -------------------------------------------------------------
    if (playedCount === 0) {
        let nonPoints = filterPointCards(validCards, false);
        nonPoints.sort((a, b) => CARD_RANKS[b.card.value] - CARD_RANKS[a.card.value]);
        return nonPoints[0].idx;
    }

    // -------------------------------------------------------------
    // คนที่ 2: พยายามออกใหญ่กว่าคนแรกเสมอ ยกเว้น 10 หรือ 5[span_11](start_span)[span_11](end_span)
    // หากใหญ่ไม่เท่าคนแรก ให้ออกเล็กสุดแทน[span_12](start_span)[span_12](end_span)
    // -------------------------------------------------------------
    if (playedCount === 1) {
        let p1Card = playedCards[starter];
        let winningChoices = validCards.filter(item => isCardBigger(item.card, p1Card));

        if (winningChoices.length > 0) {
            let nonPoints = filterPointCards(winningChoices, false);
            nonPoints.sort((a, b) => CARD_RANKS[b.card.value] - CARD_RANKS[a.card.value]);
            return nonPoints[0].idx;
        } else {
            // สู้ไม่ได้ -> ออกใบเล็กที่สุดแทน[span_13](start_span)[span_13](end_span)
            let nonPoints = filterPointCards(validCards, false);
            nonPoints.sort((a, b) => CARD_RANKS[a.card.value] - CARD_RANKS[b.card.value]);
            return nonPoints[0].idx;
        }
    }

    // -------------------------------------------------------------
    // คนที่ 3: ดูว่าไพ่คนแรกใหญ่สุดหรือยัง (อิงตามไพ่ที่เคยออกไปแล้ว)[span_14](start_span)[span_14](end_span)
    // -------------------------------------------------------------
    if (playedCount === 2) {
        let p1Card = playedCards[starter];
        
        // เช็กว่ามีไพ่ใบไหนในดอกเดียวกันที่ใหญ่กว่า p1Card และยังไม่ออกมาในเกมหรือไม่[span_15](start_span)[span_15](end_span)
        let isP1HighestSoFar = true;
        for (let val in CARD_RANKS) {
            if (CARD_RANKS[val] > CARD_RANKS[p1Card.value]) {
                let cardAlreadyPlayed = room.playedHistory.some(c => c.suit === p1Card.suit && c.value === val);
                if (!cardAlreadyPlayed) {
                    isP1HighestSoFar = false; // ยังมีไพ่ที่ใหญ่กว่ายังไม่ออก[span_16](start_span)[span_16](end_span)
                    break;
                }
            }
        }

        if (isP1HighestSoFar) {
            // ไพ่คนแรกใหญ่ที่สุดแล้ว -> พยายามออกไพ่คะแนน A, 10, 5 ให้เพื่อน[span_17](start_span)[span_17](end_span)
            let pointCards = validCards.filter(item => ['A', '10', '5'].includes(item.card.value));
            if (pointCards.length > 0) {
                pointCards.sort((a, b) => calculateCardScore(b.card) - calculateCardScore(a.card));
                return pointCards[0].idx;
            }
        }

        // หากคนแรกไม่ใช่ไพ่ใหญ่สุด -> ออกไพ่ใหญ่ที่สุด[span_18](start_span)[span_18](end_span)
        let p2Seat = (starter + 1) % 4;
        let p2Card = playedCards[p2Seat];
        let currentWinningCard = isCardBigger(p1Card, p2Card) ? p1Card : p2Card;

        let winningChoices = validCards.filter(item => isCardBigger(item.card, currentWinningCard));
        if (winningChoices.length > 0) {
            let nonPoints = filterPointCards(winningChoices, false);
            nonPoints.sort((a, b) => CARD_RANKS[b.card.value] - CARD_RANKS[a.card.value]);
            return nonPoints[0].idx;
        } else {
            // สู้ไม่ได้ -> ออกใบเล็กที่สุด ยกเว้น 10 หรือ 5[span_19](start_span)[span_19](end_span)
            let nonPoints = filterPointCards(validCards, false);
            nonPoints.sort((a, b) => CARD_RANKS[a.card.value] - CARD_RANKS[b.card.value]);
            return nonPoints[0].idx;
        }
    }

    // -------------------------------------------------------------
    // คนที่ 4: ดูว่าไพ่คนสองใหญ่ที่สุดหรือใหญ่กว่าคนแรกและคนสามหรือไม่[span_20](start_span)[span_20](end_span)
    // -------------------------------------------------------------
    if (playedCount === 3) {
        let p1Seat = starter;
        let p2Seat = (starter + 1) % 4;
        let p3Seat = (starter + 2) % 4;

        let p1Card = playedCards[p1Seat];
        let p2Card = playedCards[p2Seat];
        let p3Card = playedCards[p3Seat];

        let isP2Winning = isCardBigger(p2Card, p1Card) && isCardBigger(p2Card, p3Card);

        if (isP2Winning) {
            // คนสองชนะ -> พยายามออกไพ่คะแนน A, 10, 5 ให้เพื่อน[span_21](start_span)[span_21](end_span)
            let pointCards = validCards.filter(item => ['A', '10', '5'].includes(item.card.value));
            if (pointCards.length > 0) {
                pointCards.sort((a, b) => calculateCardScore(b.card) - calculateCardScore(a.card));
                return pointCards[0].idx;
            }
        }

        // หากคนสองไม่ได้ใหญ่สุด -> พยายามออกไพ่ที่ใหญ่ที่สุด[span_22](start_span)[span_22](end_span)
        let currentBest = p1Card;
        if (isCardBigger(p2Card, currentBest)) currentBest = p2Card;
        if (isCardBigger(p3Card, currentBest)) currentBest = p3Card;

        let winningChoices = validCards.filter(item => isCardBigger(item.card, currentBest));
        if (winningChoices.length > 0) {
            let nonPoints = filterPointCards(winningChoices, false);
            nonPoints.sort((a, b) => CARD_RANKS[b.card.value] - CARD_RANKS[a.card.value]);
            return nonPoints[0].idx;
        } else {
            // เล็กกว่าทุกคน -> ออกใบเล็กที่สุด ยกเว้น 10 หรือ 5[span_23](start_span)[span_23](end_span)
            let nonPoints = filterPointCards(validCards, false);
            nonPoints.sort((a, b) => CARD_RANKS[a.card.value] - CARD_RANKS[b.card.value]);
            return nonPoints[0].idx;
        }
    }

    return 0;
}

function checkAITurn(room) {
    if (room.gameState === 'BIDDING') {
        let currentBot = room.seats[room.bidTurn];
        if (currentBot && currentBot.isAI) {
            setTimeout(() => {
                let bidValue = 0;
                let isPass = true;
                if (room.highestBid < 70 && Math.random() > 0.5) {
                    bidValue = room.highestBid + 5;
                    isPass = false;
                }
                socketEmitBid(room, bidValue, isPass);
            }, 1000);
        }
    } else if (room.gameState === 'SELECT_TRUMP') {
        let dealerBot = room.seats[room.dealer];
        if (dealerBot && dealerBot.isAI) {
            setTimeout(() => {
                const suits = ['♠', '♥️', '♣', '♦️'];
                room.trumpSuit = suits[Math.floor(Math.random() * suits.length)];
                
                room.hands[room.dealer].push(...room.kitty);
                room.hands[room.dealer].sort(sortCards);
                room.kitty = [];

                room.gameState = 'KITTY_DISCARD';
                io.to(room.id).emit('updateGameState', room);
                checkAITurn(room);
            }, 1000);
        }
    } else if (room.gameState === 'KITTY_DISCARD') {
        let dealerBot = room.seats[room.dealer];
        if (dealerBot && dealerBot.isAI) {
            setTimeout(() => {
                let hand = room.hands[room.dealer];
                let nonPointIndexes = [];
                hand.forEach((c, idx) => {
                    if (!['A', '10', '5'].includes(c.value)) nonPointIndexes.push(idx);
                });
                
                nonPointIndexes.sort(() => Math.random() - 0.5);
                let toDiscard = nonPointIndexes.slice(0, 4).sort((a, b) => b - a);

                toDiscard.forEach(idx => {
                    room.kitty.push(hand.splice(idx, 1)[0]);
                });

                hand.sort(sortCards);

                room.gameState = 'PLAYING';
                room.starterPlayer = room.dealer;
                io.to(room.id).emit('updateGameState', room);
                checkAITurn(room);
            }, 1000);
        }
    } else if (room.gameState === 'PLAYING') {
        let currentTurn = getCurrentTurn(room);
        let bot = room.seats[currentTurn];
        if (bot && bot.isAI) {
            setTimeout(() => {
                let chosenIndex = getSmartAICardIndex(room, currentTurn);
                executePlayCard(room, currentTurn, chosenIndex);
            }, 1000);
        }
    }
}

function socketEmitBid(room, bidValue, isPass) {
    if (isPass) {
        room.consecutivePasses++;
    } else {
        if (bidValue > room.highestBid) {
            room.highestBid = bidValue;
            room.highestBidder = room.bidTurn;
            room.consecutivePasses = 0;
        }
    }

    if (room.consecutivePasses >= 3 && room.highestBidder !== -1) {
        room.dealer = room.highestBidder;
        room.gameState = 'SELECT_TRUMP';
        io.to(room.id).emit('updateGameState', room);
        checkAITurn(room);
        return;
    }

    room.bidTurn = (room.bidTurn + 1) % 4;
    io.to(room.id).emit('updateGameState', room);
    checkAITurn(room);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
