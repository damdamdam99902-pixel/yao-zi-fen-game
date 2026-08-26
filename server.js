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
        playedHistory: [], // ประวัติไพ่ที่ลงสนามแล้ว
        voidSuits: { 0: [], 1: [], 2: [], 3: [] } // ตรวจสอบว่าผู้เล่นคนไหนไม่มีไพ่ดอกไหนแล้ว
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
        
        io.to(roomId).emit('newChatMessage', {
            senderName: 'ระบบ',
            message: `🎉 คุณ ${playerName} สร้างห้องพักสำเร็จ`,
            isSystem: true
        });
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
        
        io.to(roomId).emit('newChatMessage', {
            senderName: 'ระบบ',
            message: `🤖 เริ่มเกมโหมดเล่นกับบอทแล้ว`,
            isSystem: true
        });
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

        io.to(roomId).emit('newChatMessage', {
            senderName: 'ระบบ',
            message: `👋 คุณ ${playerName} เข้าร่วมห้องแล้ว`,
            isSystem: true
        });
    });

    socket.on('sendChatMessage', ({ roomId, message }) => {
        const room = rooms[roomId];
        if (!room) return;
        const player = room.seats.find(s => s && s.id === socket.id);
        const senderName = player ? player.name : 'ผู้รับชม';

        io.to(roomId).emit('newChatMessage', {
            senderId: socket.id,
            senderName: senderName,
            message: message,
            isSystem: false
        });
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
    room.playedHistory = [];
    room.voidSuits = { 0: [], 1: [], 2: [], 3: [] };

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
        // หากไม่มีไพ่ดอกเดียวกับคนแรก แสดงว่าผู้เล่นคนนี้หมดดอกนั้นแล้ว (Void Suit)
        if (!hasLeadSuit && !room.voidSuits[seatIndex].includes(leadCard.suit)) {
            room.voidSuits[seatIndex].push(leadCard.suit);
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

// =============================================================
// อัลกอริทึมสมอง AI ปรับปรุงตามเทคนิคและกฎระเบียบทั้งหมด
// =============================================================
function getSmartAICardIndex(room, seatIndex) {
    let hand = room.hands[seatIndex];
    let playedCards = room.currentRoundCards;
    let starter = room.starterPlayer;
    let playedHistory = room.playedHistory || [];
    let trumpSuit = room.trumpSuit;
    let dealerSeat = room.dealer;

    let partnerSeat = (seatIndex + 2) % 4;
    let isPartnerDealer = (partnerSeat === dealerSeat);
    let isDealerTeam = (seatIndex === dealerSeat || isPartnerDealer);

    let playedCount = playedCards.filter(c => c !== null).length;
    let leadCard = playedCount > 0 ? playedCards[starter] : null;

    // หาไพ่ที่ออกได้ตามกฎบังคับออกดอกเดียวกันก่อน
    let validCards = [];
    if (leadCard) {
        validCards = hand.map((card, idx) => ({ card, idx })).filter(item => item.card.suit === leadCard.suit);
    }
    if (validCards.length === 0) {
        validCards = hand.map((card, idx) => ({ card, idx })); // ถ้าไม่มีดอกตาม ทิ้งใบไหนก็ได้
    }

    // ตรวจสอบว่าไพ่ใบนึ้ใหญ่ที่สุดในดอกนั้นๆ ที่ยังเหลืออยู่ในเกมหรือไม่ (นับไพ่ที่ออกไปแล้ว)
    const isHighestRemainingInSuit = (card) => {
        let ranks = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
        for (let r of ranks) {
            if (CARD_RANKS[r] > CARD_RANKS[card.value]) {
                let played = playedHistory.some(c => c.suit === card.suit && c.value === r);
                let inHand = hand.some(c => c.suit === card.suit && c.value === r);
                if (!played && !inHand) return false;
            } else if (r === card.value) {
                break;
            }
        }
        return true;
    };

    // หาคนที่มีโอกาสชนะไพ่ในรอบนี้ชั่วคราว
    const getWinningSeatSoFar = () => {
        let winSeat = starter;
        let winCard = playedCards[starter];
        for (let i = 0; i < 4; i++) {
            let card = playedCards[i];
            if (!card || i === starter) continue;
            if (card.suit === winCard.suit && CARD_RANKS[card.value] > CARD_RANKS[winCard.value]) {
                winCard = card;
                winSeat = i;
            } else if (card.suit === trumpSuit && winCard.suit !== trumpSuit) {
                winCard = card;
                winSeat = i;
            }
        }
        return winSeat;
    };

    // เปรียบเทียบความใหญ่ของไพ่ 2 ใบ
    const isCardBigger = (cardA, cardB) => {
        if (!cardB) return true;
        if (cardA.suit === cardB.suit) {
            return CARD_RANKS[cardA.value] > CARD_RANKS[cardB.value];
        }
        if (cardA.suit === trumpSuit && cardB.suit !== trumpSuit) {
            return true;
        }
        return false;
    };

    // แยกกลุ่มไพ่แต้ม (A, 10, 5) และไพ่ธรรมดา
    let pointCards = validCards.filter(item => ['A', '10', '5'].includes(item.card.value));
    let nonPointCards = validCards.filter(item => !['A', '10', '5'].includes(item.card.value));

    // -------------------------------------------------------------
    // 1. กรณีออกไพ่คนแรก (P1)
    // -------------------------------------------------------------
    if (playedCount === 0) {
        
        // กฎพิเศษ: หากเจ้ามือไม่มีไพ่ดอกไหน กักไพ่ A, 10, 5 ดอกนั้นไว้ก่อน
        let safeValidCards = validCards.filter(item => {
            if (['A', '10', '5'].includes(item.card.value)) {
                let oppSeats = [ (seatIndex + 1) % 4, (seatIndex + 3) % 4 ];
                let oppIsDealerNoSuit = oppSeats.some(s => s === dealerSeat && room.voidSuits[s].includes(item.card.suit));
                if (oppIsDealerNoSuit) return false;
            }
            return true;
        });

        let targetCards = safeValidCards.length > 0 ? safeValidCards : validCards;

        if (isPartnerDealer) {
            // เพื่อนเป็นเจ้ามือ: ออกใหญ่สุด เช่น A ก่อน
            let aces = targetCards.filter(item => item.card.value === 'A');
            if (aces.length > 0) return aces[0].idx;

            // หากไม่มี A สุ่มตาม 2 ตัวเลือก
            let option = Math.floor(Math.random() * 2) + 1;
            if (option === 1) {
                // ตัวเลือกที่ 1: ดอกหลักเล็กๆ (หลบ 10, 5)
                let trumpNonPoints = nonPointCards.filter(item => item.card.suit === trumpSuit);
                if (trumpNonPoints.length > 0) {
                    trumpNonPoints.sort((a, b) => CARD_RANKS[a.card.value] - CARD_RANKS[b.card.value]);
                    return trumpNonPoints[0].idx;
                }
            }

            // ตัวเลือกที่ 2 (หรือสำรองจาก 1): ใหญ่ที่สุดที่ไม่ใช่ดอกหลัก (หลบ 10, 5)
            let nonTrumpNonPoints = nonPointCards.filter(item => item.card.suit !== trumpSuit);
            if (nonTrumpNonPoints.length > 0) {
                nonTrumpNonPoints.sort((a, b) => CARD_RANKS[b.card.value] - CARD_RANKS[a.card.value]);
                return nonTrumpNonPoints[0].idx;
            }
        } else {
            // ทีมตรงข้ามเป็นเจ้ามือ: ออกใหญ่สุด A ก่อน
            let aces = targetCards.filter(item => item.card.value === 'A');
            if (aces.length > 0) return aces[0].idx;

            // ไม่มี A ให้ออกใหญ่สุด (หลบ 10, 5 หรือดอกที่เจ้ามือไม่มี)
            let safeNonPoints = nonPointCards.filter(item => !room.voidSuits[dealerSeat].includes(item.card.suit));
            if (safeNonPoints.length > 0) {
                safeNonPoints.sort((a, b) => CARD_RANKS[b.card.value] - CARD_RANKS[a.card.value]);
                return safeNonPoints[0].idx;
            }
        }

        // หากไม่มีทางเลือกอื่น ทิ้งไพ่ 5 ก่อน 10
        let fives = pointCards.filter(item => item.card.value === '5');
        if (fives.length > 0) return fives[0].idx;
        if (pointCards.length > 0) return pointCards[0].idx;

        return validCards[0].idx;
    }

    // -------------------------------------------------------------
    // 2. กรณีออกไพ่คนที่สอง (P2)
    // -------------------------------------------------------------
    if (playedCount === 1) {
        let p1Card = playedCards[starter];
        let winningChoices = validCards.filter(item => isCardBigger(item.card, p1Card));

        if (winningChoices.length > 0) {
            // พยายามออกใบใหญ่กว่า ยกเว้น 10/5
            let nonPointWinners = winningChoices.filter(item => !['10', '5'].includes(item.card.value));
            if (nonPointWinners.length > 0) {
                nonPointWinners.sort((a, b) => CARD_RANKS[b.card.value] - CARD_RANKS[a.card.value]);
                return nonPointWinners[0].idx;
            }
            // ไม่มีใบอื่น ค่อยออก 10 หรือ 5
            winningChoices.sort((a, b) => CARD_RANKS[b.card.value] - CARD_RANKS[a.card.value]);
            return winningChoices[0].idx;
        } else {
            // ใหญ่ไม่เท่า P1 ให้ออกเล็กสุดแทน (เลี่ยงไพ่แต้ม)
            if (nonPointCards.length > 0) {
                nonPointCards.sort((a, b) => CARD_RANKS[a.card.value] - CARD_RANKS[b.card.value]);
                return nonPointCards[0].idx;
            }
            let fives = pointCards.filter(item => item.card.value === '5');
            if (fives.length > 0) return fives[0].idx;
            return validCards[0].idx;
        }
    }

    // -------------------------------------------------------------
    // 3. กรณีออกไพ่คนที่สาม (P3)
    // -------------------------------------------------------------
    if (playedCount === 2) {
        let p1Card = playedCards[starter];
        let p2Seat = (starter + 1) % 4;
        let p2Card = playedCards[p2Seat];
        let currentWinnerSeat = getWinningSeatSoFar();

        // ทริคพิเศษ: P1 ออก A โพแดง แล้ว P2 สู้ด้วย 10 โพดำ (ตัดดอกหลัก)
        if (leadCard && p2Card.suit === trumpSuit && p1Card.suit !== trumpSuit) {
            let hasLeadSuit = hand.some(c => c.suit === leadCard.suit);
            if (hasLeadSuit) {
                // ยังมีดอกตาม (โพแดง) ให้ทิ้งไพ่เล็กหลบแต้ม
                if (nonPointCards.length > 0) {
                    nonPointCards.sort((a, b) => CARD_RANKS[a.card.value] - CARD_RANKS[b.card.value]);
                    return nonPointCards[0].idx;
                }
            } else {
                // ไม่มีดอกตาม ถ้ามีดอกหลัก (โพดำ) ที่ใหญ่กว่า P2 ให้ฆ่าเลย
                let biggerTrumps = validCards.filter(item => item.card.suit === trumpSuit && CARD_RANKS[item.card.value] > CARD_RANKS[p2Card.value]);
                if (biggerTrumps.length > 0) {
                    biggerTrumps.sort((a, b) => CARD_RANKS[b.card.value] - CARD_RANKS[a.card.value]);
                    return biggerTrumps[0].idx;
                } else {
                    // ไม่มีโพดำใหญ่กว่า ให้เก็บดอกหลักไว้ ออกไพ่เล็กดอกอื่นแทน
                    let nonTrumpSmall = validCards.filter(item => item.card.suit !== trumpSuit);
                    if (nonTrumpSmall.length > 0) {
                        nonTrumpSmall.sort((a, b) => CARD_RANKS[a.card.value] - CARD_RANKS[b.card.value]);
                        return nonTrumpSmall[0].idx;
                    }
                }
            }
        }

        // กฎปกติ P3: เช็กว่า P1 ใหญ่สุดหรือยัง
        let isP1Highest = isHighestRemainingInSuit(p1Card) && currentWinnerSeat === starter;
        if (isP1Highest) {
            // เพื่อนชนะ ยัดไพ่คะแนน 10, 5
            if (pointCards.length > 0) {
                pointCards.sort((a, b) => calculateCardScore(b.card) - calculateCardScore(a.card));
                return pointCards[0].idx;
            }
        }

        // หาก P1 ไม่ใช่ไพ่ใหญ่ที่สุด พยายามออกไพ่ใหญ่สุดสู้
        let currentBest = playedCards[currentWinnerSeat];
        let winningChoices = validCards.filter(item => isCardBigger(item.card, currentBest));

        if (winningChoices.length > 0) {
            winningChoices.sort((a, b) => CARD_RANKS[b.card.value] - CARD_RANKS[a.card.value]);
            return winningChoices[0].idx;
        } else {
            // สู้ไม่ได้ ออกเล็กสุดแทน (เลี่ยง 10, 5)
            if (nonPointCards.length > 0) {
                nonPointCards.sort((a, b) => CARD_RANKS[a.card.value] - CARD_RANKS[b.card.value]);
                return nonPointCards[0].idx;
            }
            let fives = pointCards.filter(item => item.card.value === '5');
            if (fives.length > 0) return fives[0].idx;
            return validCards[0].idx;
        }
    }

    // -------------------------------------------------------------
    // 4. กรณีออกไพ่คนที่สี่ (P4)
    // -------------------------------------------------------------
    if (playedCount === 3) {
        let p2Seat = (starter + 1) % 4;
        let p2Card = playedCards[p2Seat];
        let currentWinnerSeat = getWinningSeatSoFar();

        // เช็กว่า P2 (เพื่อนร่วมทีมของ P4) ชนะในรอบนี้หรือไม่
        let isP2Winning = (currentWinnerSeat === p2Seat) || (isHighestRemainingInSuit(p2Card) && isCardBigger(p2Card, playedCards[starter]));

        if (isP2Winning) {
            // เพื่อนชนะ ยัดไพ่คะแนน 10, 5
            if (pointCards.length > 0) {
                pointCards.sort((a, b) => calculateCardScore(b.card) - calculateCardScore(a.card));
                return pointCards[0].idx;
            }
        }

        // ถ้าเพื่อนไม่ชนะ พยายามออกไพ่ใหญ่สุดชนะโต๊ะ
        let currentBest = playedCards[currentWinnerSeat];
        let winningChoices = validCards.filter(item => isCardBigger(item.card, currentBest));

        if (winningChoices.length > 0) {
            winningChoices.sort((a, b) => CARD_RANKS[b.card.value] - CARD_RANKS[a.card.value]);
            return winningChoices[0].idx;
        } else {
            // สู้ไม่ได้ ออกเล็กสุดแทน (เลี่ยง 10, 5)
            if (nonPointCards.length > 0) {
                nonPointCards.sort((a, b) => CARD_RANKS[a.card.value] - CARD_RANKS[b.card.value]);
                return nonPointCards[0].idx;
            }
            let fives = pointCards.filter(item => item.card.value === '5');
            if (fives.length > 0) return fives[0].idx;
            return validCards[0].idx;
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
