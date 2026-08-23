const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const SUITS = ['♠', '♥️', '♣', '♦️'];
const VALUES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SCORE_MAP = { '5': 5, '10': 10, 'A': 10 };
const VALUE_RANK = { '2':2, '3':3, '4':4, '5':5, '6':6, '7':7, '8':8, '9':9, '10':10, 'J':11, 'Q':12, 'K':13, 'A':14 };
const SUIT_RANK = { '♠': 0, '♥️': 1, '♣': 2, '♦️': 3 };

const rooms = {};

function createDeck() {
    let deck = [];
    for (let suit of SUITS) {
        for (let val of VALUES) {
            deck.push({ suit, value: val, points: SCORE_MAP[val] || 0 });
        }
    }
    return deck.sort(() => Math.random() - 0.5);
}

function sortHand(hand) {
    return hand.sort((a, b) => {
        if (a.suit !== b.suit) {
            return SUIT_RANK[a.suit] - SUIT_RANK[b.suit];
        }
        return VALUE_RANK[a.value] - VALUE_RANK[b.value];
    });
}

function autoFillAiInRoom(room) {
    let aiCount = 1;
    for (let i = 0; i < 4; i++) {
        if (room.seats[i] === null) {
            room.seats[i] = {
                id: `ai_${i}_${Date.now()}`,
                name: `BOT สมชาย ${aiCount++}`,
                seat: i,
                isAi: true
            };
        }
    }
}

io.on('connection', (socket) => {
    // สร้างห้องปกติ
    socket.on('createRoom', (playerName) => {
        const roomId = Math.floor(1000 + Math.random() * 9000).toString();
        rooms[roomId] = {
            id: roomId,
            hostId: socket.id,
            seats: [null, null, null, null],
            gameState: 'LOBBY',
            deck: [],
            hands: {},
            kitty: [],
            highestBid: 60,
            dealer: -1,
            trumpSuit: '',
            teamAScore: 0,
            teamBScore: 0,
            bidTurn: 0,
            playerPassed: [false, false, false, false],
            currentRoundCards: [null, null, null, null],
            starterPlayer: 0
        };

        rooms[roomId].seats[0] = { id: socket.id, name: playerName, seat: 0, isAi: false };
        socket.join(roomId);
        socket.emit('roomCreated', { roomId, seat: 0 });
        io.to(roomId).emit('updateRoom', rooms[roomId]);
    });

    // สร้างห้องสำหรับเล่นคนเดียวกับ AI 3 ตัว
    socket.on('createSinglePlayer', (playerName) => {
        const roomId = Math.floor(1000 + Math.random() * 9000).toString();
        rooms[roomId] = {
            id: roomId,
            hostId: socket.id,
            seats: [null, null, null, null],
            gameState: 'LOBBY',
            deck: [],
            hands: {},
            kitty: [],
            highestBid: 60,
            dealer: -1,
            trumpSuit: '',
            teamAScore: 0,
            teamBScore: 0,
            bidTurn: 0,
            playerPassed: [false, false, false, false],
            currentRoundCards: [null, null, null, null],
            starterPlayer: 0
        };

        rooms[roomId].seats[0] = { id: socket.id, name: playerName, seat: 0, isAi: false };
        autoFillAiInRoom(rooms[roomId]);
        
        socket.join(roomId);
        socket.emit('roomCreated', { roomId, seat: 0 });
        io.to(roomId).emit('updateRoom', rooms[roomId]);

        // เริ่มเกมอัตโนมัติทันที
        startGame(roomId);
    });

    // เข้าห้อง
    socket.on('joinRoom', ({ roomId, playerName }) => {
        const room = rooms[roomId];
        if (!room) return socket.emit('errorMessage', 'ไม่พบห้องนี้!');
        if (room.gameState !== 'LOBBY') return socket.emit('errorMessage', 'เกมเริ่มไปแล้ว!');

        let emptySeat = room.seats.findIndex(s => s === null);
        if (emptySeat === -1) return socket.emit('errorMessage', 'ห้องเต็มแล้ว!');

        room.seats[emptySeat] = { id: socket.id, name: playerName, seat: emptySeat, isAi: false };
        socket.join(roomId);
        socket.emit('joinedSuccess', { roomId, seat: emptySeat });
        io.to(roomId).emit('updateRoom', room);
    });

    // สลับเก้าอี้
    socket.on('changeSeat', ({ roomId, targetSeat }) => {
        const room = rooms[roomId];
        if (!room || room.gameState !== 'LOBBY') return;

        let currentSeat = room.seats.findIndex(s => s && s.id === socket.id);
        if (currentSeat !== -1 && room.seats[targetSeat] === null) {
            let player = room.seats[currentSeat];
            player.seat = targetSeat;
            room.seats[targetSeat] = player;
            room.seats[currentSeat] = null;
            io.to(roomId).emit('updateRoom', room);
        }
    });

    // เติม AI ในที่ว่าง
    socket.on('fillAI', ({ roomId }) => {
        const room = rooms[roomId];
        if (!room || room.gameState !== 'LOBBY') return;
        if (room.hostId !== socket.id) return socket.emit('errorMessage', 'เฉพาะหัวหน้าห้องเท่านั้นที่กดเติม AI ได้');

        autoFillAiInRoom(room);
        io.to(roomId).emit('updateRoom', room);
    });

    // เริ่มเกม (ถ้าที่ว่างอยู่จะเติม AI ให้อัตโนมัติ)
    socket.on('startGameReq', ({ roomId }) => {
        const room = rooms[roomId];
        if (!room || room.gameState !== 'LOBBY') return;

        // ถ้ายังมีช่องว่าง เติม AI ให้อัตโนมัติจนครบ 4
        autoFillAiInRoom(room);
        io.to(roomId).emit('updateRoom', room);

        startGame(roomId);
    });

    socket.on('submitBid', ({ roomId, bidValue, isPass }) => {
        handleBid(roomId, socket.id, bidValue, isPass);
    });

    socket.on('selectTrump', ({ roomId, suit }) => {
        handleTrumpSelection(roomId, socket.id, suit);
    });

    socket.on('confirmDiscard', ({ roomId, discardIndexes }) => {
        handleDiscard(roomId, socket.id, discardIndexes);
    });

    socket.on('playCard', ({ roomId, cardIndex }) => {
        handlePlayCard(roomId, socket.id, cardIndex);
    });
});

