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

io.on('connection', (socket) => {
    socket.on('createRoom', (playerName) => {
        const roomId = Math.floor(1000 + Math.random() * 9000).toString();
        rooms[roomId] = {
            id: roomId,
            players: [{ id: socket.id, name: playerName, seat: 0 }],
            gameState: 'WAITING',
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
        socket.join(roomId);
        socket.emit('roomCreated', { roomId, seat: 0 });
        io.to(roomId).emit('updateRoom', rooms[roomId]);
    });

    socket.on('joinRoom', ({ roomId, playerName }) => {
        const room = rooms[roomId];
        if (room && room.players.length < 4) {
            const seat = room.players.length;
            room.players.push({ id: socket.id, name: playerName, seat });
            socket.join(roomId);
            socket.emit('joinedSuccess', { roomId, seat });
            io.to(roomId).emit('updateRoom', room);

            if (room.players.length === 4) {
                startGame(roomId);
            }
        } else {
            socket.emit('errorMessage', 'ห้องเต็มหรือไม่มีอยู่จริง!');
        }
    });

    socket.on('submitBid', ({ roomId, bidValue, isPass }) => {
        const room = rooms[roomId];
        if (!room || room.gameState !== 'BIDDING') return;

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
    });

    socket.on('selectTrump', ({ roomId, suit }) => {
        const room = rooms[roomId];
        if (!room || room.gameState !== 'SELECT_TRUMP') return;

        let dealerSocketId = room.players[room.dealer].id;
        if (socket.id !== dealerSocketId) return;

        room.trumpSuit = suit;
        
        room.hands[dealerSocketId] = [...room.hands[dealerSocketId], ...room.kitty];
        room.kitty = [];
        sortHand(room.hands[dealerSocketId]);

        room.gameState = 'KITTY_DISCARD';
        io.to(roomId).emit('updateGameState', room);
        io.to(dealerSocketId).emit('yourHand', room.hands[dealerSocketId]);
    });

    socket.on('confirmDiscard', ({ roomId, discardIndexes }) => {
        const room = rooms[roomId];
        if (!room || room.gameState !== 'KITTY_DISCARD') return;

        let dealerSocketId = room.players[room.dealer].id;
        if (socket.id !== dealerSocketId || discardIndexes.length !== 4) return;

        discardIndexes.sort((a, b) => b - a);
        discardIndexes.forEach(idx => {
            let card = room.hands[dealerSocketId].splice(idx, 1)[0];
            room.kitty.push(card);
        });

        room.gameState = 'PLAYING';
        room.starterPlayer = room.dealer;
        io.to(roomId).emit('updateGameState', room);
        io.to(dealerSocketId).emit('yourHand', room.hands[dealerSocketId]);
    });

    // ออกไพ่พร้อมระบบเช็กตามดอก (Follow Suit)
    socket.on('playCard', ({ roomId, cardIndex }) => {
        const room = rooms[roomId];
        if (!room || room.gameState !== 'PLAYING') return;

        let currentSeat = room.players.find(p => p.id === socket.id).seat;
        let playedCount = room.currentRoundCards.filter(c => c !== null).length;
        let expectedTurn = (room.starterPlayer + playedCount) % 4;

        if (currentSeat !== expectedTurn || room.currentRoundCards[currentSeat] !== null) {
            return;
        }

        let playerHand = room.hands[socket.id];
        let chosenCard = playerHand[cardIndex];

        // ตรวจสอบกฎ Follow Suit
        if (playedCount > 0) {
            let leadCard = room.currentRoundCards[room.starterPlayer];
            let hasLeadSuit = playerHand.some(card => card.suit === leadCard.suit);

            // ถ้ามีดอกเดียวกับคนแรก แต่พยายามจะออกดอกอื่น ให้ส่งข้อความเตือนกลับไป
            if (hasLeadSuit && chosenCard.suit !== leadCard.suit) {
                socket.emit('errorMessage', `คุณต้องออกไพ่ดอก ${leadCard.suit} ตามคนแรกก่อนครับ!`);
                return;
            }
        }

        let playedCard = playerHand.splice(cardIndex, 1)[0];
        room.currentRoundCards[currentSeat] = playedCard;

        socket.emit('yourHand', sortHand(playerHand));
        io.to(roomId).emit('updateGameState', room);

        if (room.currentRoundCards.filter(c => c !== null).length === 4) {
            setTimeout(() => { evaluateRound(roomId); }, 2500);
        }
    });
});

function startGame(roomId) {
    const room = rooms[roomId];
    room.gameState = 'BIDDING';
    room.deck = createDeck();
    
    room.players.forEach(p => {
        let hand = room.deck.splice(0, 12);
        room.hands[p.id] = sortHand(hand);
        io.to(p.id).emit('yourHand', room.hands[p.id]);
    });

    room.kitty = room.deck;
    io.to(roomId).emit('updateGameState', room);
}

function endBidding(roomId, winnerSeat, forceScore = null) {
    const room = rooms[roomId];
    if (forceScore) room.highestBid = forceScore;
    room.dealer = winnerSeat;

    room.gameState = 'SELECT_TRUMP';
    io.to(roomId).emit('updateGameState', room);
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

    let firstPlayerHand = room.hands[room.players[0].id];
    if (firstPlayerHand.length === 0) {
        room.gameState = 'END';
    }

    io.to(roomId).emit('updateGameState', room);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Yao Zi Fen Server Running on port ' + PORT));
