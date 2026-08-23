const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

app.use(express.static(__dirname));

const SUITS = ['♠', '♥️', '♣', '♦️'];
const VALUES = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];

const VALUE_RANK = {
    'A': 14, 'K': 13, 'Q': 12, 'J': 11, '10': 10,
    '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2
};

let rooms = {};

function createDeck() {
    let deck = [];
    for (let suit of SUITS) {
        for (let value of VALUES) {
            deck.push({ suit, value });
        }
    }
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

function sortHand(hand) {
    return hand.sort((a, b) => {
        if (a.suit !== b.suit) {
            return SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
        }
        return VALUE_RANK[b.value] - VALUE_RANK[a.value];
    });
}

function createRoomObject(roomId) {
    return {
        id: roomId,
        seats: [null, null, null, null],
        gameState: 'LOBBY',
        deck: [],
        hands: {},
        kitty: [],
        highestBid: 60,
        dealer: -1,
        trumpSuit: '',
        bidTurn: 0,
        initialBidder: 0, // จำคนเริ่มประมูลคนแรก
        playerPassed: [false, false, false, false],
        starterPlayer: 0,
        currentRoundCards: [null, null, null, null],
        teamAScore: 0,
        teamBScore: 0
    };
}

function resetRoomState(room) {
    room.gameState = 'LOBBY';
    room.deck = [];
    room.hands = {};
    room.kitty = [];
    room.highestBid = 60;
    room.dealer = -1;
    room.trumpSuit = '';
    
    // สลับคนเริ่มประมูลคนแรกในเกมถัดไป
    if (room.initialBidder === undefined) {
        room.initialBidder = 0;
    } else {
        room.initialBidder = (room.initialBidder + 1) % 4;
    }
    room.bidTurn = room.initialBidder;

    room.playerPassed = [false, false, false, false];
    room.currentRoundCards = [null, null, null, null];
    room.starterPlayer = 0;
    room.teamAScore = 0;
    room.teamBScore = 0;
}

function startGame(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    room.gameState = 'BIDDING';
    room.deck = createDeck();
    
    // ตั้งค่าคนเริ่มประมูลตามรอบ
    if (room.initialBidder === undefined) room.initialBidder = 0;
    room.bidTurn = room.initialBidder;

    room.playerPassed = [false, false, false, false];
    room.highestBid = 60;
    room.teamAScore = 0;
    room.teamBScore = 0;
    room.currentRoundCards = [null, null, null, null];

    room.seats.forEach(p => {
        if (p) {
            let hand = room.deck.splice(0, 12);
            room.hands[p.id] = sortHand(hand);
            if (!p.isAi) {
                io.to(p.id).emit('yourHand', room.hands[p.id]);
            }
        }
    });

    room.kitty = room.deck;
    io.to(roomId).emit('updateRoom', room);
    io.to(roomId).emit('updateGameState', room);

    checkAiTurn(roomId);
}

function handleBid(roomId, playerId, bidValue, isPass) {
    const room = rooms[roomId];
    if (!room || room.gameState !== 'BIDDING') return;

    let playerSeat = room.seats.findIndex(s => s && s.id === playerId);
    if (playerSeat !== room.bidTurn) return;

    if (isPass) {
        room.playerPassed[playerSeat] = true;
    } else {
        if (bidValue > room.highestBid && bidValue <= 100) {
            room.highestBid = bidValue;
            room.dealer = playerSeat;
        }
    }

    let activePlayers = room.playerPassed.filter(p => !p).length;
    if (activePlayers === 1 && room.dealer !== -1) {
        room.gameState = 'SELECT_TRUMP';
        let dealerPlayer = room.seats[room.dealer];
        
        room.hands[dealerPlayer.id] = sortHand([...room.hands[dealerPlayer.id], ...room.kitty]);
        if (!dealerPlayer.isAi) {
            io.to(dealerPlayer.id).emit('yourHand', room.hands[dealerPlayer.id]);
        }
    } else if (activePlayers === 0) {
        startGame(roomId);
        return;
    } else {
        do {
            room.bidTurn = (room.bidTurn + 1) % 4;
        } while (room.playerPassed[room.bidTurn]);
    }

    io.to(roomId).emit('updateGameState', room);
    checkAiTurn(roomId);
}

function checkAiTurn(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    setTimeout(() => {
        if (room.gameState === 'BIDDING') {
            let p = room.seats[room.bidTurn];
            if (p && p.isAi) {
                let aiHand = room.hands[p.id] || [];
                let highCards = aiHand.filter(c => VALUE_RANK[c.value] >= 12).length;
                
                let targetBid = 0;
                if (highCards >= 6) targetBid = 85;
                else if (highCards === 5) targetBid = 75;
                else if (highCards === 4) targetBid = 65;

                if (targetBid > room.highestBid && targetBid <= 100) {
                    handleBid(roomId, p.id, targetBid, false);
                } else if (room.highestBid < 65 && highCards >= 4) {
                    handleBid(roomId, p.id, 65, false);
                } else {
                    handleBid(roomId, p.id, 0, true);
                }
            }
        } else if (room.gameState === 'SELECT_TRUMP') {
            let p = room.seats[room.dealer];
            if (p && p.isAi) {
                let aiHand = room.hands[p.id] || [];
                let suitCounts = {};
                SUITS.forEach(s => suitCounts[s] = 0);
                aiHand.forEach(c => suitCounts[c.suit]++);
                let bestSuit = SUITS.reduce((a, b) => suitCounts[a] > suitCounts[b] ? a : b);
                
                room.trumpSuit = bestSuit;
                room.gameState = 'KITTY_DISCARD';
                io.to(roomId).emit('updateGameState', room);
                checkAiTurn(roomId);
            }
        } else if (room.gameState === 'KITTY_DISCARD') {
            let p = room.seats[room.dealer];
            if (p && p.isAi) {
                let aiHand = [...room.hands[p.id]];
                let validToDiscard = aiHand.filter(c => !['A', '10', '5'].includes(c.value));
                validToDiscard.sort((a, b) => VALUE_RANK[a.value] - VALUE_RANK[b.value]);
                
                let discarded = validToDiscard.slice(0, 4);
                discarded.forEach(card => {
                    let idx = aiHand.findIndex(c => c.suit === card.suit && c.value === card.value);
                    if (idx !== -1) aiHand.splice(idx, 1);
                });

                room.hands[p.id] = sortHand(aiHand);
                room.starterPlayer = room.dealer;
                room.gameState = 'PLAYING';
                io.to(roomId).emit('updateGameState', room);
                checkAiTurn(roomId);
            }
        } else if (room.gameState === 'PLAYING') {
            let playedCount = room.currentRoundCards.filter(c => c !== null).length;
            let currentTurn = (room.starterPlayer + playedCount) % 4;
            let p = room.seats[currentTurn];

            if (p && p.isAi) {
                let aiHand = room.hands[p.id] || [];
                let playableCardIndex = 0;

                if (playedCount > 0) {
                    let leadCard = room.currentRoundCards[room.starterPlayer];
                    let sameSuitCards = aiHand.map((c, idx) => ({ ...c, idx })).filter(c => c.suit === leadCard.suit);
                    if (sameSuitCards.length > 0) {
                        playableCardIndex = sameSuitCards[0].idx;
                    }
                }

                playCard(roomId, p.id, playableCardIndex);
            }
        }
    }, 1000);
}

function playCard(roomId, playerId, cardIndex) {
    const room = rooms[roomId];
    if (!room || room.gameState !== 'PLAYING') return;

    let playedCount = room.currentRoundCards.filter(c => c !== null).length;
    let currentTurn = (room.starterPlayer + playedCount) % 4;

    let playerSeat = room.seats.findIndex(s => s && s.id === playerId);
    if (playerSeat !== currentTurn) return;

    let hand = room.hands[playerId];
    if (!hand || !hand[cardIndex]) return;

    if (playedCount > 0) {
        let leadCard = room.currentRoundCards[room.starterPlayer];
        let hasSameSuit = hand.some(c => c.suit === leadCard.suit);
        if (hasSameSuit && hand[cardIndex].suit !== leadCard.suit) {
            if (!room.seats[playerSeat].isAi) {
                io.to(playerId).emit('errorMessage', `คุณต้องออกไพ่ดอก ${leadCard.suit} ตามกฎ`);
            }
            return;
        }
    }

    let playedCard = hand.splice(cardIndex, 1)[0];
    room.currentRoundCards[playerSeat] = playedCard;

    if (!room.seats[playerSeat].isAi) {
        io.to(playerId).emit('yourHand', hand);
    }

    io.to(roomId).emit('updateGameState', room);

    if (room.currentRoundCards.filter(c => c !== null).length === 4) {
        setTimeout(() => evaluateRound(roomId), 1500);
    } else {
        checkAiTurn(roomId);
    }
}

function evaluateRound(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    let leadCard = room.currentRoundCards[room.starterPlayer];
    let winningSeat = room.starterPlayer;
    let winningCard = leadCard;

    for (let i = 0; i < 4; i++) {
        let card = room.currentRoundCards[i];
        if (!card) continue;

        let isWinningTrump = card.suit === room.trumpSuit && winningCard.suit !== room.trumpSuit;
        let isHigherTrump = card.suit === room.trumpSuit && winningCard.suit === room.trumpSuit && VALUE_RANK[card.value] > VALUE_RANK[winningCard.value];
        let isHigherLead = card.suit === leadCard.suit && winningCard.suit === leadCard.suit && VALUE_RANK[card.value] > VALUE_RANK[winningCard.value];

        if (isWinningTrump || isHigherTrump || isHigherLead) {
            winningSeat = i;
            winningCard = card;
        }
    }

    let roundPoints = 0;
    room.currentRoundCards.forEach(card => {
        if (card.value === '5') roundPoints += 5;
        if (card.value === '10' || card.value === 'K') roundPoints += 10;
    });

    if (winningSeat === 0 || winningSeat === 2) {
        room.teamAScore += roundPoints;
    } else {
        room.teamBScore += roundPoints;
    }

    room.starterPlayer = winningSeat;
    room.currentRoundCards = [null, null, null, null];

    let firstPlayerHand = room.hands[room.seats[0].id];
    if (!firstPlayerHand || firstPlayerHand.length === 0) {
        room.gameState = 'END';
    }

    io.to(roomId).emit('updateGameState', room);

    if (room.gameState === 'PLAYING') {
        checkAiTurn(roomId);
    }
}

io.on('connection', (socket) => {
    socket.on('createRoom', (playerName) => {
        let roomId = Math.floor(1000 + Math.random() * 9000).toString();
        let room = createRoomObject(roomId);
        room.seats[0] = { id: socket.id, name: playerName, seat: 0, isAi: false };
        rooms[roomId] = room;
        socket.join(roomId);
        socket.emit('roomCreated', { roomId, seat: 0 });
        io.to(roomId).emit('updateRoom', room);
    });

    socket.on('createSinglePlayer', (playerName) => {
        let roomId = Math.floor(1000 + Math.random() * 9000).toString();
        let room = createRoomObject(roomId);
        room.seats[0] = { id: socket.id, name: playerName, seat: 0, isAi: false };
        room.seats[1] = { id: 'bot_1', name: 'บอท 1 (ทีม B)', seat: 1, isAi: true };
        room.seats[2] = { id: 'bot_2', name: 'บอท 2 (ทีม A)', seat: 2, isAi: true };
        room.seats[3] = { id: 'bot_3', name: 'บอท 3 (ทีม B)', seat: 3, isAi: true };
        rooms[roomId] = room;
        socket.join(roomId);
        socket.emit('roomCreated', { roomId, seat: 0 });
        io.to(roomId).emit('updateRoom', room);
    });

    socket.on('joinRoom', ({ roomId, playerName }) => {
        let room = rooms[roomId];
        if (!room) return socket.emit('errorMessage', 'ไม่พบรหัสห้องนี้');
        
        let emptySeat = room.seats.findIndex(s => s === null);
        if (emptySeat === -1) return socket.emit('errorMessage', 'ห้องเต็มแล้ว');

        room.seats[emptySeat] = { id: socket.id, name: playerName, seat: emptySeat, isAi: false };
        socket.join(roomId);
        socket.emit('joinedSuccess', { roomId, seat: emptySeat });
        io.to(roomId).emit('updateRoom', room);
    });

    socket.on('changeSeat', ({ roomId, targetSeat }) => {
        let room = rooms[roomId];
        if (!room || room.gameState !== 'LOBBY') return;
        if (room.seats[targetSeat] !== null) return;

        let currentSeat = room.seats.findIndex(s => s && s.id === socket.id);
        if (currentSeat !== -1) {
            let p = room.seats[currentSeat];
            p.seat = targetSeat;
            room.seats[currentSeat] = null;
            room.seats[targetSeat] = p;
            io.to(roomId).emit('updateRoom', room);
        }
    });

    socket.on('fillAI', ({ roomId }) => {
        let room = rooms[roomId];
        if (!room || room.gameState !== 'LOBBY') return;
        
        let aiCounter = 1;
        for (let i = 0; i < 4; i++) {
            if (room.seats[i] === null) {
                let teamName = (i === 0 || i === 2) ? 'A' : 'B';
                room.seats[i] = { id: `bot_${i}_${Date.now()}`, name: `บอท ${aiCounter++} (ทีม ${teamName})`, seat: i, isAi: true };
            }
        }
        io.to(roomId).emit('updateRoom', room);
    });

    socket.on('startGameReq', ({ roomId }) => {
        let room = rooms[roomId];
        if (!room) return;
        let filledSeats = room.seats.filter(s => s !== null).length;
        if (filledSeats < 4) return socket.emit('errorMessage', 'ต้องมีผู้เล่นครบ 4 คน/บอท ก่อนเริ่มเกม');
        startGame(roomId);
    });

    socket.on('restartGameReq', ({ roomId }) => {
        let room = rooms[roomId];
        if (!room) return;
        resetRoomState(room);
        startGame(roomId);
    });

    socket.on('submitBid', ({ roomId, bidValue, isPass }) => {
        handleBid(roomId, socket.id, bidValue, isPass);
    });

    socket.on('selectTrump', ({ roomId, suit }) => {
        let room = rooms[roomId];
        if (!room) return;
        room.trumpSuit = suit;
        room.gameState = 'KITTY_DISCARD';
        io.to(roomId).emit('updateGameState', room);
        checkAiTurn(roomId);
    });

    socket.on('confirmDiscard', ({ roomId, discardIndexes }) => {
        let room = rooms[roomId];
        if (!room || room.gameState !== 'KITTY_DISCARD') return;

        let hand = room.hands[socket.id];
        discardIndexes.sort((a, b) => b - a);
        discardIndexes.forEach(idx => hand.splice(idx, 1));

        room.hands[socket.id] = sortHand(hand);
        io.to(socket.id).emit('yourHand', room.hands[socket.id]);

        room.starterPlayer = room.dealer;
        room.gameState = 'PLAYING';
        io.to(roomId).emit('updateGameState', room);
        checkAiTurn(roomId);
    });

    socket.on('playCard', ({ roomId, cardIndex }) => {
        playCard(roomId, socket.id, cardIndex);
    });

    socket.on('disconnect', () => {
        for (let roomId in rooms) {
            let room = rooms[roomId];
            let seatIdx = room.seats.findIndex(s => s && s.id === socket.id);
            if (seatIdx !== -1) {
                room.seats[seatIdx] = null;
                io.to(roomId).emit('updateRoom', room);
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