function startGame(roomId) {
    const room = rooms[roomId];
    room.gameState = 'BIDDING';
    room.deck = createDeck();
    
    room.seats.forEach(p => {
        let hand = room.deck.splice(0, 12);
        room.hands[p.id] = sortHand(hand);
        if (!p.isAi) {
            io.to(p.id).emit('yourHand', room.hands[p.id]);
        }
    });

    room.kitty = room.deck;
    io.to(roomId).emit('updateGameState', room);

    checkAiTurn(roomId);
}

function handleBid(roomId, playerSocketId, bidValue, isPass) {
    const room = rooms[roomId];
    if (!room || room.gameState !== 'BIDDING') return;

    let currentTurnPlayer = room.seats[room.bidTurn];
    if (currentTurnPlayer.id !== playerSocketId) return;

    if (isPass) {
        room.playerPassed[room.bidTurn] = true;
    } else {
        room.highestBid = bidValue;
        room.dealer = room.bidTurn;
    }

    let activeCount = room.playerPassed.filter(p => !p).length;

    if (activeCount === 1 && room.highestBid > 60) {
        endBidding(roomId, room.playerPassed.findIndex(p => !p));
        return;
    }

    if (activeCount === 0) {
        endBidding(roomId, Math.floor(Math.random() * 4), 65);
        return;
    }

    do {
        room.bidTurn = (room.bidTurn + 1) % 4;
    } while (room.playerPassed[room.bidTurn]);

    io.to(roomId).emit('updateGameState', room);
    checkAiTurn(roomId);
}

