const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

const rooms = {};

// ลำดับไพ่เรียงจากต่ำไปสูง
const CARD_RANKS = {
    '3': 1, '4': 2, '5': 3, '6': 4, '7': 5, '8': 6, '9': 7,
    '10': 8, 'J': 9, 'Q': 10, 'K': 11, 'A': 12, '2': 13
};

function createDeck() {
    const suits = ['♠', '♥️', '♣', '♦️'];
    const values = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
    let deck = [];
    for (let s of suits) {
        for (let v of values) {
            deck.push({ suit: s, value: v });
        }
    }
    return deck.sort(() => Math.random() - 0.5);
}

function calculateCardScore(card) {
    if (card.value === '5') return 5;
    if (card.value === '10' || card.value === 'K') return 10;
    return 0;
}

function createRoomObject(roomId) {
    return {
        id: roomId,
        seats: [null, null, null, null],
        gameState: 'LOBBY', // LOBBY, BIDDING, SELECT_TRUMP, KITTY_DISCARD, PLAYING, END
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
        roundCount: 0
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
            
            // แจกไพ่หมอน 4 ใบให้ Dealer
            room.hands[room.dealer].push(...room.kitty);
            room.kitty = [];

            // ส่งมือใหม่ให้ผู้ชนะประมูล
            const dealerSocket = io.sockets.sockets.get(room.seats[room.dealer].id);
            if (dealerSocket) dealerSocket.emit('yourHand', room.hands[room.dealer]);

            io.to(roomId).emit('updateGameState', room);
            checkAITurn(room);
            return;
        }

        // วนตาประมูลถัดไป
        room.bidTurn = (room.bidTurn + 1) % 4;
        io.to(roomId).emit('updateGameState', room);
        checkAITurn(room);
    });

    socket.on('selectTrump', ({ roomId, suit }) => {
        const room = rooms[roomId];
        if (!room || room.gameState !== 'SELECT_TRUMP') return;
        room.trumpSuit = suit;
        room.gameState = 'KITTY_DISCARD';
        io.to(roomId).emit('updateGameState', room);
        checkAITurn(room);
    });

    socket.on('confirmDiscard', ({ roomId, discardIndexes }) => {
        const room = rooms[roomId];
        if (!room || room.gameState !== 'KITTY_DISCARD') return;

        // นำไพ่ที่เลือกทิ้งลงใต้กอง Kitty
        let dealerHand = room.hands[room.dealer];
        discardIndexes.sort((a, b) => b - a);
        discardIndexes.forEach(idx => {
            room.kitty.push(dealerHand.splice(idx, 1)[0]);
        });

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

        if (playerSocket.id !== socket.id) return; // ไม่ใช่ตาตัวเอง

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
    room.teamAScore = 0;
    room.teamBScore = 0;
    room.teamACapturedCards = [];
    room.teamBCapturedCards = [];
    room.roundCount = 0;
    room.currentRoundCards = [null, null, null, null];

    // แจกไพ่คนละ 12 ใบ, หมอน 4 ใบ
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

    // ตรวจสอบกฎการลงตามดอก
    let playedCount = room.currentRoundCards.filter(c => c !== null).length;
    if (playedCount > 0) {
        let leadCard = room.currentRoundCards[room.starterPlayer];
        let hasLeadSuit = hand.some(c => c.suit === leadCard.suit);
        if (hasLeadSuit && card.suit !== leadCard.suit) {
            return; // ต้องลงดอกเดียวกันถ้ามี
        }
    }

    hand.splice(cardIndex, 1);
    room.currentRoundCards[seatIndex] = card;

    const player = room.seats[seatIndex];
    if (player && !player.isAI) {
        io.to(player.id).emit('yourHand', hand);
    }

    // ครบรอบ 4 ใบหรือยัง
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

    // คิดคะแนนรวมรอบนี้
    let roundPoints = 0;
    let pointCardsInRound = [];

    room.currentRoundCards.forEach(c => {
        let pts = calculateCardScore(c);
        roundPoints += pts;
        if (pts > 0) pointCardsInRound.push(c);
    });

    // บันทึกคะแนนและไพ่แต้มเข้าทีมผู้ชนะ
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
        // คิดคะแนนใต้มือ Kitty ในรอบสุดท้าย
        let kittyPoints = 0;
        let kittyPointCards = [];
        room.kitty.forEach(c => {
            let pts = calculateCardScore(c);
            kittyPoints += pts * 2; // คูณสอง
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
                
                // สุ่มเลือก 4 ใบที่ไม่มีแต้ม
                nonPointIndexes.sort(() => Math.random() - 0.5);
                let toDiscard = nonPointIndexes.slice(0, 4).sort((a, b) => b - a);

                toDiscard.forEach(idx => {
                    room.kitty.push(hand.splice(idx, 1)[0]);
                });

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
                let hand = room.hands[currentTurn];
                let playedCount = room.currentRoundCards.filter(c => c !== null).length;
                let validIndexes = [];

                if (playedCount === 0) {
                    validIndexes = hand.map((_, i) => i);
                } else {
                    let leadCard = room.currentRoundCards[room.starterPlayer];
                    hand.forEach((c, i) => {
                        if (c.suit === leadCard.suit) validIndexes.push(i);
                    });
                    if (validIndexes.length === 0) {
                        validIndexes = hand.map((_, i) => i);
                    }
                }

                let chosenIndex = validIndexes[Math.floor(Math.random() * validIndexes.length)];
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
        room.hands[room.dealer].push(...room.kitty);
        room.kitty = [];
        io.to(room.id).emit('updateGameState', room);
        checkAITurn(room);
        return;
    }

    room.bidTurn = (room.bidTurn + 1) % 4;
    io.to(room.id).emit('updateGameState', room);
    checkAITurn(room);
}

function sortCards(a, b) {
    if (CARD_RANKS[a.value] !== CARD_RANKS[b.value]) {
        return CARD_RANKS[b.value] - CARD_RANKS[a.value];
    }
    return a.suit.localeCompare(b.suit);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