function endBidding(roomId, winnerSeat, forceScore = null) {
    const room = rooms[roomId];
    if (forceScore) room.highestBid = forceScore;
    room.dealer = winnerSeat;
    room.gameState = 'SELECT_TRUMP';
    io.to(roomId).emit('updateGameState', room);

    checkAiTurn(roomId);
}

function handleTrumpSelection(roomId, playerSocketId, suit) {
    const room = rooms[roomId];
    if (!room || room.gameState !== 'SELECT_TRUMP') return;

    let dealerPlayer = room.seats[room.dealer];
    if (dealerPlayer.id !== playerSocketId) return;

    room.trumpSuit = suit;
    room.hands[dealerPlayer.id] = [...room.hands[dealerPlayer.id], ...room.kitty];
    room.kitty = [];
    sortHand(room.hands[dealerPlayer.id]);

    room.gameState = 'KITTY_DISCARD';
    io.to(roomId).emit('updateGameState', room);

    if (!dealerPlayer.isAi) {
        io.to(dealerPlayer.id).emit('yourHand', room.hands[dealerPlayer.id]);
    }

    checkAiTurn(roomId);
}

function handleDiscard(roomId, playerSocketId, discardIndexes) {
    const room = rooms[roomId];
    if (!room || room.gameState !== 'KITTY_DISCARD') return;

    let dealerPlayer = room.seats[room.dealer];
    if (dealerPlayer.id !== playerSocketId || discardIndexes.length !== 4) return;

    discardIndexes.sort((a, b) => b - a);
    discardIndexes.forEach(idx => {
        let card = room.hands[dealerPlayer.id].splice(idx, 1)[0];
        room.kitty.push(card);
    });

    room.gameState = 'PLAYING';
    room.starterPlayer = room.dealer;
    io.to(roomId).emit('updateGameState', room);

    if (!dealerPlayer.isAi) {
        io.to(dealerPlayer.id).emit('yourHand', room.hands[dealerPlayer.id]);
    }

    checkAiTurn(roomId);
}

function handlePlayCard(roomId, playerSocketId, cardIndex) {
    const room = rooms[roomId];
    if (!room || room.gameState !== 'PLAYING') return;

    let currentSeat = room.seats.findIndex(s => s && s.id === playerSocketId);
    let playedCount = room.currentRoundCards.filter(c => c !== null).length;
    let expectedTurn = (room.starterPlayer + playedCount) % 4;

    if (currentSeat !== expectedTurn || room.currentRoundCards[currentSeat] !== null) return;

    let playerHand = room.hands[playerSocketId];
    let chosenCard = playerHand[cardIndex];

    if (playedCount > 0) {
        let leadCard = room.currentRoundCards[room.starterPlayer];
        let hasLeadSuit = playerHand.some(card => card.suit === leadCard.suit);

        if (hasLeadSuit && chosenCard.suit !== leadCard.suit) {
            if (!room.seats[currentSeat].isAi) {
                io.to(playerSocketId).emit('errorMessage', `คุณต้องออกไพ่ดอก ${leadCard.suit} ตามคนแรกก่อนครับ!`);
            }
            return;
        }
    }

    let playedCard = playerHand.splice(cardIndex, 1)[0];
    room.currentRoundCards[currentSeat] = playedCard;

    if (!room.seats[currentSeat].isAi) {
        io.to(playerSocketId).emit('yourHand', sortHand(playerHand));
    }

    io.to(roomId).emit('updateGameState', room);

    if (room.currentRoundCards.filter(c => c !== null).length === 4) {
        setTimeout(() => { evaluateRound(roomId); }, 2000);
    } else {
        checkAiTurn(roomId);
    }
}

function evaluateRound(roomId) {
    const room = rooms[roomId];
    let leadCard = room.currentRoundCards[room.starterPlayer];
    let winningPlayer = room.starterPlayer;
    let bestCard = leadCard;

    for (let i = 0; i < 4; i++) {
        if (i === room.starterPlayer) continue;
        let card = room.currentRoundCards[i];

        if (card.suit === room.trumpSuit && bestCard.suit !== room.trumpSuit) {
            bestCard = card;
            winningPlayer = i;
        } else if (card.suit === room.trumpSuit && bestCard.suit === room.trumpSuit) {
            if (VALUE_RANK[card.value] > VALUE_RANK[bestCard.value]) {
                bestCard = card;
                winningPlayer = i;
            }
        } else if (card.suit === leadCard.suit && bestCard.suit === leadCard.suit) {
            if (VALUE_RANK[card.value] > VALUE_RANK[bestCard.value]) {
                bestCard = card;
                winningPlayer = i;
            }
        }
    }

    let roundPoints = room.currentRoundCards.reduce((sum, c) => sum + c.points, 0);
    if (winningPlayer === 0 || winningPlayer === 2) {
        room.teamAScore += roundPoints;
    } else {
        room.teamBScore += roundPoints;
    }

    room.starterPlayer = winningPlayer;
    room.currentRoundCards = [null, null, null, null];

    let firstPlayerHand = room.hands[room.seats[0].id];
    if (firstPlayerHand.length === 0) {
        room.gameState = 'END';
    }

    io.to(roomId).emit('updateGameState', room);

    if (room.gameState !== 'END') {
        checkAiTurn(roomId);
    }
}

function checkAiTurn(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    setTimeout(() => {
        if (room.gameState === 'BIDDING') {
            let p = room.seats[room.bidTurn];
            if (p && p.isAi) {
                let aiHand = room.hands[p.id];
                let highCards = aiHand.filter(c => VALUE_RANK[c.value] >= 12).length;
                let nextBid = room.highestBid === 60 ? 65 : room.highestBid + 5;

                if (highCards >= 4 && nextBid <= 75) {
                    handleBid(roomId, p.id, nextBid, false);
                } else {
                    handleBid(roomId, p.id, 0, true);
                }
            }
        } else if (room.gameState === 'SELECT_TRUMP') {
            let p = room.seats[room.dealer];
            if (p && p.isAi) {
                let aiHand = room.hands[p.id];
                let suitCounts = {};
                SUITS.forEach(s => suitCounts[s] = 0);
                aiHand.forEach(c => suitCounts[c.suit]++);
                let bestSuit = SUITS.reduce((a, b) => suitCounts[a] > suitCounts[b] ? a : b);

                handleTrumpSelection(roomId, p.id, bestSuit);
            }
        } else if (room.gameState === 'KITTY_DISCARD') {
            let p = room.seats[room.dealer];
            if (p && p.isAi) {
                let aiHand = room.hands[p.id];
                let validDiscardIndexes = [];
                aiHand.forEach((c, idx) => {
                    if (!['A', '10', '5'].includes(c.value)) {
                        validDiscardIndexes.push({ idx, rank: VALUE_RANK[c.value] });
                    }
                });
                validDiscardIndexes.sort((a, b) => a.rank - b.rank);
                let toDiscard = validDiscardIndexes.slice(0, 4).map(v => v.idx);

                handleDiscard(roomId, p.id, toDiscard);
            }
        } else if (room.gameState === 'PLAYING') {
            let playedCount = room.currentRoundCards.filter(c => c !== null).length;
            let currentTurn = (room.starterPlayer + playedCount) % 4;
            let p = room.seats[currentTurn];

            if (p && p.isAi && room.currentRoundCards[currentTurn] === null) {
                let aiHand = room.hands[p.id];
                let chosenIndex = 0;

                if (playedCount === 0) {
                    chosenIndex = 0;
                } else {
                    let leadCard = room.currentRoundCards[room.starterPlayer];
                    let sameSuitIndexes = [];
                    aiHand.forEach((c, idx) => {
                        if (c.suit === leadCard.suit) sameSuitIndexes.push(idx);
                    });

                    if (sameSuitIndexes.length > 0) {
                        chosenIndex = sameSuitIndexes[0];
                    } else {
                        chosenIndex = 0;
                    }
                }

                handlePlayCard(roomId, p.id, chosenIndex);
            }
        }
    }, 1000);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Yao Zi Fen Server Running on port ' + PORT));
